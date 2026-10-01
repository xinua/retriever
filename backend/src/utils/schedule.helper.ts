import type { Channel } from "../db/types.js";

/** The hours the day is divided into; `end` may sit on 24, meaning midnight. */
const DAY_START = 0;
const DAY_END = 24;

const MINUTE_MS = 60_000;

type IntervalPeriod = { start: number; end: number };

/**
 * A wall-clock "HH:MM" as minutes past midnight, or null when the
 * string is not one. The client only offers whole hours, but accept a minute
 * part so a hand-written value is not silently dropped.
 */
function parseClockTime(value: unknown): number | null {
  if (typeof value !== "string") return null;

  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function formatClockTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);

  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The poll times as minutes past midnight, ascending and de-duplicated, so
 * the search below can stop at the first one that is still ahead.
 *
 * Tolerates the column holding a bare string: that is what it held before the
 * field became a list, and a database written by an older build is migrated
 * on boot but may still be read by a request that races it.
 */
function parsePollTimes(pollTime: unknown): number[] {
  const raw = Array.isArray(pollTime) ? pollTime : [pollTime];

  const minutes = raw
    .map(parseClockTime)
    .filter((value): value is number => value !== null);

  return [...new Set(minutes)].sort((a, b) => a - b);
}

/**
 * What a request's `pollTime` should be stored as: the times it actually
 * names, canonically spelled, in order and without repeats. Anything that is
 * not a time of day is dropped rather than persisted for the scheduler to
 * ignore later, so the column never holds a value the UI cannot show.
 *
 * Shares parseClockTime with the scheduler on purpose - "a valid poll time"
 * has to mean the same thing to whoever writes the column and whoever reads
 * it.
 */
export function normalizePollTimes(value: unknown): string[] {
  return parsePollTimes(value).map(formatClockTime);
}

/**
 * Whether `timeZone` is an IANA zone name this runtime knows, such as
 * "Europe/Kyiv". Anything else - a typo, an offset like "+03:00" - is
 * rejected, because Intl would throw on it the first time the scheduler ran.
 */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone the wall-clock fields are read in: the one saved in settings, or
 * the process's own (`TZ`) when none is saved or it is no longer valid.
 */
