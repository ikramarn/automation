import { fromZonedTime } from 'date-fns-tz';

/**
 * Converts a user-local HH:MM + timezone to a UTC cron expression.
 *
 * @param timeHHMM   - Time string in "HH:MM" format (00:00–23:59) in the user's timezone
 * @param timezone   - IANA timezone string (e.g. "America/New_York")
 * @param recurrence - How often the pipeline should run
 * @param daysOfWeek - Array of 0–6 (0=Sunday) required when recurrence is "custom"
 * @returns A standard 5-field cron expression with UTC hours/minutes
 *
 * Examples:
 *   computeUtcCron("09:00", "America/New_York", "daily")       → "0 14 * * *"  (EST, UTC-5)
 *   computeUtcCron("09:00", "America/New_York", "weekdays")    → "0 14 * * 1-5"
 *   computeUtcCron("09:00", "America/New_York", "custom", [1,3,5]) → "0 14 * * 1,3,5"
 */
export function computeUtcCron(
  timeHHMM: string,
  timezone: string,
  recurrence: 'daily' | 'weekdays' | 'custom',
  daysOfWeek?: number[],
): string {
  // Validate time format
  if (!/^\d{2}:\d{2}$/.test(timeHHMM)) {
    throw new Error(
      `Invalid timeHHMM format: "${timeHHMM}". Expected "HH:MM" (e.g. "09:30").`,
    );
  }

  const parts = timeHHMM.split(':');
  const hours = parseInt(parts[0] ?? '', 10);
  const minutes = parseInt(parts[1] ?? '', 10);

  if (
    isNaN(hours) ||
    isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error(
      `Invalid timeHHMM value: "${timeHHMM}". Hours must be 0–23 and minutes must be 0–59.`,
    );
  }

  // Validate custom recurrence has daysOfWeek
  if (recurrence === 'custom') {
    if (!daysOfWeek || daysOfWeek.length === 0) {
      throw new Error(
        'daysOfWeek must be a non-empty array when recurrence is "custom".',
      );
    }
    for (const day of daysOfWeek) {
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        throw new Error(
          `Invalid day of week: ${day}. Values must be integers 0–6 (0=Sunday).`,
        );
      }
    }
  }

  // Use a fixed reference date (non-DST-ambiguous) to convert the local time to UTC.
  // We use 2024-01-15 (a Monday in January — no DST complications for most zones).
  // The date itself is irrelevant; only the UTC hours/minutes matter.
  const localDateStr = `2024-01-15T${timeHHMM}:00`;

  let utcDate: Date;
  try {
    utcDate = fromZonedTime(localDateStr, timezone);
  } catch {
    throw new Error(
      `Unrecognized or invalid timezone: "${timezone}". Use an IANA timezone string (e.g. "America/New_York").`,
    );
  }

  // Validate that the conversion produced a real date (fromZonedTime can
  // silently produce Invalid Date for completely unknown timezone strings
  // depending on the runtime's Intl support).
  if (isNaN(utcDate.getTime())) {
    throw new Error(
      `Unrecognized or invalid timezone: "${timezone}". Use an IANA timezone string (e.g. "America/New_York").`,
    );
  }

  const utcHours = utcDate.getUTCHours();
  const utcMinutes = utcDate.getUTCMinutes();

  // Build the day-of-week field based on recurrence
  let dowField: string;
  switch (recurrence) {
    case 'daily':
      dowField = '*';
      break;
    case 'weekdays':
      dowField = '1-5';
      break;
    case 'custom':
      // daysOfWeek is guaranteed non-empty here (validated above)
      dowField = (daysOfWeek as number[]).join(',');
      break;
  }

  return `${utcMinutes} ${utcHours} * * ${dowField}`;
}
