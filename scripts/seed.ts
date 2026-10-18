// Fill a database with seed data for development and previews. Never production.
//
//   bun run seed                         ./data/heka-news.db (DATABASE_PATH overrides)
//   bun run seed -- --reset              delete the database file first
//   bun run seed -- --db /tmp/x.db       a different file
//
// Refuses to run with NODE_ENV=production, and refuses a database that already has members
// unless --reset is given.

import { existsSync, rmSync } from 'node:fs'
import { openDb } from '../src/db/index.ts'
import { countUsers } from '../src/db/users.ts'
import { seedDatabase } from './seed-data.ts'

if (process.env.NODE_ENV === 'production') {
  console.error('seed: refusing to run with NODE_ENV=production')
  process.exit(1)
}

const args = process.argv.slice(2)
const dbFlag = args.indexOf('--db')
const path =
  (dbFlag >= 0 ? args[dbFlag + 1] : undefined) ?? process.env.DATABASE_PATH ?? './data/heka-news.db'

if (args.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(path + suffix)) rmSync(path + suffix)
  }
}

const db = openDb(path)
if (countUsers(db) > 0) {
  console.error(`seed: ${path} already has members; pass --reset to start over`)
  process.exit(1)
}
seedDatabase(db)
db.close()
console.log(`seed: wrote seed data to ${path}`)
