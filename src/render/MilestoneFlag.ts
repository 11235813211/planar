import type { LayoutNode } from '../types'

// Flag floats in the OUTER_PAD space above the tasks.
// The section <g> is translated so y=0 is where tasks start.
// We place the flag label at y = -(FLAG_H + 8) so it's above task rows.
const FLAG_H    = 26
const FLAG_PAD  = 10
const FLAG_FS   = 12
const FLAG_TAIL = 10  // right-pointing notch

export function renderMilestoneFlag(
  node: LayoutNode,
  name: string,
  xOffset: number,
  sectionHeight: number,
  color: string,
  onDblClick?: () => void
): SVGGElement {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  g.classList.add('milestone-flag')
  g.setAttribute('data-id', node.id)

  const x = xOffset + node.x

  // Dashed vertical separator line (full section height)
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line.setAttribute('x1', String(x))
  line.setAttribute('y1', String(-(FLAG_H + 10)))
  line.setAttribute('x2', String(x))
  line.setAttribute('y2', String(sectionHeight))
  line.setAttribute('stroke', color)
  line.classList.add('milestone-line')

  // Flag body positioned above y=0
  const flagTop = -(FLAG_H + 8)
  const flagBot = -8
  const textW = Math.max(name.length * (FLAG_FS * 0.62), 40) + FLAG_PAD * 2

  const points = [
    `${x},${flagTop}`,
    `${x + textW},${flagTop}`,
    `${x + textW + FLAG_TAIL},${(flagTop + flagBot) / 2}`,
    `${x + textW},${flagBot}`,
    `${x},${flagBot}`,
  ].join(' ')

  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
  poly.setAttribute('points', points)
  poly.setAttribute('fill', color)
  poly.setAttribute('opacity', '0.92')

  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  label.setAttribute('x', String(x + FLAG_PAD))
  label.setAttribute('y', String((flagTop + flagBot) / 2 + 4))
  label.setAttribute('fill', '#fff')
  label.setAttribute('font-size', String(FLAG_FS))
  label.setAttribute('font-weight', '600')
  label.classList.add('task-label')
  label.textContent = name

  g.appendChild(line)
  g.appendChild(poly)
  g.appendChild(label)

  if (onDblClick) g.addEventListener('dblclick', onDblClick)

  return g
}
