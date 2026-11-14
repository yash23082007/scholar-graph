import {
  configuredModelCandidates,
  getModelRole,
} from './model-registry.js';

function preferredProvider() {
  const requested = process.env.AI_PROVIDER;
  if (
    (requested === 'groq' || requested === 'gemini') &&
    process.env[`${requested.toUpperCase()}_API_KEY`]
  )
    return requested;
  return configuredModelCandidates('answer')[0]?.provider || null;
}

function providerCandidates(requested, role) {
  const candidates = configuredModelCandidates(role, requested || null);
  const preferred = requested || preferredProvider();
  if (!preferred) return candidates;
  return [
    ...candidates.filter((candidate) => candidate.provider === preferred),
    ...candidates.filter((candidate) => candidate.provider !== preferred),
  ];
}

async function fetchJson(url, init, timeoutMs) {
  const configuredAttempts = Number.parseInt(process.env.PROVIDER_MAX_RETRIES || '2', 10);
  const attempts = Number.isInteger(configuredAttempts)
    ? Math.min(5, Math.max(1, configuredAttempts))
    : 2;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data;
      const status = response.status;
      const message = data?.error?.message || data?.message || `Provider returned HTTP ${status}.`;
      lastError = Object.assign(new Error(message), { status });
      if (!(status === 408 || status === 429 || status >= 500) || attempt === attempts - 1)
        throw lastError;
    } catch (error) {
      lastError = error;
      const retryable = !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
      if (!retryable || attempt === attempts - 1) throw error;
    } finally {
      clearTimeout(timeout);
    }
    const backoff = Math.min(4000, 250 * 2 ** attempt) + Math.floor(Math.random() * 150);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
  throw lastError || new Error('Provider request failed.');
}

export function configuredProviders() {
  const answerCandidates = configuredModelCandidates('answer');
  return {
    groq: Boolean(process.env.GROQ_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    preferred: preferredProvider(),
    fallbackOrder: answerCandidates.map((candidate) => candidate.provider),
  };
}

async function generateWithProvider({
  candidate,
  systemPrompt,
  userPrompt,
  temperature,
  maxOutputTokens,
  timeoutMs,
}) {
  const { provider, model } = candidate;
  const headers = { 'Content-Type': 'application/json' };
  if (provider === 'groq') {
    if (!process.env.GROQ_API_KEY) {
      throw Object.assign(new Error('GROQ_API_KEY is not configured.'), {
        code: 'PROVIDER_NOT_CONFIGURED',
      });
    }
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
    }, timeoutMs);
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('The Groq response did not contain text.');
    return { text: String(text), provider, model: data.model || model, usage: data.usage || null };
  }

  if (!process.env.GEMINI_API_KEY) {
    throw Object.assign(new Error('GEMINI_API_KEY is not configured.'), {
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { ...headers, 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature, maxOutputTokens },
    }),
  }, timeoutMs);
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
  role = 'answer',
  systemPrompt,
  userPrompt,
  temperature,
  maxOutputTokens,
}) {
  const roleConfig = getModelRole(role);
  const candidates = providerCandidates(requested, role);
  if (!candidates.length) {
    throw Object.assign(
      new Error(
        'No AI provider configured. Add GROQ_API_KEY or GEMINI_API_KEY to the server environment.',
      ),
      { code: 'NO_PROVIDER' },
    );
  }
  const resolvedTemperature = temperature ?? roleConfig.temperature ?? 0.2;
  const resolvedMaxOutputTokens = maxOutputTokens ?? roleConfig.max_output_tokens ?? 900;
  const timeoutMs = roleConfig.timeout_ms || Number(process.env.PROVIDER_TIMEOUT_MS || 45_000);
  let lastError;
  for (const candidate of candidates) {
    try {
      return await generateWithProvider({
        candidate,
        systemPrompt,
        userPrompt,
        temperature: resolvedTemperature,
        maxOutputTokens: resolvedMaxOutputTokens,
        timeoutMs,
      });
    } catch (error) {
      lastError = error;
      if (error.code === 'PROVIDER_NOT_CONFIGURED') throw error;
    }
  }
  throw lastError || new Error('All configured AI providers failed.');
}
