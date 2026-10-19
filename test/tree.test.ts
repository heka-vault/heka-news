// The invite tree up front: "Invite tree" in the bar (with "Tree" for narrow phones) and the front
// page's "Who's here" panel, in every state from an empty site to a crowd joining in one morning.

import { describe, expect, test } from 'bun:test'
import { accountByLogin, findBranch, inviteTree, treeSummary } from '../src/db/users.ts'
import { createUser } from '../src/db/write.ts'
import { branches } from '../src/views/components/WhosHere.tsx'
import { makeApp, NOW, signIn } from './helpers.ts'

const D = 86400

/** The panel's markup from a page, or '' when it is not there. */
function panel(html: string): string {
  return html.match(/<aside class="whos-here"[\s\S]*?<\/aside>/)?.[0] ?? ''
}

describe('the bar', () => {
  const fx = makeApp()

  test('says "Invite tree", with "Tree" hidden from assistive tech for narrow phones', async () => {
    const html = await (await fx.get('/')).text()
    expect(html).toContain(
      '<a href="/tree"><span class="bar__nav-long">Invite tree</span><span class="bar__nav-short" aria-hidden="true">Tree</span></a>',
    )
    // The short word is the only aria-hidden text in the link, so the name is said once.
    expect(html.match(/class="bar__nav-short"/g)).toHaveLength(1)
  })

  test('marks the invite tree as the current page on /tree', async () => {
    const html = await (await fx.get('/tree')).text()
    expect(html).toContain('<a href="/tree" aria-current="page"><span class="bar__nav-long">')
  })

  test('the other lists keep their plain labels', async () => {
    const mod = signIn(fx, 'ledgerline')
    const html = await (await mod.get('/')).text()
    for (const label of ['Top', 'New', 'Posts', 'Status', 'Replies', 'Mod']) {
      expect(html).toMatch(new RegExp(`<a href="[^"]+"(?: aria-current="page")?>${label}</a>`))
    }
  })
})

