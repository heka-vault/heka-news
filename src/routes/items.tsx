// What members do to items and comments: submit, edit, delete, comment, reply, vote, flag, and the
// markdown preview. Each POST goes through guardPost (same origin, signed in, CSRF token) and,
// where it creates something, rateLimited. Forms that fail validation come back with what was
// typed and a message per field (422).

import { RULES } from '../config.ts'
import { commentNode, getComment } from '../db/comments.ts'
import { addFlag, memberFlag, withdrawFlag } from '../db/flags.ts'
import { getItem, recentLinksOnDomain } from '../db/items.ts'
import { listTags } from '../db/tags.ts'
import type { CommentDetail, ItemDetail, ItemKind } from '../db/types.ts'
import { setVote } from '../db/votes.ts'
import {
  authorDeleteComment,
  authorDeleteItem,
  createComment,
  createItem,
  updateComment,
  updateItem,
} from '../db/write.ts'
import { domainOf, timeAgo } from '../lib/format.ts'
import { CACHE_NONE } from '../lib/http.ts'
import { renderMarkdown } from '../lib/markdown.ts'
import {
  field,
  fieldList,
  normalizeUrl,
  validateComment,
  validateFlagReason,
  validateItem,
} from '../lib/validate.ts'
import { Comment, childClass } from '../views/components/Comments.tsx'
import { itemLabel } from '../views/components/Items.tsx'
import type { PageContext } from '../views/context.ts'
import {
  CommentPage,
  ConfirmPage,
  EditCommentPage,
  FlagPage,
  QuotedComment,
  ReplyPage,
} from '../views/pages/MemberPages.tsx'
import { EditItemPage, EMPTY_ITEM, SubmitPage } from '../views/pages/SubmitPage.tsx'
import {
  type App,
  type C,
  guardPost,
  idParam,
  rateLimited,
  safeNext,
  signinRedirect,
  type Web,
  wantsJson,
} from './web.ts'

const KINDS: ItemKind[] = ['link', 'post', 'status']

function kindParam(c: C): ItemKind {
  const kind = c.req.query('kind')
  return KINDS.includes(kind as ItemKind) ? (kind as ItemKind) : 'link'
}

function minutesLeft(createdAt: number, now: number): number {
  return Math.max(1, Math.ceil((RULES.editWindow - (now - createdAt)) / 60))
}

