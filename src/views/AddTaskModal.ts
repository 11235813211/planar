import type { TaskType } from '../types'

export interface NewTaskData {
  name: string
  duration: number
  ticket: string | null
  type: TaskType
}

export function openAddTaskModal(
  onConfirm: (data: NewTaskData) => void,
  onCancel: () => void,
): void {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'

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
        <label>Duration (days)</label>
        <input id="atm-dur" type="number" value="7" min="1" />
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

  const nameInput   = overlay.querySelector<HTMLInputElement>('#atm-name')!
  const durInput    = overlay.querySelector<HTMLInputElement>('#atm-dur')!
  const ticketInput = overlay.querySelector<HTMLInputElement>('#atm-ticket')!
  const ticketRow   = overlay.querySelector<HTMLElement>('#atm-ticket-row')!
  const typeHint    = overlay.querySelector<HTMLElement>('#atm-typehint')!
  let type: TaskType = 'ticket'

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

  setTimeout(() => nameInput.focus(), 50)
  const close = () => document.body.removeChild(overlay)

  overlay.querySelector('#atm-cancel')!.addEventListener('click', () => { close(); onCancel() })
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); onCancel() } })

  const submit = () => {
    const name = nameInput.value.trim()
    if (!name) { nameInput.focus(); nameInput.style.borderColor = '#dc2626'; return }
    const duration = Math.max(1, parseInt(durInput.value) || 7)
    const ticket = type === 'ticket' ? (ticketInput.value.trim() || null) : null
    close()
    onConfirm({ name, duration, ticket, type })
  }

  overlay.querySelector('#atm-add')!.addEventListener('click', submit)
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') { close(); onCancel() }
  })
}
