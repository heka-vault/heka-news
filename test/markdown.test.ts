import { describe, expect, test } from 'bun:test'
import { excerpt, htmlToText, renderMarkdown } from '../src/lib/markdown.ts'

const ALLOWED_TAGS = new Set(
  'p br hr h2 h3 h4 h5 h6 strong em del s code pre blockquote ul ol li a div table thead tbody tr th td'.split(
    ' ',
  ),
)
const ALLOWED_ATTRS = new Set(['href', 'rel', 'dir', 'tabindex', 'class', 'start'])

/** Assert that every real tag in rendered HTML is allowlisted and carries only safe attributes. */
function expectInert(html: string) {
  for (const [, name, attrs] of html.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/g)) {
    expect(ALLOWED_TAGS.has((name ?? '').toLowerCase())).toBe(true)
    for (const [, attr, value] of (attrs ?? '').matchAll(/([^\s=]+)="([^"]*)"/g)) {
      expect(ALLOWED_ATTRS.has(attr ?? '')).toBe(true)
      if (attr === 'href') expect(value).toMatch(/^(https?:|mailto:)/)
    }
  }
}

describe('markdown sanitizing (XSS)', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '[x](javascript:alert(1))',
    '[x](JAVASCRIPT:alert(1))',
    '[x](  javascript:alert(1))',
    '[x](&#106;avascript:alert(1))',
    '[x](java\tscript:alert(1))',
    '[x](vbscript:msgbox(1))',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '<javascript:alert(1)>',
    '![x](javascript:alert(1))',
    '![x" onerror="alert(1)](https://example.com/a.png)',
    '[x](https://example.com "\\" onmouseover=\\"alert(1)")',
    '<iframe src="https://example.com"></iframe>',
    '<svg onload=alert(1)>',
    '<style>body{display:none}</style>',
    '<div style="position:fixed">x</div>',
    '```html\n<script>alert(1)</script>\n```',
    '`<img src=x onerror=alert(1)>`',
    '<details open ontoggle=alert(1)>',
    '[x](//evil.example.com)',
  ]
  for (const attack of attacks) {
    test(`inert: ${attack.slice(0, 50)}`, () => {
      expectInert(renderMarkdown(attack, 'post'))
      expectInert(renderMarkdown(attack, 'comment'))
    })
  }

  test('raw HTML is shown as text, not parsed', () => {
    expect(renderMarkdown('<b>hi</b>')).toBe('<p dir="auto">&lt;b&gt;hi&lt;/b&gt;</p>')
  })

  test('protocol-relative links lose their href', () => {
    expect(renderMarkdown('[x](//evil.example.com)')).not.toContain('evil.example.com"')
  })
})

describe('links', () => {
  test('every link gets rel="nofollow ugc noopener", including autolinks', () => {
    for (const source of [
      '[a](https://example.com)',
      'see https://example.com/x',
      '<https://example.com>',
    ]) {
      const html = renderMarkdown(source)
      expect(html).toContain('rel="nofollow ugc noopener"')
      expect(html).toContain('href="https://example.com')
    }
  })

  test('mailto is allowed', () => {
    expect(renderMarkdown('[mail](mailto:a@example.com)')).toContain('href="mailto:a@example.com"')
  })

  test('images become links to the image, labelled with the alt text', () => {
    const html = renderMarkdown('![a chart](https://example.com/c.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain(
      '<a href="https://example.com/c.png" rel="nofollow ugc noopener">a chart</a>',
    )
  })
})

describe('structure', () => {
  test('post headings start at h2 whatever the author used, and never skip a level', () => {
    const html = renderMarkdown('## A\n\n#### B\n\n## C\n\n### D', 'post')
    expect(html.match(/<h\d/g)).toEqual(['<h2', '<h3', '<h2', '<h3'])
    const top = renderMarkdown('# A\n\n## B\n\n#### C', 'post')
    expect(top.match(/<h\d/g)).toEqual(['<h2', '<h3', '<h4'])
  })

  test('comments have no headings', () => {
    expect(renderMarkdown('# Not a heading')).not.toMatch(/<h\d/)
  })

  test('code blocks and tables are keyboard-scrollable', () => {
    expect(renderMarkdown('```ts\nconst a = 1\n```')).toContain(
      '<pre tabindex="0"><code class="language-ts">',
    )
    expect(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |', 'post')).toContain(
      '<div class="table-scroll" tabindex="0"><table>',
    )
  })

  test('only the renderer’s classes survive', () => {
    expect(renderMarkdown('```x" onclick="y\ncode\n```')).not.toContain('onclick')
  })

  test('each block finds its own direction', () => {
    expect(renderMarkdown('שלום\n\nhello')).toBe('<p dir="auto">שלום</p>\n<p dir="auto">hello</p>')
  })
})

describe('text helpers', () => {
  test('htmlToText strips tags and decodes entities', () => {
    expect(htmlToText('<p>a &amp; b</p><p>c</p>')).toBe('a & b c')
  })

  test('excerpt cuts at a word boundary with an ellipsis', () => {
    expect(excerpt('short')).toBe('short')
    const cut = excerpt('word '.repeat(60), 40)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(40)
  })
})
