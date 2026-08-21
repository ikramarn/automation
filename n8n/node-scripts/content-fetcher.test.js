/**
 * content-fetcher.test.js
 * Vitest unit tests for the Content_Fetcher node logic.
 *
 * Requirements validated: 7.1–7.8
 */

import { describe, it, expect } from 'vitest';
import {
  scoreArticle,
  sanitizeContent,
  stripTrackingParams,
  selectBestArticle,
} from './content-fetcher.js';

// ---------------------------------------------------------------------------
// scoreArticle
// ---------------------------------------------------------------------------

describe('scoreArticle', () => {
  it('returns 0 when keyword is empty', () => {
    const article = { title: 'hello world', description: 'some content' };
    expect(scoreArticle(article, '')).toBe(0);
  });

  it('keyword in title scores higher than keyword only in description', () => {
    const keyword = 'bitcoin';
    const titleMatch = { title: 'Bitcoin hits new high', description: 'No keyword here at all.' };
    const bodyMatch = { title: 'Crypto news today', description: 'Bitcoin is rising fast.' };

    const titleScore = scoreArticle(titleMatch, keyword);
    const bodyScore = scoreArticle(bodyMatch, keyword);

    expect(titleScore).toBeGreaterThan(bodyScore);
  });

  it('title matches count 3 points each', () => {
    const article = { title: 'bitcoin bitcoin', description: '' };
    // 2 title occurrences × 3 = 6
    expect(scoreArticle(article, 'bitcoin')).toBe(6);
  });

  it('description matches count 1 point each', () => {
    const article = { title: '', description: 'bitcoin is volatile. bitcoin goes up. bitcoin goes down.' };
    // 3 description occurrences × 1 = 3
    expect(scoreArticle(article, 'bitcoin')).toBe(3);
  });

  it('is case-insensitive', () => {
    const article = { title: 'BITCOIN price today', description: 'Bitcoin analysis' };
    expect(scoreArticle(article, 'bitcoin')).toBeGreaterThan(0);
  });

  it('uses summary field as fallback for description', () => {
    const article = { title: 'Market news', summary: 'ethereum surge expected' };
    expect(scoreArticle(article, 'ethereum')).toBe(1);
  });

  it('returns 0 when keyword not found anywhere', () => {
    const article = { title: 'Weather report', description: 'Sunny skies ahead.' };
    expect(scoreArticle(article, 'bitcoin')).toBe(0);
  });

  it('counts multiple non-overlapping occurrences', () => {
    const article = { title: 'AI AI AI', description: '' };
    // 3 × 3 = 9
    expect(scoreArticle(article, 'ai')).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// sanitizeContent
// ---------------------------------------------------------------------------

describe('sanitizeContent', () => {
  it('strips basic HTML tags', () => {
    const input = '<p>Hello <strong>world</strong></p>';
    expect(sanitizeContent(input)).toBe('Hello world');
  });

  it('strips inline <script> blocks', () => {
    const input = 'Text before<script>alert("xss")</script>text after';
    const result = sanitizeContent(input);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert');
    expect(result).toContain('Text before');
    expect(result).toContain('text after');
  });

  it('strips multiline script blocks', () => {
    const input = 'Before\n<script type="text/javascript">\nvar x = 1;\ndocument.write(x);\n</script>\nAfter';
    const result = sanitizeContent(input);
    expect(result).not.toContain('var x');
    expect(result).not.toContain('document.write');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });

  it('strips style blocks', () => {
    const input = '<style>.foo { color: red; }</style>Real content';
    const result = sanitizeContent(input);
    expect(result).not.toContain('.foo');
    expect(result).toContain('Real content');
  });

  it('decodes common HTML entities', () => {
    expect(sanitizeContent('Rock &amp; Roll')).toBe('Rock & Roll');
    expect(sanitizeContent('&lt;tag&gt;')).toBe('<tag>');
    expect(sanitizeContent('&quot;quoted&quot;')).toBe('"quoted"');
    expect(sanitizeContent('it&#39;s')).toBe("it's");
  });

  it('collapses excess whitespace', () => {
    const input = 'Hello   \t  world\n\n  foo';
    expect(sanitizeContent(input)).toBe('Hello world foo');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeContent('')).toBe('');
    expect(sanitizeContent(null)).toBe('');
    expect(sanitizeContent(undefined)).toBe('');
  });

  it('leaves plain text unchanged (beyond whitespace normalization)', () => {
    const input = 'This is a plain text article.';
    expect(sanitizeContent(input)).toBe('This is a plain text article.');
  });
});

// ---------------------------------------------------------------------------
// stripTrackingParams
// ---------------------------------------------------------------------------

describe('stripTrackingParams', () => {
  it('removes utm_source', () => {
    const url = 'https://example.com/article?utm_source=twitter&id=123';
    const result = stripTrackingParams(url);
    expect(result).not.toContain('utm_source');
    expect(result).toContain('id=123');
  });

  it('removes utm_medium', () => {
    const url = 'https://example.com/?utm_medium=social';
    expect(stripTrackingParams(url)).not.toContain('utm_medium');
  });

  it('removes utm_campaign', () => {
    const url = 'https://example.com/?utm_campaign=spring_sale';
    expect(stripTrackingParams(url)).not.toContain('utm_campaign');
  });

  it('removes utm_content', () => {
    const url = 'https://example.com/?utm_content=banner';
    expect(stripTrackingParams(url)).not.toContain('utm_content');
  });

  it('removes utm_term', () => {
    const url = 'https://example.com/?utm_term=keyword';
    expect(stripTrackingParams(url)).not.toContain('utm_term');
  });

  it('removes fbclid', () => {
    const url = 'https://example.com/post?fbclid=abc123&page=1';
    const result = stripTrackingParams(url);
    expect(result).not.toContain('fbclid');
    expect(result).toContain('page=1');
  });

  it('removes gclid', () => {
    const url = 'https://example.com/?gclid=xyz789&ref=home';
    const result = stripTrackingParams(url);
    expect(result).not.toContain('gclid');
    expect(result).toContain('ref=home');
  });

  it('keeps non-tracking query parameters', () => {
    const url = 'https://example.com/search?q=bitcoin&page=2&sort=date';
    const result = stripTrackingParams(url);
    expect(result).toContain('q=bitcoin');
    expect(result).toContain('page=2');
    expect(result).toContain('sort=date');
  });

  it('removes all tracking params at once from a mixed URL', () => {
    const url = 'https://example.com/article?id=42&utm_source=email&utm_medium=cpc&fbclid=FB123&gclid=GC456&utm_campaign=launch&utm_content=hero&utm_term=saas';
    const result = stripTrackingParams(url);
    expect(result).toContain('id=42');
    expect(result).not.toContain('utm_source');
    expect(result).not.toContain('utm_medium');
    expect(result).not.toContain('utm_campaign');
    expect(result).not.toContain('utm_content');
    expect(result).not.toContain('utm_term');
    expect(result).not.toContain('fbclid');
    expect(result).not.toContain('gclid');
  });

  it('returns URL unchanged when no tracking params present', () => {
    const url = 'https://example.com/article?id=42&ref=home';
    expect(stripTrackingParams(url)).toBe(url);
  });

  it('handles URL with no query string', () => {
    const url = 'https://example.com/article';
    expect(stripTrackingParams(url)).toBe(url);
  });

  it('returns input unchanged for invalid/relative URLs', () => {
    const url = '/relative/path?utm_source=test';
    expect(stripTrackingParams(url)).toBe(url);
  });

  it('returns empty string for empty input', () => {
    expect(stripTrackingParams('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// selectBestArticle
// ---------------------------------------------------------------------------

describe('selectBestArticle', () => {
  it('returns null when no articles provided', () => {
    expect(selectBestArticle([], 'bitcoin')).toBeNull();
    expect(selectBestArticle(null, 'bitcoin')).toBeNull();
    expect(selectBestArticle(undefined, 'bitcoin')).toBeNull();
  });

  it('selects the single article when only one is provided', () => {
    const article = { title: 'Bitcoin news', description: 'Some text', publishedAt: '2024-01-01T12:00:00Z' };
    expect(selectBestArticle([article], 'bitcoin')).toBe(article);
  });

  it('selects the highest scoring article', () => {
    const highScore = { title: 'Bitcoin Bitcoin price surge', description: 'Bitcoin analysis', publishedAt: '2024-01-01T10:00:00Z' };
    const lowScore = { title: 'Crypto news', description: 'Some market update', publishedAt: '2024-01-01T12:00:00Z' };

    const result = selectBestArticle([lowScore, highScore], 'bitcoin');
    expect(result).toBe(highScore);
  });

  it('breaks ties by most recent publication timestamp', () => {
    const keyword = 'crypto';
    // Both have exactly 1 mention in title (score = 3 each)
    const older = { title: 'Crypto market today', description: '', publishedAt: '2024-01-01T08:00:00Z' };
    const newer = { title: 'Crypto market today', description: '', publishedAt: '2024-01-01T14:00:00Z' };

    const result = selectBestArticle([older, newer], keyword);
    expect(result).toBe(newer);
  });

  it('breaks ties correctly regardless of input order', () => {
    const keyword = 'ethereum';
    const older = { title: 'Ethereum update', description: '', publishedAt: '2024-01-01T06:00:00Z' };
    const newer = { title: 'Ethereum update', description: '', publishedAt: '2024-01-01T18:00:00Z' };

    // Same result whether newer or older is first in the array
    expect(selectBestArticle([newer, older], keyword)).toBe(newer);
    expect(selectBestArticle([older, newer], keyword)).toBe(newer);
  });

  it('handles articles with pubDate field (RSS format)', () => {
    const rssOlder = { title: 'AI news', description: '', pubDate: 'Mon, 01 Jan 2024 08:00:00 GMT' };
    const rssNewer = { title: 'AI news', description: '', pubDate: 'Mon, 01 Jan 2024 14:00:00 GMT' };

    const result = selectBestArticle([rssOlder, rssNewer], 'ai');
    expect(result).toBe(rssNewer);
  });

  it('handles articles with no date gracefully', () => {
    const noDate = { title: 'Bitcoin news', description: 'bitcoin mentioned' };
    const withDate = { title: 'Crypto updates', description: 'no keyword' };

    // noDate scores higher (has keyword), so it should be selected regardless
    const result = selectBestArticle([noDate, withDate], 'bitcoin');
    expect(result).toBe(noDate);
  });

  it('selects from multiple articles correctly', () => {
    const keyword = 'solar energy';
    const articles = [
      { title: 'Weather report', description: 'Sunny skies', publishedAt: '2024-01-01T12:00:00Z' },
      { title: 'Solar energy boom', description: 'Solar energy investments surge', publishedAt: '2024-01-01T10:00:00Z' },
      { title: 'Tech news', description: 'Various updates', publishedAt: '2024-01-01T11:00:00Z' },
      { title: 'Solar energy future', description: 'Predictions', publishedAt: '2024-01-01T09:00:00Z' },
    ];

    const result = selectBestArticle(articles, keyword);
    // "Solar energy boom" has: title 1×3=3 + description 1×1=1 = 4 points
    // "Solar energy future" has: title 1×3=3 + description 0 = 3 points
    expect(result).toBe(articles[1]);
  });
});
