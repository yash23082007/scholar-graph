const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function providerName(requested) {
  if (requested === 'groq' || requested === 'gemini') return requested;
  const preferred = process.env.AI_PROVIDER;
  if (preferred === 'groq' && process.env.GROQ_API_KEY) return preferred;
  if (preferred === 'gemini' && process.env.GEMINI_API_KEY) return preferred;
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}

function providerCandidates(requested) {
  if (requested === 'groq' || requested === 'gemini') return [requested];
  const preferred = providerName();
  const configured = ['groq', 'gemini'].filter((provider) =>
    Boolean(process.env[`${provider.toUpperCase()}_API_KEY`]),
  );
  return preferred
    ? [preferred, ...configured.filter((provider) => provider !== preferred)]
    : configured;
}

async function fetchJson(url, init, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (response.ok) return data;
        const status = response.status;
        const message =
          data?.error?.message || data?.message || `Provider returned HTTP ${status}.`;
        if (attempt === 0 && (status === 429 || status >= 500)) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          continue;
        }
        throw Object.assign(new Error(message), { status });
      } catch (error) {
        lastError = error;
        if (error.name === 'AbortError' || error.status || attempt > 0) throw error;
      }
    }
    throw lastError || new Error('Provider request failed.');
  } finally {
    clearTimeout(timeout);
  }
}

export function configuredProviders() {
  return {
    groq: Boolean(process.env.GROQ_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    preferred: providerName(),
    fallbackOrder: providerCandidates(),
  };
}

async function generateWithProvider({
  provider,
  systemPrompt,
  userPrompt,
  temperature,
  maxOutputTokens,
}) {
  const headers = { 'Content-Type': 'application/json' };
  if (provider === 'groq') {
    if (!process.env.GROQ_API_KEY) {
      throw Object.assign(new Error('GROQ_API_KEY is not configured.'), {
        code: 'PROVIDER_NOT_CONFIGURED',
      });
    }
    const model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
    const data = await fetchJson('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature,
        max_completion_tokens: maxOutputTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('The Groq response did not contain text.');
    return { text: String(text), provider, model: data.model || model, usage: data.usage || null };
  }

  if (!process.env.GEMINI_API_KEY) {
    throw Object.assign(new Error('GEMINI_API_KEY is not configured.'), {
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { ...headers, 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature, maxOutputTokens },
    }),
  });
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
  if (!text) throw new Error('The Gemini response did not contain text.');
  return {
    text: String(text),
    provider,
    model: data.modelVersion || model,
    usage: data.usageMetadata || null,
  };
}

export async function generateText({
  provider: requested,
  systemPrompt,
  userPrompt,
  temperature = 0.2,
  maxOutputTokens = 900,
}) {
  const candidates = providerCandidates(requested);
  if (!candidates.length) {
    throw Object.assign(
      new Error(
        'No AI provider configured. Add GROQ_API_KEY or GEMINI_API_KEY to the server environment.',
      ),
      { code: 'NO_PROVIDER' },
    );
  }
  let lastError;
  for (const provider of candidates) {
    try {
      return await generateWithProvider({
        provider,
        systemPrompt,
        userPrompt,
        temperature,
        maxOutputTokens,
      });
    } catch (error) {
      lastError = error;
      if (requested || error.code === 'PROVIDER_NOT_CONFIGURED') throw error;
    }
  }
  throw lastError || new Error('All configured AI providers failed.');
}