export function registerItems(app: App, web: Web): void {
  const { db, clock } = web
  const knownTags = () => new Set(listTags(db).map((tag) => tag.name))

  /** The member, or a redirect to sign in, for GET pages that need one. */
  const memberCtx = (c: C): PageContext | Response => {
    const ctx = web.ctxOf(c)
    c.header('Cache-Control', CACHE_NONE)
    if (!ctx.viewer) return signinRedirect(c, ctx.returnTo)
    return ctx
  }

  const liveItem = (c: C): ItemDetail | null => {
    const id = idParam(c)
    const item = id ? getItem(db, id) : null
    return item && !item.deleted ? item : null
  }

  const liveComment = (c: C): CommentDetail | null => {
    const id = idParam(c)
    const comment = id ? getComment(db, id) : null
    return comment && !comment.deleted && !comment.itemDeleted ? comment : null
  }

  const notYours = (c: C) =>
    web.refuse(c, {
      title: 'Only the author can do that',
      body: 'You can edit or delete only what you wrote.',
    })

  const tooLate = (c: C, href: string) =>
    web.refuse(c, {
      title: 'The time to edit has passed',
      body: `Authors can edit for ${RULES.editWindow / 3600} hours after posting. You can still delete it, from ${href}.`,
    })

  // --- Submit --------------------------------------------------------------------------------

  app.get('/submit', (c) => {
    const ctx = memberCtx(c)
    if (ctx instanceof Response) return ctx
    return web.html(
      c,
      <SubmitPage
        ctx={ctx}
        kind={kindParam(c)}
        values={EMPTY_ITEM}
        errors={{}}
        tags={listTags(db)}
      />,
    )
  })

  app.post('/submit', async (c) => {
    const kind = kindParam(c)
    const guard = await guardPost(web, c, `/submit?kind=${kind}`)
    if (guard instanceof Response) return guard
    const { viewer, fields } = guard
    const ctx = web.ctxOf(c)
    const values = {
      title: field(fields, 'title'),
      url: field(fields, 'url'),
      body: field(fields, 'body'),
      tags: fieldList(fields, 'tags'),
    }
    const tags = listTags(db)
    const page = (extra: Partial<Parameters<typeof SubmitPage>[0]>, status: 200 | 409 | 422) =>
      web.html(
        c,
        <SubmitPage ctx={ctx} kind={kind} values={values} errors={{}} tags={tags} {...extra} />,
        status,
      )

    if (field(fields, 'intent') === 'preview') {
      return page(
        { previewHtml: renderMarkdown(values.body, kind === 'post' ? 'post' : 'comment') },
        200,
      )
    }
    const result = validateItem(kind, fields, new Set(tags.map((t) => t.name)))
    if (!result.ok) return page({ errors: result.errors }, 422)
    const input = result.value

    if (input.url) {
      const domain = domainOf(input.url)
      const wanted = normalizeUrl(input.url)
      const now = clock()
      const twin = domain
        ? recentLinksOnDomain(db, domain, now - RULES.duplicateWindow).find(
            (link) => normalizeUrl(link.url) === wanted,
          )
        : undefined
      if (twin) {
        return page(
          { duplicate: { id: twin.id, title: twin.title, when: timeAgo(twin.createdAt, now) } },
          409,
        )
      }
    }

    const limited = rateLimited(web, c, viewer, 'item')
    if (limited) return limited
    const id = createItem(db, {
      kind,
      authorId: viewer.id,
      title: input.title,
      url: input.url,
      bodyMd: input.bodyMd,
      tags: input.tags,
      createdAt: clock(),
    })
    web.outbox.record('item_created', { itemId: id })
    return c.redirect(`/item/${id}`, 303)
  })

  // --- Edit and delete an item ---------------------------------------------------------------

  app.get('/item/:id/edit', (c) => {
    const ctx = memberCtx(c)
    if (ctx instanceof Response) return ctx
    const item = liveItem(c)
    if (!item) return web.notFound(c)
    if (item.authorId !== ctx.viewer?.id) return notYours(c)
    if (ctx.now - item.createdAt >= RULES.editWindow) return tooLate(c, `/item/${item.id}`)
    return web.html(
      c,
      <EditItemPage
        ctx={ctx}
        itemId={item.id}
        kind={item.kind}
        values={{
          title: item.title ?? '',
          url: item.url ?? '',
          body: item.bodyMd,
          tags: item.tags,
        }}
        errors={{}}
        tags={listTags(db)}
        minutesLeft={minutesLeft(item.createdAt, ctx.now)}
      />,
    )
  })

  app.post('/item/:id/edit', async (c) => {
    const guard = await guardPost(web, c, c.req.path)
    if (guard instanceof Response) return guard
    const { viewer, fields } = guard
    const item = liveItem(c)
    if (!item) return web.notFound(c)
    if (item.authorId !== viewer.id) return notYours(c)
    const now = clock()
    if (now - item.createdAt >= RULES.editWindow) return tooLate(c, `/item/${item.id}`)
    const ctx = web.ctxOf(c)
    const values = {
      title: field(fields, 'title'),
      url: item.url ?? '',
      body: field(fields, 'body'),
      tags: fieldList(fields, 'tags'),
    }
    const page = (
      extra: { errors?: Record<string, string>; previewHtml?: string },
      status: 200 | 422,
    ) =>
      web.html(
        c,
        <EditItemPage
          ctx={ctx}
          itemId={item.id}
          kind={item.kind}
          values={values}
          errors={extra.errors ?? {}}
          previewHtml={extra.previewHtml}
          tags={listTags(db)}
          minutesLeft={minutesLeft(item.createdAt, now)}
        />,
        status,
      )
    if (field(fields, 'intent') === 'preview') {
      return page(
        { previewHtml: renderMarkdown(values.body, item.kind === 'post' ? 'post' : 'comment') },
        200,
      )
    }
    const result = validateItem(item.kind, fields, knownTags(), { editing: true })
    if (!result.ok) return page({ errors: result.errors }, 422)
    updateItem(
      db,
      item.id,
      { title: result.value.title, bodyMd: result.value.bodyMd, tags: result.value.tags },
      now,
    )
    web.outbox.record('item_updated', { itemId: item.id })
    return c.redirect(`/item/${item.id}`, 303)
  })

  app.get('/item/:id/delete', (c) => {
    const ctx = memberCtx(c)
    if (ctx instanceof Response) return ctx
    const item = liveItem(c)
    if (!item) return web.notFound(c)
    if (item.authorId !== ctx.viewer?.id) return notYours(c)
    return web.html(
      c,
      <ConfirmPage
        ctx={ctx}
        title="Delete this item?"
        action={`/item/${item.id}/delete`}
        button="Delete item"
        sending="Deleting…"
        cancel={`/item/${item.id}`}
        danger
      >
        <p class="confirm__what" dir="auto">
          {itemLabel(item)}
        </p>
        <p>
          It leaves every list, and its page will say you deleted it. Its comments go with it. This
          cannot be undone.
        </p>
      </ConfirmPage>,
    )
  })

  app.post('/item/:id/delete', async (c) => {
    const guard = await guardPost(web, c, c.req.path)
    if (guard instanceof Response) return guard
    const item = liveItem(c)
    if (!item) return web.notFound(c)
    if (item.authorId !== guard.viewer.id) return notYours(c)
    if (authorDeleteItem(db, item.id, guard.viewer.id, clock())) {
      web.outbox.record('item_removed', { itemId: item.id })
    }
    return c.redirect(`/u/${guard.viewer.login}`, 303)
  })

  // --- Comments ------------------------------------------------------------------------------

  app.post('/item/:id/comments', async (c) => {
    const guard = await guardPost(web, c, c.req.path.replace(/\/comments$/, ''))
    if (guard instanceof Response) return guard
    const { viewer, fields } = guard
    const item = liveItem(c)
    if (!item) {
      if (wantsJson(c)) return c.json({ error: 'That item is gone.' }, 404)
      return web.notFound(c)
    }
    const parentRaw = field(fields, 'parent')
    const parentId = /^[1-9]\d{0,15}$/.test(parentRaw) ? Number(parentRaw) : null
    const parent = parentId ? getComment(db, parentId) : null
    if (parentId && (!parent || parent.itemId !== item.id || parent.deleted)) {
      if (wantsJson(c))
        return c.json({ error: 'That comment is gone, so it cannot be answered.' }, 404)
      return web.notFound(c)
    }

    const ctx = web.ctxOf(c)
    const body = field(fields, 'body')
    const formPage = (extra: { error?: string; previewHtml?: string }, status: 200 | 422) => {
      if (parent) {
        return web.html(
          c,
          <ReplyPage
            ctx={ctx}
            parent={parent}
            value={body}
            error={extra.error}
            previewHtml={extra.previewHtml}
          />,
          status,
        )
      }
      return web.html(
        c,
        <CommentPage
          ctx={ctx}
          item={item}
          value={body}
          error={extra.error}
          previewHtml={extra.previewHtml}
        />,
        status,
      )
    }

    if (field(fields, 'intent') === 'preview') {
      return formPage({ previewHtml: renderMarkdown(body, 'comment') }, 200)
    }
    const result = validateComment(fields)
    if (!result.ok) {
      if (wantsJson(c)) return c.json({ error: result.errors.body }, 422)
      return formPage({ error: result.errors.body }, 422)
    }
    const limited = rateLimited(web, c, viewer, 'comment')
    if (limited) return limited
    const id = createComment(db, {
      itemId: item.id,
      authorId: viewer.id,
      parentId: parent?.id ?? null,
      bodyMd: result.value,
      createdAt: clock(),
    })
    web.outbox.record('comment_created', { commentId: id })
    if (wantsJson(c)) {
      const node = commentNode(db, id)
      if (!node) return c.json({ error: 'The comment was saved but could not be shown.' }, 500)
      const html = String(<Comment node={node} ctx={ctx} itemId={item.id} />)
      return c.json({ id, html, listClass: childClass(node.depth) }, 201)
    }
    return c.redirect(`/item/${item.id}#c${id}`, 303)
  })

  app.get('/c/:id/reply', (c) => {
    const ctx = memberCtx(c)
    if (ctx instanceof Response) return ctx
    const comment = liveComment(c)
    if (!comment) return web.notFound(c)
    return web.html(c, <ReplyPage ctx={ctx} parent={comment} value="" />)
  })

  app.get('/c/:id/edit', (c) => {
    const ctx = memberCtx(c)
    if (ctx instanceof Response) return ctx
    const comment = liveComment(c)
    if (!comment) return web.notFound(c)
    if (comment.authorId !== ctx.viewer?.id) return notYours(c)
    if (ctx.now - comment.createdAt >= RULES.editWindow) {
      return tooLate(c, `/item/${comment.itemId}#c${comment.id}`)
    }
    return web.html(
      c,
      <EditCommentPage
        ctx={ctx}
        comment={comment}
        value={comment.bodyMd}
        minutesLeft={minutesLeft(comment.createdAt, ctx.now)}
      />,
    )
  })

  app.post('/c/:id/edit', async (c) => {
    const guard = await guardPost(web, c, c.req.path)
    if (guard instanceof Response) return guard
    const { viewer, fields } = guard
    const comment = liveComment(c)
    if (!comment) return web.notFound(c)
    if (comment.authorId !== viewer.id) return notYours(c)
    const now = clock()
    const href = `/item/${comment.itemId}#c${comment.id}`
    if (now - comment.createdAt >= RULES.editWindow) return tooLate(c, href)
    const ctx = web.ctxOf(c)
    const body = field(fields, 'body')
    const page = (extra: { error?: string; previewHtml?: string }, status: 200 | 422) =>
      web.html(
        c,
        <EditCommentPage
          ctx={ctx}
          comment={comment}
          value={body}
          error={extra.error}
          previewHtml={extra.previewHtml}
          minutesLeft={minutesLeft(comment.createdAt, now)}
        />,
        status,
      )
    if (field(fields, 'intent') === 'preview')
      return page({ previewHtml: renderMarkdown(body, 'comment') }, 200)
    const result = validateComment(fields)
    if (!result.ok) return page({ error: result.errors.body }, 422)
    updateComment(db, comment.id, result.value, now)
    web.outbox.record('comment_updated', { commentId: comment.id })
    return c.redirect(href, 303)
  })

  app.get('/c/:id/delete', (c) => {
    const ctx = memberCtx(c)
    if (ctx instanceof Response) return ctx
    const comment = liveComment(c)
    if (!comment) return web.notFound(c)
    if (comment.authorId !== ctx.viewer?.id) return notYours(c)
    return web.html(
      c,
      <ConfirmPage
        ctx={ctx}
        title="Delete this comment?"
        action={`/c/${comment.id}/delete`}
        button="Delete comment"
        sending="Deleting…"
        cancel={`/item/${comment.itemId}#c${comment.id}`}
        danger
      >
        <QuotedComment ctx={ctx} comment={comment} />
        <p>
          Its text goes. Replies to it stay where they are, under “[deleted]”. This cannot be
          undone.
        </p>
      </ConfirmPage>,
    )
  })

  app.post('/c/:id/delete', async (c) => {
    const guard = await guardPost(web, c, c.req.path)
    if (guard instanceof Response) return guard
    const comment = liveComment(c)
    if (!comment) return web.notFound(c)
    if (comment.authorId !== guard.viewer.id) return notYours(c)
    if (authorDeleteComment(db, comment.id, guard.viewer.id, clock())) {
      web.outbox.record('comment_deleted', { commentId: comment.id })
    }
    return c.redirect(`/item/${comment.itemId}#comments`, 303)
  })

  // --- Votes ---------------------------------------------------------------------------------

  const vote = (target: 'item' | 'comment') => async (c: C) => {
    const id = idParam(c)
    const fallback = target === 'item' ? `/item/${id}` : '/'
    const guard = await guardPost(web, c, fallback)
    if (guard instanceof Response) return guard
    const { viewer, fields } = guard
    if (!id) return web.notFound(c)
    const limited = rateLimited(web, c, viewer, 'vote')
    if (limited) return limited
    const result = setVote(db, target, id, viewer.id, field(fields, 'dir') !== 'un', clock())
    if (!result.ok) {
      const message =
        result.reason === 'own' ? 'You cannot vote on what you wrote.' : 'That is gone.'
      if (wantsJson(c)) return c.json({ error: message }, result.reason === 'own' ? 403 : 404)
      return result.reason === 'own'
        ? web.refuse(c, { title: 'That is yours', body: message })
        : web.notFound(c)
    }
    if (wantsJson(c)) return c.json({ points: result.points, voted: result.voted })
    return c.redirect(safeNext(field(fields, 'next') || fallback), 303)
  }
  app.post('/item/:id/vote', vote('item'))
  app.post('/c/:id/vote', vote('comment'))

  // --- Flags ---------------------------------------------------------------------------------

  const flagPage = (target: 'item' | 'comment') => (c: C) => {
    const ctx = memberCtx(c)
    if (ctx instanceof Response) return ctx
    const viewerId = ctx.viewer?.id ?? 0
    if (target === 'item') {
      const item = liveItem(c)
      if (!item) return web.notFound(c)
      if (item.authorId === viewerId)
        return web.refuse(c, {
          title: 'That is yours',
          body: 'You cannot flag your own item. You can delete it.',
        })
      return web.html(
        c,
        <FlagPage
          ctx={ctx}
          what="item"
          label={itemLabel(item)}
          href={`/item/${item.id}`}
          action={`/item/${item.id}/flag`}
          existing={memberFlag(db, 'item', item.id, viewerId)}
        />,
      )
    }
    const comment = liveComment(c)
    if (!comment) return web.notFound(c)
    if (comment.authorId === viewerId)
      return web.refuse(c, {
        title: 'That is yours',
        body: 'You cannot flag your own comment. You can delete it.',
      })
    return web.html(
      c,
      <FlagPage
        ctx={ctx}
        what="comment"
        label={`${comment.author.login}’s comment on ${comment.itemTitle}`}
        href={`/item/${comment.itemId}#c${comment.id}`}
        action={`/c/${comment.id}/flag`}
        existing={memberFlag(db, 'comment', comment.id, viewerId)}
      />,
    )
  }

  const flag = (target: 'item' | 'comment') => async (c: C) => {
    const guard = await guardPost(web, c, c.req.path)
    if (guard instanceof Response) return guard
    const { viewer, fields } = guard
    const id = idParam(c)
    const item = target === 'item' ? liveItem(c) : null
    const comment = target === 'comment' ? liveComment(c) : null
    if (!id || (!item && !comment)) return web.notFound(c)
    const href = item ? `/item/${item.id}` : `/item/${comment?.itemId}#c${id}`
    if (field(fields, 'intent') === 'withdraw') {
      withdrawFlag(db, target, id, viewer.id)
      return c.redirect(href, 303)
    }
    const reason = validateFlagReason(fields)
    if (!reason.ok) {
      return web.html(
        c,
        <FlagPage
          ctx={web.ctxOf(c)}
          what={target}
          label={item ? itemLabel(item) : `${comment?.author.login}’s comment`}
          href={href}
          action={c.req.path}
          existing={null}
          error={reason.errors.reason}
        />,
        422,
      )
    }
    const limited = rateLimited(web, c, viewer, 'flag')
    if (limited) return limited
    const result = addFlag(db, target, id, viewer.id, reason.value, clock())
    if (!result.ok && result.reason === 'own') {
      return web.refuse(c, { title: 'That is yours', body: 'You cannot flag what you wrote.' })
    }
    return c.redirect(c.req.path, 303)
  }

  app.get('/item/:id/flag', flagPage('item'))
  app.get('/c/:id/flag', flagPage('comment'))
  app.post('/item/:id/flag', flag('item'))
  app.post('/c/:id/flag', flag('comment'))

  // --- Preview -------------------------------------------------------------------------------

  // The same renderer the page will use, for src/client/forms.ts. Nothing is stored.
  app.post('/preview', async (c) => {
    const guard = await guardPost(web, c, '/')
    if (guard instanceof Response) return guard
    const { viewer, fields } = guard
    const limited = rateLimited(web, c, viewer, 'preview')
    if (limited) return limited
    const mode = field(fields, 'mode') === 'post' ? 'post' : 'comment'
    const body = field(fields, 'body')
    if (Array.from(body).length > 100_000)
      return c.json({ error: 'That is too long to preview.' }, 413)
    return c.json({ html: renderMarkdown(body, mode) })
  })
}
