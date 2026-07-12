import type { LayoutNode, Project, TicketTask } from '../types'
import { renderAvatars } from './Avatar'
import { TASK_HEIGHT } from '../engine/layout'

const LABEL_PAD = 9
const LABEL_FS  = 12
const CHAR_W    = LABEL_FS * 0.58
const SVGNS     = 'http://www.w3.org/2000/svg'

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVGNS, tag)
}

function fitText(text: string, availPx: number): string {
  const max = Math.floor((availPx - LABEL_PAD * 2) / CHAR_W)
  if (max <= 0) return ''
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + '…'
}

export interface TaskBlockHandlers {
  onSelect: () => void
  onOpen: () => void          // ticket → popup; container → drill in
  onLabelClick: (labelEl: SVGTextElement) => void
  onAddRight: () => void
  onAddLeft: () => void
}

export function renderTaskBlock(
  node: LayoutNode,
  project: Project,
  selected: boolean,
  h: TaskBlockHandlers,
): SVGGElement {
  const rt = project.tasks.get(node.id)!
  const raw = rt.raw
  const isContainer = raw.type === 'container'

  const g = el('g')
  g.classList.add('task-block')
  if (isContainer) g.classList.add('container-task')
  if (node.dimmed) g.classList.add('dimmed')
  g.setAttribute('data-id', raw.id)

  const x = node.x, y = node.y, w = node.width

  // Selection ring
  if (selected) {
    const ring = el('rect')
    ring.setAttribute('x', String(x - 2)); ring.setAttribute('y', String(y - 2))
    ring.setAttribute('width', String(w + 4)); ring.setAttribute('height', String(TASK_HEIGHT + 4))
    ring.setAttribute('rx', '8'); ring.setAttribute('fill', 'none')
    ring.setAttribute('stroke', '#2563eb'); ring.setAttribute('stroke-width', '2.5')
    g.appendChild(ring)
  }

  // Background rect
  const rect = el('rect')
  rect.setAttribute('x', String(x)); rect.setAttribute('y', String(y))
  rect.setAttribute('width', String(w)); rect.setAttribute('height', String(TASK_HEIGHT))
  rect.setAttribute('rx', '6')
  rect.setAttribute('fill', raw.style.background)
  if (isContainer) {
    rect.setAttribute('stroke', '#ffffff')
    rect.setAttribute('stroke-width', '1.5')
    rect.setAttribute('stroke-dasharray', '1 0')
  }
  g.appendChild(rect)

  // Container gets a "stacked" edge to signal it drills in
  if (isContainer) {
    const shadow = el('rect')
    shadow.setAttribute('x', String(x + 3)); shadow.setAttribute('y', String(y + 3))
    shadow.setAttribute('width', String(w)); shadow.setAttribute('height', String(TASK_HEIGHT))
    shadow.setAttribute('rx', '6')
    shadow.setAttribute('fill', raw.style.background)
    shadow.setAttribute('opacity', '0.35')
    g.insertBefore(shadow, rect)
  }

  // Tag stripe (left edge) — first tag colour
  if (raw.tags.length > 0) {
    const tag = project.tags.get(raw.tags[0])
    if (tag) {
      const stripe = el('rect')
      stripe.setAttribute('x', String(x)); stripe.setAttribute('y', String(y))
      stripe.setAttribute('width', '4'); stripe.setAttribute('height', String(TASK_HEIGHT))
      stripe.setAttribute('fill', tag.color)
      stripe.setAttribute('rx', '2')
      g.appendChild(stripe)
    }
  }

  // Label
  const avatarCount = raw.type === 'ticket' ? raw.assignees.length : 0
  const availableW = w - (avatarCount > 0 ? avatarCount * 13 + 6 : 6) - (raw.tags.length ? 4 : 0)
  const prefix = raw.type === 'ticket' && raw.ticket ? `${raw.ticket}  ` : ''
  const label = el('text')
  label.setAttribute('x', String(x + LABEL_PAD + (raw.tags.length ? 4 : 0)))
  label.setAttribute('y', String(y + TASK_HEIGHT / 2 + 4))
  label.setAttribute('text-anchor', 'start')
  label.setAttribute('fill', raw.style.text)
  label.setAttribute('font-size', String(LABEL_FS))
  label.setAttribute('font-weight', isContainer ? '600' : '400')
  label.setAttribute('cursor', 'text')
  label.classList.add('task-label', 'task-name-label')
  label.setAttribute('data-id', raw.id)
  label.textContent = fitText(prefix + raw.name, availableW)
  label.addEventListener('click', (e) => { e.stopPropagation(); h.onLabelClick(label) })
  g.appendChild(label)

  // Avatars (ticket only) — bottom-right
  if (raw.type === 'ticket') {
    const assignees = (raw as TicketTask).assignees
      .map(id => project.people.get(id))
      .filter((p): p is NonNullable<typeof p> => p != null)
    for (const a of renderAvatars(assignees, x, y, w, TASK_HEIGHT)) g.appendChild(a)
  }

  // Hover +/- buttons
  const btnR = 8
  const makeBtn = (bx: number, by: number, handler: () => void): SVGGElement => {
    const bg = el('g'); bg.classList.add('add-btn')
    const c = el('circle')
    c.setAttribute('cx', String(bx)); c.setAttribute('cy', String(by)); c.setAttribute('r', String(btnR))
    c.setAttribute('fill', '#2563eb'); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '1.5')
    const plus = el('text')
    plus.setAttribute('x', String(bx)); plus.setAttribute('y', String(by + 4))
    plus.setAttribute('text-anchor', 'middle'); plus.setAttribute('fill', '#fff')
    plus.setAttribute('font-size', '13'); plus.setAttribute('font-weight', '700')
    plus.textContent = '+'
    bg.appendChild(c); bg.appendChild(plus)
    bg.addEventListener('click', (e) => { e.stopPropagation(); handler() })
    return bg
  }
  g.appendChild(makeBtn(x + w + btnR + 3, y + TASK_HEIGHT / 2, h.onAddRight))
  g.appendChild(makeBtn(x - btnR - 3, y + TASK_HEIGHT / 2, h.onAddLeft))

  g.addEventListener('click', (e) => { e.stopPropagation(); h.onSelect() })
  g.addEventListener('dblclick', (e) => { e.stopPropagation(); h.onOpen() })

  return g
}
