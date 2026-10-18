import { describe, expect, test } from 'bun:test'
import { getComment } from '../src/db/comments.ts'
import { getItem } from '../src/db/items.ts'
import { listModLog } from '../src/db/modlog.ts'
import { countSessions } from '../src/db/sessions.ts'
import { getTag } from '../src/db/tags.ts'
import { accountByLogin } from '../src/db/users.ts'
import { type AppFixture, type Member, makeApp, signIn } from './helpers.ts'

function setup() {
  const fx = makeApp()
  const mod = signIn(fx, 'ledgerline')
  const author = signIn(fx, 'quietfox')
  return { fx, mod, author }
}

async function newItem(author: Member): Promise<number> {
  const res = await author.post('/submit?kind=status', {
    body: 'A note to moderate.',
    tags: ['infra'],
  })
  return Number(res.headers.get('Location')?.match(/^\/item\/(\d+)/)?.[1])
}

async function newComment(author: Member, itemId: number): Promise<number> {
  const res = await author.post(`/item/${itemId}/comments`, { body: 'A comment to moderate.' })
  return Number(res.headers.get('Location')?.match(/#c(\d+)$/)?.[1])
}

/** The newest log entry. */
function lastLog(fx: AppFixture) {
  return listModLog(fx.db, { limit: 1, offset: 0 })[0]
}

function logCount(fx: AppFixture): number {
  return fx.db.query<{ n: number }, []>('SELECT count(*) AS n FROM mod_log').get()?.n ?? 0
}

describe('every moderator action writes the public log', () => {
  test('remove and restore an item', async () => {
    const { fx, mod, author } = setup()
    const id = await newItem(author)
    expect((await mod.post(`/item/${id}/remove`, { reason: 'Off-topic.' })).status).toBe(303)
    expect(getItem(fx.db, id)?.removedBy).toBe('moderator')
    expect(lastLog(fx)).toMatchObject({
      action: 'delete_item',
      itemId: id,
      moderator: 'ledgerline',
      reason: 'Off-topic.',
      subjectUser: 'quietfox',
    })
    const removed = await fx.get(`/item/${id}`)
    expect(removed.status).toBe(410)
    expect(await (await mod.get(`/item/${id}`)).text()).toContain(`action="/item/${id}/restore"`)

    expect((await mod.post(`/item/${id}/restore`, { reason: 'Misread it.' })).status).toBe(303)
    expect(getItem(fx.db, id)?.deleted).toBe(false)
    expect(lastLog(fx)).toMatchObject({ action: 'restore_item', itemId: id, reason: 'Misread it.' })
    const log = await (await fx.get('/moderation')).text()
    expect(log).toContain('Restored an item')
    expect(log).toContain('Misread it.')
  })

  test('remove and restore a comment', async () => {
    const { fx, mod, author } = setup()
    const itemId = await newItem(author)
    const cid = await newComment(signIn(fx, 'oxbow'), itemId)
    await mod.post(`/c/${cid}/remove`, { reason: 'Rude.' })
    expect(getComment(fx.db, cid)?.removedBy).toBe('moderator')
    expect(lastLog(fx)).toMatchObject({ action: 'delete_comment', commentId: cid, reason: 'Rude.' })
    const thread = await (await fx.get(`/item/${itemId}`)).text()
    expect(thread).not.toContain('A comment to moderate.')
    await mod.post(`/c/${cid}/restore`, { reason: 'On reflection, fine.' })
    expect(getComment(fx.db, cid)?.deleted).toBe(false)
    expect(lastLog(fx)).toMatchObject({ action: 'restore_comment', commentId: cid })
  })

  test('keep a flagged item: flags close and it returns to the front page', async () => {
    const { fx, mod, author } = setup()
    const id = await newItem(author)
    for (const login of ['oxbow', 'tinplate', 'jo'])
      await signIn(fx, login).post(`/item/${id}/flag`, { reason: 'spam' })
    const queue = await (await mod.get('/mod')).text()
    expect(queue).toContain('3 flags: spam 3')
    await mod.post(`/item/${id}/keep`, { reason: 'Not spam; a real note.' })
    expect(getItem(fx.db, id)?.flagCount).toBe(0)
    expect(lastLog(fx)).toMatchObject({ action: 'dismiss_flags', itemId: id })
    expect(await (await fx.get('/')).text()).toContain(`id="i${id}"`)
    expect(await (await fx.get('/moderation')).text()).toContain('Kept after flags')
  })

  test('keep a flagged comment', async () => {
    const { fx, mod, author } = setup()
    const itemId = await newItem(author)
    const cid = await newComment(signIn(fx, 'oxbow'), itemId)
    await signIn(fx, 'jo').post(`/c/${cid}/flag`, { reason: 'unkind' })
    await mod.post(`/c/${cid}/keep`, { reason: 'Blunt, not unkind.' })
    expect(lastLog(fx)).toMatchObject({ action: 'dismiss_flags', commentId: cid })
  })

  test('edit tags, with the change recorded', async () => {
    const { fx, mod, author } = setup()
    const id = await newItem(author)
    await mod.post(`/item/${id}/tags`, { tags: ['agents', 'infra'], reason: 'It is about agents.' })
    expect(getItem(fx.db, id)?.tags).toEqual(['agents', 'infra'])
    expect(lastLog(fx)).toMatchObject({
      action: 'retag_item',
      itemId: id,
      reason: 'It is about agents.',
    })
    expect(lastLog(fx)?.subject).toContain('tags were infra; now agents, infra')
  })

  test('ban and unban; a ban ends every session and withdraws open invitations', async () => {
    const { fx, mod, author } = setup()
    signIn(fx, 'quietfox')
    await author.post('/settings/invites', {})
    expect(countSessions(fx.db, author.id)).toBe(2)
    expect((await mod.post('/u/quietfox/ban', { reason: 'Spam ring.' })).status).toBe(303)
    expect(countSessions(fx.db, author.id)).toBe(0)
    expect(accountByLogin(fx.db, 'quietfox')?.banned).toBe(true)
    expect(lastLog(fx)).toMatchObject({
      action: 'ban_user',
      subjectUser: 'quietfox',
      reason: 'Spam ring.',
    })
    const open = fx.db
      .query<{ n: number }, [number, number]>(
        'SELECT count(*) AS n FROM invites WHERE inviter_id = ? AND revoked_at IS NULL AND expires_at > ?',
      )
      .get(author.id, fx.now())
    expect(open?.n).toBe(0)
    // The old cookie no longer signs anyone in.
    expect(await (await author.get('/')).text()).toContain('Sign in')

    await mod.post('/u/quietfox/unban', { reason: 'Appeal accepted.' })
    expect(accountByLogin(fx.db, 'quietfox')?.banned).toBe(false)
    expect(lastLog(fx)).toMatchObject({ action: 'unban_user', reason: 'Appeal accepted.' })
  })

  test('moderators cannot be banned', async () => {
    const { fx, mod } = setup()
    const before = logCount(fx)
    expect((await mod.post('/u/tallyhall/ban', { reason: 'x' })).status).toBe(403)
    expect(logCount(fx)).toBe(before)
  })

  test("revoke someone else's invitation", async () => {
    const { fx, mod, author } = setup()
    await author.post('/settings/invites', { note: 'friend' })
    const id = fx.db
      .query<{ id: number }, []>('SELECT id FROM invites ORDER BY id DESC LIMIT 1')
      .get()?.id
    expect(await (await mod.get('/mod')).text()).toContain(`/mod/invites/${id}/revoke`)
    await mod.post(`/mod/invites/${id}/revoke`, { reason: 'Asked to by the inviter.' })
    expect(lastLog(fx)).toMatchObject({ action: 'revoke_invite', subjectUser: 'quietfox' })
  })

  test('create a tag', async () => {
    const { fx, mod } = setup()
    await mod.post('/mod/tags', {
      name: 'evals',
      description: 'Measuring agents.',
      reason: 'Asked for twice.',
    })
    expect(getTag(fx.db, 'evals')?.description).toBe('Measuring agents.')
    expect(lastLog(fx)).toMatchObject({ action: 'create_tag', subject: 'evals' })
    const dupe = await mod.post('/mod/tags', { name: 'evals', reason: 'Again.' })
    expect(dupe.status).toBe(422)
    expect(await dupe.text()).toContain('There is already a tag called evals.')
  })

  test('no reason, no action: the form comes back and the log is unchanged', async () => {
    const { fx, mod, author } = setup()
    const id = await newItem(author)
    const before = logCount(fx)
    const res = await mod.post(`/item/${id}/remove`, { reason: '  ' })
    expect(res.status).toBe(422)
    expect(await res.text()).toContain('Give a reason. It is published in the moderation log.')
    expect(getItem(fx.db, id)?.deleted).toBe(false)
    expect(logCount(fx)).toBe(before)
  })

  test('members who are not moderators are refused, and nothing is logged', async () => {
    const { fx, author } = setup()
    const id = await newItem(signIn(fx, 'oxbow'))
    const before = logCount(fx)
    expect((await author.get('/mod')).status).toBe(403)
    expect((await author.post(`/item/${id}/remove`, { reason: 'x' })).status).toBe(403)
    expect((await author.post('/u/oxbow/ban', { reason: 'x' })).status).toBe(403)
    expect((await author.post('/mod/tags', { name: 'x', reason: 'x' })).status).toBe(403)
    expect(logCount(fx)).toBe(before)
    expect(getItem(fx.db, id)?.deleted).toBe(false)
  })
})

describe('making members moderators', () => {
  /** ledgerline is a founding moderator (MODERATORS); tallyhall was made one on the site. */
  function withFounder() {
    const fx = makeApp({ env: { MODERATORS: 'LedgerLine' } })
    return { fx, founder: signIn(fx, 'ledgerline'), member: signIn(fx, 'quietfox') }
  }

  const isModerator = (fx: AppFixture, login: string) => accountByLogin(fx.db, login)?.isModerator

  test('make a member a moderator and remove them, with both in the public log', async () => {
    const { fx, founder } = withFounder()
    const profile = await (await founder.get('/u/quietfox')).text()
    expect(profile).toContain('action="/u/quietfox/make-moderator"')
    expect(profile).toContain('action="/u/quietfox/ban"')

    const made = await founder.post('/u/quietfox/make-moderator', { reason: 'Asked to help.' })
    expect(made.status).toBe(303)
    expect(made.headers.get('Location')).toBe('/u/quietfox')
    expect(isModerator(fx, 'quietfox')).toBe(true)
    expect(lastLog(fx)).toMatchObject({
      action: 'promote_moderator',
      moderator: 'ledgerline',
      subjectUser: 'quietfox',
      reason: 'Asked to help.',
    })
    const after = await (await founder.get('/u/quietfox')).text()
    expect(after).toContain('<span class="role">Moderator</span>')
    expect(after).toContain('action="/u/quietfox/remove-moderator"')
    // A moderator cannot be banned, so the ban form is gone.
    expect(after).not.toContain('action="/u/quietfox/ban"')

    const removed = await founder.post('/u/quietfox/remove-moderator', { reason: 'Stepped back.' })
    expect(removed.status).toBe(303)
    expect(isModerator(fx, 'quietfox')).toBe(false)
    expect(lastLog(fx)).toMatchObject({
      action: 'remove_moderator',
      subjectUser: 'quietfox',
      reason: 'Stepped back.',
    })

    const log = await (await fx.get('/moderation')).text()
    expect(log).toContain('Made a moderator')
    expect(log).toContain('Removed a moderator')
    expect(log).toContain('href="/u/quietfox"')
    expect(log).toContain('Stepped back.')
  })

  test('it takes effect on the next request; removal leaves sessions alone', async () => {
    const { fx, founder, member } = withFounder()
    expect((await member.get('/mod')).status).toBe(403)
    await founder.post('/u/quietfox/make-moderator', { reason: 'Asked to help.' })
    expect((await member.get('/mod')).status).toBe(200)

    const sessions = countSessions(fx.db, member.id)
    await founder.post('/u/quietfox/remove-moderator', { reason: 'Stepped back.' })
    expect(countSessions(fx.db, member.id)).toBe(sessions)
    expect((await member.get('/mod')).status).toBe(403)
    const page = await (await member.get('/')).text()
    expect(page).toContain('quietfox')
    expect(page).not.toContain('href="/mod"')
    const before = logCount(fx)
    expect((await member.post('/u/oxbow/ban', { reason: 'x' })).status).toBe(403)
    expect(logCount(fx)).toBe(before)
  })

  test('a founding moderator cannot be removed, and the profile says why', async () => {
    const { fx } = withFounder()
    const other = signIn(fx, 'tallyhall')
    const profile = await (await other.get('/u/ledgerline')).text()
    expect(profile).toContain('Founding moderator')
    expect(profile).toContain('cannot be removed or banned from here')
    expect(profile).not.toContain('action="/u/ledgerline/remove-moderator"')
    expect(profile).not.toContain('action="/u/ledgerline/ban"')

    const before = logCount(fx)
    const res = await other.post('/u/ledgerline/remove-moderator', { reason: 'Coup.' })
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('Founding moderators cannot be removed here')
    const ban = await other.post('/u/ledgerline/ban', { reason: 'Coup.' })
    expect(ban.status).toBe(403)
    expect(await ban.text()).toContain('Take them out of MODERATORS')
    expect(isModerator(fx, 'ledgerline')).toBe(true)
    expect(logCount(fx)).toBe(before)
  })

  test('a moderator made on the site is removed before they can be banned', async () => {
    const { fx, founder } = withFounder()
    const ban = await founder.post('/u/tallyhall/ban', { reason: 'x' })
    expect(ban.status).toBe(403)
    expect(await ban.text()).toContain('Remove them as moderator first, then ban them.')
    await founder.post('/u/tallyhall/remove-moderator', { reason: 'Leaving.' })
    expect((await founder.post('/u/tallyhall/ban', { reason: 'Spam.' })).status).toBe(303)
    expect(accountByLogin(fx.db, 'tallyhall')?.banned).toBe(true)
  })

  test('nobody changes their own status', async () => {
    const { fx } = withFounder()
    const tallyhall = signIn(fx, 'tallyhall')
    const before = logCount(fx)
    const own = await (await tallyhall.get('/u/tallyhall')).text()
    expect(own).not.toContain('remove-moderator')
    const res = await tallyhall.post('/u/tallyhall/remove-moderator', { reason: 'Done.' })
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('You cannot change your own moderator status')
    expect(isModerator(fx, 'tallyhall')).toBe(true)
    expect(logCount(fx)).toBe(before)
  })

  test('a banned member cannot be made a moderator', async () => {
    const { fx, founder } = withFounder()
    const profile = await (await founder.get('/u/growth-hacker-9000')).text()
    expect(profile).not.toContain('make-moderator')
    expect(profile).toContain('action="/u/growth-hacker-9000/unban"')
    const before = logCount(fx)
    const res = await founder.post('/u/growth-hacker-9000/make-moderator', { reason: 'Oops.' })
    expect(res.status).toBe(409)
    expect(await res.text()).toContain('Lift the ban first')
    expect(isModerator(fx, 'growth-hacker-9000')).toBe(false)
    expect(logCount(fx)).toBe(before)
  })

  test('members who are not moderators cannot do it, or see the form', async () => {
    const { fx, member } = withFounder()
    expect(await (await member.get('/u/oxbow')).text()).not.toContain('make-moderator')
    const before = logCount(fx)
    expect((await member.post('/u/oxbow/make-moderator', { reason: 'x' })).status).toBe(403)
    expect((await member.post('/u/tallyhall/remove-moderator', { reason: 'x' })).status).toBe(403)
    expect(isModerator(fx, 'oxbow')).toBe(false)
    expect(isModerator(fx, 'tallyhall')).toBe(true)
    expect(logCount(fx)).toBe(before)
  })

  test('the CSRF token and a reason are required', async () => {
    const { fx, founder } = withFounder()
    const before = logCount(fx)
    const path = '/u/quietfox/make-moderator'
    expect((await founder.post(path, { reason: 'x' }, { csrf: null })).status).toBe(403)
    expect((await founder.post(path, { reason: 'x' }, { csrf: 'nope' })).status).toBe(403)
    const other = signIn(fx, 'tallyhall')
    expect((await founder.post(path, { reason: 'x' }, { csrf: other.csrf })).status).toBe(403)
    expect(
      (await founder.post(path, { reason: 'x' }, { headers: { origin: 'https://evil.example' } }))
        .status,
    ).toBe(403)
    const noReason = await founder.post(path, { reason: ' ' })
    expect(noReason.status).toBe(422)
    const html = await noReason.text()
    expect(html).toContain('Make quietfox a moderator?')
    expect(html).toContain('Give a reason. It is published in the moderation log.')
    expect(isModerator(fx, 'quietfox')).toBe(false)
    expect(logCount(fx)).toBe(before)
  })
})
