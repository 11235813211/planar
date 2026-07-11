import type { LayoutNode, RuntimeTask, Project } from '../types'
import { renderAvatars } from './Avatar'
import { TASK_HEIGHT } from '../engine/layout'

const LABEL_Y_OFFSET = TASK_HEIGHT + 14

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
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.classList.add('task-block')
  g.setAttribute('data-id', raw.id)
  if (raw.status === 'done') g.classList.add('done')

  const x = xOffset + node.x
  const y = node.y

  // Selection ring (drawn first, behind everything)
  if (selected) {
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    ring.setAttribute('x', String(x - 2))
    ring.setAttribute('y', String(y - 2))
    ring.setAttribute('width', String(node.width + 4))
    ring.setAttribute('height', String(TASK_HEIGHT + 4))
    ring.setAttribute('rx', '8')
    ring.setAttribute('fill', 'none')
    ring.setAttribute('stroke', '#2563eb')
    ring.setAttribute('stroke-width', '2')
    g.appendChild(ring)
  }

  // Background rect
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', String(x))
  rect.setAttribute('y', String(y))
  rect.setAttribute('width', String(node.width))
  rect.setAttribute('height', String(TASK_HEIGHT))
  rect.setAttribute('rx', '6')
  rect.setAttribute('fill', raw.style.background)

  // Ticket label (top-left inside block)
  const ticketLabel = raw.ticket
    ? (() => {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        t.setAttribute('x', String(x + 7))
        t.setAttribute('y', String(y + 11))
        t.setAttribute('fill', raw.style.text)
        t.setAttribute('font-size', '9')
        t.setAttribute('opacity', '0.65')
        t.classList.add('task-label')
        t.textContent = raw.ticket
        return t
      })()
    : null

  // Task name below the block — clickable for inline editing
  const nameLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  nameLabel.setAttribute('x', String(x + node.width / 2))
  nameLabel.setAttribute('y', String(y + LABEL_Y_OFFSET))
  nameLabel.setAttribute('text-anchor', 'middle')
  nameLabel.setAttribute('fill', '#111')
  nameLabel.setAttribute('font-size', '12')
  nameLabel.setAttribute('cursor', 'text')
  nameLabel.classList.add('task-label', 'task-name-label')
  nameLabel.setAttribute('data-id', raw.id)
  nameLabel.textContent = raw.name

  nameLabel.addEventListener('click', (e) => {
    e.stopPropagation()
    onLabelClick(nameLabel)
  })

  // Avatars
  const assignees = raw.assignees
    .map(id => project.people.get(id))
    .filter((p): p is NonNullable<typeof p> => p != null)
  const avatarEls = renderAvatars(assignees, x, y, node.width)

  // Hover +/- buttons
  const btnR = 10
  function makeAddBtn(bx: number, by: number, handler: () => void): SVGGElement {
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
    plus.setAttribute('font-size', '15')
    plus.setAttribute('font-weight', '600')
    plus.textContent = '+'

    bg.appendChild(circle)
    bg.appendChild(plus)
    bg.addEventListener('click', (e) => { e.stopPropagation(); handler() })
    return bg
  }

  const addRight = makeAddBtn(x + node.width + btnR + 3, y + TASK_HEIGHT / 2, onAddRight)
  const addLeft  = makeAddBtn(x - btnR - 3,              y + TASK_HEIGHT / 2, onAddLeft)

  // Click = select, dblclick = open modal
  g.addEventListener('click', (e) => { e.stopPropagation(); onSelect() })
  g.addEventListener('dblclick', (e) => { e.stopPropagation(); onDblClick() })

  g.appendChild(rect)
  if (ticketLabel) g.appendChild(ticketLabel)
  g.appendChild(nameLabel)
  for (const a of avatarEls) g.appendChild(a)
  g.appendChild(addRight)
  g.appendChild(addLeft)

  return g
}
