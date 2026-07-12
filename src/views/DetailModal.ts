import type { RuntimeTask, Project, TicketTask } from '../types'
import { bindModalEnter } from './modalKit'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export function openDetailModal(rt: RuntimeTask, project: Project, onSave: () => void) {
  if (rt.raw.type !== 'ticket') return
  const raw = rt.raw as TicketTask

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  const modal = document.createElement('div')
  modal.className = 'modal'

  const people = [...project.people.values()]
  const tags = [...project.tags.values()]

  modal.innerHTML = `
    <h2>${esc(raw.name)}</h2>
    <div class="modal-row">
      <label>Name</label>
      <input id="m-name" value="${esc(raw.name)}" />
    </div>
    <div class="modal-row">
      <label>Ticket</label>
      <input id="m-ticket" value="${esc(raw.ticket ?? '')}" />
    </div>
    <div class="modal-row">
      <label>Duration (days)</label>
      <input id="m-dur" type="number" min="1" value="${raw.duration ?? 7}" />
    </div>
    <div class="modal-row">
      <label>Status</label>
      <select id="m-status">
        ${project.columns.map(c =>
          `<option value="${c.id}" ${raw.status === c.id ? 'selected' : ''}>${esc(c.label)}</option>`
        ).join('')}
      </select>
    </div>
    <div class="modal-row">
      <label>Assignees</label>
      <div class="chip-select" id="m-assignees">
        ${people.length === 0 ? '<span class="muted">No people yet — add them in the example or file.</span>' : ''}
        ${people.map(p => `
          <button class="chip ${raw.assignees.includes(p.id) ? 'on' : ''}" data-id="${p.id}">${esc(p.name)}</button>
        `).join('')}
      </div>
    </div>
    <div class="modal-row">
      <label>Tags</label>
      <div class="chip-select" id="m-tags">
        ${tags.length === 0 ? '<span class="muted">No tags yet — create them from the Tags menu.</span>' : ''}
        ${tags.map(g => `
          <button class="chip ${raw.tags.includes(g.id) ? 'on' : ''}" data-id="${g.id}" style="--chip:${g.color}">${esc(g.name)}</button>
        `).join('')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="m-cancel">Cancel</button>
      <button class="btn active" id="m-save">Save</button>
    </div>
  `

  overlay.appendChild(modal)
  document.body.appendChild(overlay)
  bindModalEnter(overlay)

  const selectedAssignees = new Set(raw.assignees)
  const selectedTags = new Set(raw.tags)

  modal.querySelectorAll<HTMLButtonElement>('#m-assignees .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.id!
      if (selectedAssignees.has(id)) { selectedAssignees.delete(id); chip.classList.remove('on') }
      else { selectedAssignees.add(id); chip.classList.add('on') }
    })
  })
  modal.querySelectorAll<HTMLButtonElement>('#m-tags .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.id!
      if (selectedTags.has(id)) { selectedTags.delete(id); chip.classList.remove('on') }
      else { selectedTags.add(id); chip.classList.add('on') }
    })
  })

  const close = () => document.body.removeChild(overlay)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  modal.querySelector('#m-cancel')!.addEventListener('click', close)
  modal.querySelector('#m-save')!.addEventListener('click', () => {
    const name = (modal.querySelector('#m-name') as HTMLInputElement).value.trim()
    const ticket = (modal.querySelector('#m-ticket') as HTMLInputElement).value.trim()
    const dur = parseInt((modal.querySelector('#m-dur') as HTMLInputElement).value)
    const status = (modal.querySelector('#m-status') as HTMLSelectElement).value

    if (name) raw.name = name
    raw.ticket = ticket || null
    if (!isNaN(dur) && dur > 0) { raw.duration = dur; raw.timeMode = 'duration' }
    raw.status = status
    raw.assignees = [...selectedAssignees]
    raw.tags = [...selectedTags]
    project.dirty = true
    onSave()
    close()
  })
}
