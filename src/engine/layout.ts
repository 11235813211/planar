import type {
  Project, NodeId, RuntimeTask, SectionLayout, LayoutNode, LayoutConnector
} from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

export const TASK_HEIGHT   = 40
export const TASK_ROW_GAP  = 24
export const ROW_STRIDE    = TASK_HEIGHT + TASK_ROW_GAP
export const PX_PER_DAY    = 10
export const MILESTONE_WIDTH = 2
export const SECTION_H_PAD  = 64

const MS = 86_400_000

// ─── Time-aware row occupancy ────────────────────────────────────────────────
//
// A row is "free" at a given time interval [s, e) (day offsets from section
// start) if no task already assigned to that row overlaps that interval.
// This lets tasks that don't overlap in time share the same row — the key to
// avoiding unnecessary crossovers in chains like A→C (C starts where A ends).

type Interval = [number, number]  // [startDay, endDay]

function isFree(occ: Map<number, Interval[]>, row: number, s: number, e: number): boolean {
  return !(occ.get(row) ?? []).some(([rs, re]) => s < re && e > rs)
}

function claim(occ: Map<number, Interval[]>, row: number, s: number, e: number): void {
  if (!occ.has(row)) occ.set(row, [])
  occ.get(row)!.push([s, e])
}

// Search outward from `preferred` for the nearest free row at [s, e).
function pickRow(occ: Map<number, Interval[]>, preferred: number, s: number, e: number): number {
  for (let d = 0; d <= 200; d++) {
    const candidates = d === 0 ? [preferred] : [preferred + d, preferred - d]
    for (const r of candidates) {
      if (r >= 0 && isFree(occ, r, s, e)) return r
    }
  }
  return preferred  // unreachable in practice
}

// ─── Row assignment (topo sort + fan-in midpoint + time-aware) ───────────────

function assignRows(
  tasks: RuntimeTask[],
  project: Project,
  sectionStart: Date,
): Map<NodeId, number> {
  const siblingIds = new Set(tasks.map(t => t.raw.id))
  const rowOf = new Map<NodeId, number>()
  const occ   = new Map<number, Interval[]>()

  // Build local adjacency for topological processing
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

  while (queue.length) {
    const id = queue.shift()!
    const t  = project.tasks.get(id)!
    const c  = t.computed

    // Day-offset interval for this task
    const s = c ? (c.start.getTime() - sectionStart.getTime()) / MS : 0
    const e = c ? Math.max(s + 0.01, (c.end.getTime() - sectionStart.getTime()) / MS) : s + 1

    const siblingPres = t.raw.prerequisites.filter(p => siblingIds.has(p))
    const preferred = siblingPres.length === 0
      ? 0
      : Math.round(siblingPres.reduce((sum, p) => sum + (rowOf.get(p) ?? 0), 0) / siblingPres.length)

    let row: number
    if (t.raw.type === 'milestone') {
      // Milestones are full-height dividers — don't occupy a row slot
      row = preferred
    } else {
      row = pickRow(occ, preferred, s, e)
      claim(occ, row, s, e)
    }

    rowOf.set(id, row)

    for (const next of adj.get(id) ?? []) {
      const d = inDeg.get(next)! - 1
      inDeg.set(next, d)
      if (d === 0) queue.push(next)
    }
  }

  return rowOf
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

  // Earliest start across all tasks → section x-origin
  let sectionStart: Date | null = null
  for (const t of tasks) {
    if (t.computed && (!sectionStart || t.computed.start < sectionStart))
      sectionStart = t.computed.start
  }
  if (!sectionStart) sectionStart = new Date()

  const rowOf = assignRows(tasks, project, sectionStart)

  const taskRows = [...rowOf.values()].filter((_, i) => tasks[i]?.raw.type !== 'milestone')
  const totalRows = taskRows.length === 0 ? 1 : Math.max(...taskRows) + 1

  const siblingIds = new Set(tasks.map(t => t.raw.id))
  const sectionId  = String(parentTaskId ?? 'root')

  // ── LayoutNodes ────────────────────────────────────────────────────────────
  const nodes: LayoutNode[] = []

  for (const t of tasks) {
    const c   = t.computed
    const id  = t.raw.id
    const row = rowOf.get(id) ?? 0
    if (!c) continue

    const dayOffset = (c.start.getTime() - sectionStart.getTime()) / MS
    const x = SECTION_H_PAD + Math.max(0, dayOffset) * pxPerDay

    if (t.raw.type === 'milestone') {
      nodes.push({
        id, x, y: 0,
        width: MILESTONE_WIDTH,
        height: totalRows * ROW_STRIDE,
        row: 0, sectionId,
      })
    } else {
      const w = Math.max(c.durationDays * pxPerDay, 48)
      nodes.push({
        id, x, y: row * ROW_STRIDE,
        width: w, height: TASK_HEIGHT,
        row, sectionId,
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

  const maxX   = nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0) + SECTION_H_PAD
  const height = totalRows * ROW_STRIDE

  return [{
    id: sectionId,
    parentTaskId,
    startMilestoneId: null,
    endMilestoneId: milestones.length > 0 ? milestones[milestones.length - 1].raw.id : null,
    nodes, connectors,
    xOffset: xOffsetStart,
    width: maxX,
    height,
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
