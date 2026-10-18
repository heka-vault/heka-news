// Keeps relative times ("3 minutes ago") current. Pages are rendered on the server and may sit in a
// shared cache for a few minutes, so the times are corrected on load and once a minute after. The
// server's text stays if this never runs. Same wording as src/lib/format.ts timeAgo().

const UNITS: [limit: number, seconds: number, unit: string][] = [
  [3600, 60, 'minute'],
  [86400, 3600, 'hour'],
  [86400 * 30, 86400, 'day'],
  [86400 * 365, 86400 * 30, 'month'],
  [Number.POSITIVE_INFINITY, 86400 * 365, 'year'],
]

const numbers = new Intl.NumberFormat('en-US')

function ago(then: number, now: number): string {
  const elapsed = Math.max(0, now - then)
  if (elapsed < 60) return 'just now'
  for (const [limit, seconds, unit] of UNITS) {
    if (elapsed < limit) {
      const n = Math.floor(elapsed / seconds)
      return `${numbers.format(n)} ${n === 1 ? unit : `${unit}s`} ago`
    }
  }
  return ''
}

function update(): void {
  const now = Date.now() / 1000
  for (const el of document.querySelectorAll<HTMLTimeElement>('time[data-ago]')) {
    const at = Date.parse(el.dateTime) / 1000
    if (Number.isNaN(at)) continue
    const text = ago(at, now)
    if (text && el.textContent !== text) el.textContent = text
  }
}

update()
let timer = window.setInterval(update, 60_000)
document.addEventListener('visibilitychange', () => {
  window.clearInterval(timer)
  if (document.visibilityState === 'visible') {
    update()
    timer = window.setInterval(update, 60_000)
  }
})
// Replies added in place carry times too.
document.addEventListener('heka:inserted', update)

export {}
