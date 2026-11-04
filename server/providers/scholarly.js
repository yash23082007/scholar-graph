function reconstructAbstract(index) {
  if (!index || typeof index !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions || [])
      if (Number.isInteger(position) && position >= 0) words[position] = word;
  }
  return words.filter(Boolean).join(' ');
}

function plainText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function authorsFromOpenAlex(work) {
  return (work.authorships || [])
    .slice(0, 8)
    .map((entry) => entry.author?.display_name)
    .filter(Boolean);
}

const requestCache = new Map();
const maxCacheEntries = 500;
let crossrefRequests = Promise.resolve();
let lastCrossrefRequestAt = 0;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function cacheTtl() {
  return Math.max(0, Number(process.env.SCHOLARLY_CACHE_TTL_MS || 5 * 60 * 1000));
}

function retryDelay(error, attempt) {
  const retryAfter = Number(error.retryAfter);
  if (Number.isFinite(retryAfter) && retryAfter > 0)
    return Math.min(5000, Math.ceil(retryAfter * 1000));
  if (error.retryAt) return Math.min(5000, Math.max(0, error.retryAt - Date.now()));
  return Math.min(1600, 200 * 2 ** attempt);
}

function isRetryable(error) {
  return !error.status || error.status === 429 || error.status >= 500;
}

async function waitForCrossrefSlot() {
  const request = crossrefRequests.then(async () => {
    const minimumInterval = Math.max(0, Number(process.env.CROSSREF_MIN_INTERVAL_MS || 1000));
    const remaining = minimumInterval - (Date.now() - lastCrossrefRequestAt);
    if (remaining > 0) await wait(remaining);
    lastCrossrefRequestAt = Date.now();
  });
  crossrefRequests = request.catch(() => {});
  await request;
}

async function fetchJsonOnce(url, { timeoutMs, headers, beforeRequest }) {
  await beforeRequest?.();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`Scholarly source returned HTTP ${response.status}.`);
      error.status = response.status;
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds)) error.retryAfter = seconds;
        else {
          const retryAt = Date.parse(retryAfter);
          if (Number.isFinite(retryAt)) error.retryAt = retryAt;
        }
      }
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithRetry(url, { timeoutMs = 15000, headers = {}, beforeRequest } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchJsonOnce(url, { timeoutMs, headers, beforeRequest });
    } catch (error) {
      lastError = error;
      if (attempt === 2 || !isRetryable(error)) throw error;
      await wait(retryDelay(error, attempt));
    }
  }
  throw lastError || new Error('Scholarly source request failed.');
}

async function fetchJsonCached(url, options) {
  const ttl = cacheTtl();
  if (!ttl) return fetchJsonWithRetry(url, options);
  const key = String(url);
  const now = Date.now();
  const cached = requestCache.get(key);
  if (cached && (cached.pending || cached.expiresAt > now)) return cached.promise;
  if (cached) requestCache.delete(key);

  for (const [cacheKey, entry] of requestCache) {
    if (!entry.pending && entry.expiresAt <= now) requestCache.delete(cacheKey);
  }
  while (requestCache.size >= maxCacheEntries) {
    const oldestSettledKey = [...requestCache].find(([, entry]) => !entry.pending)?.[0];
    if (!oldestSettledKey) break;
    requestCache.delete(oldestSettledKey);
  }

  const promise = fetchJsonWithRetry(url, options).then(
    (data) => {
      const entry = requestCache.get(key);
      if (entry?.promise === promise) {
        entry.pending = false;
        entry.expiresAt = Date.now() + ttl;
      }
      return data;
    },
    (error) => {
      if (requestCache.get(key)?.promise === promise) requestCache.delete(key);
      throw error;
    },
  );
  requestCache.set(key, { expiresAt: 0, pending: true, promise });
  return promise;
}

