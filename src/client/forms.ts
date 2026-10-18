// Form helpers, all by event delegation so they also work on reply forms added later:
//
// - Preview: the Preview button is a real submit button (the server re-renders the form with the
//   preview). Here it asks POST /preview for the same rendering and shows it in place.
// - Character counts: "312 characters left" under fields with a limit (the server enforces it).
// - Tags: once three are picked, the rest are disabled until one is unpicked.
// - A form being sent says so on its main button and cannot be sent twice.

const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
const numbers = new Intl.NumberFormat('en-US')

function chars(text: string): number {
  return Array.from(text.replace(/\r\n?/g, '\n')).length
}

// --- Preview -------------------------------------------------------------------------------------

async function preview(form: HTMLFormElement, button: HTMLButtonElement): Promise<void> {
  const textarea = form.querySelector<HTMLTextAreaElement>(
    'textarea[name="body"], textarea[name="bio"]',
  )
  const panel = form.querySelector<HTMLElement>('.preview')
  const out = panel?.querySelector<HTMLElement>('.preview__body')
  if (!textarea || !panel || !out) return
  const body = new URLSearchParams({
    body: textarea.value,
    mode: form.dataset.preview ?? 'comment',
  })
  button.setAttribute('aria-busy', 'true')
  try {
    const res = await fetch('/preview', {
      method: 'POST',
      body,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
    })
    const data = (await res.json()) as { html?: string; error?: string }
    if (!res.ok || data.html === undefined) throw new Error(data.error ?? 'failed')
    // The server's own markdown renderer and sanitizer produced this HTML.
    out.innerHTML = data.html || '<p class="preview__empty">Nothing to preview yet.</p>'
    panel.hidden = false
    button.textContent = 'Update preview'
  } catch (error) {
    out.textContent =
      error instanceof Error && error.message !== 'failed'
        ? error.message
        : 'The preview did not load. Your text is still here.'
    panel.hidden = false
  } finally {
    button.removeAttribute('aria-busy')
  }
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element | null)?.closest?.(
    'button[name="intent"][value="preview"]',
  )
  if (!(button instanceof HTMLButtonElement) || !csrf) return
  const form = button.form
  if (!form?.dataset.preview) return
  event.preventDefault()
  void preview(form, button)
})

// --- Character counts ----------------------------------------------------------------------------

function count(field: HTMLTextAreaElement | HTMLInputElement): void {
  const max = Number(field.dataset.limit)
  const out = field.id ? document.getElementById(`${field.id}-count`) : null
  if (!max || !out) return
  const left = max - chars(field.value)
  out.textContent =
    left >= 0
      ? `${numbers.format(left)} ${left === 1 ? 'character' : 'characters'} left`
      : `${numbers.format(-left)} over the limit`
  out.classList.toggle('field__count--over', left < 0)
}

document.addEventListener('input', (event) => {
  const field = event.target
  if (
    (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) &&
    field.dataset.limit
  ) {
    count(field)
  }
})

// --- Tags ----------------------------------------------------------------------------------------

function limitTags(fieldset: HTMLFieldSetElement): void {
  const max = Number(fieldset.dataset.max ?? 3)
  const boxes = [...fieldset.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  const full = boxes.filter((box) => box.checked).length >= max
  for (const box of boxes) box.disabled = full && !box.checked
}

document.addEventListener('change', (event) => {
  const box = event.target
  if (!(box instanceof HTMLInputElement) || box.type !== 'checkbox') return
  const fieldset = box.closest<HTMLFieldSetElement>('fieldset.tag-picker')
  if (fieldset) limitTags(fieldset)
})

for (const fieldset of document.querySelectorAll<HTMLFieldSetElement>('fieldset.tag-picker')) {
  limitTags(fieldset)
}
for (const field of document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
  '[data-limit]',
)) {
  count(field)
}

// --- Sending -------------------------------------------------------------------------------------

document.addEventListener('submit', (event) => {
  const form = event.target
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('form')) return
  const submitter = (event as SubmitEvent).submitter
  if (form.dataset.sending === 'true') {
    event.preventDefault()
    return
  }
  // Disabled boxes are not sent; enable them so a picked tag is never dropped.
  for (const box of form.querySelectorAll<HTMLInputElement>('fieldset.tag-picker input:disabled')) {
    box.disabled = false
  }
  // After this tick, so the browser has already read the submitter's name and value.
  window.setTimeout(() => {
    if (event.defaultPrevented) return
    form.dataset.sending = 'true'
    if (submitter instanceof HTMLButtonElement && submitter.dataset.sending) {
      submitter.textContent = submitter.dataset.sending
    }
  })
})

// A page restored from the back/forward cache must be sendable again.
window.addEventListener('pageshow', () => {
  for (const form of document.querySelectorAll<HTMLFormElement>('form[data-sending]')) {
    delete form.dataset.sending
  }
})

export {}
