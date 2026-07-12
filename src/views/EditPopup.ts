import type { Project, RuntimeTask, TicketTask, ContainerTask } from '../types'

const COLOR_PRESETS: Array<{ bg: string; text: string }> = [
  { bg: '#1e3a5f', text: '#dbeafe' }, { bg: '#052e16', text: '#d1fae5' },
  { bg: '#3b0764', text: '#ede9fe' }, { bg: '#450a0a', text: '#fee2e2' },
  { bg: '#1c1917', text: '#fafaf9' }, { bg: '#713f12', text: '#fef3c7' },
  { bg: '#0c4a6e', text: '#e0f2fe' }, { bg: '#134e4a', text: '#ccfbf1' },
  { bg: '#334155', text: '#f8fafc' }, { bg: '#f1f5f9', text: '#1e293b' },
]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export interface EditPopupCallbacks {
  onChange: () => void        // mutated a field (reschedule + re-render)
  onConvert: (toType: 'ticket' | 'container') => void
  onDelete: () => void
  onClose: () => void
}

/**
 * Floating editor anchored just below a task. Single source of truth for editing
 * a task's name/duration/ticket/colour/tags and converting its type.
 */
export class EditPopup {
  private el: HTMLElement
  private rt: RuntimeTask | null = null
  private cb: EditPopupCallbacks | null = null

  constructor(private host: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'edit-popup'
    this.el.style.display = 'none'
    // Clicks inside the popup must not bubble to the canvas (which would close it).
    this.el.addEventListener('pointerdown', e => e.stopPropagation())
    this.el.addEventListener('click', e => e.stopPropagation())
    host.appendChild(this.el)
  }

  get openFor(): string | null { return this.rt?.raw.id ?? null }
  get isOpen(): boolean { return this.rt !== null }
  contains(n: Node | null): boolean { return !!n && this.el.contains(n) }

  close() {
    this.rt = null; this.cb = null
    this.el.style.display = 'none'
    this.el.innerHTML = ''
  }

  open(rt: RuntimeTask, project: Project, anchor: { x: number; y: number; bottom: number }, cb: EditPopupCallbacks) {
    this.rt = rt; this.cb = cb
    this.render(project)
    this.el.style.display = 'block'
    this.reposition(anchor)
  }

