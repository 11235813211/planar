import type { LayoutConnector, LayoutNode } from '../types'
import { TASK_HEIGHT } from '../engine/layout'

const CORNER_R = 6
const CONNECTOR_COLOR = '#94a3b8'
const SVGNS = 'http://www.w3.org/2000/svg'

function orthoPath(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y1 - y2) < 2) return `M ${x1} ${y1} H ${x2}`
  const midX = (x1 + x2) / 2
  const dy = y2 > y1 ? 1 : -1
  const r = Math.min(CORNER_R, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 2 || CORNER_R)
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
    const toIsMs   = to.kind === 'milestone'

    // Source: right edge of a task, or the line of a milestone
    const fromX = from.x + from.width
    const fromY = fromIsMs ? to.y + TASK_HEIGHT / 2 : from.y + TASK_HEIGHT / 2

    // Target: left edge of a task, or the milestone line (connector ENDS at it)
    const toX = to.x
    const toY = toIsMs ? fromY : to.y + TASK_HEIGHT / 2

    const path = document.createElementNS(SVGNS, 'path')
    path.setAttribute('d', orthoPath(fromX, fromY, toX, toY))
    path.setAttribute('stroke', CONNECTOR_COLOR)
    path.classList.add('connector')
    if (from.dimmed || to.dimmed) path.classList.add('dimmed')
    return path
  }).filter((p): p is SVGPathElement => p !== null)
}
