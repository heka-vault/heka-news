import { describe, expect, test } from 'bun:test'
import { domainOf, formatNumber, plural, readingMinutes, timeAgo } from '../src/lib/format.ts'

describe('format', () => {
  test('numbers and plurals', () => {
    expect(formatNumber(10000)).toBe('10,000')
    expect(plural(1, 'point')).toBe('1 point')
    expect(plural(0, 'point')).toBe('0 points')
    expect(plural(10000, 'comment')).toBe('10,000 comments')
  })

  test('relative time', () => {
    expect(timeAgo(100, 130)).toBe('just now')
    expect(timeAgo(0, 60)).toBe('1 minute ago')
    expect(timeAgo(0, 3 * 3600 + 5)).toBe('3 hours ago')
    expect(timeAgo(0, 86400)).toBe('1 day ago')
    expect(timeAgo(0, 400 * 86400)).toBe('1 year ago')
    expect(timeAgo(500, 100)).toBe('just now')
  })

  test('reading time is at least a minute', () => {
    expect(readingMinutes(10)).toBe(1)
    expect(readingMinutes(6 * 230 * 7)).toBe(7)
  })

  test('domains', () => {
    expect(domainOf('https://www.example.com/a')).toBe('example.com')
    expect(domainOf('http://sub.example.org')).toBe('sub.example.org')
    expect(domainOf('javascript:alert(1)')).toBeNull()
    expect(domainOf('not a url')).toBeNull()
  })
})
