// Static assets, built once at startup: the stylesheet (fonts' @font-face rules, tokens, base and
// app CSS, concatenated and minified), the self-hosted font files, and public/. Nothing is built
// ahead of time (ADR 0001), so the Docker image copies source and this does the rest.
//
// The stylesheet is inlined into every page (about 7 KB compressed) rather than linked: on a slow
// phone connection a linked stylesheet is one more round trip before anything paints, and that
// cost Lighthouse points on every page. Fonts are separate, immutable files.

import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const SRC = join(import.meta.dir, '..')
const ROOT = join(SRC, '..')
const STYLES = ['tokens.css', 'base.css', 'app.css']

/**
 * Font CSS files to include from each @fontsource-variable package. Archivo needs its width axis
 * (wide display headings). Source Serif 4 uses the weight-only files (50 KB for Latin) rather than
 * the optical-size ones (120 KB): every serif here is reading text between 16 and 21px, where the
 * optical axis barely changes, and the 70 KB came straight off the time to first paint on a phone
 * (docs/design-plan.md, "Type").
 */
const FONTS: Record<string, string[]> = {
  archivo: ['wdth.css'],
  'source-serif-4': ['wght.css', 'wght-italic.css'],
}

/** Faces every page needs at first paint; preloaded from the <head>. */
const PRELOAD = ['archivo-latin-wdth-normal.woff2', 'source-serif-4-latin-wght-normal.woff2']

export interface Assets {
  /** The whole stylesheet, minified, for a <style> element. */
  css: string
  /** Absolute file path of a font by its public path (/fonts/<version>/<file>), if known. */
  fonts: Map<string, string>
  /** Public paths of fonts to preload. */
  preloads: string[]
  /** public/ files by URL path. */
  publicFiles: Map<string, string>
}

/** Comments out, whitespace collapsed. Enough for hand-written CSS with no strings that matter. */
export function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()
}

export function buildAssets(): Assets {
  const fonts = new Map<string, string>()
  const fontCss: string[] = []
  for (const [pkg, files] of Object.entries(FONTS)) {
    const pkgJson = Bun.resolveSync(`@fontsource-variable/${pkg}/package.json`, ROOT)
    const pkgDir = dirname(pkgJson)
    const version = (JSON.parse(readFileSync(pkgJson, 'utf8')) as { version: string }).version
    const prefix = `/fonts/${pkg}-${version}`
    for (const file of files) {
      // font-display: optional. The regular faces are preloaded, so on any reasonable connection
      // they arrive inside the 100ms block period and are used at first paint. On a slow first
      // visit the page keeps the fallback face instead of re-laying out the text when the font
      // lands: no layout shift and no largest-paint delay. The next page has the font cached.
      const css = readFileSync(join(pkgDir, file), 'utf8')
        .replaceAll('font-display: swap', 'font-display: optional')
        .replace(/url\(\.\/files\/([\w.-]+)\)/g, (_, name: string) => {
          fonts.set(`${prefix}/${name}`, join(pkgDir, 'files', name))
          return `url(${prefix}/${name})`
        })
      fontCss.push(css)
    }
  }

  const styles = STYLES.map((name) => readFileSync(join(SRC, 'styles', name), 'utf8'))
  const css = minifyCss([...fontCss, ...styles].join('\n'))

  const preloads = [...fonts.keys()].filter((path) => PRELOAD.includes(basename(path)))

  const publicDir = join(ROOT, 'public')
  const publicFiles = new Map<string, string>()
  for (const name of readdirSync(publicDir)) publicFiles.set(`/${name}`, join(publicDir, name))

  return { css, fonts, preloads, publicFiles }
}
