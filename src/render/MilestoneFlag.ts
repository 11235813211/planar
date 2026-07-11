import type { LayoutNode } from '../types'

const FLAG_HEIGHT = 28
const FLAG_PAD_H = 10
const FLAG_PAD_V = 6
const LABEL_FONT_SIZE = 12

/**
 * Render a milestone as a flag shape + dashed vertical separator line.
 * The flag body sits above y=0 of the section; the dashed line runs full height.
 */
export function renderMilestoneFlag(
  node: LayoutNode,
  name: string,
  xOffset: number,
  sectionHeight: number,
  onClick?: () => void
): SVGGElement {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.classList.add('milestone-flag')

  const x = xOffset + node.x
  const labelWidth = name.length * (LABEL_FONT_SIZE * 0.62) + FLAG_PAD_H * 2
  const flagW = labelWidth
  const flagH = FLAG_HEIGHT
  const pointX = x + flagW
  const midY = -flagH / 2 - FLAG_PAD_V

  // Flag polygon: rect with a pointed right edge
  const points = [
    `${x},${midY - flagH / 2}`,
    `${pointX},${midY - flagH / 2}`,
    `${pointX + 10},${midY}`,
    `${pointX},${midY + flagH / 2}`,
    `${x},${midY + flagH / 2}`,
  ].join(' ')

  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
  poly.setAttribute('points', points)
  poly.setAttribute('fill', '#7c3aed')
  poly.setAttribute('opacity', '0.9')

  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  label.setAttribute('x', String(x + FLAG_PAD_H))
  label.setAttribute('y', String(midY + 4))
  label.setAttribute('fill', '#fff')
  label.setAttribute('font-size', String(LABEL_FONT_SIZE))
  label.setAttribute('dominant-baseline', 'middle')
  label.classList.add('task-label')
  label.textContent = name

  // Dashed vertical line running down
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line.setAttribute('x1', String(x))
  line.setAttribute('y1', '0')
  line.setAttribute('x2', String(x))
  line.setAttribute('y2', String(sectionHeight))
  line.setAttribute('stroke', '#7c3aed')
  line.classList.add('milestone-line')

  g.appendChild(line)
  g.appendChild(poly)
  g.appendChild(label)

  if (onClick) g.addEventListener('dblclick', onClick)

  return g
}
