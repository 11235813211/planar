import type {
  Project, NodeId, RuntimeTask, SectionLayout, LayoutNode, LayoutConnector
} from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

export const TASK_HEIGHT   = 40
export const TASK_ROW_GAP  = 24
export const ROW_STRIDE    = TASK_HEIGHT + TASK_ROW_GAP
export const PX_PER_DAY    = 10          // default px per day (before zoom)
export const MILESTONE_WIDTH = 2
export const SECTION_H_PAD  = 64

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowY(row: number): number {
  return row * ROW_STRIDE
}

function taskWidth(durationDays: number, pxPerDay: number): number {
  return Math.max(durationDays * pxPerDay, 60)
}

function timeToX(date: Date, sectionStart: Date, pxPerDay: number): number {
  const days = (date.getTime() - sectionStart.getTime()) / 86_400_000
  return SECTION_H_PAD + Math.max(0, days) * pxPerDay
}

// ─── Section layout ───────────────────────────────────────────────────────────

export function layoutSiblingGroup(
  tasks: RuntimeTask[],
  project: Project,
  parentTaskId: NodeId | null,
  xOffsetStart: number,
  pxPerDay: number,
): SectionLayout[] {

  if (tasks.length === 0) return []

  const milestones = tasks.filter(t => t.raw.type === 'milestone')
  if (tasks.length === 0) return []

  // Earliest start date = section x-origin
  let sectionStart: Date | null = null
  for (const t of tasks) {
    if (t.computed && (!sectionStart || t.computed.start < sectionStart))
      sectionStart = t.computed.start
  }
  if (!sectionStart) sectionStart = new Date()

  const siblingIds = new Set(tasks.map(t => t.raw.id))

  // ── Row assignment via topological sort + fan-in midpoint ──────────────────
  const rowOf = new Map<NodeId, number>()
  const inDeg = new Map<NodeId, number>()
  const adj   = new Map<NodeId, NodeId[]>()
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
    const siblingPres = project.tasks.get(curId)!.raw.prerequisites.filter(p => siblingIds.has(p))

    if (siblingPres.length === 0) {
      rowOf.set(curId, nextFreeRow++)
    } else {
      const preRows = siblingPres.map(p => rowOf.get(p) ?? 0)
      const mid = Math.round(preRows.reduce((a, b) => a + b, 0) / preRows.length)
      const used = new Set(rowOf.values())
      let r = mid
      while (used.has(r)) r++
      rowOf.set(curId, r)
      if (r >= nextFreeRow) nextFreeRow = r + 1
    }

    for (const next of adj.get(curId) ?? []) {
      const d = inDeg.get(next)! - 1
      inDeg.set(next, d)
      if (d === 0) queue.push(next)
    }
  }

  // Milestones span all rows vertically
  const totalRows = Math.max(nextFreeRow, 1)

  // ── Build LayoutNodes ──────────────────────────────────────────────────────
  const nodes: LayoutNode[] = []
  const sectionId = parentTaskId ?? 'root'

  for (const t of tasks) {
    const c = t.computed
    if (!c) continue
    const id  = t.raw.id
    const row = rowOf.get(id) ?? 0

    if (t.raw.type === 'milestone') {
      nodes.push({
        id, x: timeToX(c.start, sectionStart, pxPerDay), y: 0,
        width: MILESTONE_WIDTH, height: totalRows * ROW_STRIDE,
        row: 0, sectionId: String(sectionId),
      })
    } else {
      nodes.push({
        id,
        x: timeToX(c.start, sectionStart, pxPerDay),
        y: rowY(row),
        width: taskWidth(c.durationDays, pxPerDay),
        height: TASK_HEIGHT,
        row, sectionId: String(sectionId),
      })
    }
  }

  // ── Connectors ─────────────────────────────────────────────────────────────
  const connectors: LayoutConnector[] = []
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  for (const t of tasks) {
    for (const preId of t.raw.prerequisites) {
      if (!siblingIds.has(preId)) continue
      if (!nodeMap.has(preId) || !nodeMap.has(t.raw.id)) continue
      connectors.push({ fromId: preId, toId: t.raw.id, points: [] })
    }
  }

  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0) + SECTION_H_PAD

  return [{
    id: String(sectionId),
    parentTaskId,
    startMilestoneId: null,
    endMilestoneId: milestones.length > 0 ? milestones[milestones.length - 1].raw.id : null,
    nodes,
    connectors,
    xOffset: xOffsetStart,
    width: maxX,
    height: totalRows * ROW_STRIDE,
  }]
}

export function buildLayout(
  project: Project,
  parentTaskId: NodeId | null,
  pxPerDay: number = PX_PER_DAY,
): SectionLayout[] {
  const siblings: RuntimeTask[] = parentTaskId === null
    ? project.roots
    : (project.tasks.get(parentTaskId)?.children ?? [])

  return layoutSiblingGroup(siblings, project, parentTaskId, 0, pxPerDay)
}
