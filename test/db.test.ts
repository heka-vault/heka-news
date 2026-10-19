import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { seedDatabase } from '../scripts/seed-data.ts'
import { commentTree, countTree } from '../src/db/comments.ts'
import { migrate, openDb } from '../src/db/index.ts'
import { getItem, listNewest, listRankCandidates } from '../src/db/items.ts'
import { deleteComment } from '../src/db/moderation.ts'
import { inviteTree } from '../src/db/users.ts'
import { createComment, createItem, createTag, createUser } from '../src/db/write.ts'
import { NOW } from './helpers.ts'

function fresh() {
  const db = openDb(':memory:')
  createTag(db, 'harness')
  createTag(db, 'agents')
  createTag(db, 'infra')
  createTag(db, 'security')
  const author = createUser(db, { login: 'someone' })
  return { db, author }
}

describe('migrations', () => {
  test('apply once and are idempotent', () => {
    const db = openDb(':memory:')
    expect(migrate(db)).toEqual([])
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((t) => t.name)
    for (const table of [
      'users',
      'invites',
      'sessions',
      'items',
      'tags',
      'item_tags',
      'comments',
      'item_votes',
      'comment_votes',
      'flags',
      'mod_log',
    ]) {
      expect(tables).toContain(table)
    }
  })
})

describe('migration 0003', () => {
  test('rebuilds mod_log for the moderator actions and keeps every row, id and the index', () => {
    const db = new Database(':memory:', { strict: true })
    db.run('PRAGMA foreign_keys = ON')
    migrate(db, { before: '0003' })
    seedDatabase(db, NOW)
    const insert = (action: string) =>
      db
        .query(
          `INSERT INTO mod_log (moderator_id, action, subject, reason, created_at)
           VALUES ((SELECT min(id) FROM users), ?, 'someone', 'Asked to help.', ?)`,
        )
        .run(action, NOW)
    expect(() => insert('promote_moderator')).toThrow()
    const rows = () => db.query('SELECT * FROM mod_log ORDER BY id').all()
    const before = rows()
    expect(before.length).toBeGreaterThan(0)

    expect(migrate(db, { before: '0004' })).toEqual(['0003_moderator_roles'])
    expect(rows()).toEqual(before)
    const indexes = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'mod_log'",
      )
      .all()
      .map((row) => row.name)
    expect(indexes).toContain('mod_log_created')
    insert('promote_moderator')
    insert('remove_moderator')
    expect(() => insert('crown_king')).toThrow()
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
  })
})

describe('items', () => {
  test('need one to three tags', () => {
    const { db, author } = fresh()
    expect(() =>
      createItem(db, { kind: 'status', authorId: author, bodyMd: 'x', tags: [] }),
    ).toThrow()
    expect(() =>
      createItem(db, {
        kind: 'status',
        authorId: author,
        bodyMd: 'x',
        tags: ['harness', 'agents', 'infra', 'security'],
      }),
    ).toThrow()
    expect(
      createItem(db, { kind: 'status', authorId: author, bodyMd: 'x', tags: ['harness'] }),
    ).toBeGreaterThan(0)
  })

  test('the schema enforces each kind’s shape', () => {
    const { db, author } = fresh()
    expect(() =>
      createItem(db, {
        kind: 'status',
        authorId: author,
        bodyMd: 'x'.repeat(501),
        tags: ['harness'],
      }),
    ).toThrow()
    expect(
      createItem(db, {
        kind: 'status',
        authorId: author,
        bodyMd: 'x'.repeat(500),
        tags: ['harness'],
      }),
    ).toBeGreaterThan(0)
    expect(() =>
      createItem(db, { kind: 'post', authorId: author, title: 't', bodyMd: '', tags: ['harness'] }),
    ).toThrow()
    expect(() =>
      createItem(db, {
        kind: 'link',
        authorId: author,
        title: 't',
        url: 'javascript:alert(1)',
        tags: ['harness'],
      }),
    ).toThrow()
    expect(() =>
      createItem(db, {
        kind: 'link',
        authorId: author,
        title: 'x'.repeat(161),
        url: 'https://example.com',
        tags: ['harness'],
      }),
    ).toThrow()
    const id = createItem(db, {
      kind: 'link',
      authorId: author,
      title: 't',
      url: 'https://www.example.com/a',
      tags: ['harness'],
    })
    expect(getItem(db, id)?.domain).toBe('example.com')
  })

  test('body_html is rendered and cached on write', () => {
    const { db, author } = fresh()
    const id = createItem(db, {
      kind: 'post',
      authorId: author,
      title: 't',
      bodyMd: '# Hi\n\n<script>x</script>',
      tags: ['harness'],
    })
    const item = getItem(db, id)
    expect(item?.bodyHtml).toContain('<h2 dir="auto">Hi</h2>')
    expect(item?.bodyHtml).not.toContain('<script')
  })
})

