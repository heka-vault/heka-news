// Moderator routes (ADR 0003, 0007): the queue at /mod, removing and restoring items and
// comments, keeping flagged ones, editing tags, banning and unbanning, revoking invitations and
// adding tags. Every action requires a reason and writes the public log (src/db/moderation.ts).
// A missing reason brings back a page asking for one.

import { getComment } from '../db/comments.ts'
import { flagQueue } from '../db/flags.ts'
import { listOpenInvites } from '../db/invites.ts'
import { getItem } from '../db/items.ts'
import {
  banUser,
  createTagAsModerator,
  deleteComment,
  deleteItem,
  dismissFlags,
  recentRemovals,
  restoreComment,
  restoreItem,
  retagItem,
  revokeInviteAsModerator,
  unbanUser,
} from '../db/moderation.ts'
import { listTags } from '../db/tags.ts'
import { accountByLogin } from '../db/users.ts'
import { CACHE_NONE } from '../lib/http.ts'
import {
  type Errors,
  field,
  fieldList,
  validateReason,
  validateTag,
  validateTags,
} from '../lib/validate.ts'
import { TagPicker } from '../views/components/Forms.tsx'
import { itemLabel } from '../views/components/Items.tsx'
import type { PageContext, Viewer } from '../views/context.ts'
import { ConfirmPage, QuotedComment } from '../views/pages/MemberPages.tsx'
import { ModQueuePage } from '../views/pages/ModQueuePage.tsx'
import { type App, type C, guardPost, idParam, signinRedirect, type Web } from './web.ts'

