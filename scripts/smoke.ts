// Build-free smoke test: boot the real server process (bun src/server.ts) on a temporary seeded
// database, request every kind of route, and check status codes and a marker in each body.
//
//   bun run smoke

import { serveSeeded } from './serve-seeded.ts'

const server = await serveSeeded()
const checks: [path: string, status: number, marker: string][] = [
  ['/healthz', 200, 'ok smoke'],
  ['/', 200, 'class="items items--ranked"'],
  ['/newest', 200, '<h1>Newest</h1>'],
  ['/posts', 200, '<h1>Posts</h1>'],
  ['/status', 200, '<div class="note" dir="auto">'],
  [`/item/${server.postId}`, 200, 'DiscussionForumPosting'],
  [`/item/${server.statusId}`, 200, 'SocialMediaPosting'],
  ['/t/harness', 200, 'Tagged harness'],
  ['/u/ledgerline', 200, 'ProfilePage'],
  ['/tree', 200, 'class="tree"'],
  ['/moderation', 200, 'class="modlog"'],
  ['/about', 200, 'How membership works'],
  ['/signin', 200, 'sign-in opens soon'],
  ['/rss', 200, '<rss version="2.0"'],
  ['/t/harness/rss', 200, '<category>harness</category>'],
  ['/sitemap.xml', 200, '<urlset'],
  ['/robots.txt', 200, 'Sitemap:'],
  ['/favicon.svg', 200, '<svg'],
  ['/no-such-page', 404, 'Nothing at this address'],
]

let failed = 0
try {
  for (const [path, status, marker] of checks) {
    const res = await fetch(server.origin + path)
    const body = await res.text()
    const ok = res.status === status && body.includes(marker)
    if (!ok) failed++
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${res.status} ${path}${ok ? '' : ` (wanted ${status} and "${marker}")`}`,
    )
  }
} finally {
  server.stop()
}
if (failed > 0) {
  console.error(`smoke: ${failed} of ${checks.length} checks failed`)
  process.exit(1)
}
console.log(`smoke: ${checks.length} routes ok`)
