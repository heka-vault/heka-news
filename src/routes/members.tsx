// A member's own pages: /replies, /settings (profile and invitations), and withdrawing an
// invitation. A moderator withdrawing someone else's invitation is in moderation.tsx (it is logged).

import { PAGE_SIZE, RULES } from '../config.ts'
import { listRepliesTo } from '../db/comments.ts'
import { discordLinkFor } from '../db/discord.ts'
import { createInvite, getInvite, listInvitesBy, revokeInvite } from '../db/invites.ts'
import { profileSettings } from '../db/users.ts'
import { updateProfile } from '../db/write.ts'
import { randomToken, sha256Hex } from '../lib/crypto.ts'
import { CACHE_NONE } from '../lib/http.ts'
import { renderMarkdown } from '../lib/markdown.ts'
import { field, validateInviteNote, validateProfile } from '../lib/validate.ts'
import {
  type DiscordNotice,
  type SettingsForm,
  SettingsPage,
} from '../views/pages/AccountPages.tsx'
import { RepliesPage } from '../views/pages/MemberPages.tsx'
import { type App, type C, guardPost, idParam, signinRedirect, type Web } from './web.ts'

const DISCORD_NOTICES: DiscordNotice[] = ['linked', 'unlinked', 'cancelled']

export function registerMembers(app: App, web: Web): void {
  const { db, config, clock } = web

  app.get('/replies', (c) => {
    c.header('Cache-Control', CACHE_NONE)
    const ctx = web.ctxOf(c)
    if (!ctx.viewer) return signinRedirect(c, '/replies')
    const raw = c.req.query('p') ?? '1'
    if (!/^[1-9]\d{0,5}$/.test(raw)) return web.notFound(c)
    const page = Number(raw)
    const rows = listRepliesTo(db, ctx.viewer.id, {
      limit: PAGE_SIZE + 1,
      offset: (page - 1) * PAGE_SIZE,
    })
    if (page > 1 && rows.length === 0) return web.notFound(c)
    return web.html(
      c,
      <RepliesPage
        ctx={ctx}
        replies={rows.slice(0, PAGE_SIZE)}
        page={page}
        hasNext={rows.length > PAGE_SIZE}
      />,
    )
  })

  const settings = (
    c: C,
    form: Partial<SettingsForm>,
    extra: {
      newInvite?: { url: string; note: string; expiresAt: number }
      saved?: boolean
      discord?: DiscordNotice
    } = {},
    status: 200 | 201 | 422 = 200,
  ) => {
    const ctx = web.ctxOf(c)
    const viewer = ctx.viewer
    if (!viewer) return signinRedirect(c, '/settings')
    const current = profileSettings(db, viewer.id)
    return web.html(
      c,
      <SettingsPage
        ctx={ctx}
        login={viewer.login}
        form={{
          displayName: form.displayName ?? current?.displayName ?? '',
          bio: form.bio ?? current?.bio ?? '',
          note: form.note ?? '',
          errors: form.errors ?? {},
          previewHtml: form.previewHtml,
        }}
        invites={listInvitesBy(db, viewer.id, clock())}
        newInvite={extra.newInvite}
        saved={extra.saved}
        discord={{
          available: web.discord !== null,
          link: discordLinkFor(db, viewer.id),
          notice: extra.discord ?? null,
        }}
      />,
      status === 201 ? 200 : status,
    )
  }

  app.get('/settings', (c) => {
    c.header('Cache-Control', CACHE_NONE)
    const notice = c.req.query('discord')
    return settings(
      c,
      {},
      {
        saved: c.req.query('saved') === '1',
        discord: DISCORD_NOTICES.find((n) => n === notice),
      },
    )
  })

  app.post('/settings/profile', async (c) => {
    const guard = await guardPost(web, c, '/settings')
    if (guard instanceof Response) return guard
    const { viewer, fields } = guard
    const typed = { displayName: field(fields, 'display_name'), bio: field(fields, 'bio') }
    if (field(fields, 'intent') === 'preview') {
      return settings(c, { ...typed, previewHtml: renderMarkdown(typed.bio, 'comment') })
    }
    const result = validateProfile(fields)
    if (!result.ok) return settings(c, { ...typed, errors: result.errors }, {}, 422)
    updateProfile(db, viewer.id, result.value)
    return c.redirect('/settings?saved=1', 303)
  })

  // The code is shown once, on this response; only its hash is stored.
  app.post('/settings/invites', async (c) => {
    const guard = await guardPost(web, c, '/settings')
    if (guard instanceof Response) return guard
    const { viewer, fields } = guard
    const note = validateInviteNote(fields)
    if (!note.ok) return settings(c, { note: field(fields, 'note'), errors: note.errors }, {}, 422)
    const code = randomToken(16)
    const now = clock()
    createInvite(db, {
      inviterId: viewer.id,
      codeHash: sha256Hex(code),
      note: note.value,
      now,
      ttl: RULES.inviteTtl,
    })
    return settings(
      c,
      {},
      {
        newInvite: {
          url: `${config.publicUrl}/invite/${code}`,
          note: note.value,
          expiresAt: now + RULES.inviteTtl,
        },
      },
      201,
    )
  })

  app.post('/invites/:id/revoke', async (c) => {
    const guard = await guardPost(web, c, '/settings')
    if (guard instanceof Response) return guard
    const id = idParam(c)
    const invite = id ? getInvite(db, id, clock()) : null
    if (!invite) return web.notFound(c)
    if (invite.inviterId !== guard.viewer.id) {
      return web.refuse(c, {
        title: 'That invitation is not yours',
        body: 'You can withdraw only invitations you made. Moderators revoke others from the queue.',
      })
    }
    revokeInvite(db, invite.id, clock())
    return c.redirect('/settings#invites-heading', 303)
  })
}