export async function searchOpenAlex(query, limit = 5) {
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', query);
  url.searchParams.set('per-page', String(Math.min(limit, 5)));
  url.searchParams.set(
    'select',
    'id,doi,title,publication_year,abstract_inverted_index,authorships,cited_by_count,primary_location',
  );
  if (process.env.OPENALEX_API_KEY) url.searchParams.set('api_key', process.env.OPENALEX_API_KEY);
  const data = await fetchJsonCached(url);
  return (data.results || [])
    .map((work) => {
      const abstract = reconstructAbstract(work.abstract_inverted_index);
      const title = String(work.title || 'Untitled work');
      const authors = authorsFromOpenAlex(work);
      const doi = work.doi || null;
      const canonicalUrl = doi || work.id || null;
      const abstractText = abstract
        ? `Abstract: ${abstract}`
        : `Title: ${title}. Authors: ${authors.join(', ') || 'not listed'}. Publication year: ${work.publication_year || 'not listed'}.`;
      return {
        title,
        text: abstractText.slice(0, 4500),
        documentName: title,
        documentId: null,
        pageStart: null,
        sectionTitle: abstract ? 'Abstract' : 'Metadata record',
        url: canonicalUrl,
        doi,
        authors,
        publishedAt: work.publication_year ? String(work.publication_year) : null,
        citedByCount: Number(work.cited_by_count || 0),
        sourceType: 'academic_record',
        contentCoverage: abstract ? 'abstract_only' : 'metadata_only',
        retrievedAt: new Date().toISOString(),
        sourceProvider: 'OpenAlex',
      };
    })
    .filter((item) => item.title && item.text);
}

export async function searchCrossref(query, limit = 5) {
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('query.bibliographic', query);
  url.searchParams.set('rows', String(Math.min(limit, 5)));
  url.searchParams.set(
    'select',
    'DOI,title,author,published,created,type,container-title,abstract,URL',
  );
  const mailto = process.env.CROSSREF_MAILTO?.trim();
  if (mailto) url.searchParams.set('mailto', mailto);
  const userAgent = mailto
    ? `ScholarGraph/1.0 (mailto:${mailto})`
    : 'ScholarGraph/1.0 (research metadata client)';
  const data = await fetchJsonCached(url, {
    headers: { 'User-Agent': userAgent },
    beforeRequest: waitForCrossrefSlot,
  });
  return (data.message?.items || [])
    .map((work) => {
      const title = String(work.title?.[0] || 'Untitled work');
      const authors = (work.author || [])
        .slice(0, 8)
        .map((author) => [author.given, author.family].filter(Boolean).join(' '))
        .filter(Boolean);
      const doi = work.DOI ? `https://doi.org/${work.DOI}` : null;
      const abstract = plainText(work.abstract);
      const journal = work['container-title']?.[0] || '';
      const year =
        work.published?.['date-parts']?.[0]?.[0] || work.created?.['date-parts']?.[0]?.[0] || null;
      return {
        title,
        text: abstract
          ? `Abstract: ${abstract}`
          : `Title: ${title}. Authors: ${authors.join(', ') || 'not listed'}. Publication: ${journal || 'not listed'}. Year: ${year || 'not listed'}. DOI: ${work.DOI || 'not listed'}.`,
        documentName: title,
        documentId: null,
        pageStart: null,
        sectionTitle: abstract ? 'Abstract' : 'Metadata record',
        url: doi || work.URL || null,
        doi,
        authors,
        publishedAt: year ? String(year) : null,
        sourceType: 'academic_record',
        contentCoverage: abstract ? 'abstract_only' : 'metadata_only',
        retrievedAt: new Date().toISOString(),
        sourceProvider: 'Crossref',
      };
    })
    .filter((item) => item.title && item.text);
}

function normalizeDoi(value) {
  if (!value) return '';
  let doi = String(value).trim().toLowerCase();
  try {
    doi = decodeURIComponent(doi);
  } catch {}
  return doi
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '')
    .replace(/[\s.,;]+$/g, '');
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function dedupeScholarlySources(sources) {
  const seenKeys = new Set();
  const unique = [];
  for (const source of sources) {
    const doi = normalizeDoi(source.doi || source.url);
    const title = normalizeTitle(source.title);
    const keys = [doi && `doi:${doi}`, title && `title:${title}`].filter(Boolean);
    if (keys.some((key) => seenKeys.has(key))) continue;
    keys.forEach((key) => seenKeys.add(key));
    unique.push(source);
  }
  return unique;
}

export async function searchScholarly(query, limit = 5) {
  const [openAlex, crossref] = await Promise.allSettled([
    searchOpenAlex(query, limit),
    searchCrossref(query, limit),
  ]);
  const warnings = [];
  if (openAlex.status === 'rejected')
    warnings.push(`OpenAlex search failed: ${openAlex.reason?.message || 'request error'}`);
  if (crossref.status === 'rejected')
    warnings.push(`Crossref search failed: ${crossref.reason?.message || 'request error'}`);
  const sources = [
    ...(openAlex.status === 'fulfilled' ? openAlex.value : []),
    ...(crossref.status === 'fulfilled' ? crossref.value : []),
  ];
  return { sources: dedupeScholarlySources(sources), warnings };
}
