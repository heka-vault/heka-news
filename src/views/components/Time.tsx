import { isoTime, longDate, timeAgo } from '../../lib/format.ts'

/**
 * A relative time ("3 hours ago") with the exact time for machines and the date on hover.
 * src/client/time.ts keeps the words current on cached pages (data-ago).
 */
export function Time({ at, now }: { at: number; now: number }) {
  return (
    <time datetime={isoTime(at)} title={longDate(at)} data-ago="">
      {timeAgo(at, now)}
    </time>
  )
}
