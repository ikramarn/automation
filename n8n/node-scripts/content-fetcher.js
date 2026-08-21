/**
 * content-fetcher.js
 * Standalone logic for the Content_Fetcher n8n node.
 * Exported functions can be unit-tested independently of n8n.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score an article for relevance to a keyword.
 * Title matches are worth 3 points each; description/summary matches 1 point each.
 *
 * @param {{ title?: string, description?: string, summary?: string }} article
 * @param {string} keyword
 * @returns {number}
 */
function scoreArticle(article, keyword) {
  if (!keyword) return 0;

  const needle = keyword.toLowerCase();
  const title = (article.title || '').toLowerCase();
  const body = (article.description || article.summary || '').toLowerCase();

  // Count non-overlapping occurrences
  const countOccurrences = (haystack, needle) => {
    if (!needle) return 0;
    let count = 0;
    let pos = 0;
    while ((pos = haystack.indexOf(needle, pos)) !== -1) {
      count++;
      pos += needle.length;
    }
    return count;
  };

  const titleScore = countOccurrences(title, needle) * 3;
  const bodyScore = countOccurrences(body, needle);

  return titleScore + bodyScore;
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags and inline JavaScript from a string.
 * Also collapses excess whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
function sanitizeContent(text) {
  if (!text) return '';

  let result = text;

  // Remove <script>...</script> blocks (including multiline, case-insensitive)
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  // Remove <style>...</style> blocks
  result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove remaining HTML tags
  result = result.replace(/<[^>]*>/g, '');

  // Decode common HTML entities
  result = result
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Collapse whitespace
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Remove analytics tracking query parameters from a URL.
 * Strips: utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid
 *
 * @param {string} url
 * @returns {string}
 */
function stripTrackingParams(url) {
  if (!url) return '';

  const TRACKING_PARAMS = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'fbclid',
    'gclid',
  ]);

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // Not a valid absolute URL — return as-is
    return url;
  }

  const toDelete = [];
  for (const key of parsed.searchParams.keys()) {
    if (TRACKING_PARAMS.has(key)) {
      toDelete.push(key);
    }
  }
  for (const key of toDelete) {
    parsed.searchParams.delete(key);
  }

  return parsed.toString();
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Select the best article from a list based on keyword relevance.
 * Ties are broken by most recent publication timestamp.
 *
 * @param {Array<{ title?: string, description?: string, summary?: string, pubDate?: string|Date, publishedAt?: string|Date }>} articles
 * @param {string} keyword
 * @returns {object|null}
 */
function selectBestArticle(articles, keyword) {
  if (!articles || articles.length === 0) return null;

  const scored = articles.map((article) => ({
    article,
    score: scoreArticle(article, keyword),
    // Support both RSS (pubDate) and NewsAPI (publishedAt) timestamp fields
    timestamp: new Date(article.publishedAt || article.pubDate || 0).getTime(),
  }));

  // Sort: highest score first, then most recent timestamp
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.timestamp - a.timestamp;
  });

  return scored[0].article;
}

// ---------------------------------------------------------------------------
// HTTP helpers used inside n8n (not exported for testing)
// ---------------------------------------------------------------------------

/**
 * Fetch articles from NewsAPI within a time window.
 *
 * @param {string} keyword
 * @param {string} apiKey
 * @param {Date} from   - start of window (oldest)
 * @param {Date} to     - end of window (newest)
 * @param {Function} httpGet - injected HTTP function (e.g. $http.get in n8n)
 * @returns {Promise<Array>}
 */
async function fetchFromNewsApi(keyword, apiKey, from, to, httpGet) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const params = new URLSearchParams({
    q: keyword,
    from: fromIso,
    to: toIso,
    language: 'en',
    sortBy: 'publishedAt',
    pageSize: '20',
    apiKey,
  });

  const url = `https://newsapi.org/v2/everything?${params.toString()}`;
  const response = await httpGet(url);
  const data = typeof response === 'string' ? JSON.parse(response) : response;

  if (!data || !Array.isArray(data.articles)) return [];

  return data.articles.map((a) => ({
    title: a.title || '',
    description: a.description || '',
    summary: a.description || '',
    content: a.content || '',
    url: a.url || '',
    publishedAt: a.publishedAt || '',
  }));
}

/**
 * Fetch articles from Google News RSS within a time window.
 * Google News RSS does not support date filtering natively — we filter client-side.
 *
 * @param {string} keyword
 * @param {Date} from
 * @param {Function} httpGet
 * @returns {Promise<Array>}
 */
