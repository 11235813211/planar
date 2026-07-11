import type { LayoutConnector, LayoutNode } from '../types'
import { TASK_HEIGHT } from '../engine/layout'

const CORNER_R = 6
const CONNECTOR_COLOR = '#94a3b8'

/**
 * Build an SVG path string for an orthogonal connector with rounded corners.
 * from = right-center of source task
 * to   = left-center of target task
 */
function orthoPath(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y1 - y2) < 2) {
    // Straight horizontal
    return `M ${x1} ${y1} H ${x2}`
  }

  const midX = (x1 + x2) / 2
  const dy = y2 > y1 ? 1 : -1
  const r = Math.min(CORNER_R, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 2)

  // Go right, turn, go vertical, turn, go right to destination
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
  sectionXOffset: number
): SVGPathElement[] {
  return connectors.map(conn => {
    const from = nodeMap.get(conn.fromId)
    const to = nodeMap.get(conn.toId)
    if (!from || !to) return null

    const fromX = sectionXOffset + from.x + from.width
    const fromY = sectionXOffset + from.y + TASK_HEIGHT / 2

    // If target is a milestone, connect to its left edge horizontally
    const isMilestone = to.width <= 2
    const toX = sectionXOffset + to.x
    const toY = isMilestone ? fromY : sectionXOffset + to.y + TASK_HEIGHT / 2

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', orthoPath(fromX, fromY, toX, toY))
    path.setAttribute('stroke', CONNECTOR_COLOR)
    path.classList.add('connector')
    return path
  }).filter((p): p is SVGPathElement => p !== null)
}
