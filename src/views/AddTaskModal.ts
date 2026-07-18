import type { TaskType } from '../types'
import { bindModalEnter } from './modalKit'

export interface NewTaskData {
  name: string
  type: TaskType
  timeMode: 'duration' | 'date'
  duration: number
  start: string | null   // ISO (date mode)
  end: string | null     // ISO (date mode)
  ticket: string | null
}

export function openAddTaskModal(
  onConfirm: (data: NewTaskData) => void,
  onCancel: () => void,
): void {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  const today = new Date().toISOString().slice(0, 10)

  overlay.innerHTML = `
    <div class="modal add-task-modal">
      <h2>New Task</h2>
      <div class="modal-row">
        <label>Type</label>
        <div class="seg" id="atm-type">
          <button class="seg-btn active" data-type="ticket">Ticket task</button>
          <button class="seg-btn" data-type="container">Milestone task</button>
        </div>
        <span class="atm-typehint" id="atm-typehint">A ticket task is a leaf — double-click opens its details and it appears on the Kanban.</span>
      </div>
      <div class="modal-row">
        <label>Name</label>
        <input id="atm-name" placeholder="Task name" />
      </div>
      <div class="modal-row">
        <label>Scheduling</label>
        <div class="seg" id="atm-mode">
          <button class="seg-btn active" data-mode="duration">Duration</button>
          <button class="seg-btn" data-mode="date">Date-fixed</button>
        </div>
      </div>
      <div class="modal-row" id="atm-dur-row">
        <label>Duration (days)</label>
        <input id="atm-dur" type="number" value="7" min="1" />
      </div>
      <div class="modal-row" id="atm-date-row" style="display:none">
        <div style="display:flex;gap:8px">
          <div style="flex:1"><label>Start</label><input id="atm-start" type="date" value="${today}" /></div>
          <div style="flex:1"><label>End</label><input id="atm-end" type="date" value="${today}" /></div>
        </div>
      </div>
      <div class="modal-row" id="atm-ticket-row">
        <label>Ticket (optional)</label>
        <input id="atm-ticket" placeholder="ENG-123" />
      </div>
      <div class="modal-actions">
        <button class="btn" id="atm-cancel">Cancel</button>
        <button class="btn active" id="atm-add">Add</button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)
  bindModalEnter(overlay)

  const $ = <T extends HTMLElement>(s: string) => overlay.querySelector<T>(s)!
  const nameInput = $<HTMLInputElement>('#atm-name')
  const durInput = $<HTMLInputElement>('#atm-dur')
  const startInput = $<HTMLInputElement>('#atm-start')
  const endInput = $<HTMLInputElement>('#atm-end')
  const ticketInput = $<HTMLInputElement>('#atm-ticket')
  const ticketRow = $<HTMLElement>('#atm-ticket-row')
  const durRow = $<HTMLElement>('#atm-dur-row')
  const dateRow = $<HTMLElement>('#atm-date-row')
  const typeHint = $<HTMLElement>('#atm-typehint')
  let type: TaskType = 'ticket'
  let mode: 'duration' | 'date' = 'duration'

  overlay.querySelectorAll<HTMLButtonElement>('#atm-type .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('#atm-type .seg-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      type = btn.dataset.type as TaskType
      ticketRow.style.display = type === 'ticket' ? 'flex' : 'none'
      typeHint.textContent = type === 'ticket'
        ? 'A ticket task is a leaf — double-click opens its details and it appears on the Kanban.'
        : 'A milestone task is a container — double-click drills into its sub-tasks.'
    })
  })
  overlay.querySelectorAll<HTMLButtonElement>('#atm-mode .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('#atm-mode .seg-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      mode = btn.dataset.mode as 'duration' | 'date'
      durRow.style.display = mode === 'duration' ? 'flex' : 'none'
      dateRow.style.display = mode === 'date' ? 'flex' : 'none'
    })
  })

  setTimeout(() => nameInput.focus(), 50)
  const close = () => document.body.removeChild(overlay)
  $('#atm-cancel').addEventListener('click', () => { close(); onCancel() })
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); onCancel() } })

  const submit = () => {
    const name = nameInput.value.trim()
    if (!name) { nameInput.focus(); nameInput.style.borderColor = '#dc2626'; return }
    const duration = Math.max(1, parseInt(durInput.value) || 7)
    const ticket = type === 'ticket' ? (ticketInput.value.trim() || null) : null
    close()
    onConfirm({
      name, type, timeMode: mode, duration, ticket,
      start: mode === 'date' ? (startInput.value || today) : null,
      end: mode === 'date' ? (endInput.value || startInput.value || today) : null,
    })
  }
  $('#atm-add').addEventListener('click', submit)
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); onCancel() } })
}