export function resolveTimeZone(timeZone?: string | null): string {
  return isValidTimeZone(timeZone)
    ? timeZone
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    });
    formatters.set(timeZone, formatter);
  }

  return formatter;
}

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** What a clock in `timeZone` reads at the instant `date`. */
function wallClockIn(date: Date, timeZone: string): WallClock {
  const parts: Record<string, number> = {};

  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

/** How far `timeZone` is ahead of UTC at `instantMs`, in milliseconds. */
function offsetAt(instantMs: number, timeZone: string): number {
  const { year, month, day, hour, minute, second } = wallClockIn(
    new Date(instantMs),
    timeZone
  );
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Midnight in `timeZone`, `dayOffset` days from the day `now` falls on there,
 * plus `minutes`. Worked out on the calendar date rather than by adding
 * milliseconds, so a day that is not 24 hours long - a DST transition - still
 * lands on the requested wall clock.
 *
 * `minutes` of 24 * 60 is deliberately allowed: Date.UTC rolls it over to
 * midnight the following day, which is what an interval window ending at 24
 * means.
 *
 * The offset is read twice because the guess can sit on the other side of a
 * DST change from the answer. A wall clock skipped by a spring-forward gap
 * comes out shifted by the size of the gap, which is still the right hour of
 * the day to poll.
 */
function zonedTimeOn(
  now: Date,
  dayOffset: number,
  minutes: number,
  timeZone: string
): Date {
  const { year, month, day } = wallClockIn(now, timeZone);
  const wallAsUtc = Date.UTC(year, month - 1, day + dayOffset, 0, minutes);

  const guess = wallAsUtc - offsetAt(wallAsUtc, timeZone);
  const settled = wallAsUtc - offsetAt(guess, timeZone);

  return new Date(settled);
}

function isSameZonedDay(a: Date, b: Date, timeZone: string): boolean {
  const left = wallClockIn(a, timeZone);
  const right = wallClockIn(b, timeZone);

  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day
  );
}

/**
 * Whether a `pollOnce` subscription has already captured a video today and so
 * should be left alone until tomorrow.
 *
 * `lastCaptureAt` is the whole answer: it is written by the same scan that
 * queues the download, so the hold survives a restart and does not need the
 * worker to remember anything between ticks. The day is the one in
 * `timeZone`, the clock the rest of this file schedules against.
 *
 * Off for a subscription without the flag, so nothing else changes.
 */
export function isHeldForToday(
  ch: Channel,
  now: Date,
  timeZone?: string | null
): boolean {
  if (!ch.pollOnce || !ch.lastCaptureAt) return false;

  const captured = new Date(ch.lastCaptureAt);

  if (Number.isNaN(captured.getTime())) return false;

  return isSameZonedDay(captured, now, resolveTimeZone(timeZone));
}

/**
 * The window as the client sends it, or null when it places no limit.
 *
 * A window whose start is not before its end describes no hours at all. The
 * form rejects that, and treating it as "no window" keeps a row that somehow
 * carries one polling instead of going silent.
 */
export function parseIntervalPeriod(intervalPeriod: unknown): IntervalPeriod | null {
  if (!intervalPeriod || typeof intervalPeriod !== "object") return null;

  const { start, end } = intervalPeriod as { start?: unknown; end?: unknown };

  if (typeof start !== "number" || typeof end !== "number") return null;

  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;

  if (start < DAY_START || end > DAY_END || start >= end) return null;

  // The full span is the same thing as no window; the client already sends
  // null for it, so this only catches a row written by hand.
  if (start === DAY_START && end === DAY_END) return null;

  return { start, end };
}

/**
 * The next interval tick, restricted to the hours in `period`.
 *
 * Both edges of the window are polled whatever the interval divides into:
 * the first check of the day lands on the opening hour, and a tick that would
 * overshoot the close is pulled back onto it, so a video uploaded late in the
 * window is not left until the next morning.
 */
function nextIntervalCheck(
  now: Date,
  intervalMs: number,
  period: IntervalPeriod | null,
  timeZone: string
): Date {
  const tick = new Date(now.getTime() + intervalMs);

  if (!period) return tick;

  const opensAt = zonedTimeOn(now, 0, period.start * 60, timeZone);
  const closesAt = zonedTimeOn(now, 0, period.end * 60, timeZone);

  // Still before today's window: open on the hour.
  if (now < opensAt) return opensAt;

  // Inside it, with room for a whole interval.
  if (tick <= closesAt) return tick;

  // Inside it, but the next tick falls past the close - poll the close.
  if (now < closesAt) return closesAt;

  // Past it: tomorrow's opening hour.
  return zonedTimeOn(now, 1, period.start * 60, timeZone);
}

/**
 * When the subscription should next be polled, as an ISO instant, or null
 * when it has nothing to schedule - an interval type with no interval, or a
 * time type with no usable times.
 *
 * Wall-clock fields (`pollTime`, `intervalPeriod`) are read in `timeZone`,
 * the zone saved in settings - the browser's own, filled in by the client
 * the first time it loads. Without one they fall back to the server's clock,
 * so the `TZ` the container runs under decides what "09:00" means.
 *
 * `pollOnce` rows that have already captured today are scheduled straight on
 * to tomorrow's first slot - see isHeldForToday.
 */
export function calculateNextCheck(
  ch: Channel,
  now: Date,
  timeZone?: string | null
): string | null {
  const zone = resolveTimeZone(timeZone);

  // A `pollOnce` row that has already captured today is done for the day: the
  // rest of today's slots are skipped and the search starts on tomorrow.
  const heldForToday = isHeldForToday(ch, now, zone);

  if (ch.pollType === "interval") {
    const minutes = ch.pollInterval ?? 0;

    if (minutes <= 0) return null;

    const period = parseIntervalPeriod(ch.intervalPeriod);

    // Tomorrow's opening hour, or local midnight when the interval runs all
    // day - the first tick the row would have had anyway.
    if (heldForToday) {
      return zonedTimeOn(now, 1, (period?.start ?? DAY_START) * 60, zone).toISOString();
    }

    return nextIntervalCheck(now, minutes * MINUTE_MS, period, zone).toISOString();
  }

  if (ch.pollType === "time") {
    const times = parsePollTimes(ch.pollTime);

    if (!times.length) return null;

    // Ascending, so the first one still ahead today is the earliest; falling
    // through to tomorrow takes the first of the list.
    for (const dayOffset of heldForToday ? [1] : [0, 1]) {
      for (const minutes of times) {
        const target = zonedTimeOn(now, dayOffset, minutes, zone);

        if (target > now) return target.toISOString();
      }
    }
  }

  return null;
}
