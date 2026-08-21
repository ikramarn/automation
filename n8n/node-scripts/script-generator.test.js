/**
 * script-generator.test.js
 * Vitest unit tests for the Script_Generator node logic.
 *
 * Requirements validated: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  countWords,
  truncateAtSentenceBoundary,
  trimScriptToWordLimit,
  buildSystemPrompt,
  buildUserPrompt,
  enforceScriptWordLimit,
  runScriptGenerator,
} from './script-generator.js';

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------

describe('countWords', () => {
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 1 for a single word', () => {
    expect(countWords('hello')).toBe(1);
  });

  it('counts multiple words with punctuation', () => {
    // Punctuation attached to words still counts as one token per word
    expect(countWords('Hello, world! This is a test.')).toBe(6);
  });

  it('handles leading and trailing whitespace', () => {
    expect(countWords('  hello world  ')).toBe(2);
  });

  it('handles multiple spaces between words', () => {
    expect(countWords('hello   world')).toBe(2);
  });

  it('handles tabs and newlines as whitespace', () => {
    expect(countWords('hello\tworld\nfoo')).toBe(3);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   ')).toBe(0);
  });

  it('returns 0 for null', () => {
    expect(countWords(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(countWords(undefined)).toBe(0);
  });

  it('counts a 150-word string correctly', () => {
    const text = Array(150).fill('word').join(' ');
    expect(countWords(text)).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// truncateAtSentenceBoundary (character-limit based)
// ---------------------------------------------------------------------------

describe('truncateAtSentenceBoundary', () => {
  it('returns text unchanged when shorter than limit', () => {
    const text = 'Short text. No truncation needed.';
    expect(truncateAtSentenceBoundary(text, 1000)).toBe(text);
  });

  it('returns text unchanged when exactly at limit', () => {
    const text = 'Exactly here.';
    expect(truncateAtSentenceBoundary(text, text.length)).toBe(text);
  });

  it('truncates at a period when text exceeds the char limit', () => {
    // Build: short sentence (fits within limit), then long overflow text
    const head = 'First sentence ends here. ';
    const tail = 'x'.repeat(100);
    const text = head + tail;
    const limit = head.length + 10; // limit is within the overflow tail

    const result = truncateAtSentenceBoundary(text, limit);

    // Should cut back to the last sentence boundary before the limit
    expect(result).toBe('First sentence ends here.');
    expect(result.length).toBeLessThanOrEqual(limit);
  });

  it('truncates at the nearest sentence boundary (period) below maxChars', () => {
    const text = 'Sentence one. Sentence two is longer. Extra content that overflows the limit.';
    // Pick a limit that falls in the middle of "Extra content..."
    const limit = 55; // falls after "Sentence two is longer."
    const result = truncateAtSentenceBoundary(text, limit);
    expect(result).toBe('Sentence one. Sentence two is longer.');
    expect(result.length).toBeLessThanOrEqual(limit);
  });

  it('handles text with no sentence boundary — returns hard truncation', () => {
    // No period/!/? anywhere, text longer than limit
    const text = 'abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz';
    const limit = 20;
    const result = truncateAtSentenceBoundary(text, limit);
    expect(result.length).toBeLessThanOrEqual(limit);
    // Should be trimmed version of the first 20 chars
    expect(result).toBe(text.substring(0, limit).trim());
  });

  it('handles exclamation and question marks as sentence boundaries', () => {
    const text = 'What a day! More text that overflows past the limit easily.';
    const limit = 15;
    const result = truncateAtSentenceBoundary(text, limit);
    expect(result).toBe('What a day!');
    expect(result.length).toBeLessThanOrEqual(limit);
  });

  it('returns empty string for empty input', () => {
    expect(truncateAtSentenceBoundary('', 100)).toBe('');
    expect(truncateAtSentenceBoundary(null, 100)).toBe('');
  });

  it('returns empty string for zero or negative maxChars', () => {
    expect(truncateAtSentenceBoundary('hello world', 0)).toBe('');
    expect(truncateAtSentenceBoundary('hello world', -5)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// trimScriptToWordLimit
// ---------------------------------------------------------------------------

describe('trimScriptToWordLimit', () => {
  /**
   * Helper: build a script of exactly N words with sentence boundaries
   * every 10 words so trimming can find a clean boundary.
   */
  function makeScript(wordCount) {
    const words = Array(wordCount).fill('word');
    for (let i = 9; i < words.length; i += 10) {
      words[i] = 'boundary.';
    }
    return words.join(' ');
  }

  it('returns script unchanged when under the word limit', () => {
    const script = makeScript(150);
    expect(countWords(script)).toBe(150);
    // maxWords=200, so 150 words should pass through untouched
    const result = trimScriptToWordLimit(script, 200, 150);
    expect(result).toBe(script);
  });

  it('returns script unchanged when exactly at the word limit', () => {
    const script = makeScript(200);
    expect(countWords(script)).toBe(200);
    const result = trimScriptToWordLimit(script, 200, 150);
    expect(result).toBe(script);
  });

  it('trims script to ≤150 words when over 200 words', () => {
    const script = makeScript(210);
    expect(countWords(script)).toBeGreaterThan(200);

    const result = trimScriptToWordLimit(script, 200, 150);
    expect(countWords(result)).toBeLessThanOrEqual(150);
  });

  it('preserves sentence boundary on trim', () => {
    const script = makeScript(210);
    const result = trimScriptToWordLimit(script, 200, 150);
    // Last char should be the sentence boundary '.'
    expect(result.endsWith('.')).toBe(true);
  });

  it('falls back to word boundary when no sentence boundary within targetWords', () => {
    // Script with no punctuation at all
    const script = Array(210).fill('word').join(' ');
    const result = trimScriptToWordLimit(script, 200, 150);
    expect(countWords(result)).toBeLessThanOrEqual(150);
  });

  it('returns empty string for null/empty input', () => {
    expect(trimScriptToWordLimit('', 200, 150)).toBe('');
    expect(trimScriptToWordLimit(null, 200, 150)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('mentions copyrighted quotes prohibition (Req 8.4)', () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toContain('copyright');
  });

  it('mentions profanity prohibition (Req 8.4)', () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toContain('profanity');
  });

  it('mentions misinformation prohibition (Req 8.4)', () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toContain('misinformation');
  });
});

