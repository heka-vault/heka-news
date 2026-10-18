// Form parts. Every form posts and works without JavaScript; src/client/forms.ts adds the in-place
// preview, character counts and the three-tag limit. Errors are shown next to their field and
// summarized at the top, and the first invalid field gets focus when the form comes back.
//
// Inputs are at least 16px (--text-ui) so phones do not zoom into them (mobile-native).

import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import type { Tag } from '../../db/types.ts'
import type { Errors } from '../../lib/validate.ts'
import type { PageContext } from '../context.ts'

export function Csrf({ ctx }: { ctx: PageContext }) {
  return ctx.viewer ? <input type="hidden" name="csrf" value={ctx.viewer.csrf} /> : null
}

/** The errors at the top of a form that came back, each linking to its field. */
export function ErrorSummary({
  errors,
  labels,
}: {
  errors: Errors
  labels: Record<string, string>
}) {
  const entries = Object.entries(errors)
  if (entries.length === 0) return null
  return (
    <div class="error-summary" role="alert">
      <p class="error-summary__title">
        {entries.length === 1
          ? 'One thing to fix before this can be saved:'
          : `${entries.length} things to fix before this can be saved:`}
      </p>
      <ul>
        {entries.map(([name, message]) => (
          <li>
            <a href={`#f-${name}`}>{labels[name] ?? name}</a>: {message}
          </li>
        ))}
      </ul>
    </div>
  )
}

interface FieldProps {
  name: string
  label: string
  value: string
  error?: string
  hint?: Child
  /** The first field with an error gets focus when the form comes back. */
  focus?: boolean
}

function describedBy(
  name: string,
  hint: unknown,
  error: unknown,
  count: boolean,
): string | undefined {
  const ids = [
    hint ? `f-${name}-hint` : '',
    count ? `f-${name}-count` : '',
    error ? `f-${name}-error` : '',
  ].filter(Boolean)
  return ids.length ? ids.join(' ') : undefined
}

function FieldError({ name, error }: { name: string; error?: string }) {
  return error ? (
    <p class="field__error" id={`f-${name}-error`}>
      {error}
    </p>
  ) : null
}

export function TextField(
  props: FieldProps & {
    type?: 'text' | 'url'
    maxLength?: number
    autocomplete?: string
    inputmode?: 'url' | 'text'
    required?: boolean
    placeholder?: string
    spellcheck?: boolean
    /** Count characters against this limit (forms.ts). */
    limit?: number
  },
) {
  const id = `f-${props.name}`
  return (
    <div class={props.error ? 'field field--invalid' : 'field'}>
      <label class="field__label" for={id}>
        {props.label}
      </label>
      {props.hint && (
        <p class="field__hint" id={`${id}-hint`}>
          {props.hint}
        </p>
      )}
      <input
        class="input"
        id={id}
        name={props.name}
        type={props.type ?? 'text'}
        value={props.value}
        maxlength={props.maxLength}
        autocomplete={props.autocomplete ?? 'off'}
        inputmode={props.inputmode}
        required={props.required}
        placeholder={props.placeholder}
        spellcheck={props.spellcheck}
        autocapitalize={props.type === 'url' ? 'none' : undefined}
        aria-invalid={props.error ? 'true' : undefined}
        aria-describedby={describedBy(props.name, props.hint, props.error, Boolean(props.limit))}
        data-limit={props.limit}
        autofocus={props.focus}
        dir="auto"
      />
      {props.limit && <Counter name={props.name} limit={props.limit} />}
      <FieldError name={props.name} error={props.error} />
    </div>
  )
}

function Counter({ name, limit }: { name: string; limit: number }) {
  return (
    <p class="field__count" id={`f-${name}-count`}>
      Up to {limit.toLocaleString('en-US')} characters
    </p>
  )
}

