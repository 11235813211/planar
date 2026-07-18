import type { LayoutConnector, LayoutNode } from '../types'
import { TASK_HEIGHT } from '../engine/layout'

const CORNER_R = 7
const STUB = 12          // minimum horizontal run off each endpoint so elbows are visible
const CONNECTOR_COLOR = '#94a3b8'
const SVGNS = 'http://www.w3.org/2000/svg'

// Orthogonal path with a guaranteed horizontal stub at both ends, a vertical run,
// and rounded corners — so the horizontal / curve / vertical segments are all visible,
// including connectors coming off a milestone line.
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y1 - y2) < 1.5) return `M ${x1} ${y1} H ${x2}`

  // Turn point: leave a stub off the source, but never past the target's stub.
  let midX = x1 + STUB
  if (x2 - x1 < STUB * 2) midX = (x1 + x2) / 2
  else midX = Math.min(midX, x2 - STUB)

  const dy = y2 > y1 ? 1 : -1
  const r = Math.max(2, Math.min(CORNER_R, Math.abs(y2 - y1) / 2, Math.abs(midX - x1), Math.abs(x2 - midX)))
  return [
    `M ${x1} ${y1}`,
    `H ${midX - r}`,
    `Q ${midX} ${y1} ${midX} ${y1 + dy * r}`,
    `V ${y2 - dy * r}`,
    `Q ${midX} ${y2} ${midX + r} ${y2}`,
    `H ${x2}`,
  ].join(' ')
}

export function renderConnectors(
  connectors: LayoutConnector[],
  nodeMap: Map<string, LayoutNode>,
): SVGPathElement[] {
  return connectors.map(conn => {
    const from = nodeMap.get(conn.fromId)
    const to = nodeMap.get(conn.toId)
    if (!from || !to) return null

    const fromIsMs = from.kind === 'milestone'
    const toIsMs = to.kind === 'milestone'

    // Source: right edge of a task, or the milestone line at the target's height.
    const toY = toIsMs ? (fromIsMs ? from.y + TASK_HEIGHT / 2 : from.y + TASK_HEIGHT / 2) : to.y + TASK_HEIGHT / 2
    const fromX = from.x + from.width
    const fromY = fromIsMs ? toY : from.y + TASK_HEIGHT / 2
    const toX = to.x

    const path = document.createElementNS(SVGNS, 'path')
    path.setAttribute('d', elbow(fromX, fromY, toX, toY))
    path.setAttribute('stroke', CONNECTOR_COLOR)
    path.classList.add('connector')
    return path
  }).filter((p): p is SVGPathElement => p !== null)
}
