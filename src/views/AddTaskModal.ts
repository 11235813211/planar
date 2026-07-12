export interface NewTaskData {
  name: string
  duration: number
  ticket: string | null
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
        <label>Name</label>
        <input id="atm-name" placeholder="Task name" />
      </div>
      <div class="modal-row">
        <label>Duration (days)</label>
        <input id="atm-dur" type="number" value="7" min="1" />
      </div>
      <div class="modal-row">
        <label>Ticket (optional)</label>
        <input id="atm-ticket" placeholder="ENG-123" />
      </div>
      <p class="atm-hint">After clicking Place, click a task in the chart to add your new task after it, or click empty canvas to add it at the end.</p>
      <div class="modal-actions">
        <button class="btn" id="atm-cancel">Cancel</button>
        <button class="btn active" id="atm-place">Place Task →</button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  const nameInput   = overlay.querySelector<HTMLInputElement>('#atm-name')!
  const durInput    = overlay.querySelector<HTMLInputElement>('#atm-dur')!
  const ticketInput = overlay.querySelector<HTMLInputElement>('#atm-ticket')!

  setTimeout(() => nameInput.focus(), 50)

  const close = () => document.body.removeChild(overlay)

  overlay.querySelector('#atm-cancel')!.addEventListener('click', () => { close(); onCancel() })
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); onCancel() } })

  const submit = () => {
    const name = nameInput.value.trim()
    if (!name) { nameInput.focus(); nameInput.style.borderColor = '#dc2626'; return }
    const duration = Math.max(1, parseInt(durInput.value) || 7)
    const ticket = ticketInput.value.trim() || null
    close()
    onConfirm({ name, duration, ticket })
  }

  overlay.querySelector('#atm-place')!.addEventListener('click', submit)
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') { close(); onCancel() }
  })
}