export function TextArea(
  props: FieldProps & {
    rows?: number
    limit?: number
    required?: boolean
    /** Reading text: the serif face, as it will be shown. */
    prose?: boolean
    /** Extra classes on the field wrapper. */
    tall?: boolean
  },
) {
  const id = `f-${props.name}`
  return (
    <div class={`field${props.error ? ' field--invalid' : ''}${props.tall ? ' field--tall' : ''}`}>
      <label class="field__label" for={id}>
        {props.label}
      </label>
      {props.hint && (
        <p class="field__hint" id={`${id}-hint`}>
          {props.hint}
        </p>
      )}
      <textarea
        class={props.prose === false ? 'input input--area' : 'input input--area input--prose'}
        id={id}
        name={props.name}
        rows={props.rows ?? 6}
        required={props.required}
        aria-invalid={props.error ? 'true' : undefined}
        aria-describedby={describedBy(props.name, props.hint, props.error, Boolean(props.limit))}
        data-limit={props.limit}
        autofocus={props.focus}
        dir="auto"
      >
        {props.value}
      </textarea>
      {props.limit && <Counter name={props.name} limit={props.limit} />}
      <FieldError name={props.name} error={props.error} />
    </div>
  )
}

/** One to three tags, as checkboxes styled like the tags on an item. */
export function TagPicker(props: {
  tags: Tag[]
  selected: string[]
  error?: string
  focus?: boolean
  legend?: string
}) {
  const chosen = new Set(props.selected)
  return (
    <fieldset
      class={props.error ? 'field tag-picker field--invalid' : 'field tag-picker'}
      data-max="3"
      id="f-tags"
      aria-describedby={props.error ? 'f-tags-hint f-tags-error' : 'f-tags-hint'}
    >
      <legend class="field__label">{props.legend ?? 'Tags'}</legend>
      <p class="field__hint" id="f-tags-hint">
        Pick one to three.
      </p>
      <div class="tag-picker__options">
        {props.tags.map((tag, i) => (
          <label class="tag-option" title={tag.description || undefined}>
            <input
              type="checkbox"
              name="tags"
              value={tag.name}
              checked={chosen.has(tag.name)}
              autofocus={props.focus && i === 0}
            />
            <span>{tag.name}</span>
          </label>
        ))}
      </div>
      <FieldError name="tags" error={props.error} />
    </fieldset>
  )
}

export const MARKDOWN_HINT = (
  <>
    Markdown: <code>*italic*</code>, <code>**bold**</code>, <code>`code`</code>, links, lists and
    quotes. No images or HTML.
  </>
)

/** The preview panel: filled by the server (no-JS preview) or by forms.ts. */
export function Preview({ html }: { html?: string | null }) {
  return (
    <section
      class="preview"
      hidden={html === undefined || html === null}
      aria-live="polite"
      aria-label="Preview"
    >
      <p class="preview__label">Preview</p>
      <div class="preview__body prose" dir="auto">
        {html ? (
          raw(html)
        ) : html === '' ? (
          <p class="preview__empty">Nothing to preview yet.</p>
        ) : null}
      </div>
    </section>
  )
}

/** The main button, and Preview for markdown fields. */
export function FormActions(props: {
  label: string
  sending: string
  preview?: boolean
  cancel?: { href: string; label: string }
  extra?: Child
}) {
  return (
    <div class="form__actions">
      <button class="button" type="submit" name="intent" value="post" data-sending={props.sending}>
        {props.label}
      </button>
      {props.preview && (
        <button
          class="button button--quiet"
          type="submit"
          name="intent"
          value="preview"
          formnovalidate
        >
          Preview
        </button>
      )}
      {props.cancel && (
        <a class="form__cancel" href={props.cancel.href}>
          {props.cancel.label}
        </a>
      )}
      {props.extra}
      <p class="form__status" role="status" aria-live="polite" />
    </div>
  )
}

/** The first field name with an error, in the order the form shows them. */
export function firstError(errors: Errors, order: string[]): string | undefined {
  return order.find((name) => errors[name])
}