async function fetchFromGoogleNewsRss(keyword, from, httpGet) {
  const encodedKeyword = encodeURIComponent(keyword);
  const url = `https://news.google.com/rss/search?q=${encodedKeyword}&hl=en-US&gl=US&ceid=US:en`;
  const xmlText = await httpGet(url);

  const articles = parseRssFeed(xmlText, from);
  return articles;
}

/**
 * Minimal RSS XML parser — no external deps, safe for n8n code nodes.
 *
 * @param {string} xml
 * @param {Date} fromDate - only include items newer than this date
 * @returns {Array}
 */
function parseRssFeed(xml, fromDate) {
  if (!xml || typeof xml !== 'string') return [];

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const getTag = (tag) => {
      const tagRegex = new RegExp(`<${tag}(?:[^>]*)><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}(?:[^>]*)>([^<]*)<\\/${tag}>`, 'i');
      const m = tagRegex.exec(block);
      if (!m) return '';
      return (m[1] !== undefined ? m[1] : m[2] || '').trim();
    };

    const title = getTag('title');
    const link = getTag('link') || getTag('guid');
    const description = getTag('description');
    const pubDateStr = getTag('pubDate');

    let pubDate = null;
    if (pubDateStr) {
      pubDate = new Date(pubDateStr);
      if (isNaN(pubDate.getTime())) pubDate = null;
    }

    // Filter by date window
    if (fromDate && pubDate && pubDate < fromDate) continue;

    items.push({
      title,
      description: sanitizeContent(description),
      summary: sanitizeContent(description),
      content: '',
      url: link,
      publishedAt: pubDate ? pubDate.toISOString() : '',
      pubDate: pubDate ? pubDate.toISOString() : '',
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Main entry point — called from n8n Content_Fetcher node
// ---------------------------------------------------------------------------

/**
 * Run the full content-fetch pipeline.
 * Returns article data or throws an error with a standardized message.
 *
 * @param {object} ctx - n8n execution context object
 * @param {Function} httpGet - HTTP GET function (injected for testability)
 * @returns {Promise<{ article_title: string, article_summary: string, article_url: string, content_fetch_status: string }>}
 */
async function runContentFetcher(ctx, httpGet) {
  const keyword = ctx.niche_keyword || '';
  const newsApiKey = (ctx.credentials && ctx.credentials.newsapi_api_key) || '';
  const now = new Date();

  // --- 24-hour window ---
  const from24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  let articles = await fetchAllSources(keyword, newsApiKey, from24h, now, httpGet);

  // --- Extend to 72h if no results (Req 7.5) ---
  if (articles.length === 0) {
    const from72h = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    articles = await fetchAllSources(keyword, newsApiKey, from72h, now, httpGet);
  }

  // Still nothing → abort (Req 7.6)
  if (articles.length === 0) {
    throw new Error('no content found');
  }

  // Select best article (Req 7.3)
  const best = selectBestArticle(articles, keyword);

  // Extract content (Req 7.4)
  let rawContent = best.summary || best.description || '';
  if (!rawContent && best.content) {
    rawContent = best.content.substring(0, 2000);
  }
  if (!rawContent) {
    rawContent = (best.content || '').substring(0, 2000);
  }

  // Sanitize (Req 7.7)
  const sanitized = sanitizeContent(rawContent);

  // Abort if empty after sanitization (Req 7.8)
  if (!sanitized) {
    throw new Error('empty content after sanitization');
  }

  const cleanUrl = stripTrackingParams(best.url || '');

  return {
    article_title: sanitizeContent(best.title || ''),
    article_summary: sanitized,
    article_url: cleanUrl,
    content_fetch_status: 'success',
  };
}

/**
 * Fetch from all sources and merge results.
 *
 * @param {string} keyword
 * @param {string} newsApiKey
 * @param {Date} from
 * @param {Date} to
 * @param {Function} httpGet
 * @returns {Promise<Array>}
 */
async function fetchAllSources(keyword, newsApiKey, from, to, httpGet) {
  const results = await Promise.allSettled([
    newsApiKey ? fetchFromNewsApi(keyword, newsApiKey, from, to, httpGet) : Promise.resolve([]),
    fetchFromGoogleNewsRss(keyword, from, httpGet),
  ]);

  const allArticles = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allArticles.push(...result.value);
    }
  }
  return allArticles;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  scoreArticle,
  sanitizeContent,
  stripTrackingParams,
  selectBestArticle,
  runContentFetcher,
  fetchAllSources,
  parseRssFeed,
};
