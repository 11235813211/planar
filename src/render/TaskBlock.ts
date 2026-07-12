import type { LayoutNode, Project, TicketTask } from '../types'
import { renderAvatars } from './Avatar'
import { TASK_HEIGHT } from '../engine/layout'

const LABEL_FS  = 12
const SVGNS     = 'http://www.w3.org/2000/svg'

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVGNS, tag)
}

function fitChars(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, Math.max(0, maxChars - 1)) + '…'
}

export interface TaskBlockHandlers {
  onSelect: () => void        // single click → select + open edit popup
  onOpen: () => void          // double click → drill in (containers only)
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
  if (selected) g.classList.add('selected')
  g.setAttribute('data-id', raw.id)

  const x = node.x, y = node.y, w = node.width

  // Selection ring — always present; shown via CSS only when .selected.
  // (Selection is toggled by class so it never triggers a full re-render,
  //  which would otherwise break double-click detection.)
  const ring = el('rect')
  ring.classList.add('sel-ring')
  ring.setAttribute('x', String(x - 2)); ring.setAttribute('y', String(y - 2))
  ring.setAttribute('width', String(w + 4)); ring.setAttribute('height', String(TASK_HEIGHT + 4))
  ring.setAttribute('rx', '8'); ring.setAttribute('fill', 'none')
  ring.setAttribute('stroke', '#2563eb'); ring.setAttribute('stroke-width', '2.5')
  g.appendChild(ring)

  // Container "stacked" shadow (signals it drills in) — drawn behind the bar
  if (isContainer) {
    const shadow = el('rect')
    shadow.setAttribute('x', String(x + 5)); shadow.setAttribute('y', String(y + 5))
    shadow.setAttribute('width', String(w)); shadow.setAttribute('height', String(TASK_HEIGHT))
    shadow.setAttribute('rx', '6'); shadow.setAttribute('fill', raw.style.background); shadow.setAttribute('opacity', '0.4')
    g.appendChild(shadow)
  }

  // Background rect
  const rect = el('rect')
  rect.classList.add('bar-rect')
  rect.setAttribute('x', String(x)); rect.setAttribute('y', String(y))
  rect.setAttribute('width', String(w)); rect.setAttribute('height', String(TASK_HEIGHT))
  rect.setAttribute('rx', '6')
  rect.setAttribute('fill', raw.style.background)
  if (isContainer) { rect.setAttribute('stroke', '#ffffff'); rect.setAttribute('stroke-width', '1.5') }
  g.appendChild(rect)

  // Tag stripe (left edge)
  if (raw.tags.length > 0) {
    const tag = project.tags.get(raw.tags[0])
    if (tag) {
      const stripe = el('rect')
      stripe.setAttribute('x', String(x)); stripe.setAttribute('y', String(y))
      stripe.setAttribute('width', '4'); stripe.setAttribute('height', String(TASK_HEIGHT))
      stripe.setAttribute('fill', tag.color); stripe.setAttribute('rx', '2')
      g.appendChild(stripe)
    }
  }

  // Avatars (ticket only) — vertically centred on the bar's right edge
  if (raw.type === 'ticket') {
    const assignees = (raw as TicketTask).assignees
      .map(id => project.people.get(id))
      .filter((p): p is NonNullable<typeof p> => p != null)
    for (const a of renderAvatars(assignees, x, y, w, TASK_HEIGHT)) g.appendChild(a)
  }

  // Name label ABOVE the bar, left-aligned. Because successors staircase down-and-right,
  // the space above/right of each bar is free, so names can run their natural length
  // (capped generously). Display-only — editing happens in the click popup.
  const prefix = raw.type === 'ticket' && raw.ticket ? `${raw.ticket}  ` : ''
  const label = el('text')
  label.setAttribute('x', String(x + 1))
  label.setAttribute('y', String(y - 5))
  label.setAttribute('text-anchor', 'start')
  label.setAttribute('fill', '#334155')
  label.setAttribute('font-size', String(LABEL_FS))
  label.setAttribute('font-weight', isContainer ? '600' : '500')
  label.setAttribute('pointer-events', 'none')
  label.classList.add('task-label', 'task-name-label')
  label.setAttribute('data-id', raw.id)
  label.textContent = fitChars(prefix + raw.name, 44)   // cap ~44 chars
  g.appendChild(label)

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
