import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from '../server/providers/llm.js';
import { searchTavily } from '../server/providers/tavily.js';
import { searchCrossref, searchScholarly } from '../server/providers/scholarly.js';

test('Groq adapter keeps credentials in the server request and normalizes output', async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-server-secret';
  let request;
  global.fetch = async (url, init) => {
    request = { url, init };
    return new Response(
      JSON.stringify({
        model: 'fixture-model',
        choices: [{ message: { content: 'A sourced response [E1].' } }],
        usage: { prompt_tokens: 8, completion_tokens: 4 },
      }),
      { status: 200 },
    );
  };
  try {
    const result = await generateText({
      provider: 'groq',
      systemPrompt: 'system',
      userPrompt: 'question',
    });
    assert.equal(result.text, 'A sourced response [E1].');
    assert.equal(result.provider, 'groq');
    assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(request.init.headers.Authorization, 'Bearer test-server-secret');
    assert.equal(JSON.parse(request.init.body).messages[0].content, 'system');
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  }
});

test('Gemini adapter sends system instructions to generateContent', async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-secret';
  let request;
  global.fetch = async (url, init) => {
    request = { url, init };
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Gemini draft.' }] } }],
        usageMetadata: { promptTokenCount: 9 },
      }),
      { status: 200 },
    );
  };
  try {
    const result = await generateText({
      provider: 'gemini',
      systemPrompt: 'system role',
      userPrompt: 'question',
    });
    assert.equal(result.text, 'Gemini draft.');
    assert.equal(
      request.url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    assert.equal(request.init.headers['x-goog-api-key'], 'test-gemini-secret');
    assert.equal(JSON.parse(request.init.body).systemInstruction.parts[0].text, 'system role');
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});

test('AI provider selection falls back from unavailable Groq to Gemini', async () => {
  const oldFetch = global.fetch;
  const oldEnv = Object.fromEntries(
    ['AI_PROVIDER', 'GROQ_API_KEY', 'GEMINI_API_KEY'].map((key) => [key, process.env[key]]),
  );
  process.env.AI_PROVIDER = 'groq';
  process.env.GROQ_API_KEY = 'test-groq-secret';
  process.env.GEMINI_API_KEY = 'test-gemini-secret';
  let groqAttempts = 0;
  global.fetch = async (url) => {
    if (String(url).includes('groq.com')) {
      groqAttempts += 1;
      return new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
        status: 503,
      });
    }
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Fallback answer.' }] } }] }),
      { status: 200 },
    );
  };
  try {
    const result = await generateText({ systemPrompt: 'system', userPrompt: 'question' });
    assert.equal(groqAttempts, 2);
    assert.equal(result.provider, 'gemini');
    assert.equal(result.text, 'Fallback answer.');
  } finally {
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Tavily adapter preserves result provenance and filters non-web URLs', async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = 'test-tavily-secret';
  let request;
  global.fetch = async (url, init) => {
    request = { url, init };
    return new Response(
      JSON.stringify({
        results: [
          {
            title: 'Example source',
            url: 'https://example.org/paper',
            content: 'Evidence excerpt',
            score: 0.8,
          },
          { title: 'Bad URL', url: 'file:///tmp/private', content: 'No' },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const results = await searchTavily('research question');
    assert.equal(request.url, 'https://api.tavily.com/search');
    assert.equal(JSON.parse(request.init.body).query, 'research question');
    assert.equal(results.length, 1);
    assert.equal(results[0].sourceType, 'web_page_extract');
    assert.ok(results[0].retrievedAt);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = oldKey;
  }
});

test('Crossref retries transient failures, caches results and sends polite-pool contact', async () => {
  const oldFetch = global.fetch;
  const oldEnv = Object.fromEntries(
    ['CROSSREF_MAILTO', 'CROSSREF_MIN_INTERVAL_MS', 'SCHOLARLY_CACHE_TTL_MS'].map((key) => [
      key,
      process.env[key],
    ]),
  );
  process.env.CROSSREF_MAILTO = 'researcher@example.org';
  process.env.CROSSREF_MIN_INTERVAL_MS = '0';
  process.env.SCHOLARLY_CACHE_TTL_MS = '60000';
  let requestCount = 0;
  let requestUrl;
  let requestHeaders;
  global.fetch = async (url, init) => {
    requestCount += 1;
    requestUrl = new URL(url);
    requestHeaders = init.headers;
    if (requestCount === 1) return new Response('{}', { status: 503 });
    return new Response(
      JSON.stringify({
        message: {
          items: [
            {
              DOI: '10.1234/cache-test',
              title: ['Resilient scholarly search'],
              author: [{ given: 'Ari', family: 'Researcher' }],
              published: { 'date-parts': [[2024]] },
              abstract: '<jats:p>Cached abstract evidence.</jats:p>',
              URL: 'https://doi.org/10.1234/cache-test',
            },
          ],
        },
      }),
      { status: 200 },
    );
  };
  try {
    const query = `crossref reliability fixture ${Math.random()}`;
    const first = await searchCrossref(query);
    const second = await searchCrossref(query);
    assert.equal(requestCount, 2, 'one retry succeeds and the next lookup uses cache');
    assert.equal(requestUrl.searchParams.get('mailto'), 'researcher@example.org');
    assert.match(requestHeaders['User-Agent'], /mailto:researcher@example\.org/);
    assert.equal(first[0].contentCoverage, 'abstract_only');
    assert.match(first[0].text, /Cached abstract evidence/);
    assert.equal(second[0].doi, first[0].doi);
    assert.equal(second[0].text, first[0].text);
  } finally {
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('OpenAlex and Crossref records deduplicate across DOI URL and title variations', async () => {
  const oldFetch = global.fetch;
  const oldEnv = Object.fromEntries(
    ['CROSSREF_MIN_INTERVAL_MS', 'SCHOLARLY_CACHE_TTL_MS'].map((key) => [key, process.env[key]]),
  );
  process.env.CROSSREF_MIN_INTERVAL_MS = '0';
  process.env.SCHOLARLY_CACHE_TTL_MS = '0';
  global.fetch = async (url) => {
    if (String(url).includes('openalex.org')) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 'https://openalex.org/W1',
              doi: 'https://doi.org/10.5555/SHARED-DOI',
              title: 'Evidence: A Cross-Source Study',
              publication_year: 2024,
              abstract_inverted_index: { evidence: [0], across: [1], sources: [2] },
              authorships: [{ author: { display_name: 'Alex Scholar' } }],
              cited_by_count: 5,
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        message: {
          items: [
            {
              DOI: '10.5555/shared-doi',
              title: ['Evidence: A Cross-Source Study'],
              author: [{ given: 'Alex', family: 'Scholar' }],
              published: { 'date-parts': [[2024]] },
              URL: 'https://doi.org/10.5555/shared-doi',
            },
          ],
        },
      }),
      { status: 200 },
    );
  };
  try {
    const result = await searchScholarly(`dedup fixture ${Math.random()}`);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].sourceProvider, 'OpenAlex');
  } finally {
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
