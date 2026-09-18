/**
 * Date arithmetic for compliance deadlines.
 *
 * Rules of the house:
 *  - A "date" in this system is a calendar date in Europe/London, held as an
 *    ISO `yyyy-MM-dd` string. We deliberately do NOT carry times around: a
 *    deadline of "14 March 2027" means end of that day in London, and mixing
 *    in UTC timestamps is how BST bugs get in.
 *  - All arithmetic is done on the calendar fields directly, so BST/GMT
 *    transitions cannot shift a deadline by a day.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class InvalidDateError extends Error {
  constructor(value: string) {
    super(`Not an ISO yyyy-MM-dd date: ${JSON.stringify(value)}`);
    this.name = "InvalidDateError";
  }
}

export type CalendarDate = { year: number; month: number; day: number };

export function parseIsoDate(value: string): CalendarDate {
  const m = ISO_DATE.exec(value);
  if (!m) throw new InvalidDateError(value);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) throw new InvalidDateError(value);
  if (day < 1 || day > daysInMonth(year, month)) throw new InvalidDateError(value);
  return { year, month, day };
}

export function isValidIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function formatIsoDate(d: CalendarDate): string {
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12:
      return 31;
    case 4: case 6: case 9: case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      throw new Error(`Invalid month: ${month}`);
  }
}

/** Days since 1970-01-01, computed from calendar fields only (no Date, no TZ). */
export function toEpochDay(value: string): number {
  const { year, month, day } = parseIsoDate(value);
  // Howard Hinnant's civil_from_days, inverted.
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDay(epochDay: number): string {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return formatIsoDate({ year: m <= 2 ? y + 1 : y, month: m, day: d });
}

/** Whole days from `from` to `to`. Positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function addDays(value: string, days: number): string {
  return fromEpochDay(toEpochDay(value) + days);
}

/**
 * Add calendar months, clamping to the end of the target month.
 * 2026-01-31 + 1 month => 2026-02-28 (2028-01-31 + 1 => 2028-02-29).
 */
export function addMonths(value: string, months: number): string {
  const { year, month, day } = parseIsoDate(value);
  const zeroBased = year * 12 + (month - 1) + months;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12) + 1;
  const clampedDay = Math.min(day, daysInMonth(newYear, newMonth));
  return formatIsoDate({ year: newYear, month: newMonth, day: clampedDay });
}

export function addYears(value: string, years: number): string {
  return addMonths(value, years * 12);
}

export function minDate(...dates: (string | null)[]): string | null {
  const present = dates.filter((d): d is string => d !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => (toEpochDay(a) <= toEpochDay(b) ? a : b));
}

export function maxDate(...dates: (string | null)[]): string | null {
  const present = dates.filter((d): d is string => d !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => (toEpochDay(a) >= toEpochDay(b) ? a : b));
}

export function isBefore(a: string, b: string): boolean {
  return toEpochDay(a) < toEpochDay(b);
}

export function isAfter(a: string, b: string): boolean {
  return toEpochDay(a) > toEpochDay(b);
}

export function isOnOrBefore(a: string, b: string): boolean {
  return toEpochDay(a) <= toEpochDay(b);
}

export function isOnOrAfter(a: string, b: string): boolean {
  return toEpochDay(a) >= toEpochDay(b);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Long UK format, e.g. "14 March 2027". Used everywhere in the UI. */
export function formatUkLong(value: string): string {
  const { year, month, day } = parseIsoDate(value);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/** Short UK format, e.g. "14 Mar 2027". */
export function formatUkShort(value: string): string {
  const { year, month, day } = parseIsoDate(value);
  return `${day} ${MONTH_NAMES[month - 1]!.slice(0, 3)} ${year}`;
}

/**
 * The calendar date "now" in Europe/London, derived from a real instant.
 * This is the ONLY place the engine's date model meets wall-clock time, and
 * callers pass the instant in, so tests stay deterministic.
 */
export function londonDateOf(instant: Date): string {
  // en-CA gives yyyy-mm-dd ordering; the timeZone option does the BST work.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(instant);
}

/**
 * Deadlines are inclusive end-of-day Europe/London. "Days remaining" is
 * therefore 0 on the due date itself (still in time), negative afterwards.
 */
export function daysRemaining(today: string, dueOn: string): number {
  return daysBetween(today, dueOn);
}
