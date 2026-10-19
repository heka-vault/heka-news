// The process entry point: open the database (migrating it), refresh stale rendered HTML, serve.
//
//   bun src/server.ts                      PORT=8080, DATABASE_PATH=./data/heka-news.db
//
// Environment: see src/config.ts and deploy/prod/compose.yaml.

import { createApp } from './app.tsx'
import { loadConfig } from './config.ts'
import { openDb } from './db/index.ts'
import { rerenderStale } from './db/write.ts'
import { createOutbox } from './lib/outbox.ts'

const config = loadConfig()
const db = openDb(config.databasePath)
const rerendered = rerenderStale(db)
if (rerendered > 0) console.log(`re-rendered ${rerendered} rows for the current markdown version`)

// The Discord bridge's outbox (ADR 0009): sent right after each change, and every minute for
// retries and anything left from before a restart.
const outbox = createOutbox({
  db,
  bridge: config.bridge,
  publicUrl: config.publicUrl,
  clock: () => Math.floor(Date.now() / 1000),
  fetch,
  autoDrain: true,
})
if (outbox.enabled) setInterval(() => void outbox.drain(), 60_000)

const app = createApp({ db, config, outbox })
const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch })
console.log(
  `heka news ${config.gitSha} on http://${server.hostname}:${server.port} (${config.databasePath})`,
)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.stop()
    db.close()
    process.exit(0)
  })
}
