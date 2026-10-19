import { describe, expect, test } from 'bun:test'
import { RATE_LIMITS, RULES } from '../src/config.ts'
import { getComment } from '../src/db/comments.ts'
import { getItem, listRankCandidates } from '../src/db/items.ts'
import { takeRate } from '../src/db/ratelimit.ts'
import { getProfile } from '../src/db/users.ts'
import { normalizeUrl } from '../src/lib/validate.ts'
import { type Member, makeApp, signIn } from './helpers.ts'

function itemIdFrom(res: Response): number {
  return Number(res.headers.get('Location')?.match(/^\/item\/(\d+)/)?.[1] ?? 0)
}

async function postLink(member: Member, fields: Record<string, string | string[]> = {}) {
  return member.post('/submit?kind=link', {
    title: 'A link worth reading',
    url: 'https://example.com/an/article',
    tags: ['harness'],
    ...fields,
  })
}

describe('submitting', () => {
  test('a link, a post and a status note', async () => {
    const fx = makeApp()
    const m = signIn(fx, 'quietfox')
    const link = await postLink(m)
    expect(link.status).toBe(303)
    expect(getItem(fx.db, itemIdFrom(link))?.domain).toBe('example.com')

    const post = await m.post('/submit?kind=post', {
      title: 'My post',
      body: '## Heading\n\nText.',
      tags: ['agents', 'infra'],
    })
    const postItem = getItem(fx.db, itemIdFrom(post))
    expect(postItem?.kind).toBe('post')
    expect(postItem?.bodyHtml).toContain('<h2 dir="auto">Heading</h2>')
    expect(postItem?.tags).toEqual(['agents', 'infra'])

    const status = await m.post('/submit?kind=status', {
      body: 'Shipping the gate today.',
      tags: ['infra'],
      title: 'ignored',
    })
    const note = getItem(fx.db, itemIdFrom(status))
    expect(note?.kind).toBe('status')
    expect(note?.title).toBeNull()
    expect(note?.points).toBe(1)
  })

  test('errors re-render the form with what was typed', async () => {
    const fx = makeApp()
    const m = signIn(fx, 'quietfox')
    const res = await m.post('/submit?kind=link', {
      title: 'Kept <title> & all',
      url: 'not a url',
      tags: ['harness', 'agents', 'infra', 'security'],
    })
    expect(res.status).toBe(422)
    const html = await res.text()
    expect(html).toContain('value="Kept &lt;title&gt; &amp; all"')
    expect(html).toContain('That is not a web address')
    expect(html).toContain('Pick up to 3 tags')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('class="error-summary"')

    const long = await m.post('/submit?kind=status', { body: 'x'.repeat(501), tags: ['infra'] })
    expect(long.status).toBe(422)
    expect(await long.text()).toContain(
      'A status note can be up to 500 characters; this is 501 characters.',
    )

    const none = await m.post('/submit?kind=post', { title: 'T', body: 'B' })
    expect(await none.text()).toContain('Pick at least one tag.')
  })

  test('a link posted in the last 30 days points at the existing item', async () => {
    const fx = makeApp()
    const a = signIn(fx, 'quietfox')
    const b = signIn(fx, 'oxbow')
    const first = itemIdFrom(
      await postLink(a, { url: 'https://www.example.com/an/article/?utm_source=x#top' }),
    )
    const dupe = await postLink(b, { url: 'http://example.com/an/article' })
    expect(dupe.status).toBe(409)
    const html = await dupe.text()
    expect(html).toContain('This link is already here.')
    expect(html).toContain(`href="/item/${first}"`)
    fx.advance(RULES.duplicateWindow + 1)
    expect((await postLink(b, { url: 'http://example.com/an/article' })).status).toBe(303)
  })

  test('URL normalization ignores scheme, www, fragments, tracking and a trailing slash', () => {
    expect(normalizeUrl('https://www.Example.com/a/?utm_medium=x&id=3#f')).toBe(
      'example.com/a?id=3',
    )
    expect(normalizeUrl('http://example.com/a?id=3')).toBe('example.com/a?id=3')
    expect(normalizeUrl('https://example.com/a?id=4')).not.toBe(
      normalizeUrl('https://example.com/a?id=3'),
    )
  })

  test('signed out, /submit asks you to sign in', async () => {
    const fx = makeApp()
    const res = await fx.get('/submit?kind=post')
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/signin?next=%2Fsubmit%3Fkind%3Dpost')
  })

  test('the preview button renders without saving', async () => {
    const fx = makeApp()
    const m = signIn(fx, 'quietfox')
    const before = fx.db.query('SELECT count(*) AS n FROM items').get()
    const res = await m.post('/submit?kind=post', {
      title: 'T',
      body: '**bold**',
      tags: ['harness'],
      intent: 'preview',
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<strong>bold</strong>')
    expect(fx.db.query('SELECT count(*) AS n FROM items').get()).toEqual(before)
  })
})

describe('edit windows and deleting', () => {
  test('an author can edit an item for two hours, then not', async () => {
    const fx = makeApp()
    const m = signIn(fx, 'quietfox')
    const id = itemIdFrom(await postLink(m))
    expect((await m.get(`/item/${id}/edit`)).status).toBe(200)
    const ok = await m.post(`/item/${id}/edit`, {
      title: 'A better title',
      body: 'Now with text.',
      tags: ['agents'],
    })
    expect(ok.status).toBe(303)
    const edited = getItem(fx.db, id)
    expect(edited?.title).toBe('A better title')
    expect(edited?.editedAt).toBe(fx.now())
    expect(edited?.url).toBe('https://example.com/an/article')
    fx.advance(RULES.editWindow)
    expect((await m.get(`/item/${id}/edit`)).status).toBe(403)
    expect((await m.post(`/item/${id}/edit`, { title: 'Late', tags: ['agents'] })).status).toBe(403)
    expect(getItem(fx.db, id)?.title).toBe('A better title')
  })

  test('only the author can edit or delete', async () => {
    const fx = makeApp()
    const id = itemIdFrom(await postLink(signIn(fx, 'quietfox')))
    const other = signIn(fx, 'oxbow')
    expect((await other.get(`/item/${id}/edit`)).status).toBe(403)
    expect((await other.post(`/item/${id}/delete`)).status).toBe(403)
    expect(getItem(fx.db, id)?.deleted).toBe(false)
  })

  test('deleting an item is soft and its page says the author deleted it', async () => {
    const fx = makeApp()
    const m = signIn(fx, 'quietfox')
    const id = itemIdFrom(await postLink(m))
    expect((await m.post(`/item/${id}/delete`)).status).toBe(303)
    const item = getItem(fx.db, id)
    expect(item?.deleted).toBe(true)
    expect(item?.removedBy).toBe('author')
    const page = await fx.get(`/item/${id}`)
    expect(page.status).toBe(410)
    expect(await page.text()).toContain('Its author deleted it.')
  })

  test('comments: edit for two hours; deleting keeps the thread shape as [deleted]', async () => {
    const fx = makeApp()
    const a = signIn(fx, 'quietfox')
    const b = signIn(fx, 'oxbow')
    const itemId = itemIdFrom(await postLink(a))
    const top = await b.post(`/item/${itemId}/comments`, { body: 'First.' })
    expect(top.status).toBe(303)
    const topId = Number(top.headers.get('Location')?.match(/#c(\d+)$/)?.[1])
    const reply = await a.post(`/item/${itemId}/comments`, {
      body: 'A reply.',
      parent: String(topId),
    })
    const replyId = Number(reply.headers.get('Location')?.match(/#c(\d+)$/)?.[1])
    expect(getComment(fx.db, replyId)?.parentId).toBe(topId)
    expect(getItem(fx.db, itemId)?.commentCount).toBe(2)

    expect((await b.post(`/c/${topId}/edit`, { body: 'First, edited.' })).status).toBe(303)
    expect(getComment(fx.db, topId)?.bodyMd).toBe('First, edited.')
    expect((await a.post(`/c/${topId}/edit`, { body: 'Not mine.' })).status).toBe(403)
    fx.advance(RULES.editWindow + 1)
    expect((await b.post(`/c/${topId}/edit`, { body: 'Too late.' })).status).toBe(403)

    expect((await b.post(`/c/${topId}/delete`)).status).toBe(303)
    expect(getItem(fx.db, itemId)?.commentCount).toBe(1)
    const html = await (await fx.get(`/item/${itemId}`)).text()
    expect(html).toContain('[deleted]')
    expect(html).not.toContain('First, edited.')
    expect(html).toContain('A reply.')
  })

  test('a reply in place comes back as JSON with the rendered comment', async () => {
    const fx = makeApp()
    const a = signIn(fx, 'quietfox')
    const b = signIn(fx, 'oxbow')
    const itemId = itemIdFrom(await postLink(a))
    const top = await b.post(`/item/${itemId}/comments`, { body: 'Top.' })
    const topId = top.headers.get('Location')?.match(/#c(\d+)$/)?.[1] ?? ''
    const res = await a.post(
      `/item/${itemId}/comments`,
      { body: 'In place *reply*', parent: topId },
      { headers: { accept: 'application/json' } },
    )
    expect(res.status).toBe(201)
    const data = (await res.json()) as { id: number; html: string; listClass: string }
    expect(data.html).toContain(`id="c${data.id}"`)
    expect(data.html).toContain('<em>reply</em>')
    expect(data.listClass).toBe('c-children')
  })
})

describe('votes', () => {
  test('one per member, idempotent, can be taken back, never on your own', async () => {
    const fx = makeApp()
    const author = signIn(fx, 'quietfox')
    const voter = signIn(fx, 'oxbow')
    const id = itemIdFrom(await postLink(author))
    const json = { headers: { accept: 'application/json' } }

    const own = await author.post(`/item/${id}/vote`, { dir: 'up' }, json)
    expect(own.status).toBe(403)
    expect(getItem(fx.db, id)?.points).toBe(1)

    expect(await (await voter.post(`/item/${id}/vote`, { dir: 'up' }, json)).json()).toEqual({
      points: 2,
      voted: true,
    })
    expect(await (await voter.post(`/item/${id}/vote`, { dir: 'up' }, json)).json()).toEqual({
      points: 2,
      voted: true,
    })
    expect(await (await voter.post(`/item/${id}/vote`, { dir: 'un' }, json)).json()).toEqual({
      points: 1,
      voted: false,
    })
    expect(await (await voter.post(`/item/${id}/vote`, { dir: 'un' }, json)).json()).toEqual({
      points: 1,
      voted: false,
    })
  })

  test('without JavaScript the vote form redirects back, and the mark shows it is pressed', async () => {
    const fx = makeApp()
    const voter = signIn(fx, 'oxbow')
    const id = itemIdFrom(await postLink(signIn(fx, 'quietfox')))
    const res = await voter.post(`/item/${id}/vote`, { dir: 'up', next: '/newest#i1' })
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/newest#i1')
    const html = await (await voter.get(`/item/${id}`)).text()
    expect(html).toContain('aria-pressed="true"')
    const evil = await voter.post(`/item/${id}/vote`, { dir: 'un', next: '//evil.example' })
    expect(evil.headers.get('Location')).toBe('/')
  })

  test('comment votes follow the same rules', async () => {
    const fx = makeApp()
    const a = signIn(fx, 'quietfox')
    const b = signIn(fx, 'oxbow')
    const itemId = itemIdFrom(await postLink(a))
    const c = await a.post(`/item/${itemId}/comments`, { body: 'Mine.' })
    const cid = c.headers.get('Location')?.match(/#c(\d+)$/)?.[1]
    const json = { headers: { accept: 'application/json' } }
    expect((await a.post(`/c/${cid}/vote`, { dir: 'up' }, json)).status).toBe(403)
    expect(await (await b.post(`/c/${cid}/vote`, { dir: 'up' }, json)).json()).toEqual({
      points: 2,
      voted: true,
    })
  })

  test('your own item shows your filled mark, not a button', async () => {
    const fx = makeApp()
    const a = signIn(fx, 'quietfox')
    const id = itemIdFrom(await postLink(a))
    const html = await (await a.get(`/item/${id}`)).text()
    expect(html).toContain('vote__mark vote__mark--own')
    expect(html).not.toContain(`action="/item/${id}/vote"`)
  })
})

describe('flags', () => {
  test('three flags take an item off the front page until a moderator acts', async () => {
    const fx = makeApp()
    const id = itemIdFrom(await postLink(signIn(fx, 'quietfox')))
    const onFront = () =>
      listRankCandidates(fx.db, 500, RULES.flagThreshold).some((i) => i.id === id)
    expect(onFront()).toBe(true)
    for (const login of ['oxbow', 'tinplate']) {
      expect((await signIn(fx, login).post(`/item/${id}/flag`, { reason: 'spam' })).status).toBe(
        303,
      )
    }
    expect(onFront()).toBe(true)
    await signIn(fx, 'jo').post(`/item/${id}/flag`, { reason: 'off-topic' })
    expect(getItem(fx.db, id)?.flagCount).toBe(3)
    expect(onFront()).toBe(false)
    expect(await (await fx.get('/')).text()).not.toContain(`id="i${id}"`)
    // Still readable, and still on /newest.
    expect((await fx.get(`/item/${id}`)).status).toBe(200)
    expect(await (await fx.get('/newest')).text()).toContain(`id="i${id}"`)
  })

  test('one flag per member, none on your own, and a flag can be withdrawn', async () => {
    const fx = makeApp()
    const author = signIn(fx, 'quietfox')
    const id = itemIdFrom(await postLink(author))
    const m = signIn(fx, 'oxbow')
    await m.post(`/item/${id}/flag`, { reason: 'spam' })
    await m.post(`/item/${id}/flag`, { reason: 'spam' })
    expect(getItem(fx.db, id)?.flagCount).toBe(1)
    expect((await author.post(`/item/${id}/flag`, { reason: 'spam' })).status).toBe(403)
    expect(await (await m.get(`/item/${id}/flag`)).text()).toContain('You flagged it as spam.')
    await m.post(`/item/${id}/flag`, { intent: 'withdraw' })
    expect(getItem(fx.db, id)?.flagCount).toBe(0)
    expect((await m.post(`/item/${id}/flag`, { reason: 'nonsense' })).status).toBe(422)
  })
})

describe('rate limits', () => {
  test('the counter allows the limit in an hour, then refuses, then recovers', () => {
    const fx = makeApp()
    const user =
      fx.db.query<{ id: number }, []>("SELECT id FROM users WHERE login = 'quietfox'").get()?.id ??
      0
    for (let i = 0; i < 3; i++) expect(takeRate(fx.db, user, 'x', 3, 1000 + i)).toBe(true)
    expect(takeRate(fx.db, user, 'x', 3, 1100)).toBe(false)
    expect(takeRate(fx.db, user, 'y', 3, 1100)).toBe(true)
    expect(takeRate(fx.db, user, 'x', 3, 1000 + 3600)).toBe(true)
  })

  test('the eleventh item in an hour gets a friendly 429', async () => {
    const fx = makeApp()
    const m = signIn(fx, 'quietfox')
    for (let i = 0; i < RATE_LIMITS.item; i++) {
      expect(
        (await m.post('/submit?kind=status', { body: `Note ${i}`, tags: ['infra'] })).status,
      ).toBe(303)
    }
    const res = await m.post('/submit?kind=status', { body: 'One too many', tags: ['infra'] })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('3600')
    expect(await res.text()).toContain('Slow down a little')
    fx.advance(3600)
    expect((await m.post('/submit?kind=status', { body: 'Later', tags: ['infra'] })).status).toBe(
      303,
    )
  })

  test('votes are limited too, and fetch gets JSON', async () => {
    const fx = makeApp()
    const m = signIn(fx, 'oxbow')
    const user = m.id
    for (let i = 0; i < RATE_LIMITS.vote; i++)
      takeRate(fx.db, user, 'vote', RATE_LIMITS.vote, fx.now())
    const id = itemIdFrom(await postLink(signIn(fx, 'quietfox')))
    const res = await m.post(
      `/item/${id}/vote`,
      { dir: 'up' },
      { headers: { accept: 'application/json' } },
    )
    expect(res.status).toBe(429)
    expect(((await res.json()) as { error: string }).error).toContain('300 votes')
  })
})

/** Real tags in HTML (escaped text does not count): none may run script or load an image. */
function expectNoActiveMarkup(html: string) {
  for (const tag of html.match(/<[a-z][^>]*>/gi) ?? []) {
    expect(tag).not.toMatch(/^<(script|img|iframe|object|embed|style)\b/i)
    expect(tag).not.toMatch(/\son[a-z]+=/i)
    expect(tag).not.toMatch(/javascript:/i)
  }
}

describe('markdown stays safe in comments and bios', () => {
  const ATTACKS = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '<a href="https://x.test" onclick="alert(1)">x</a>',
    '![t](https://tracker.example/pixel.gif)',
  ].join('\n\n')

  test('a comment', async () => {
    const fx = makeApp()
    const a = signIn(fx, 'quietfox')
    const itemId = itemIdFrom(await postLink(a))
    const res = await signIn(fx, 'oxbow').post(`/item/${itemId}/comments`, { body: ATTACKS })
    const id = Number(res.headers.get('Location')?.match(/#c(\d+)$/)?.[1])
    const html = getComment(fx.db, id)?.bodyHtml ?? ''
    expect(html).toContain('&lt;script&gt;')
    expectNoActiveMarkup(html)
    const page = await (await fx.get(`/item/${itemId}`)).text()
    expect(page).not.toMatch(/<script>alert|<img |href="javascript:/i)
  })

  test('a bio, and the preview endpoint', async () => {
    const fx = makeApp()
    const m = signIn(fx, 'quietfox')
    expect(
      (
        await m.post('/settings/profile', {
          display_name: 'Quiet Fox',
          bio: `${ATTACKS}\n\n**real**`,
        })
      ).status,
    ).toBe(303)
    const profile = getProfile(fx.db, 'quietfox')
    expect(profile?.displayName).toBe('Quiet Fox')
    expect(profile?.bioHtml).toContain('<strong>real</strong>')
    expectNoActiveMarkup(profile?.bioHtml ?? '')
    const page = await (await fx.get('/u/quietfox')).text()
    expect(page).not.toMatch(/<script>alert|<img |href="javascript:/i)

    const preview = await m.post(
      '/preview',
      { body: ATTACKS, mode: 'comment' },
      { headers: { accept: 'application/json' } },
    )
    const { html } = (await preview.json()) as { html: string }
    expectNoActiveMarkup(html)
  })

  test('an empty display name clears it; a long one is refused with the text kept', async () => {
    const fx = makeApp()
    const m = signIn(fx, 'ledgerline')
    const res = await m.post('/settings/profile', { display_name: 'x'.repeat(81), bio: 'kept bio' })
    expect(res.status).toBe(422)
    expect(await res.text()).toContain('kept bio')
    await m.post('/settings/profile', { display_name: '', bio: '' })
    expect(getProfile(fx.db, 'ledgerline')?.displayName).toBeNull()
  })
})

describe('replies', () => {
  test('lists replies to your items and comments, not your own', async () => {
    const fx = makeApp()
    const a = signIn(fx, 'quietfox')
    const b = signIn(fx, 'oxbow')
    const itemId = itemIdFrom(await postLink(a))
    const top = await b.post(`/item/${itemId}/comments`, { body: 'On your item.' })
    const topId = top.headers.get('Location')?.match(/#c(\d+)$/)?.[1] ?? ''
    await a.post(`/item/${itemId}/comments`, { body: 'My own answer.', parent: topId })
    const mine = await (await a.get('/replies')).text()
    expect(mine).toContain('On your item.')
    expect(mine).not.toContain('My own answer.')
    const theirs = await (await b.get('/replies')).text()
    expect(theirs).toContain('My own answer.')
    expect((await fx.get('/replies')).status).toBe(303)
  })
})

describe('signed-in pages', () => {
  const pages = [
    '/',
    '/newest',
    '/submit',
    '/submit?kind=post',
    '/submit?kind=status',
    '/settings',
    '/replies',
    '/u/quietfox',
  ]
  for (const path of pages) {
    test(`${path} has no inline script or handlers, and carries the CSRF token`, async () => {
      const fx = makeApp()
      const m = signIn(fx, 'quietfox')
      const res = await m.get(path)
      expect(res.status).toBe(200)
      const html = await res.text()
      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
        expect(
          tag === '<script type="application/ld+json">' || /\ssrc="\/js\/[\w.]+\.js"/.test(tag),
        ).toBe(true)
      }
      expect(html).not.toMatch(/\son[a-z]+=/i)
      expect(html).toContain(`<meta name="csrf-token" content="${m.csrf}"/>`)
    })
  }

  test('client modules are served, fingerprinted and immutable', async () => {
    const fx = makeApp()
    const html = await (await signIn(fx, 'quietfox').get('/')).text()
    const src = html.match(/<script type="module" src="(\/js\/vote\.[\w]+\.js)"/)?.[1] ?? ''
    const res = await fx.get(src)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/javascript')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(await res.text()).toContain('X-CSRF-Token')
  })
})

describe('a profile links to GitHub', () => {
  const fx = makeApp()

  test('as a fact and in the structured data', async () => {
    const html = await (await fx.get('/u/spindle')).text()
    expect(html).toContain(
      '<dt>GitHub</dt><dd><a href="https://github.com/spindle" rel="me noopener" translate="no">github.com/spindle</a></dd>',
    )
    expect(html).toContain('"sameAs":["https://github.com/spindle"]')
  })
})