  /** Reposition below the anchor (or above if it wouldn't fit), clamped to the host. */
  reposition(anchor: { x: number; y: number; bottom: number }) {
    const hostRect = this.host.getBoundingClientRect()
    const pw = this.el.offsetWidth || 280
    const ph = this.el.offsetHeight || 320
    const hostH = this.host.clientHeight

    let left = anchor.x - hostRect.left
    left = Math.max(8, Math.min(left, this.host.clientWidth - pw - 8))

    const below = anchor.bottom - hostRect.top + 8
    const above = anchor.y - hostRect.top - ph - 8
    // Prefer below; flip above if it overflows and there's room; else clamp + scroll.
    let top = below
    if (below + ph > hostH - 8) top = above >= 8 ? above : Math.max(8, hostH - ph - 8)

    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`
  }

  private render(project: Project) {
    const rt = this.rt!; const raw = rt.raw
    const isTicket = raw.type === 'ticket'
    const isDateMode = raw.timeMode === 'date'
    const tags = [...project.tags.values()]
    const dur = raw.duration ?? 7
    const cs = rt.computed?.start
    const ce = rt.computed?.end
    const startVal = raw.start ?? (cs ? cs.toISOString().slice(0, 10) : '')
    const endVal = raw.end ?? (ce ? ce.toISOString().slice(0, 10) : '')

    this.el.innerHTML = `
      <div class="ep-head">
        <div class="seg ep-type">
          <button class="seg-btn ${isTicket ? 'active' : ''}" data-type="ticket">Ticket</button>
          <button class="seg-btn ${!isTicket ? 'active' : ''}" data-type="container">Milestone</button>
        </div>
      </div>
      <label class="ep-l">Name</label>
      <input class="ep-in" id="ep-name" value="${esc(raw.name)}" />
      ${isTicket ? `<label class="ep-l">Ticket</label>
        <input class="ep-in" id="ep-ticket" value="${esc((raw as TicketTask).ticket ?? '')}" placeholder="ENG-123" />` : ''}
      <label class="ep-l">Scheduling</label>
      <div class="seg ep-mode">
        <button class="seg-btn ${!isDateMode ? 'active' : ''}" data-mode="duration">Duration</button>
        <button class="seg-btn ${isDateMode ? 'active' : ''}" data-mode="date">Date-fixed</button>
      </div>
      ${isDateMode ? `
        <div class="ep-row">
          <div style="flex:1"><label class="ep-l">Start</label><input class="ep-in" id="ep-start" type="date" value="${startVal}" /></div>
          <div style="flex:1"><label class="ep-l">End</label><input class="ep-in" id="ep-end" type="date" value="${endVal}" /></div>
        </div>`
      : `
        <label class="ep-l">Duration (days)</label>
        <input class="ep-in" id="ep-dur" type="number" min="1" value="${dur}" ${isTicket ? '' : 'disabled title="Milestone tasks size to their children"'} />`}
      <label class="ep-l">Colour</label>
      <div class="ep-swatches" id="ep-colors"></div>
      <label class="ep-l">Tags</label>
      <div class="ep-tags" id="ep-tags">
        ${tags.length === 0 ? '<span class="muted" style="font-size:11px">none — add via Tags menu</span>' : ''}
      </div>
      <div class="ep-foot">
        <button class="btn ep-del">Delete</button>
      </div>
    `

    // type convert
    this.el.querySelectorAll<HTMLButtonElement>('.ep-type .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const to = btn.dataset.type as 'ticket' | 'container'
        if (to !== raw.type) this.cb!.onConvert(to)
      })
    })

    // schedule mode toggle
    this.el.querySelectorAll<HTMLButtonElement>('.ep-mode .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode as 'duration' | 'date'
        if (mode === raw.timeMode) return
        raw.timeMode = mode
        if (mode === 'date') {
          raw.start = startVal || new Date().toISOString().slice(0, 10)
          raw.end = endVal || raw.start
        }
        this.cb!.onChange(); this.render(project)
      })
    })

    const nameIn = this.el.querySelector<HTMLInputElement>('#ep-name')!
    nameIn.addEventListener('input', () => { raw.name = nameIn.value; this.cb!.onChange() })

    const durIn = this.el.querySelector<HTMLInputElement>('#ep-dur')
    durIn?.addEventListener('input', () => {
      const v = parseInt(durIn.value)
      if (!isNaN(v) && v > 0) { (raw as TicketTask | ContainerTask).duration = v; raw.timeMode = 'duration'; this.cb!.onChange() }
    })
    const startIn = this.el.querySelector<HTMLInputElement>('#ep-start')
    startIn?.addEventListener('change', () => { if (startIn.value) { raw.start = startIn.value; this.cb!.onChange() } })
    const endIn = this.el.querySelector<HTMLInputElement>('#ep-end')
    endIn?.addEventListener('change', () => { if (endIn.value) { raw.end = endIn.value; this.cb!.onChange() } })

    const tkIn = this.el.querySelector<HTMLInputElement>('#ep-ticket')
    tkIn?.addEventListener('input', () => { (raw as TicketTask).ticket = tkIn.value.trim() || null; this.cb!.onChange() })

    // colours
    const colWrap = this.el.querySelector('#ep-colors')!
    for (const c of COLOR_PRESETS) {
      const sw = document.createElement('button')
      sw.className = 'ep-swatch'
      sw.style.background = c.bg
      sw.style.outline = raw.style.background === c.bg ? '2px solid #2563eb' : 'none'
      sw.addEventListener('click', () => {
        raw.style = { background: c.bg, text: c.text }
        this.cb!.onChange(); this.render(project)
      })
      colWrap.appendChild(sw)
    }

    // tags
    const tagWrap = this.el.querySelector('#ep-tags')!
    for (const tag of tags) {
      const chip = document.createElement('button')
      chip.className = 'chip' + (raw.tags.includes(tag.id) ? ' on' : '')
      chip.style.setProperty('--chip', tag.color)
      chip.textContent = tag.name
      chip.addEventListener('click', () => {
        const i = raw.tags.indexOf(tag.id)
        if (i >= 0) raw.tags.splice(i, 1); else raw.tags.push(tag.id)
        this.cb!.onChange(); this.render(project)
      })
      tagWrap.appendChild(chip)
    }

    this.el.querySelector('.ep-del')!.addEventListener('click', () => this.cb!.onDelete())
  }
}
