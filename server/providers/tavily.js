import { isPublicWebUrl } from '../security.js';

export async function searchTavily(query, { maxResults = 5, timeoutMs = 20000 } = {}) {
  if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: Math.min(maxResults, 5),
        include_raw_content: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Tavily returned HTTP ${response.status}.`);
    const data = await response.json();
    return (data.results || [])
      .map((result) => ({
        title: String(result.title || result.url || 'Web result').slice(0, 300),
        url: String(result.url || ''),
        content: String(result.content || '').slice(0, 5000),
        score: Number(result.score || 0),
        publishedAt: result.published_date || null,
        retrievedAt: new Date().toISOString(),
        sourceType: 'web_page_extract',
      }))
      .filter((result) => isPublicWebUrl(result.url) && result.content);
  } finally {
    clearTimeout(timeout);
  }
}
