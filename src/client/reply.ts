// Replying in place. Every comment's "reply" is a link to /c/:id/reply, a page with the comment and
// a form. Here the link opens the same form under the comment instead (from the page's
// <template id="reply-template">), sends it with fetch, and puts the new comment into the thread
// with the server's own rendering. Escape or Cancel closes an empty form and returns focus.

const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
const template = document.getElementById('reply-template')
const numbers = new Intl.NumberFormat('en-US')

function close(form: HTMLFormElement): void {
  const link = document.querySelector<HTMLAnchorElement>(
    `a.c-reply[data-for="${form.dataset.for}"]`,
  )
  form.remove()
  link?.setAttribute('aria-expanded', 'false')
  link?.focus()
}

function bumpCount(): void {
  const heading = document.getElementById('comments')
  if (!heading) return
  const n = Number(heading.dataset.count ?? 0) + 1
  heading.dataset.count = String(n)
  heading.textContent = `${numbers.format(n)} ${n === 1 ? 'comment' : 'comments'}`
}

function showError(form: HTMLFormElement, message: string): void {
  const slot = form.querySelector<HTMLElement>('.form__status')
  if (slot) slot.textContent = message
}

async function send(form: HTMLFormElement, comment: HTMLElement): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>('button[name="intent"][value="post"]')
  const body = new URLSearchParams()
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string') body.append(key, value)
  }
  body.set('intent', 'post')
  if (button) {
    button.disabled = true
    button.textContent = 'Posting…'
  }
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      body,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
    })
    const data = (await res.json().catch(() => ({}))) as {
      html?: string
      listClass?: string
      id?: number
      error?: string
    }
    if (!res.ok || !data.html || !data.id) {
      showError(form, data.error ?? 'The reply was not posted. Your text is still here; try again.')
      return
    }
    let list = comment.querySelector<HTMLOListElement>(':scope > .c-fold > ol')
    if (!list) {
      list = document.createElement('ol')
      list.className = data.listClass ?? 'c-children'
      comment.querySelector(':scope > .c-fold')?.append(list)
    }
    // Rendered by the server from sanitized markdown: the same markup as the thread around it.
    list.insertAdjacentHTML('beforeend', data.html)
    form.remove()
    document.dispatchEvent(new CustomEvent('heka:sent'))
    const added = document.getElementById(`c${data.id}`)
    added?.classList.add('comment--new')
    added?.querySelector<HTMLElement>('.c-author')?.focus()
    document
      .querySelector(`a.c-reply[data-for="${form.dataset.for}"]`)
      ?.setAttribute('aria-expanded', 'false')
    bumpCount()
    document.dispatchEvent(new CustomEvent('heka:inserted'))
  } catch {
    showError(form, 'The reply was not posted. Check your connection; your text is still here.')
  } finally {
    if (button?.isConnected) {
      button.disabled = false
      button.textContent = 'Post reply'
    }
  }
}

document.addEventListener('click', (event) => {
  const target = event.target as Element | null
  const cancel = target?.closest?.('button[data-cancel]')
  if (cancel) {
    const form = cancel.closest('form')
    if (form) close(form)
    return
  }
  const link = target?.closest?.('a.c-reply')
  if (!(link instanceof HTMLAnchorElement) || !(template instanceof HTMLTemplateElement) || !csrf)
    return
  const event_ = event as MouseEvent
  if (event_.metaKey || event_.ctrlKey || event_.shiftKey || event_.altKey || event_.button !== 0)
    return
  const id = link.dataset.for
  const comment = id ? document.getElementById(`c${id}`) : null
  if (!id || !comment) return
  // Deep in a thread on a phone there is no room to write in place: the link opens the reply page,
  // which quotes the comment and gives the form the full width (break-ui).
  const room =
    comment.querySelector(':scope > .c-fold > .c-actions')?.getBoundingClientRect().width ?? 0
  if (room < 288) return
  event.preventDefault()

  const open = document.querySelector<HTMLFormElement>(`form.reply-inline[data-for="${id}"]`)
  if (open) {
    open.querySelector('textarea')?.focus()
    return
  }
  const fragment = template.content.cloneNode(true) as DocumentFragment
  const form = fragment.querySelector('form')
  if (!form) return
  form.dataset.for = id
  const parent = form.querySelector<HTMLInputElement>('input[name="parent"]')
  if (parent) parent.value = id
  // The template's ids are for one form; give this one its own.
  const textarea = form.querySelector('textarea')
  if (textarea) {
    const old = textarea.id
    textarea.id = `reply-${id}`
    form.querySelector('label')?.setAttribute('for', textarea.id)
    for (const el of form.querySelectorAll<HTMLElement>(`[id^="${old}-"]`)) {
      el.id = el.id.replace(old, textarea.id)
    }
    const described = textarea.getAttribute('aria-describedby')
    if (described) textarea.setAttribute('aria-describedby', described.replaceAll(old, textarea.id))
  }
  const anchor = link.closest('.c-actions')
  anchor?.after(form)
  link.setAttribute('aria-expanded', 'true')
  textarea?.focus()
})

document.addEventListener('submit', (event) => {
  const form = event.target
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('reply-inline')) return
  const submitter = (event as SubmitEvent).submitter
  if (submitter instanceof HTMLButtonElement && submitter.value === 'preview') return
  const comment = document.getElementById(`c${form.dataset.for}`)
  if (!comment || !csrf) return
  event.preventDefault()
  void send(form, comment)
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  const form = (event.target as Element | null)?.closest?.('form.reply-inline')
  if (!(form instanceof HTMLFormElement)) return
  const textarea = form.querySelector('textarea')
  if (textarea && textarea.value.trim() !== '') return
  close(form)
})

export {}
