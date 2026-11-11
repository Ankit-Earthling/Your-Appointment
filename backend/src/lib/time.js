import { AppError } from './errors.js';

const weekdayNumber = new Map([
  ['Sun', 0],
  ['Mon', 1],
  ['Tue', 2],
  ['Wed', 3],
  ['Thu', 4],
  ['Fri', 5],
  ['Sat', 6],
]);

export function isIanaTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function localParts(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    dayOfWeek: weekdayNumber.get(values.weekday),
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function localDate(instant, timezone) {
  return localParts(instant, timezone).date;
}

export function localTimeToUtc(date, minutes, timezone) {
  const [year, month, day] = date.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let candidate = new Date(desired);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(candidate, timezone);
    const [actualYear, actualMonth, actualDay] = actual.date.split('-').map(Number);
    const actualWallTime = Date.UTC(
      actualYear,
      actualMonth - 1,
      actualDay,
      Math.floor(actual.minutes / 60),
      actual.minutes % 60,
    );
    const difference = desired - actualWallTime;
    if (difference === 0) return candidate;
    candidate = new Date(candidate.getTime() + difference);
  }
  return undefined;
}

export function scheduleAllows(hours, timezone, startAt, endAt) {
  const start = localParts(startAt, timezone);
  const end = localParts(new Date(endAt.getTime() - 1), timezone);
  if (start.date !== end.date) return false;
  const window = hours.find((item) => item.dayOfWeek === start.dayOfWeek);
  if (!window) return false;
  const [openHour, openMinute] = window.opensLocal.split(':').map(Number);
  const [closeHour, closeMinute] = window.closesLocal.split(':').map(Number);
  const open = openHour * 60 + openMinute;
  const close = closeHour * 60 + closeMinute;
  return start.minutes >= open && end.minutes + 1 <= close;
}

export function parseInstant(value, field) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} must be a valid date/time.`);
  }
  return date;
}
