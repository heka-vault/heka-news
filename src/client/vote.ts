// Voting without a reload. Each vote mark is a real form (POST /item/:id/vote or /c/:id/vote) that
// works without this script; here the form is sent with fetch instead, the mark and the count
// change at once, and they go back if the server says no. Clicks while a request is out are
// coalesced: the last state the member asked for is the one sent.

const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
const numbers = new Intl.NumberFormat('en-US')

interface State {
  wanted: boolean
  confirmed: boolean
  points: number
  busy: boolean
}

const states = new WeakMap<HTMLFormElement, State>()

function parts(form: HTMLFormElement) {
  const button = form.querySelector<HTMLButtonElement>('button.vote__mark')
  const id = form.dataset.target ?? ''
  const counts = id ? document.querySelectorAll<HTMLElement>(`[data-points="${id}"]`) : []
  return { button, counts }
}

function render(form: HTMLFormElement, voted: boolean, points: number): void {
  const { button, counts } = parts(form)
  if (!button) return
  button.setAttribute('aria-pressed', String(voted))
  button.value = voted ? 'un' : 'up'
  for (const el of counts) {
    const unit = el.dataset.unit
    const n = numbers.format(points)
    const text = unit ? `${n} ${points === 1 ? unit : `${unit}s`}` : n
    const label = el.querySelector('.vote__count')
    if (label) label.textContent = n
    else el.textContent = text
  }
}

async function send(form: HTMLFormElement, state: State): Promise<void> {
  state.busy = true
  const body = new URLSearchParams()
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string') body.append(key, value)
  }
  body.set('dir', state.wanted ? 'up' : 'un')
  const asked = state.wanted
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      body,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
    })
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { points: number; voted: boolean }
    state.confirmed = data.voted
    state.points = data.points
  } catch (error) {
    // Back to what the server last confirmed. A rate limit or an expired session is explained
    // better by the page the plain form leads to, so hand over to it.
    state.wanted = state.confirmed
    render(form, state.confirmed, state.points)
    state.busy = false
    const status = error instanceof Error ? error.message : ''
    if (error instanceof TypeError || ['401', '403', '429'].includes(status)) {
      HTMLFormElement.prototype.submit.call(form)
    }
    return
  }
  state.busy = false
  if (state.wanted !== asked) {
    void send(form, state)
    return
  }
  render(form, state.confirmed, state.points)
}

document.addEventListener('submit', (event) => {
  const form = event.target
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('vote') || !csrf) return
  const { button } = parts(form)
  if (!button) return
  event.preventDefault()

  let state = states.get(form)
  if (!state) {
    const voted = button.getAttribute('aria-pressed') === 'true'
    state = {
      wanted: voted,
      confirmed: voted,
      points: Number(form.dataset.current ?? 0),
      busy: false,
    }
    states.set(form, state)
  }
  state.wanted = !state.wanted
  // Optimistic: the mark and the count change now.
  const delta = state.wanted === state.confirmed ? 0 : state.wanted ? 1 : -1
  render(form, state.wanted, state.points + delta)
  if (!state.busy) void send(form, state)
})

export {}
