import type { LayoutNode } from '../types'

// A milestone is a boundary marker: a dashed vertical line spanning the panel,
// a small diamond at the top, and a label. It has a + button (top) to add a
// prerequisite — never a post-requisite. Milestones are NOT drillable.

const FLAG_H   = 22
const FLAG_FS  = 11
const SVGNS    = 'http://www.w3.org/2000/svg'

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVGNS, tag)
}

export function renderMilestone(
  node: LayoutNode,
  name: string,
  color: string,
  panelHeight: number,
  onAddPrereq?: () => void,
): SVGGElement {
  const g = el('g')
  g.classList.add('milestone-flag')
  if (node.dimmed) g.classList.add('dimmed')
  g.setAttribute('data-id', node.id)

  const x = node.x

  // Dashed vertical line (full panel height)
  const line = el('line')
  line.setAttribute('x1', String(x)); line.setAttribute('y1', String(-FLAG_H))
  line.setAttribute('x2', String(x)); line.setAttribute('y2', String(panelHeight))
  line.setAttribute('stroke', color)
  line.classList.add('milestone-line')
  g.appendChild(line)

  // Diamond marker at top
  const d = 7
  const diamond = el('polygon')
  diamond.setAttribute('points', `${x},${-FLAG_H} ${x + d},${-FLAG_H + d} ${x},${-FLAG_H + 2 * d} ${x - d},${-FLAG_H + d}`)
  diamond.setAttribute('fill', color)
  g.appendChild(diamond)

  // Label to the right of the diamond
  const label = el('text')
  label.setAttribute('x', String(x + d + 5))
  label.setAttribute('y', String(-FLAG_H + d + 4))
  label.setAttribute('fill', color)
  label.setAttribute('font-size', String(FLAG_FS))
  label.setAttribute('font-weight', '600')
  label.classList.add('task-label')
  label.textContent = name
  g.appendChild(label)

  // + prereq button on the LEFT side of the milestone
  if (onAddPrereq) {
    const btn = el('g'); btn.classList.add('add-btn', 'ms-add-btn')
    const cx = x - 14, cy = -FLAG_H + d
    const c = el('circle')
    c.setAttribute('cx', String(cx)); c.setAttribute('cy', String(cy)); c.setAttribute('r', '8')
    c.setAttribute('fill', color); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '1.5')
    const plus = el('text')
    plus.setAttribute('x', String(cx)); plus.setAttribute('y', String(cy + 4))
    plus.setAttribute('text-anchor', 'middle'); plus.setAttribute('fill', '#fff')
    plus.setAttribute('font-size', '13'); plus.setAttribute('font-weight', '700')
    plus.textContent = '+'
    btn.appendChild(c); btn.appendChild(plus)
    btn.addEventListener('click', (e) => { e.stopPropagation(); onAddPrereq() })
    g.appendChild(btn)
  }

  return g
}
