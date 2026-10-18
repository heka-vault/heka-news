import { describe, expect, test } from 'bun:test'
import { GRAVITY, rankItems, rankScore } from '../src/lib/rank.ts'

const HOUR = 3600
const now = 1_000_000

describe('rankScore', () => {
  test('is (points - 1) / (age_hours + 2) ^ 1.8', () => {
    expect(GRAVITY).toBe(1.8)
    expect(rankScore(101, now - 10 * HOUR, now)).toBeCloseTo(100 / 12 ** 1.8, 10)
    expect(rankScore(2, now, now)).toBeCloseTo(1 / 2 ** 1.8, 10)
  })

  test('an item with only its author vote scores zero; zero points scores below it', () => {
    expect(rankScore(1, now - HOUR, now)).toBe(0)
    expect(rankScore(0, now - HOUR, now)).toBeLessThan(0)
  })

  test('a future timestamp counts as age zero', () => {
    expect(rankScore(11, now + 5 * HOUR, now)).toBe(rankScore(11, now, now))
  })
})

describe('rankItems', () => {
  test('gravity lets a fresh item beat an older one with more points', () => {
    const old = { id: 1, points: 200, createdAt: now - 48 * HOUR }
    const fresh = { id: 2, points: 30, createdAt: now - 1 * HOUR }
    expect(rankItems([old, fresh], now).map((i) => i.id)).toEqual([2, 1])
  })

  test('ties go to the newer item, then the higher id', () => {
    const a = { id: 1, points: 1, createdAt: now - 2 * HOUR }
    const b = { id: 2, points: 1, createdAt: now - 1 * HOUR }
    const c = { id: 3, points: 1, createdAt: now - 1 * HOUR }
    expect(rankItems([a, b, c], now).map((i) => i.id)).toEqual([3, 2, 1])
  })

  test('does not mutate its input', () => {
    const items = [
      { id: 1, points: 1, createdAt: now },
      { id: 2, points: 50, createdAt: now },
    ]
    rankItems(items, now)
    expect(items.map((i) => i.id)).toEqual([1, 2])
  })
})