describe("who's here, on seed data", () => {
  const fx = makeApp()

  test('lists the newest members under who invited them, linked to each profile', async () => {
    const html = panel(await (await fx.get('/')).text())
    expect(html).toContain('<h2 id="whos-here">Who’s here</h2>')
    // Newest first: sapling (2 days), bollard (20), jo (30), spindle (50), aleksandra (60).
    const order = ['sapling', 'bollard', 'jo', 'spindle', 'aleksandra-wisniewska-kowalczyk-ops']
    const positions = order.map((login) =>
      html.indexOf(`>${login}</a> <span class="tree__joined">joined <time`),
    )
    expect(positions.every((p) => p > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    for (const inviter of ['wrenfield', 'spindle', 'tinplate', 'gantry', 'quietfox']) {
      expect(html).toContain(`<a href="/u/${inviter}" translate="no">${inviter}</a>`)
    }
    expect(html).toContain('<span class="sr-only"> invited</span>')
    expect(html).toContain('joined <time datetime=')
  })

  test('tells the size of the tree and links to it', async () => {
    const html = panel(await (await fx.get('/')).text())
    expect(html).toContain('18 members so far. The longest chain of invitations is 4 people long.')
    expect(html).toContain('<a href="/tree">See the whole invite tree</a>')
  })

  test('never lists a banned member', async () => {
    // growth-hacker-9000 joined 12 days ago, between sapling and bollard, and is banned.
    expect(panel(await (await fx.get('/')).text())).not.toContain('growth-hacker-9000')
  })

  test('comes after the list in the page, on page 1 only', async () => {
    const html = await (await fx.get('/')).text()
    expect(html.indexOf('<aside class="whos-here"')).toBeGreaterThan(html.indexOf('</ol>'))
    expect(panel(await (await fx.get('/?p=2')).text())).toBe('')
    expect(panel(await (await fx.get('/newest')).text())).toBe('')
  })

  test('keeps the front page publicly cacheable, and private when signed in', async () => {
    const anon = await fx.get('/')
    expect(anon.headers.get('Cache-Control')).toBe(
      'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    )
    const member = await signIn(fx, 'quietfox').get('/')
    expect(member.headers.get('Cache-Control')).toBe('private, no-store')
    expect(panel(await member.text())).toContain('18 members so far.')
  })
})

describe("who's here, empty and small", () => {
  test('an empty site says how membership works and still links to the tree', async () => {
    const fx = makeApp({ seed: false })
    const html = panel(await (await fx.get('/')).text())
    expect(html).toContain('No members yet.')
    expect(html).toContain('<a href="/about#membership">how membership works</a>')
    expect(html).toContain('<a href="/tree">See the invite tree</a>')
    expect(html).not.toContain('class="tree')
    expect(html).not.toContain('so far')
  })

  test('one founding member: their branch, and no chain to speak of yet', async () => {
    const fx = makeApp({ seed: false })
    createUser(fx.db, { login: 'first-mod', isModerator: true, createdAt: NOW - 3600 })
    const html = panel(await (await fx.get('/')).text())
    expect(html).toContain('Founding member<')
    expect(html).toContain('<a href="/u/first-mod" translate="no">first-mod</a>')
    expect(html).toContain('1 member so far. Everyone else joins by invitation.')
    expect(html).not.toContain('longest chain')
    expect(html).toContain('<a href="/tree">See the whole invite tree</a>')
  })

  test('a crowd from one inviter in one morning groups under them, five at most', async () => {
    const fx = makeApp({ seed: false })
    const host = 'aleksandra-wisniewska-kowalczyk-ops-sre'
    const hostId = createUser(fx.db, { login: host, isModerator: true, createdAt: NOW - 30 * D })
    const logins = ['mira-k', 'b', 'tomasz-nowak-platform-engineering-lead', 'ola', 'x9', 'pk']
    logins.forEach((login, i) => {
      createUser(fx.db, { login, invitedBy: hostId, createdAt: NOW - 3600 + i * 60 })
    })
    const html = panel(await (await fx.get('/')).text())
    expect(html.match(new RegExp(`href="/u/${host}"`, 'g'))).toHaveLength(1)
    for (const login of logins.slice(1)) expect(html).toContain(`href="/u/${login}"`)
    expect(html).not.toContain('href="/u/mira-k"')
    expect(html).toContain('7 members so far. The longest chain of invitations is 2 people long.')
  })
})

describe('the tree in brief', () => {
  test('counts every member, measures the deepest chain, and lists the newest unbanned', () => {
    const fx = makeApp()
    const summary = treeSummary(fx.db, 5)
    expect(summary.members).toBe(18)
    expect(summary.deepest).toBe(3)
    expect(summary.newest.map((m) => m.login)).toEqual([
      'sapling',
      'bollard',
      'jo',
      'spindle',
      'aleksandra-wisniewska-kowalczyk-ops',
    ])
    expect(summary.newest[0]?.invitedBy).toBe('wrenfield')
  })

  test('follows a deep chain to the end', () => {
    const fx = makeApp()
    let parent = accountByLogin(fx.db, 'bollard')?.id ?? null
    for (let i = 1; i <= 10; i++) {
      parent = createUser(fx.db, { login: `chain-${i}`, invitedBy: parent, createdAt: NOW - D + i })
    }
    expect(treeSummary(fx.db, 5).deepest).toBe(13)
  })

  test('an empty site has no members and no depth', () => {
    expect(treeSummary(makeApp({ seed: false }).db, 5)).toEqual({
      members: 0,
      deepest: 0,
      newest: [],
    })
  })

  test('groups the newest under their inviters, newest group first', () => {
    const m = (login: string, invitedBy: string | null) => ({ login, invitedBy, createdAt: 0 })
    expect(
      branches([m('a', 'x'), m('b', 'y'), m('c', 'x'), m('d', null)]).map((b) => [
        b.inviter,
        b.members.map((member) => member.login),
      ]),
    ).toEqual([
      ['x', ['a', 'c']],
      ['y', ['b']],
      [null, ['d']],
    ])
  })
})

describe('a member as their own root', () => {
  const fx = makeApp()

  test('shows the line above them and everyone who joined through them', async () => {
    // pressbrake (founding) → gantry → spindle → bollard.
    const res = await fx.get('/tree/spindle')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<h1><span translate="no">spindle</span>’s branch</h1>')
    expect(html).toContain('1 person traces back to them.')
    const line = html.match(/<ol class="tree-line__list">[\s\S]*?<\/ol>/)?.[0] ?? ''
    expect(line.indexOf('href="/tree/pressbrake"')).toBeGreaterThan(0)
    expect(line.indexOf('href="/tree/gantry"')).toBeGreaterThan(line.indexOf('/tree/pressbrake'))
    expect(line).toContain('<li aria-current="page"><span translate="no">spindle</span></li>')
    // Below: spindle at the root, bollard under them, and nobody from other branches.
    const below = html.slice(html.indexOf('<ul class="tree">'))
    expect(below.indexOf('href="/u/spindle"')).toBeLessThan(below.indexOf('href="/u/bollard"'))
    expect(below).not.toContain('href="/u/gantry"')
    expect(below).not.toContain('href="/u/quietfox"')
    expect(html).toContain('<link rel="canonical" href="http')
    expect(html).toMatch(/<link rel="canonical" href="[^"]+\/tree\/spindle"/)
    expect(html).toContain('<a href="/tree">See the whole invite tree</a>')
  })

  test('counts the whole branch, not just the people they invited themselves', async () => {
    // quietfox invited tinplate and aleksandra; tinplate invited jo.
    const html = await (await fx.get('/tree/quietfox')).text()
    expect(html).toContain('3 people trace back to them.')
  })

  test('a founding member is at the top, with no line', async () => {
    const html = await (await fx.get('/tree/pressbrake')).text()
    expect(html).toContain('Founding member</h2>')
    expect(html).toContain('At the top of the tree. Nobody invited them.')
    expect(html).not.toContain('<ol class="tree-line__list"')
  })

  test('speaks to the member when it is their own branch', async () => {
    const html = await (await signIn(fx, 'sapling').get('/tree/sapling')).text()
    expect(html).toContain('<h1>Your branch</h1>')
    expect(html).toContain(
      'Nobody has joined through you yet. <a href="/settings#invites-heading">Invite someone</a>.',
    )
  })

  test('is publicly cacheable when signed out, like the whole tree', async () => {
    const res = await fx.get('/tree/spindle')
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    )
    expect((await signIn(fx, 'quietfox').get('/tree/spindle')).headers.get('Cache-Control')).toBe(
      'private, no-store',
    )
  })

  test('redirects to the login as stored, and 404s for nobody', async () => {
    const res = await fx.get('/tree/SPINDLE')
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('/tree/spindle')
    expect((await fx.get('/tree/nobody-here')).status).toBe(404)
  })

  test('every profile links to the branch', async () => {
    const theirs = await (await fx.get('/u/spindle')).text()
    expect(theirs).toContain(
      '<dt>Invite tree</dt><dd><a href="/tree/spindle">Their branch</a></dd>',
    )
    const own = await (await signIn(fx, 'spindle').get('/u/spindle')).text()
    expect(own).toContain('<a href="/tree/spindle">Your branch</a>')
  })

  test('the line is found anywhere in the forest', () => {
    const roots = inviteTree(fx.db)
    expect(findBranch(roots, 'bollard')?.line.map((n) => n.login)).toEqual([
      'pressbrake',
      'gantry',
      'spindle',
    ])
    expect(findBranch(roots, 'tallyhall')?.line).toEqual([])
    expect(findBranch(roots, 'nobody')).toBeNull()
  })
})
