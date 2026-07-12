import type { Project, RuntimeTask, TicketTask, KanbanColumn } from '../types'
import { openDetailModal } from './DetailModal'
import { colorForId, initials } from '../render/Avatar'
import { newColumnId } from '../data/ids'

type TicketRuntimeTask = RuntimeTask & { raw: TicketTask }
const isTicketRT = (rt: RuntimeTask): rt is TicketRuntimeTask => rt.raw.type === 'ticket'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export class KanbanView {
  private wrap: HTMLElement
  private project: Project
  private dragId: string | null = null

  constructor(container: HTMLElement, project: Project) {
    this.project = project
    container.innerHTML = ''
    this.wrap = document.createElement('div')
    this.wrap.id = 'kanban-wrap'
    container.appendChild(this.wrap)
    this.render()
  }

  private byOrder = (a: KanbanColumn, b: KanbanColumn) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

  render() {
    this.wrap.innerHTML = ''
    const cols = [...this.project.columns].sort(this.byOrder)
    const allTasks = [...this.project.tasks.values()].filter(isTicketRT)

    for (const col of cols) {
      const tasks = allTasks.filter(t => t.raw.status === col.id)
      const colEl = document.createElement('div')
      colEl.className = 'kanban-col' + (col.grayed ? ' grayed' : '')
      colEl.style.setProperty('--col', col.color)

      const header = document.createElement('div')
      header.className = 'kanban-col-header'
      header.innerHTML = `
        <span class="kc-dot" style="background:${col.color}"></span>
        <span class="kc-label">${esc(col.label)}</span>
        <span class="kc-count">${tasks.length}</span>
        <button class="kc-config" title="Configure column">⚙</button>`
      header.querySelector('.kc-config')!.addEventListener('click', (e) => {
        e.stopPropagation(); this.configColumn(col)
      })

      const cards = document.createElement('div')
      cards.className = 'kanban-cards'

      // Drop target
      cards.addEventListener('dragover', (e) => { e.preventDefault(); cards.classList.add('drop') })
      cards.addEventListener('dragleave', () => cards.classList.remove('drop'))
      cards.addEventListener('drop', (e) => {
        e.preventDefault(); cards.classList.remove('drop')
        if (this.dragId) {
          const rt = this.project.tasks.get(this.dragId)
          if (rt && rt.raw.type === 'ticket') { rt.raw.status = col.id; this.project.dirty = true; this.render() }
        }
      })

      for (const rt of tasks) {
        const raw = rt.raw
        const card = document.createElement('div')
        card.className = 'kanban-card'
        card.draggable = true
        card.style.borderLeftColor = raw.style.background

        const avatars = raw.assignees
          .map(id => this.project.people.get(id))
          .filter((p): p is NonNullable<typeof p> => p != null)
        const tags = raw.tags.map(id => this.project.tags.get(id)).filter((t): t is NonNullable<typeof t> => t != null)

        card.innerHTML = `
          ${tags.length ? `<div class="card-tags">${tags.map(t => `<span class="card-tag" style="background:${t.color}">${esc(t.name)}</span>`).join('')}</div>` : ''}
          <div class="card-name">${esc(raw.name)}</div>
          <div class="card-foot">
            <span class="card-ticket">${raw.ticket ? esc(raw.ticket) : ''}</span>
            <span class="card-avatars">
              ${avatars.map(p => `<span class="card-avatar" title="${esc(p.name)}" style="background:${colorForId(p.id)}">${initials(p.name)}</span>`).join('')}
            </span>
          </div>`
        card.addEventListener('dblclick', () => openDetailModal(rt, this.project, () => this.render()))
        card.addEventListener('dragstart', () => { this.dragId = raw.id; card.classList.add('dragging') })
        card.addEventListener('dragend', () => { this.dragId = null; card.classList.remove('dragging') })
        cards.appendChild(card)
      }

      colEl.appendChild(header)
      colEl.appendChild(cards)
      this.wrap.appendChild(colEl)
    }

    // Add-column button
    const addCol = document.createElement('button')
    addCol.className = 'kanban-add-col'
    addCol.textContent = '+ Add column'
    addCol.addEventListener('click', () => this.addColumn())
    this.wrap.appendChild(addCol)
  }

  private addColumn() {
    const last = [...this.project.columns].sort(this.byOrder).pop()
    this.project.columns.push({
      id: newColumnId(), label: 'New Column', color: '#64748b', grayed: false,
      order: (last?.order ?? 'a0') + 'm',
    })
    this.project.dirty = true
    this.render()
  }

  private configColumn(col: KanbanColumn) {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal">
        <h2>Column settings</h2>
        <div class="modal-row"><label>Name</label><input id="cc-name" value="${esc(col.label)}" /></div>
        <div class="modal-row"><label>Colour</label><input id="cc-color" type="color" value="${col.color}" /></div>
        <div class="modal-row cc-check">
          <label><input id="cc-gray" type="checkbox" ${col.grayed ? 'checked' : ''} /> Grey out tasks in this column (e.g. Done/Complete)</label>
        </div>
        <div class="modal-actions">
          <button class="btn" id="cc-del">Delete</button>
          <div style="flex:1"></div>
          <button class="btn" id="cc-cancel">Cancel</button>
          <button class="btn active" id="cc-save">Save</button>
        </div>
      </div>`
    document.body.appendChild(overlay)
    const close = () => document.body.removeChild(overlay)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
    overlay.querySelector('#cc-cancel')!.addEventListener('click', close)
    overlay.querySelector('#cc-del')!.addEventListener('click', () => {
      if (this.project.columns.length <= 1) { alert('Keep at least one column.'); return }
      const tasksInCol = [...this.project.tasks.values()].filter(t => t.raw.type === 'ticket' && (t.raw as TicketTask).status === col.id)
      const fallback = this.project.columns.find(c => c.id !== col.id)!.id
      for (const t of tasksInCol) (t.raw as TicketTask).status = fallback
      this.project.columns = this.project.columns.filter(c => c.id !== col.id)
      this.project.dirty = true; close(); this.render()
    })
    overlay.querySelector('#cc-save')!.addEventListener('click', () => {
      col.label = (overlay.querySelector('#cc-name') as HTMLInputElement).value.trim() || col.label
      col.color = (overlay.querySelector('#cc-color') as HTMLInputElement).value
      col.grayed = (overlay.querySelector('#cc-gray') as HTMLInputElement).checked
      this.project.dirty = true; close(); this.render()
    })
  }
}
