import { isoTime, longDate, timeAgo } from '../../lib/format.ts'

/** A relative time ("3 hours ago") with the exact time for machines and the date on hover. */
export function Time({ at, now }: { at: number; now: number }) {
  return (
    <time datetime={isoTime(at)} title={longDate(at)}>
      {timeAgo(at, now)}
    </time>
  )
}
