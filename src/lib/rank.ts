// Front page ranking (ADR 0004): Hacker News' gravity formula, computed at read time.
//
//   score = (points - 1) / (age_hours + 2) ^ 1.8

export const GRAVITY = 1.8

/** The rank score of an item with `points` created at `createdAt`, at time `now` (Unix seconds). */
export function rankScore(points: number, createdAt: number, now: number): number {
  const ageHours = Math.max(0, now - createdAt) / 3600
  return (points - 1) / (ageHours + 2) ** GRAVITY
}

export interface Rankable {
  id: number
  points: number
  createdAt: number
}

/** A new array, best first. Ties go to the newer item, then the higher id. */
export function rankItems<T extends Rankable>(items: readonly T[], now: number): T[] {
  return items
    .map((item) => ({ item, score: rankScore(item.points, item.createdAt, now) }))
    .sort(
      (a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt || b.item.id - a.item.id,
    )
    .map(({ item }) => item)
}
