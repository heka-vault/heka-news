// "Copy link" next to a new invitation. Without this script the link is in a read-only field the
// member can select and copy by hand; the button is hidden until it can work.

for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
  const input = document.getElementById(button.dataset.copy ?? '')
  if (!(input instanceof HTMLInputElement) || !navigator.clipboard) continue
  button.hidden = false
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(input.value)
      button.textContent = 'Copied'
    } catch {
      input.select()
      button.textContent = 'Press Ctrl+C to copy'
    }
    window.setTimeout(() => {
      button.textContent = 'Copy link'
    }, 2500)
  })
}

export {}
