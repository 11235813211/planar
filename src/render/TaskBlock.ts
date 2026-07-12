import type { LayoutNode, RuntimeTask, Project } from '../types'
import { renderAvatars } from './Avatar'
import { TASK_HEIGHT } from '../engine/layout'

const LABEL_PAD = 8  // left padding inside task rect
const LABEL_FS  = 12
const CHAR_W    = LABEL_FS * 0.58  // approximate char width for system-ui

function fitText(text: string, availPx: number): string {
  const max = Math.floor((availPx - LABEL_PAD * 2) / CHAR_W)
  if (max <= 0) return ''
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + '…'
}

export function renderTaskBlock(
  node: LayoutNode,
  rt: RuntimeTask,
  project: Project,
  xOffset: number,
  selected: boolean,
  onSelect: () => void,
  onDblClick: () => void,
  onLabelClick: (labelEl: SVGTextElement) => void,
  onAddRight: () => void,
  onAddLeft: () => void,
): SVGGElement {
  if (rt.raw.type !== 'task') throw new Error('renderTaskBlock called on milestone')

  const raw = rt.raw
  const g   = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.classList.add('task-block')
  g.setAttribute('data-id', raw.id)
  if (raw.status === 'done') g.classList.add('done')

  const x = xOffset + node.x
  const y = node.y

  // ── Selection ring ─────────────────────────────────────────────────────────
  if (selected) {
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    ring.setAttribute('x', String(x - 2))
    ring.setAttribute('y', String(y - 2))
    ring.setAttribute('width', String(node.width + 4))
    ring.setAttribute('height', String(TASK_HEIGHT + 4))
    ring.setAttribute('rx', '8')
    ring.setAttribute('fill', 'none')
    ring.setAttribute('stroke', '#2563eb')
    ring.setAttribute('stroke-width', '2.5')
    g.appendChild(ring)
  }

  // ── Background rect ────────────────────────────────────────────────────────
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', String(x))
  rect.setAttribute('y', String(y))
  rect.setAttribute('width', String(node.width))
  rect.setAttribute('height', String(TASK_HEIGHT))
  rect.setAttribute('rx', '6')
  rect.setAttribute('fill', raw.style.background)

  // ── Title inside the rect, left-aligned ────────────────────────────────────
  // Reserve right side for avatars if any
  const avatarCount = raw.assignees.length
  const avatarReserve = avatarCount > 0 ? avatarCount * 14 + 8 : 0
  const availableW = node.width - avatarReserve

  // Optionally prefix with ticket
  const displayText = raw.ticket
    ? fitText(`${raw.ticket}  ${raw.name}`, availableW)
    : fitText(raw.name, availableW)

  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  label.setAttribute('x', String(x + LABEL_PAD))
  label.setAttribute('y', String(y + TASK_HEIGHT / 2 + 4))
  label.setAttribute('text-anchor', 'start')
  label.setAttribute('fill', raw.style.text)
  label.setAttribute('font-size', String(LABEL_FS))
  label.setAttribute('pointer-events', 'all')
  label.setAttribute('cursor', 'text')
  label.classList.add('task-label', 'task-name-label')
  label.setAttribute('data-id', raw.id)
  label.textContent = displayText

  label.addEventListener('click', (e) => { e.stopPropagation(); onLabelClick(label) })

  // ── Avatars ────────────────────────────────────────────────────────────────
  const assignees = raw.assignees
    .map(id => project.people.get(id))
    .filter((p): p is NonNullable<typeof p> => p != null)
  const avatarEls = renderAvatars(assignees, x, y, node.width)

  // ── Hover +/- buttons ──────────────────────────────────────────────────────
  const btnR = 9
  function makeBtn(bx: number, by: number, handler: () => void): SVGGElement {
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    bg.classList.add('add-btn')

    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    c.setAttribute('cx', String(bx)); c.setAttribute('cy', String(by))
    c.setAttribute('r', String(btnR))
    c.setAttribute('fill', '#2563eb')
    c.setAttribute('stroke', '#fff')
    c.setAttribute('stroke-width', '1.5')

    const plus = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    plus.setAttribute('x', String(bx)); plus.setAttribute('y', String(by + 4))
    plus.setAttribute('text-anchor', 'middle')
    plus.setAttribute('fill', '#fff')
    plus.setAttribute('font-size', '14')
    plus.setAttribute('font-weight', '700')
    plus.textContent = '+'

    bg.appendChild(c); bg.appendChild(plus)
    bg.addEventListener('click', (e) => { e.stopPropagation(); handler() })
    return bg
  }

  const addRight = makeBtn(x + node.width + btnR + 3, y + TASK_HEIGHT / 2, onAddRight)
  const addLeft  = makeBtn(x - btnR - 3,              y + TASK_HEIGHT / 2, onAddLeft)

  g.addEventListener('click',    (e) => { e.stopPropagation(); onSelect() })
  g.addEventListener('dblclick', (e) => { e.stopPropagation(); onDblClick() })

  g.appendChild(rect)
  g.appendChild(label)
  for (const a of avatarEls) g.appendChild(a)
  g.appendChild(addRight)
  g.appendChild(addLeft)

  return g
}