describe('comments', () => {
  test('keep comment_count and the tree in step; removed comments keep their replies', () => {
    const { db, author } = fresh()
    const item = createItem(db, {
      kind: 'status',
      authorId: author,
      bodyMd: 'x',
      tags: ['harness'],
    })
    const a = createComment(db, { itemId: item, authorId: author, bodyMd: 'a' })
    const b = createComment(db, { itemId: item, authorId: author, bodyMd: 'b', parentId: a })
    createComment(db, { itemId: item, authorId: author, bodyMd: 'c', parentId: b })
    const lone = createComment(db, { itemId: item, authorId: author, bodyMd: 'lone' })
    expect(getItem(db, item)?.commentCount).toBe(4)

    deleteComment(db, a, author, 'test')
    deleteComment(db, lone, author, 'test')
    expect(getItem(db, item)?.commentCount).toBe(2)
    const tree = commentTree(db, item)
    expect(tree).toHaveLength(1)
    expect(tree[0]?.deleted).toBe(true)
    expect(tree[0]?.bodyHtml).toBe('')
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2)
    expect(countTree(tree)).toBe(2)
  })

  test('a reply must be on the same item as its parent', () => {
    const { db, author } = fresh()
    const one = createItem(db, { kind: 'status', authorId: author, bodyMd: 'x', tags: ['harness'] })
    const two = createItem(db, { kind: 'status', authorId: author, bodyMd: 'y', tags: ['harness'] })
    const c = createComment(db, { itemId: one, authorId: author, bodyMd: 'a' })
    expect(() =>
      createComment(db, { itemId: two, authorId: author, bodyMd: 'b', parentId: c }),
    ).toThrow()
  })
})

describe('seed data', () => {
  test('loads, with the worst cases in place', () => {
    const db = openDb(':memory:')
    seedDatabase(db, NOW)
    const items = listRankCandidates(db, 500)
    expect(items.length).toBeGreaterThanOrEqual(27)
    expect(items.some((i) => i.points === 0)).toBe(true)
    expect(items.some((i) => i.points === 10000)).toBe(true)
    expect(items.some((i) => (i.title?.length ?? 0) >= 155)).toBe(true)
    expect(listNewest(db, { kind: 'status', limit: 50, offset: 0 }).length).toBeGreaterThanOrEqual(
      6,
    )
    expect(inviteTree(db)).toHaveLength(3)
  })
})

describe('members', () => {
  test('logins follow GitHub’s rules; display names are bounded', () => {
    const db = openDb(':memory:')
    expect(createUser(db, { login: 'a'.repeat(39) })).toBeGreaterThan(0)
    expect(() => createUser(db, { login: 'b'.repeat(40) })).toThrow()
    expect(() => createUser(db, { login: 'has space' })).toThrow()
    expect(() => createUser(db, { login: '../etc' })).toThrow()
    expect(() => createUser(db, { login: 'ok-name', displayName: 'x'.repeat(81) })).toThrow()
  })
})

describe('migration 0004', () => {
  test('adds the talk tables', () => {
    const db = new Database(':memory:', { strict: true })
    migrate(db, { before: '0004' })
    expect(migrate(db)).toEqual(['0004_talk'])
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name)
    for (const table of ['talk_visitors', 'talk_days', 'talk_conversations']) {
      expect(tables).toContain(table)
    }
  })
})
