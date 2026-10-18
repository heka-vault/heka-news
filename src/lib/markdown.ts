// The one markdown pipeline for everything a member writes (ADR 0006): markdown-it with raw HTML
// off, then sanitize-html with an allowlist as a second, independent layer. The output is cached
// in the row (body_html) with MARKDOWN_VERSION; bump the version when the output changes and every
// row is re-rendered at the next startup (src/db/write.ts, rerenderStale).
//
// - No raw HTML: `<script>` in a post is text, not a tag.
// - Links: http, https and mailto only, every one with rel="nofollow ugc noopener".
// - No remote images: `![alt](src)` becomes a link to src, so a post cannot track readers or shift
//   the layout while an image loads.
// - Posts may use headings; they are shifted under the page's <h1> and never skip a level.
//   Comments and status notes have no headings.
// - Code blocks and tables can scroll sideways and are keyboard-focusable when they do.

import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'

export const MARKDOWN_VERSION = 3

/** `post` allows headings; `comment` (comments, status notes, link text, bios) does not. */
export type MarkdownMode = 'post' | 'comment'

export const USER_LINK_REL = 'nofollow ugc noopener'

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

type Renderer = InstanceType<typeof MarkdownIt>

function build(mode: MarkdownMode): Renderer {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false })

  if (mode === 'comment') md.disable(['heading', 'lheading'])

  // Headings: the page title is the <h1>, so a post's highest heading level becomes <h2>, whatever
  // the author used ("#" or "##"), and no level is skipped (axe heading-order): each heading may
  // go back up freely but only one level down at a time.
  md.core.ruler.push('heka_heading_levels', (state) => {
    const opens = state.tokens.filter((token) => token.type === 'heading_open')
    if (opens.length === 0) return
    const top = Math.min(...opens.map((token) => Number(token.tag.slice(1))))
    let previous = 1
    for (const token of state.tokens) {
      if (token.type === 'heading_open') {
        const requested = Number(token.tag.slice(1)) - top + 2
        const level = Math.min(Math.max(requested, 2), previous + 1, 6)
        token.tag = `h${level}`
        previous = level
      } else if (token.type === 'heading_close') {
        token.tag = `h${previous}`
      }
    }
  })

  // Images become links to the image, labelled with the alt text.
  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx]
    const src = String(token?.attrGet('src') ?? '')
    const alt = String(token?.content || src)
    return `<a href="${escapeAttr(src)}">${md.utils.escapeHtml(alt)}</a>`
  }

  // Scrollable blocks must be focusable so keyboard users can scroll them.
  const fence = md.renderer.rules.fence
  const codeBlock = md.renderer.rules.code_block
  if (fence) {
    md.renderer.rules.fence = (...args) => fence(...args).replace(/^<pre>/, '<pre tabindex="0">')
  }
  if (codeBlock) {
    md.renderer.rules.code_block = (...args) =>
      codeBlock(...args).replace(/^<pre>/, '<pre tabindex="0">')
  }
  md.renderer.rules.table_open = () => '<div class="table-scroll" tabindex="0"><table>\n'
  md.renderer.rules.table_close = () => '</table></div>\n'

  return md
}

const renderers: Record<MarkdownMode, Renderer> = {
  post: build('post'),
  comment: build('comment'),
}

const autoDir = (tagName: string) => ({ tagName, attribs: { dir: 'auto' } })

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'hr',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'em',
    'del',
    's',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'a',
    'div',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
    '*': ['dir'],
    a: ['href', 'title', 'rel', 'dir'],
    pre: ['tabindex'],
    div: ['class', 'tabindex'],
    code: ['class'],
    ol: ['start'],
  },
  allowedClasses: {
    code: [/^language-[\w-]{1,32}$/],
    div: ['table-scroll'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { href: attribs.href ?? '', rel: USER_LINK_REL },
    }),
    // Each block finds its own direction, so a post can mix Arabic, Hebrew and English paragraphs.
    p: autoDir,
    li: autoDir,
    blockquote: autoDir,
    h2: autoDir,
    h3: autoDir,
    h4: autoDir,
    h5: autoDir,
    h6: autoDir,
    th: autoDir,
    td: autoDir,
    // Only the values our renderer writes survive.
    pre: (tagName) => ({ tagName, attribs: { tabindex: '0' } }),
    div: (tagName, attribs) =>
      attribs.class === 'table-scroll'
        ? { tagName, attribs: { class: 'table-scroll', tabindex: '0' } }
        : { tagName, attribs: {} as Record<string, string> },
  },
  exclusiveFilter: (frame) => frame.tag === 'div' && frame.attribs.class !== 'table-scroll',
}

/** Markdown to safe HTML. */
export function renderMarkdown(source: string, mode: MarkdownMode = 'comment'): string {
  const html = renderers[mode].render(source)
  return sanitizeHtml(html, SANITIZE).trim()
}

/** Plain text from rendered HTML: tags dropped, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html.replace(/<\/(p|li|h\d|pre|blockquote|tr)>/g, ' $&'), {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** At most `max` characters, cut at a word boundary, with an ellipsis when cut. */
export function excerpt(text: string, max = 160): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  const cut = chars.slice(0, max - 1).join('')
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`
}
