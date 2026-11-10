// Pure scheduling logic (no Alexa dependencies) so it can be tested on its own.

export const DEFAULT_MINUTES = 25;
export const MAX_MINUTES = 120; // Alexa timers cannot be set more than 2 hours ahead
// Alexa documents a per-skill timer limit between 10 and 25, and personal timers may count
// towards it. Stay at 10 so a normal household's own timers don't block a session.
export const MAX_TIMERS = 10;

export interface Checkpoint {
  /** Minutes after the start at which this timer fires. */
  at: number;
  text: string;
}

const left = (r: number): string => (r === 1 ? 'One minute left.' : `${r} minutes left.`);

/**
 * Reminder schedule for a session of `total` minutes.
 *
 * - "Time's up" at `total`.
 * - 1 and 5 minutes left (when the session is long enough for them).
 * - Reminders at minutes-left divisible by 5 above 5. If that would need more than the
 *   timer budget allows, use the smallest multiple-of-5 spacing that fits (10, 15, 20...).
 *
 * Examples: 13 -> 10, 5, 1 left. 25 -> 20, 15, 10, 5, 1 left.
 */
export const buildCheckpoints = (total: number): Checkpoint[] => {
  const budget = MAX_TIMERS - 1 /* final */ - (total > 5 ? 1 : 0) /* 5 left */ - (total > 1 ? 1 : 0) /* 1 left */;
  let spacing = 5;
  const bigOnes = (s: number): number[] => {
    const out: number[] = [];
    for (let r = s; r < total; r += s) if (r > 5) out.push(r);
    return out;
  };
  while (bigOnes(spacing).length > budget) spacing += 5;

  const remaining = new Set<number>(bigOnes(spacing));
  if (total > 5) remaining.add(5);
  if (total > 1) remaining.add(1);

  const points: Checkpoint[] = [...remaining]
    .sort((a, b) => b - a)
    .map((r) => ({ at: total - r, text: left(r) }));
  points.push({ at: total, text: "Time's up. Chores done, well done everyone!" });
  return points;
};

/** Returns a whole number of minutes in 1..MAX_MINUTES, or undefined if the value is invalid. */
export const parseMinutes = (raw: string | undefined): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_MINUTES ? n : undefined;
};

export const spokenMinutes = (n: number): string => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
