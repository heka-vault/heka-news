// /submit and /item/:id/edit: one form per kind of item (ADR 0006). The kind is chosen with links
// (/submit?kind=post), so the URL says which form you are on and nothing needs JavaScript.

import type { ItemKind, Tag } from '../../db/types.ts'
import { type Errors, LIMITS } from '../../lib/validate.ts'
import {
  Csrf,
  ErrorSummary,
  FormActions,
  firstError,
  MARKDOWN_HINT,
  Preview,
  TagPicker,
  TextArea,
  TextField,
} from '../components/Forms.tsx'
import { Layout } from '../components/Layout.tsx'
import type { PageContext } from '../context.ts'

export interface ItemFormValues {
  title: string
  url: string
  body: string
  tags: string[]
}

export const EMPTY_ITEM: ItemFormValues = { title: '', url: '', body: '', tags: [] }

const KINDS: { kind: ItemKind; label: string; hint: string }[] = [
  { kind: 'link', label: 'Link', hint: 'Someone’s work, ideally the primary source.' },
  { kind: 'post', label: 'Post', hint: 'Your own long-form writing, published only here.' },
  { kind: 'status', label: 'Status note', hint: 'What you are building, reading or stuck on.' },
]

const LABELS = { title: 'Title', url: 'Address', body: 'Text', tags: 'Tags' }

function bodyLabel(kind: ItemKind): string {
  if (kind === 'post') return 'Post'
  if (kind === 'status') return 'Note'
  return 'Text (optional)'
}

export function ItemForm(props: {
  ctx: PageContext
  kind: ItemKind
  action: string
  values: ItemFormValues
  errors: Errors
  tags: Tag[]
  previewHtml?: string | null
  /** Editing keeps the URL fixed and changes the button. */
  editing?: { itemHref: string }
  /** An earlier item with the same link. */
  duplicate?: { id: number; title: string; when: string }
}) {
  const { kind, values, errors } = props
  const focus = firstError(errors, ['title', 'url', 'body', 'tags'])
  const bodyLimit =
    kind === 'post' ? LIMITS.post : kind === 'status' ? LIMITS.status : LIMITS.linkText
  return (
    <form
      class="form item-form"
      method="post"
      action={props.action}
      data-preview={kind === 'post' ? 'post' : 'comment'}
      novalidate
    >
      <Csrf ctx={props.ctx} />
      <ErrorSummary errors={errors} labels={{ ...LABELS, body: bodyLabel(kind) }} />
      {props.duplicate && (
        <div class="error-summary" role="alert">
          <p class="error-summary__title">This link is already here.</p>
          <p>
            It was posted {props.duplicate.when}:{' '}
            <a href={`/item/${props.duplicate.id}`} dir="auto">
              {props.duplicate.title}
            </a>
            . Add your comment there instead.
          </p>
        </div>
      )}
      {kind !== 'status' && (
        <TextField
          name="title"
          label="Title"
          value={values.title}
          error={errors.title}
          limit={LIMITS.title}
          required
          focus={focus === 'title'}
          hint={kind === 'link' ? 'The page’s own title, without the site’s name.' : undefined}
        />
      )}
      {kind === 'link' &&
        (props.editing ? (
          <div class="field">
            <p class="field__label">Address</p>
            <p class="field__fixed">{values.url}</p>
            <p class="field__hint">A link’s address cannot change after it is posted.</p>
          </div>
        ) : (
          <TextField
            name="url"
            label="Address"
            type="url"
            inputmode="url"
            value={values.url}
            error={errors.url}
            placeholder="https://…"
            spellcheck={false}
            maxLength={LIMITS.url}
            required
            focus={focus === 'url'}
          />
        ))}
      <TextArea
        name="body"
        label={bodyLabel(kind)}
        value={values.body}
        error={errors.body}
        rows={kind === 'post' ? 18 : kind === 'status' ? 4 : 5}
        limit={bodyLimit}
        required={kind !== 'link'}
        focus={focus === 'body'}
        tall={kind === 'post'}
        hint={
          kind === 'post' ? (
            <>
              {MARKDOWN_HINT} Headings with <code>##</code>.
            </>
          ) : kind === 'link' ? (
            <>Why it is worth reading, if the title does not say. {MARKDOWN_HINT}</>
          ) : (
            MARKDOWN_HINT
          )
        }
      />
      <Preview html={props.previewHtml} />
      <TagPicker
        tags={props.tags}
        selected={values.tags}
        error={errors.tags}
        focus={focus === 'tags'}
      />
      <FormActions
        label={
          props.editing
            ? 'Save changes'
            : kind === 'status'
              ? 'Post note'
              : kind === 'post'
                ? 'Publish post'
                : 'Post link'
        }
        sending={props.editing ? 'Saving…' : 'Posting…'}
        preview
        cancel={props.editing ? { href: props.editing.itemHref, label: 'Cancel' } : undefined}
      />
    </form>
  )
}

export function SubmitPage(props: {
  ctx: PageContext
  kind: ItemKind
  values: ItemFormValues
  errors: Errors
  tags: Tag[]
  previewHtml?: string | null
  duplicate?: { id: number; title: string; when: string }
}) {
  const { ctx, kind } = props
  const current = KINDS.find((k) => k.kind === kind) ?? KINDS[0]
  return (
    <Layout
      ctx={ctx}
      title={`Submit a ${current?.label.toLowerCase() ?? 'link'}`}
      description="Post a link, a post or a status note to heka news."
      canonical="/submit"
      noindex
      scripts={['forms']}
    >
      <div class="wrap submit">
        <header class="page-head">
          <h1>Submit</h1>
        </header>
        <nav class="kind-tabs" aria-label="Kind of item">
          {KINDS.map((k) => (
            <a
              class="kind-tab"
              href={`/submit?kind=${k.kind}`}
              aria-current={k.kind === kind ? 'page' : undefined}
            >
              <span class="kind-tab__label">{k.label}</span>
              <span class="kind-tab__hint">{k.hint}</span>
            </a>
          ))}
        </nav>
        <ItemForm
          ctx={ctx}
          kind={kind}
          action={`/submit?kind=${kind}`}
          values={props.values}
          errors={props.errors}
          tags={props.tags}
          previewHtml={props.previewHtml}
          duplicate={props.duplicate}
        />
      </div>
    </Layout>
  )
}

export function EditItemPage(props: {
  ctx: PageContext
  itemId: number
  kind: ItemKind
  values: ItemFormValues
  errors: Errors
  tags: Tag[]
  previewHtml?: string | null
  minutesLeft: number
}) {
  const href = `/item/${props.itemId}`
  return (
    <Layout ctx={props.ctx} title="Edit" description="Edit an item." noindex scripts={['forms']}>
      <div class="wrap submit">
        <header class="page-head">
          <h1>
            Edit{' '}
            {props.kind === 'status'
              ? 'your note'
              : props.kind === 'post'
                ? 'your post'
                : 'your link'}
          </h1>
          <p>
            You can edit for {props.minutesLeft} more{' '}
            {props.minutesLeft === 1 ? 'minute' : 'minutes'}. The item will say it was edited.
          </p>
        </header>
        <ItemForm
          ctx={props.ctx}
          kind={props.kind}
          action={`${href}/edit`}
          values={props.values}
          errors={props.errors}
          tags={props.tags}
          previewHtml={props.previewHtml}
          editing={{ itemHref: href }}
        />
      </div>
    </Layout>
  )
}
