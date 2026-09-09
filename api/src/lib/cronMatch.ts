/**
 * Minimal cron-field matcher for the in-process pipeline scheduler.
 *
 * Supports the subset of cron syntax produced by `computeUtcCron` and
 * commonly used for simple recurring schedules:
 *   - `*`            matches any value
 *   - `5`             exact value
 *   - `1,3,5`         comma-separated list
 *   - `1-5`           inclusive range
 *   - `1-5,0`         list of ranges/values combined
 *
 * Does NOT support step syntax (`*\/5`) or month names — not needed for
 * this application's schedule generation (see cronUtils.ts).
 */

/**
 * Returns true if `value` satisfies a single cron field expression.
 */
function fieldMatches(field: string, value: number): boolean {
  if (field === '*') return true;

  return field.split(',').some((part) => {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [loStr, hiStr] = trimmed.split('-');
      const lo = Number(loStr);
      const hi = Number(hiStr);
      if (Number.isNaN(lo) || Number.isNaN(hi)) return false;
      return value >= lo && value <= hi;
    }
    const exact = Number(trimmed);
    return !Number.isNaN(exact) && exact === value;
  });
}

/**
 * Checks whether a standard 5-field cron expression
 * (`minute hour day-of-month month day-of-week`) matches the given UTC date
 * at minute-level granularity.
 *
 * @param cronExpression - e.g. "30 14 * * 1-5"
 * @param date           - reference Date, evaluated using UTC components
 * @returns true if the cron expression matches the date's current UTC minute
 */
export function cronMatchesDate(cronExpression: string, date: Date): boolean {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minuteField, hourField, domField, monthField, dowField] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1; // JS months are 0-indexed
  const dayOfWeek = date.getUTCDay(); // 0=Sunday

  return (
    fieldMatches(minuteField, minute) &&
    fieldMatches(hourField, hour) &&
    fieldMatches(domField, dayOfMonth) &&
    fieldMatches(monthField, month) &&
    fieldMatches(dowField, dayOfWeek)
  );
}
