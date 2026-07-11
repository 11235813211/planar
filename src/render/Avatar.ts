import type { Person } from '../types'

const PALETTE = [
  '#2563eb','#16a34a','#d97706','#dc2626','#7c3aed',
  '#0891b2','#be185d','#65a30d','#ea580c','#475569',
]

function colorForId(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_R = 10
const AVATAR_OVERLAP = 14  // center-to-center spacing when multiple avatars

export function renderAvatars(
  people: Person[],
  taskX: number,
  taskY: number,
  taskWidth: number
): SVGElement[] {
  const els: SVGElement[] = []
  const count = people.length
  const startX = taskX + taskWidth - AVATAR_R - 4 - (count - 1) * AVATAR_OVERLAP

  people.forEach((p, i) => {
    const cx = startX + i * AVATAR_OVERLAP
    const cy = taskY + 2  // slightly above the task top edge

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.classList.add('avatar-circle')

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('cx', String(cx))
    circle.setAttribute('cy', String(cy))
    circle.setAttribute('r', String(AVATAR_R))
    circle.setAttribute('fill', colorForId(p.id))
    circle.setAttribute('stroke', '#fff')
    circle.setAttribute('stroke-width', '1.5')

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', String(cx))
    text.setAttribute('y', String(cy + 4))
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('fill', '#fff')
    text.classList.add('avatar-text')
    text.textContent = initials(p.name)

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = p.name

    g.appendChild(circle)
    g.appendChild(text)
    g.appendChild(title)
    els.push(g)
  })

  return els
}
