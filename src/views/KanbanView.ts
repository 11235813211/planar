import type { Project, RuntimeTask, TicketTask } from '../types'
import { openDetailModal } from './DetailModal'

type TicketRuntimeTask = RuntimeTask & { raw: TicketTask }

function isTicketRT(rt: RuntimeTask): rt is TicketRuntimeTask {
  return rt.raw.type === 'task'
}

export class KanbanView {
  private wrap: HTMLElement
  private project: Project

  constructor(container: HTMLElement, project: Project) {
    this.project = project
    container.innerHTML = ''
    this.wrap = document.createElement('div')
    this.wrap.id = 'kanban-wrap'
    container.appendChild(this.wrap)
    this.render()
  }

  render() {
    this.wrap.innerHTML = ''

    const cols = [...this.project.columns].sort((a, b) =>
      a.order < b.order ? -1 : a.order > b.order ? 1 : 0
    )

    const allTasks = [...this.project.tasks.values()].filter(isTicketRT)

    for (const col of cols) {
      const tasks = allTasks.filter(t => t.raw.status === col.id)

      const colEl = document.createElement('div')
      colEl.className = 'kanban-col'

      const header = document.createElement('div')
      header.className = 'kanban-col-header'
      header.innerHTML = `<span>${col.label}</span><span style="color:#888;font-weight:400">${tasks.length}</span>`

      const cards = document.createElement('div')
      cards.className = 'kanban-cards'

      for (const rt of tasks) {
        if (rt.raw.type !== 'task') continue
        const raw = rt.raw
        const card = document.createElement('div')
        card.className = 'kanban-card'
        card.innerHTML = `
          <div class="card-name">${raw.name}</div>
          ${raw.ticket ? `<div class="card-ticket">${raw.ticket}</div>` : ''}
        `
        card.style.borderLeftColor = raw.style.background
        card.style.borderLeftWidth = '3px'
        card.addEventListener('dblclick', () =>
          openDetailModal(rt, this.project, () => this.render())
        )
        cards.appendChild(card)
      }

      colEl.appendChild(header)
      colEl.appendChild(cards)
      this.wrap.appendChild(colEl)
    }
  }
}
