// Start the real server process on a temporary, seeded database: used by the smoke test and the
// Lighthouse gate. Returns the origin, a few item ids worth testing, and a stop function.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db/index.ts'
import { listNewest } from '../src/db/items.ts'
import { seedDatabase } from './seed-data.ts'

const ROOT = join(import.meta.dir, '..')

export interface SeededServer {
  origin: string
  postId: number
  statusId: number
  stop: () => void
}

export async function serveSeeded(): Promise<SeededServer> {
  const dir = mkdtempSync(join(tmpdir(), 'heka-news-'))
  const dbPath = join(dir, 'heka-news.db')
  const db = openDb(dbPath)
  seedDatabase(db)
  const post = listNewest(db, { kind: 'post', limit: 50, offset: 0 }).find((i) =>
    i.title?.startsWith('Holdout'),
  )
  const status = listNewest(db, { kind: 'status', limit: 1, offset: 0 })[0]
  db.close()
  if (!post || !status) throw new Error('seed data has no post or status note')

  const port = 20000 + Math.floor(Math.random() * 20000)
  const origin = `http://127.0.0.1:${port}`
  const proc = Bun.spawn(['bun', 'src/server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: dbPath,
      PUBLIC_URL: origin,
      GIT_SHA: 'smoke',
    },
    stdout: 'ignore',
    stderr: 'inherit',
  })
  const stop = () => {
    proc.kill()
    rmSync(dir, { recursive: true, force: true })
  }

  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin}/healthz`)).ok) {
        return { origin, postId: post.id, statusId: status.id, stop }
      }
    } catch {
      // not listening yet
    }
    await Bun.sleep(50)
  }
  stop()
  throw new Error('the server did not answer /healthz within 5 seconds')
}
