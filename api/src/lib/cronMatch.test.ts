/**
 * Tests for the minimal cron-field matcher used by the in-process scheduler.
 */
import { describe, expect, it } from 'vitest';
import { cronMatchesDate } from './cronMatch.js';

/** Builds a UTC Date from components, avoiding local-timezone surprises. */
function utc(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

describe('cronMatchesDate', () => {
  it('matches "* * * * *" for any date', () => {
    expect(cronMatchesDate('* * * * *', utc(2026, 3, 15, 9, 30))).toBe(true);
    expect(cronMatchesDate('* * * * *', utc(2026, 12, 31, 23, 59))).toBe(true);
  });

  it('matches an exact minute and hour', () => {
    expect(cronMatchesDate('30 9 * * *', utc(2026, 3, 15, 9, 30))).toBe(true);
    expect(cronMatchesDate('30 9 * * *', utc(2026, 3, 15, 9, 31))).toBe(false);
    expect(cronMatchesDate('30 9 * * *', utc(2026, 3, 15, 10, 30))).toBe(false);
  });

  it('matches a day-of-week range (weekdays)', () => {
    // 2026-03-16 is a Monday (dow=1), 2026-03-21 is a Saturday (dow=6)
    expect(cronMatchesDate('0 14 * * 1-5', utc(2026, 3, 16, 14, 0))).toBe(true);
    expect(cronMatchesDate('0 14 * * 1-5', utc(2026, 3, 21, 14, 0))).toBe(false);
  });

  it('matches a day-of-week list (custom days)', () => {
    // 2026-03-16=Mon(1), 2026-03-18=Wed(3), 2026-03-20=Fri(5)
    expect(cronMatchesDate('0 8 * * 1,3,5', utc(2026, 3, 16, 8, 0))).toBe(true);
    expect(cronMatchesDate('0 8 * * 1,3,5', utc(2026, 3, 18, 8, 0))).toBe(true);
    expect(cronMatchesDate('0 8 * * 1,3,5', utc(2026, 3, 17, 8, 0))).toBe(false); // Tuesday
  });

  it('matches day-of-week 0 for Sunday', () => {
    // 2026-03-15 is a Sunday
    expect(cronMatchesDate('0 0 * * 0', utc(2026, 3, 15, 0, 0))).toBe(true);
  });

  it('rejects malformed cron expressions (wrong field count)', () => {
    expect(cronMatchesDate('* * * *', utc(2026, 1, 1, 0, 0))).toBe(false);
    expect(cronMatchesDate('', utc(2026, 1, 1, 0, 0))).toBe(false);
  });

  it('matches minute 0 (edge case — falsy but valid)', () => {
    expect(cronMatchesDate('0 0 * * *', utc(2026, 1, 1, 0, 0))).toBe(true);
    expect(cronMatchesDate('0 0 * * *', utc(2026, 1, 1, 0, 1))).toBe(false);
  });

  it('handles a full explicit field combination', () => {
    // Every field pinned to an exact value that matches
    expect(cronMatchesDate('15 6 20 3 5', utc(2026, 3, 20, 6, 15))).toBe(true);
    // Day-of-month mismatch
    expect(cronMatchesDate('15 6 21 3 5', utc(2026, 3, 20, 6, 15))).toBe(false);
  });
});
