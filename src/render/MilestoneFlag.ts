import type { LayoutNode } from '../types'

// A milestone is a boundary marker: a dashed vertical line spanning the whole panel,
// a diamond + label near the top (kept clear of the sticky date bar), and a + button
// to add a prerequisite. Milestones are NOT drillable. The line sits exactly on a day
// boundary (its x is a pure time position).

const TOP_PAD = 6     // diamond offset from the panel content top (below the date bar)
const FLAG_FS = 11
const SVGNS   = 'http://www.w3.org/2000/svg'

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
  const top = TOP_PAD
  const d = 6

  // Dashed vertical line — full panel height, starting just under the date bar.
  const line = el('line')
  line.setAttribute('x1', String(x)); line.setAttribute('y1', String(top))
  line.setAttribute('x2', String(x)); line.setAttribute('y2', String(panelHeight))
  line.setAttribute('stroke', color)
  line.classList.add('milestone-line')
  g.appendChild(line)

  // Diamond marker
  const diamond = el('polygon')
  diamond.setAttribute('points', `${x},${top} ${x + d},${top + d} ${x},${top + 2 * d} ${x - d},${top + d}`)
  diamond.setAttribute('fill', color)
  g.appendChild(diamond)

  // Label to the right of the diamond
  const label = el('text')
  label.setAttribute('x', String(x + d + 5))
  label.setAttribute('y', String(top + d + 4))
  label.setAttribute('fill', color)
  label.setAttribute('font-size', String(FLAG_FS))
  label.setAttribute('font-weight', '600')
  label.classList.add('task-label')
  label.textContent = name
  g.appendChild(label)

  // + prereq button on the LEFT side of the milestone
  if (onAddPrereq) {
    const btn = el('g'); btn.classList.add('add-btn', 'ms-add-btn')
    const cx = x - 14, cy = top + d
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