// ---------------------------------------------------------------------------
// buildUserPrompt
// ---------------------------------------------------------------------------

describe('buildUserPrompt', () => {
  it('includes article title and summary', () => {
    const prompt = buildUserPrompt('My Title', 'My summary content.', 'professional', 60);
    expect(prompt).toContain('My Title');
    expect(prompt).toContain('My summary content.');
  });

  it('includes tone parameter', () => {
    const prompt = buildUserPrompt('Title', 'Summary', 'energetic', 60);
    expect(prompt.toLowerCase()).toContain('energetic');
  });

  it('includes duration parameter', () => {
    const prompt = buildUserPrompt('Title', 'Summary', 'casual', 90);
    expect(prompt).toContain('90');
  });

  it('specifies 130–150 word range (Req 8.2)', () => {
    const prompt = buildUserPrompt('Title', 'Summary', 'professional', 60);
    expect(prompt).toContain('130');
    expect(prompt).toContain('150');
  });
});

// ---------------------------------------------------------------------------
// enforceScriptWordLimit (Req 8.8)
// ---------------------------------------------------------------------------

describe('enforceScriptWordLimit', () => {
  function makeScript(wordCount) {
    const words = Array(wordCount).fill('word');
    for (let i = 9; i < words.length; i += 10) {
      words[i] = 'sentence.';
    }
    return words.join(' ');
  }

  it('returns script unchanged when word count is under 200', () => {
    const script = makeScript(150);
    expect(enforceScriptWordLimit(script)).toBe(script);
  });

  it('returns script unchanged when word count is exactly 200', () => {
    const script = makeScript(200);
    expect(enforceScriptWordLimit(script)).toBe(script);
  });

  it('trims script to ≤150 words when over 200 words', () => {
    const script = makeScript(201);
    const result = enforceScriptWordLimit(script);
    expect(countWords(result)).toBeLessThanOrEqual(150);
  });

  it('trimmed result ends at a sentence boundary', () => {
    const script = makeScript(210);
    const result = enforceScriptWordLimit(script);
    expect(result.endsWith('.')).toBe(true);
  });

  it('returns empty string for null/empty input', () => {
    expect(enforceScriptWordLimit('')).toBe('');
    expect(enforceScriptWordLimit(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// runScriptGenerator integration tests (with mocked httpPost)
// ---------------------------------------------------------------------------

describe('runScriptGenerator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeScript(wordCount) {
    const words = Array(wordCount).fill('word');
    for (let i = 9; i < words.length; i += 10) {
      words[i] = 'boundary.';
    }
    return words.join(' ');
  }

  const mockHttpPost = (scriptText) => async (_url, _headers, _body) => ({
    choices: [{ message: { content: scriptText } }],
  });

  it('returns script_text and success status for a normal script (Req 8.5)', async () => {
    const script = makeScript(140);
    const ctx = {
      article_title: 'Test Article',
      article_summary: 'Some summary content.',
      script_tone: 'professional',
      target_duration_secs: 60,
      openai_model: 'gpt-4o-mini',
      credentials: { openai_api_key: 'test-key' },
    };

    const result = await runScriptGenerator(ctx, mockHttpPost(script));
    expect(result.script_gen_status).toBe('success');
    expect(result.script_text).toBe(script);
  });

  it('uses user openai_api_key when present (Req 8.3)', async () => {
    const capturedHeaders = [];
    const httpPost = async (_url, headers, _body) => {
      capturedHeaders.push(headers);
      return { choices: [{ message: { content: makeScript(140) } }] };
    };

    const ctx = {
      article_title: 'Title',
      article_summary: 'Summary',
      script_tone: 'casual',
      target_duration_secs: 60,
      openai_model: 'gpt-4o-mini',
      credentials: { openai_api_key: 'user-key-123' },
    };

    await runScriptGenerator(ctx, httpPost, 'platform-fallback-key');
    expect(capturedHeaders[0].Authorization).toContain('user-key-123');
  });

  it('falls back to platform key when user key is absent (Req 8.3)', async () => {
    const capturedHeaders = [];
    const httpPost = async (_url, headers, _body) => {
      capturedHeaders.push(headers);
      return { choices: [{ message: { content: makeScript(140) } }] };
    };

    const ctx = {
      article_title: 'Title',
      article_summary: 'Summary',
      script_tone: 'casual',
      target_duration_secs: 60,
      openai_model: 'gpt-4o-mini',
      credentials: { openai_api_key: '' },
    };

    await runScriptGenerator(ctx, httpPost, 'platform-fallback-key');
    expect(capturedHeaders[0].Authorization).toContain('platform-fallback-key');
  });

  it('trims script > 200 words to ≤150 at sentence boundary (Req 8.8)', async () => {
    const script = makeScript(210);
    const ctx = {
      article_title: 'Title',
      article_summary: 'Summary',
      script_tone: 'professional',
      target_duration_secs: 60,
      openai_model: 'gpt-4o-mini',
      credentials: { openai_api_key: 'key' },
    };

    const result = await runScriptGenerator(ctx, mockHttpPost(script));
    expect(countWords(result.script_text)).toBeLessThanOrEqual(150);
    expect(result.script_text.endsWith('.')).toBe(true);
  });

  it('does not trim script with exactly 200 words (Req 8.8)', async () => {
    const script = makeScript(200);
    const ctx = {
      article_title: 'Title',
      article_summary: 'Summary',
      script_tone: 'professional',
      target_duration_secs: 60,
      openai_model: 'gpt-4o-mini',
      credentials: { openai_api_key: 'key' },
    };

    const result = await runScriptGenerator(ctx, mockHttpPost(script));
    expect(countWords(result.script_text)).toBe(200);
  });

  it('retries once after 10s on first failure, succeeds on retry (Req 8.6)', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const httpPost = async () => {
      callCount++;
      if (callCount === 1) throw new Error('API error');
      return { choices: [{ message: { content: makeScript(140) } }] };
    };

    const ctx = {
      article_title: 'Title',
      article_summary: 'Summary',
      script_tone: 'professional',
      target_duration_secs: 60,
      openai_model: 'gpt-4o-mini',
      credentials: { openai_api_key: 'key' },
    };

    const resultPromise = runScriptGenerator(ctx, httpPost);
    // Advance timers past the 10s retry delay
    await vi.advanceTimersByTimeAsync(10001);
    const result = await resultPromise;

    expect(callCount).toBe(2);
    expect(result.script_gen_status).toBe('success');
  });

  it('throws "script generation failed" when both attempts fail (Req 8.7)', async () => {
    vi.useFakeTimers();
    const httpPost = async () => { throw new Error('API error'); };

    const ctx = {
      article_title: 'Title',
      article_summary: 'Summary',
      script_tone: 'professional',
      target_duration_secs: 60,
      openai_model: 'gpt-4o-mini',
      credentials: { openai_api_key: 'key' },
    };

    const resultPromise = runScriptGenerator(ctx, httpPost);
    const assertRejects = expect(resultPromise).rejects.toThrow('script generation failed');
    await vi.advanceTimersByTimeAsync(10001);
    await assertRejects;
  });

  it('throws "script generation failed" on empty response (Req 8.6)', async () => {
    vi.useFakeTimers();
    // Both attempts return empty choices
    const httpPost = async () => ({ choices: [] });

    const ctx = {
      article_title: 'Title',
      article_summary: 'Summary',
      script_tone: 'professional',
      target_duration_secs: 60,
      openai_model: 'gpt-4o-mini',
      credentials: { openai_api_key: 'key' },
    };

    const resultPromise = runScriptGenerator(ctx, httpPost);
    const assertRejects = expect(resultPromise).rejects.toThrow('script generation failed');
    await vi.advanceTimersByTimeAsync(10001);
    await assertRejects;
  });

  it('caps article content at 5000 chars (Req 8.1)', async () => {
    const capturedBodies = [];
    const httpPost = async (_url, _headers, body) => {
      capturedBodies.push(body);
      return { choices: [{ message: { content: makeScript(140) } }] };
    };

    const longSummary = 'A'.repeat(100) + '. ' + 'B'.repeat(6000);
    const ctx = {
      article_title: 'Title',
      article_summary: longSummary,
      script_tone: 'professional',
      target_duration_secs: 60,
      openai_model: 'gpt-4o-mini',
      credentials: { openai_api_key: 'key' },
    };

    await runScriptGenerator(ctx, httpPost);
    const userMessage = capturedBodies[0].messages.find((m) => m.role === 'user').content;
    // The overflow B-block should not appear in the prompt
    expect(userMessage).not.toContain('B'.repeat(100));
    // The 100-A sentence should be present
    expect(userMessage).toContain('A'.repeat(100));
  });

  it('throws when no API key available', async () => {
    const ctx = {
      article_title: 'Title',
      article_summary: 'Summary',
      script_tone: 'professional',
      target_duration_secs: 60,
      openai_model: 'gpt-4o-mini',
      credentials: { openai_api_key: '' },
    };

    await expect(runScriptGenerator(ctx, async () => {}, '')).rejects.toThrow('script generation failed');
  });
});
