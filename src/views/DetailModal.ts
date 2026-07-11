import type { RuntimeTask, Project } from '../types'

export function openDetailModal(rt: RuntimeTask, project: Project, onSave: () => void) {
  if (rt.raw.type !== 'task') return
  const raw = rt.raw

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'

  const modal = document.createElement('div')
  modal.className = 'modal'

  const assigneeNames = raw.assignees
    .map(id => project.people.get(id)?.name ?? id)
    .join(', ')

  modal.innerHTML = `
    <h2>${raw.name}</h2>
    <div class="modal-row">
      <label>Name</label>
      <input id="m-name" value="${raw.name}" />
    </div>
    <div class="modal-row">
      <label>Ticket</label>
      <input id="m-ticket" value="${raw.ticket ?? ''}" />
    </div>
    <div class="modal-row">
      <label>Status</label>
      <select id="m-status">
        ${project.columns.map(c =>
          `<option value="${c.id}" ${raw.status === c.id ? 'selected' : ''}>${c.label}</option>`
        ).join('')}
      </select>
    </div>
    <div class="modal-row">
      <label>Assignees (comma-separated names — read only for now)</label>
      <input id="m-assignees" value="${assigneeNames}" disabled />
    </div>
    <div class="modal-actions">
      <button class="btn" id="m-cancel">Cancel</button>
      <button class="btn active" id="m-save">Save</button>
    </div>
  `

  overlay.appendChild(modal)
  document.body.appendChild(overlay)

  const close = () => document.body.removeChild(overlay)

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  modal.querySelector('#m-cancel')!.addEventListener('click', close)
  modal.querySelector('#m-save')!.addEventListener('click', () => {
    const name = (modal.querySelector('#m-name') as HTMLInputElement).value.trim()
    const ticket = (modal.querySelector('#m-ticket') as HTMLInputElement).value.trim()
    const status = (modal.querySelector('#m-status') as HTMLSelectElement).value

    if (name) raw.name = name
    raw.ticket = ticket || null
    raw.status = status
    project.dirty = true
    onSave()
    close()
  })
}
