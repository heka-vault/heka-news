// The heka mark (hekafactory.com, Mark.astro): a tally of four changes. The tall violet bar is the
// change a person read; the other three were checked by the harness. Bars follow the text color.

export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg class="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="3" width="5" height="26" rx="1" fill="var(--mark-read, var(--stamp))" />
      <rect x="10" y="11" width="5" height="18" rx="1" fill="currentColor" />
      <rect x="17" y="11" width="5" height="18" rx="1" fill="currentColor" />
      <rect x="24" y="11" width="5" height="18" rx="1" fill="currentColor" />
    </svg>
  )
}