export function registerModeration(app: App, web: Web): void {
  const { db, clock } = web

  const notModerator = (c: C) =>
    web.refuse(c, {
      title: 'Moderators only',
      body: 'Three of us moderate. What we do is public in the moderation log.',
    })

  /** GET pages: a signed-in moderator's context, or the response to send. */
  const modCtx = (c: C): PageContext | Response => {
    c.header('Cache-Control', CACHE_NONE)
    const ctx = web.ctxOf(c)
    if (!ctx.viewer) return signinRedirect(c, ctx.returnTo)
    if (!ctx.viewer.isModerator) return notModerator(c)
    return ctx
  }

  /** POSTs: guardPost, then moderator, then a reason. */
  const modPost = async (
    c: C,
    ask: (
      ctx: PageContext,
      reason: { value: string; error?: string },
    ) => Response | Promise<Response>,
  ): Promise<{ viewer: Viewer; reason: string; fields: Record<string, unknown> } | Response> => {
    const guard = await guardPost(web, c, c.req.path)
    if (guard instanceof Response) return guard
    if (!guard.viewer.isModerator) return notModerator(c)
    const reason = validateReason(guard.fields)
    if (!reason.ok) {
      return ask(web.ctxOf(c), {
        value: field(guard.fields, 'reason'),
        error: reason.errors.reason,
      })
    }
    return { viewer: guard.viewer, reason: reason.value, fields: guard.fields }
  }

  const tagFormEmpty = { name: '', description: '', reason: '', errors: {} as Errors }

  const queue = (c: C, ctx: PageContext, tagForm = tagFormEmpty, status: 200 | 422 = 200) => {
    const { items, comments } = flagQueue(db)
    return web.html(
      c,
      <ModQueuePage
        ctx={ctx}
        items={items}
        comments={comments}
        removals={recentRemovals(db)}
        invites={listOpenInvites(db, clock())}
        tags={listTags(db)}
        tagForm={tagForm}
      />,
      status,
    )
  }

  app.get('/mod', (c) => {
    const ctx = modCtx(c)
    if (ctx instanceof Response) return ctx
    return queue(c, ctx)
  })

  // --- Items -----------------------------------------------------------------------------------

  const itemPage = (
    c: C,
    ctx: PageContext,
    opts: {
      title: string
      action: string
      button: string
      sending: string
      body: string
      reason: { value: string; error?: string }
      danger?: boolean
    },
    status: 200 | 422 = 200,
  ) => {
    const item = getItem(db, idParam(c) ?? 0)
    if (!item) return web.notFound(c)
    return web.html(
      c,
      <ConfirmPage
        ctx={ctx}
        title={opts.title}
        action={opts.action}
        button={opts.button}
        sending={opts.sending}
        cancel={item.deleted ? '/mod' : `/item/${item.id}`}
        reason={opts.reason}
        danger={opts.danger}
      >
        <p class="confirm__what" dir="auto">
          {itemLabel(item)}{' '}
          <span class="muted">
            by{' '}
            <a href={`/u/${item.author.login}`} translate="no">
              {item.author.login}
            </a>
          </span>
        </p>
        <p>{opts.body}</p>
      </ConfirmPage>,
      status,
    )
  }

  const removeItemOpts = (id: number, reason: { value: string; error?: string }) => ({
    title: 'Remove this item?',
    action: `/item/${id}/remove`,
    button: 'Remove item',
    sending: 'Removing…',
    body: 'It leaves every list and its page says a moderator removed it. Its open flags close. You can restore it from the queue.',
    reason,
    danger: true,
  })

  app.get('/item/:id/remove', (c) => {
    const ctx = modCtx(c)
    if (ctx instanceof Response) return ctx
    return itemPage(c, ctx, removeItemOpts(idParam(c) ?? 0, { value: '' }))
  })

  app.post('/item/:id/remove', async (c) => {
    const id = idParam(c) ?? 0
    const ok = await modPost(c, (ctx, reason) => itemPage(c, ctx, removeItemOpts(id, reason), 422))
    if (ok instanceof Response) return ok
    if (!deleteItem(db, id, ok.viewer.id, ok.reason, clock())) return web.notFound(c)
    return c.redirect('/mod', 303)
  })

  app.post('/item/:id/restore', async (c) => {
    const id = idParam(c) ?? 0
    const ok = await modPost(c, (ctx, reason) =>
      itemPage(
        c,
        ctx,
        {
          title: 'Restore this item?',
          action: `/item/${id}/restore`,
          button: 'Restore item',
          sending: 'Restoring…',
          body: 'It goes back into the lists where it was.',
          reason,
        },
        422,
      ),
    )
    if (ok instanceof Response) return ok
    if (!restoreItem(db, id, ok.viewer.id, ok.reason, clock())) return web.notFound(c)
    return c.redirect(`/item/${id}`, 303)
  })

  app.post('/item/:id/keep', async (c) => {
    const id = idParam(c) ?? 0
    const ok = await modPost(c, (ctx, reason) =>
      itemPage(
        c,
        ctx,
        {
          title: 'Keep this item?',
          action: `/item/${id}/keep`,
          button: 'Keep it and close the flags',
          sending: 'Saving…',
          body: 'Its open flags close and it goes back on the front page.',
          reason,
        },
        422,
      ),
    )
    if (ok instanceof Response) return ok
    dismissFlags(db, 'item', id, ok.viewer.id, ok.reason, clock())
    return c.redirect('/mod', 303)
  })

  const tagsPage = (
    c: C,
    ctx: PageContext,
    selected: string[] | null,
    reason: { value: string; error?: string },
    errors: Errors = {},
    status: 200 | 422 = 200,
  ) => {
    const item = getItem(db, idParam(c) ?? 0)
    if (!item || item.deleted) return web.notFound(c)
    return web.html(
      c,
      <ConfirmPage
        ctx={ctx}
        title="Edit tags"
        action={`/item/${item.id}/tags`}
        button="Save tags"
        sending="Saving…"
        cancel={`/item/${item.id}`}
        reason={reason}
        errors={reason.error ? { ...errors, reason: reason.error } : errors}
        fields={
          <TagPicker tags={listTags(db)} selected={selected ?? item.tags} error={errors.tags} />
        }
      >
        <p class="confirm__what" dir="auto">
          {itemLabel(item)}
        </p>
      </ConfirmPage>,
      status,
    )
  }

  app.get('/item/:id/tags', (c) => {
    const ctx = modCtx(c)
    if (ctx instanceof Response) return ctx
    return tagsPage(c, ctx, null, { value: '' })
  })

  app.post('/item/:id/tags', async (c) => {
    const guard = await guardPost(web, c, c.req.path)
    if (guard instanceof Response) return guard
    if (!guard.viewer.isModerator) return notModerator(c)
    const ctx = web.ctxOf(c)
    const tags = fieldList(guard.fields, 'tags')
    const tagError = validateTags(tags, new Set(listTags(db).map((t) => t.name)))
    const reason = validateReason(guard.fields)
    if (tagError || !reason.ok) {
      return tagsPage(
        c,
        ctx,
        tags,
        {
          value: field(guard.fields, 'reason'),
          error: reason.ok ? undefined : reason.errors.reason,
        },
        tagError ? { tags: tagError } : {},
        422,
      )
    }
    const id = idParam(c) ?? 0
    if (!retagItem(db, id, tags, guard.viewer.id, reason.value, clock())) return web.notFound(c)
    return c.redirect(`/item/${id}`, 303)
  })

  // --- Comments --------------------------------------------------------------------------------

  const commentPage = (
    c: C,
    ctx: PageContext,
    opts: {
      title: string
      action: string
      button: string
      sending: string
      body: string
      danger?: boolean
    },
    reason: { value: string; error?: string },
    status: 200 | 422 = 200,
  ) => {
    const comment = getComment(db, idParam(c) ?? 0)
    if (!comment) return web.notFound(c)
    return web.html(
      c,
      <ConfirmPage
        ctx={ctx}
        title={opts.title}
        action={opts.action}
        button={opts.button}
        sending={opts.sending}
        cancel={`/item/${comment.itemId}#c${comment.id}`}
        reason={reason}
        danger={opts.danger}
      >
        <QuotedComment
          ctx={ctx}
          comment={{ ...comment, deleted: false, bodyHtml: comment.bodyHtml || '<p>[removed]</p>' }}
        />
        <p>{opts.body}</p>
      </ConfirmPage>,
      status,
    )
  }

  const removeCommentOpts = (id: number) => ({
    title: 'Remove this comment?',
    action: `/c/${id}/remove`,
    button: 'Remove comment',
    sending: 'Removing…',
    body: 'Its text is replaced by “Removed by a moderator”; replies stay. You can restore it from the queue.',
    danger: true,
  })

  app.get('/c/:id/remove', (c) => {
    const ctx = modCtx(c)
    if (ctx instanceof Response) return ctx
    return commentPage(c, ctx, removeCommentOpts(idParam(c) ?? 0), { value: '' })
  })

  app.post('/c/:id/remove', async (c) => {
    const id = idParam(c) ?? 0
    const ok = await modPost(c, (ctx, reason) =>
      commentPage(c, ctx, removeCommentOpts(id), reason, 422),
    )
    if (ok instanceof Response) return ok
    const comment = getComment(db, id)
    if (!comment || !deleteComment(db, id, ok.viewer.id, ok.reason, clock())) return web.notFound(c)
    return c.redirect(`/item/${comment.itemId}#c${id}`, 303)
  })

  app.post('/c/:id/restore', async (c) => {
    const id = idParam(c) ?? 0
    const ok = await modPost(c, (ctx, reason) =>
      commentPage(
        c,
        ctx,
        {
          title: 'Restore this comment?',
          action: `/c/${id}/restore`,
          button: 'Restore comment',
          sending: 'Restoring…',
          body: 'Its text comes back where it was.',
        },
        reason,
        422,
      ),
    )
    if (ok instanceof Response) return ok
    const comment = getComment(db, id)
    if (!comment || !restoreComment(db, id, ok.viewer.id, ok.reason, clock()))
      return web.notFound(c)
    return c.redirect(`/item/${comment.itemId}#c${id}`, 303)
  })

  app.post('/c/:id/keep', async (c) => {
    const id = idParam(c) ?? 0
    const ok = await modPost(c, (ctx, reason) =>
      commentPage(
        c,
        ctx,
        {
          title: 'Keep this comment?',
          action: `/c/${id}/keep`,
          button: 'Keep it and close the flags',
          sending: 'Saving…',
          body: 'Its open flags close.',
        },
        reason,
        422,
      ),
    )
    if (ok instanceof Response) return ok
    dismissFlags(db, 'comment', id, ok.viewer.id, ok.reason, clock())
    return c.redirect('/mod', 303)
  })

  // --- Members, invitations, tags ------------------------------------------------------------

  const banPage = (
    c: C,
    ctx: PageContext,
    login: string,
    unban: boolean,
    reason: { value: string; error?: string },
  ) =>
    web.html(
      c,
      <ConfirmPage
        ctx={ctx}
        title={unban ? `Lift the ban on ${login}?` : `Ban ${login}?`}
        action={`/u/${login}/${unban ? 'unban' : 'ban'}`}
        button={unban ? 'Lift ban' : 'Ban'}
        sending="Saving…"
        cancel={`/u/${login}`}
        reason={reason}
        danger={!unban}
      >
        <p>
          {unban
            ? 'They will be able to sign in again.'
            : 'They are signed out everywhere, their open invitations are withdrawn, and they cannot sign in again until a moderator lifts the ban.'}
        </p>
      </ConfirmPage>,
      422,
    )

  const ban = (unban: boolean) => async (c: C) => {
    const login = c.req.param('login') ?? ''
    const ok = await modPost(c, (ctx, reason) => banPage(c, ctx, login, unban, reason))
    if (ok instanceof Response) return ok
    const account = accountByLogin(db, login)
    if (!account) return web.notFound(c)
    if (unban) {
      unbanUser(db, account.id, ok.viewer.id, ok.reason, clock())
    } else {
      const result = banUser(db, account.id, ok.viewer.id, ok.reason, clock())
      if (!result.ok && result.reason === 'moderator') {
        return web.refuse(c, {
          title: 'Moderators cannot be banned',
          body: 'Take them out of MODERATORS first, then ban them.',
        })
      }
    }
    return c.redirect(`/u/${account.login}`, 303)
  }
  app.post('/u/:login/ban', ban(false))
  app.post('/u/:login/unban', ban(true))

  app.post('/mod/invites/:id/revoke', async (c) => {
    const id = idParam(c) ?? 0
    const ok = await modPost(c, (ctx, reason) =>
      web.html(
        c,
        <ConfirmPage
          ctx={ctx}
          title="Revoke this invitation?"
          action={`/mod/invites/${id}/revoke`}
          button="Revoke"
          sending="Revoking…"
          cancel="/mod"
          reason={reason}
          danger
        >
          <p>The link stops working. The member who made it can make another.</p>
        </ConfirmPage>,
        422,
      ),
    )
    if (ok instanceof Response) return ok
    revokeInviteAsModerator(db, id, ok.viewer.id, ok.reason, clock())
    return c.redirect('/mod#open-invites', 303)
  })

  app.post('/mod/tags', async (c) => {
    const guard = await guardPost(web, c, '/mod')
    if (guard instanceof Response) return guard
    if (!guard.viewer.isModerator) return notModerator(c)
    const ctx = web.ctxOf(c)
    const typed = {
      name: field(guard.fields, 'name'),
      description: field(guard.fields, 'description'),
      reason: field(guard.fields, 'reason'),
    }
    const tag = validateTag(guard.fields)
    const reason = validateReason(guard.fields)
    const errors: Errors = { ...(tag.ok ? {} : tag.errors), ...(reason.ok ? {} : reason.errors) }
    if (!tag.ok || !reason.ok) return queue(c, ctx, { ...typed, errors }, 422)
    if (!createTagAsModerator(db, tag.value, guard.viewer.id, reason.value, clock())) {
      return queue(
        c,
        ctx,
        { ...typed, errors: { name: `There is already a tag called ${tag.value.name}.` } },
        422,
      )
    }
    return c.redirect('/mod#tags', 303)
  })
}
