// The Lighthouse gate (CLAUDE.md): 100 in performance, accessibility, best practices and SEO on
// the front page, a long-form post and a profile, on mobile and on desktop.
//
//   bun run lighthouse                 needs Chrome (CHROME_PATH, default /usr/bin/google-chrome)
//   LIGHTHOUSE_PRESETS=mobile bun run lighthouse      one form factor while iterating
//
// Starts the real server on a temporary seeded database, runs Lighthouse CI (lighthouserc.json:
// three runs per page, median run asserted at 1.0 in every category) once per form factor, and
// prints the scores.

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { serveSeeded } from './serve-seeded.ts'

const ROOT = join(import.meta.dir, '..')
const OUT = join(ROOT, '.lighthouseci')
const chromePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'
if (!existsSync(chromePath)) {
  console.error(`lighthouse: no Chrome at ${chromePath}; set CHROME_PATH`)
  process.exit(1)
}

interface Lhr {
  requestedUrl: string
  categories: Record<string, { score: number | null }>
}

const server = await serveSeeded()
const pages = ['/', `/item/${server.postId}`, '/u/ledgerline']
let failed = false

try {
  const presets = (process.env.LIGHTHOUSE_PRESETS ?? 'mobile,desktop').split(',')
  for (const preset of presets) {
    rmSync(OUT, { recursive: true, force: true })
    const args = [
      'bunx',
      'lhci',
      'collect',
      '--config=lighthouserc.json',
      ...pages.map((path) => `--url=${server.origin}${path}`),
      ...(preset === 'desktop' ? ['--settings.preset=desktop'] : []),
    ]
    const collect = Bun.spawnSync(args, {
      cwd: ROOT,
      env: { ...process.env, CHROME_PATH: chromePath },
      stdout: 'ignore',
      stderr: 'inherit',
    })
    if (collect.exitCode !== 0) throw new Error(`lhci collect failed (${preset})`)

    // Print every run's scores, grouped by page.
    const runs = readdirSync(OUT)
      .filter((f) => f.startsWith('lhr-') && f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(OUT, f), 'utf8')) as Lhr)
    console.log(`\n${preset}`)
    for (const path of pages) {
      const scores = runs
        .filter((r) => r.requestedUrl === server.origin + path)
        .map((r) =>
          ['performance', 'accessibility', 'best-practices', 'seo']
            .map((c) => Math.round((r.categories[c]?.score ?? 0) * 100))
            .join('/'),
        )
      console.log(`  ${path.padEnd(14)} ${scores.join('  ')}   (perf/a11y/bp/seo per run)`)
    }

    const assert = Bun.spawnSync(['bunx', 'lhci', 'assert', '--config=lighthouserc.json'], {
      cwd: ROOT,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if (assert.exitCode !== 0) failed = true
  }
} finally {
  server.stop()
}

if (failed) {
  console.error('\nlighthouse: below 100 somewhere; see the assertions above and .lighthouseci/')
  process.exit(1)
}
console.log('\nlighthouse: 100 in every category, every page, mobile and desktop')
