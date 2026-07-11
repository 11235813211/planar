import type { LayoutNode, RuntimeTask, Project } from '../types'
import { renderAvatars } from './Avatar'
import { TASK_HEIGHT } from '../engine/layout'

const LABEL_OFFSET_Y = TASK_HEIGHT + 14

export function renderTaskBlock(
  node: LayoutNode,
  rt: RuntimeTask,
  project: Project,
  xOffset: number,
  onDblClick?: () => void,
  onAddRight?: () => void,
  onAddLeft?: () => void
): SVGGElement {
  if (rt.raw.type !== 'task') throw new Error('renderTaskBlock called on milestone')

  const raw = rt.raw
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.classList.add('task-block')
  if (raw.status === 'done') g.classList.add('done')

  const x = xOffset + node.x
  const y = node.y

  // Background rect
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', String(x))
  rect.setAttribute('y', String(y))
  rect.setAttribute('width', String(node.width))
  rect.setAttribute('height', String(TASK_HEIGHT))
  rect.setAttribute('rx', '6')
  rect.setAttribute('fill', raw.style.background)

  // Ticket label inside block (top-left)
  const ticketLabel = raw.ticket
    ? (() => {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        t.setAttribute('x', String(x + 8))
        t.setAttribute('y', String(y + 12))
        t.setAttribute('fill', raw.style.text)
        t.setAttribute('font-size', '9')
        t.setAttribute('opacity', '0.7')
        t.classList.add('task-label')
        t.textContent = raw.ticket
        return t
      })()
    : null

  // Task name below the block
  const nameLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  nameLabel.setAttribute('x', String(x + node.width / 2))
  nameLabel.setAttribute('y', String(y + LABEL_OFFSET_Y))
  nameLabel.setAttribute('text-anchor', 'middle')
  nameLabel.setAttribute('fill', '#111')
  nameLabel.setAttribute('font-size', '12')
  nameLabel.classList.add('task-label')
  nameLabel.textContent = raw.name

  // Avatars
  const assignees = raw.assignees
    .map(id => project.people.get(id))
    .filter((p): p is NonNullable<typeof p> => p != null)
  const avatarEls = renderAvatars(assignees, x, y, node.width)

  // Hover add-buttons
  const btnR = 10
  function makeAddBtn(bx: number, by: number, label: string, handler?: () => void): SVGGElement {
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    bg.classList.add('add-btn')

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('cx', String(bx))
    circle.setAttribute('cy', String(by))
    circle.setAttribute('r', String(btnR))
    circle.setAttribute('fill', '#2563eb')
    circle.setAttribute('stroke', '#fff')
    circle.setAttribute('stroke-width', '1.5')

    const plus = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    plus.setAttribute('x', String(bx))
    plus.setAttribute('y', String(by + 4))
    plus.setAttribute('text-anchor', 'middle')
    plus.setAttribute('fill', '#fff')
    plus.setAttribute('font-size', '14')
    plus.setAttribute('font-weight', '600')
    plus.textContent = label

    bg.appendChild(circle)
    bg.appendChild(plus)
    if (handler) bg.addEventListener('click', (e) => { e.stopPropagation(); handler() })
    return bg
  }

  const addRight = makeAddBtn(x + node.width + btnR + 2, y + TASK_HEIGHT / 2, '+', onAddRight)
  const addLeft  = makeAddBtn(x - btnR - 2, y + TASK_HEIGHT / 2, '+', onAddLeft)

  g.appendChild(rect)
  if (ticketLabel) g.appendChild(ticketLabel)
  g.appendChild(nameLabel)
  for (const a of avatarEls) g.appendChild(a)
  g.appendChild(addRight)
  g.appendChild(addLeft)

  if (onDblClick) g.addEventListener('dblclick', onDblClick)

  return g
}
