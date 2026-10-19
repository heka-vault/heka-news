// The light/dark button in the bar. Without it the system setting decides (tokens.css), so it is
// hidden until this runs. A choice goes in the heka-theme cookie on hekafactory.com, which the
// server reads to render the page in that theme and hekafactory.com reads too, so one choice covers
// both sites. Choosing what the system already shows clears it, and the system decides again.

type Theme = 'light' | 'dark'

const COOKIE = 'heka-theme'
const root = document.documentElement
const system = window.matchMedia('(prefers-color-scheme: dark)')
const systemTheme = (): Theme => (system.matches ? 'dark' : 'light')
const current = (): Theme => (root.dataset.theme as Theme | undefined) ?? systemTheme()
// On news.hekafactory.com the cookie covers hekafactory.com too; in development it stays local.
const domain = location.hostname.endsWith('hekafactory.com') ? '; Domain=hekafactory.com' : ''

function choose(theme: Theme): void {
  const chosen = theme !== systemTheme()
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing from older Safari, and this is one cookie.
  document.cookie = chosen
    ? `${COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax; Secure${domain}`
    : `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure${domain}`
  if (chosen) root.dataset.theme = theme
  else delete root.dataset.theme
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[data-scheme]')) {
    const scheme = meta.dataset.scheme
    meta.media = !chosen
      ? `(prefers-color-scheme: ${scheme})`
      : scheme === theme
        ? 'all'
        : 'not all'
  }
}

for (const toggle of document.querySelectorAll<HTMLButtonElement>('button[data-theme-toggle]')) {
  const show = () => {
    const theme = current()
    toggle.dataset.current = theme
    toggle.setAttribute('aria-label', `Use the ${theme === 'dark' ? 'light' : 'dark'} theme`)
  }
  toggle.addEventListener('click', () => {
    choose(current() === 'dark' ? 'light' : 'dark')
    show()
  })
  system.addEventListener('change', show)
  show()
  toggle.hidden = false
}

export {}
