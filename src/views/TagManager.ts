import type { Project, Tag } from '../types'
import { newTagId } from '../data/ids'
import { bindModalEnter } from './modalKit'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const PRESET = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be185d', '#65a30d']

export function openTagManager(project: Project, onChange: () => void) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  const modal = document.createElement('div')
  modal.className = 'modal'
  overlay.appendChild(modal)
  document.body.appendChild(overlay)
  bindModalEnter(overlay)

  const close = () => document.body.removeChild(overlay)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

  const draw = () => {
    const tags = [...project.tags.values()]
    modal.innerHTML = `
      <h2>Tags</h2>
      <p class="muted" style="margin-bottom:12px">Tags categorise tasks; every task with a tag shows its colour stripe.</p>
      <div class="tag-list">
        ${tags.length === 0 ? '<p class="muted">No tags yet.</p>' : ''}
        ${tags.map(t => `
          <div class="tag-row" data-id="${t.id}">
            <input type="color" value="${t.color}" data-role="color" />
            <input type="text" value="${esc(t.name)}" data-role="name" />
            <button class="btn" data-role="del">Delete</button>
          </div>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn" id="tag-add">+ Add tag</button>
        <div style="flex:1"></div>
        <button class="btn active" id="tag-done">Done</button>
      </div>`

    modal.querySelectorAll<HTMLElement>('.tag-row').forEach(row => {
      const id = row.dataset.id!
      const tag = project.tags.get(id)!
      row.querySelector<HTMLInputElement>('[data-role=color]')!.addEventListener('input', (e) => {
        tag.color = (e.target as HTMLInputElement).value; project.dirty = true; onChange()
      })
      row.querySelector<HTMLInputElement>('[data-role=name]')!.addEventListener('change', (e) => {
        tag.name = (e.target as HTMLInputElement).value; project.dirty = true; onChange()
      })
      row.querySelector('[data-role=del]')!.addEventListener('click', () => {
        project.tags.delete(id)
        for (const rt of project.tasks.values()) {
          const i = rt.raw.tags.indexOf(id)
          if (i >= 0) rt.raw.tags.splice(i, 1)
        }
        project.dirty = true; onChange(); draw()
      })
    })
    modal.querySelector('#tag-add')!.addEventListener('click', () => {
      const t: Tag = { id: newTagId(), name: 'New Tag', color: PRESET[project.tags.size % PRESET.length] }
      project.tags.set(t.id, t); project.dirty = true; onChange(); draw()
    })
    modal.querySelector('#tag-done')!.addEventListener('click', close)
  }
  draw()
}
