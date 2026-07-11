import type {
  Project, NodeId, RuntimeTask, SectionLayout, LayoutNode, LayoutConnector
} from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

export const TASK_HEIGHT = 40
export const TASK_ROW_GAP = 20        // vertical gap between rows
export const ROW_STRIDE = TASK_HEIGHT + TASK_ROW_GAP
export const PX_PER_DAY = 12          // horizontal scale (before zoom)
export const MILESTONE_WIDTH = 2      // visual width of dashed line
export const SECTION_H_PAD = 60      // horizontal padding inside a section
export const SECTION_LABEL_H = 0     // reserved for section label above

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowY(row: number): number {
  return row * ROW_STRIDE
}

function taskWidth(durationDays: number): number {
  return Math.max(durationDays * PX_PER_DAY, 80)
}

/** Returns the x (from section origin) of a task's start, relative to sectionStartDate */
function timeToX(date: Date, sectionStartDate: Date): number {
  const days = (date.getTime() - sectionStartDate.getTime()) / 86_400_000
  return SECTION_H_PAD + Math.max(0, days) * PX_PER_DAY
}

// ─── Section layout ───────────────────────────────────────────────────────────

/**
 * Given a list of sibling tasks (same parent), compute the section layout.
 * Returns one SectionLayout per "section" (between consecutive milestones).
 *
 * We treat milestones as dividers: tasks between two milestone boundaries form
 * one section. For now this function builds the layout for a single sibling group,
 * splitting into sub-sections at each milestone encountered in order.
 */
export function layoutSiblingGroup(
  tasks: RuntimeTask[],
  project: Project,
  parentTaskId: NodeId | null,
  xOffsetStart: number
): SectionLayout[] {

  if (tasks.length === 0) return []

  // Separate milestones and ticket-tasks
  const milestones = tasks.filter(t => t.raw.type === 'milestone')
  const ticketTasks = tasks.filter(t => t.raw.type === 'task')

  if (ticketTasks.length === 0 && milestones.length === 0) return []

  // Find earliest start across all tasks for the section x-origin
  let sectionStart: Date | null = null
  for (const t of tasks) {
    if (t.computed) {
      if (!sectionStart || t.computed.start < sectionStart) sectionStart = t.computed.start
    }
  }
  if (!sectionStart) sectionStart = new Date()

  // Build a prerequisite map (id → set of prereq ids) for this sibling group
  const siblingIds = new Set(tasks.map(t => t.raw.id))

  // Assign rows using fan-in midpoint rule
  const rowOf = new Map<NodeId, number>()
  const processed = new Set<NodeId>()

  // Topological order within this sibling group only
  const inDeg = new Map<NodeId, number>()
  const adj = new Map<NodeId, NodeId[]>()
  for (const t of tasks) { inDeg.set(t.raw.id, 0); adj.set(t.raw.id, []) }
  for (const t of tasks) {
    for (const pre of t.raw.prerequisites) {
      if (!siblingIds.has(pre)) continue
      adj.get(pre)!.push(t.raw.id)
      inDeg.set(t.raw.id, inDeg.get(t.raw.id)! + 1)
    }
  }
  const queue = [...inDeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  let nextFreeRow = 0

  while (queue.length) {
    const curId = queue.shift()!
    processed.add(curId)

    // Compute row: midpoint of prerequisite rows (within sibling group only)
    const siblingPres = project.tasks.get(curId)!.raw.prerequisites.filter(p => siblingIds.has(p))
    if (siblingPres.length === 0) {
      rowOf.set(curId, nextFreeRow++)
    } else {
      const preRows = siblingPres.map(p => rowOf.get(p) ?? 0)
      const midRow = Math.round(preRows.reduce((a, b) => a + b, 0) / preRows.length)
      // Avoid collisions
      const usedRows = new Set(rowOf.values())
      let r = midRow
      while (usedRows.has(r)) r++
      rowOf.set(curId, r)
      if (r >= nextFreeRow) nextFreeRow = r + 1
    }

    for (const next of adj.get(curId)!) {
      const d = inDeg.get(next)! - 1
      inDeg.set(next, d)
      if (d === 0) queue.push(next)
    }
  }

  // Build LayoutNodes
  const nodes: LayoutNode[] = []
  const sectionId = parentTaskId ?? 'root'

  for (const t of tasks) {
    const c = t.computed
    if (!c) continue
    const id = t.raw.id
    const row = rowOf.get(id) ?? 0

    if (t.raw.type === 'milestone') {
      const x = timeToX(c.start, sectionStart)
      nodes.push({
        id, x, y: rowY(row),
        width: MILESTONE_WIDTH,
        height: ROW_STRIDE * nextFreeRow,  // full-height dashed line
        row,
        sectionId: String(sectionId),
      })
    } else {
      const x = timeToX(c.start, sectionStart)
      const width = taskWidth(c.durationDays)
      nodes.push({
        id, x, y: rowY(row),
        width, height: TASK_HEIGHT, row,
        sectionId: String(sectionId),
      })
    }
  }

  // Build connectors (orthogonal waypoints will be computed in the renderer)
  const connectors: LayoutConnector[] = []
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  for (const t of tasks) {
    for (const preId of t.raw.prerequisites) {
      if (!siblingIds.has(preId)) continue
      const from = nodeMap.get(preId)
      const to = nodeMap.get(t.raw.id)
      if (!from || !to) continue
      connectors.push({ fromId: preId, toId: t.raw.id, points: [] })
    }
  }

  // Total section dimensions
  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0) + SECTION_H_PAD
  const totalH = nextFreeRow * ROW_STRIDE

  return [{
    id: String(sectionId),
    parentTaskId,
    startMilestoneId: null,
    endMilestoneId: milestones.length > 0 ? milestones[milestones.length - 1].raw.id : null,
    nodes,
    connectors,
    xOffset: xOffsetStart,
    width: maxX,
    height: totalH,
  }]
}

/**
 * Build the full canvas layout for the current view level (the sibling group
 * of `parentTaskId`, or root if null).
 */
export function buildLayout(project: Project, parentTaskId: NodeId | null): SectionLayout[] {
  const siblings: RuntimeTask[] = parentTaskId === null
    ? project.roots
    : (project.tasks.get(parentTaskId)?.children ?? [])

  return layoutSiblingGroup(siblings, project, parentTaskId, 0)
}
