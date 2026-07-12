import type {
  Project, NodeId, TaskId, PanelId, RuntimeTask, RuntimeMilestone,
  LayoutNode, LayoutConnector, PanelLayout, LayoutKind,
} from '../types'

// ─── Constants (fixed element sizes — never scale with time zoom) ──────────────

export const TASK_HEIGHT   = 34
export const LABEL_ABOVE_H = 17   // room for the task name rendered above the bar
export const ROW_GAP       = 14
export const ROW_STRIDE    = LABEL_ABOVE_H + TASK_HEIGHT + ROW_GAP
export const PX_PER_DAY    = 10
export const MIN_TASK_W    = 16   // tiny leaf tickets stay clickable (kept small to avoid overrun)
export const SECTION_PAD   = 40   // left padding inside a panel
export const PANEL_V_PAD   = 20   // vertical padding inside a panel
export const PANEL_GAP     = 14   // gap between stacked panels
export const MILESTONE_W   = 2

const MS = 86_400_000

// ─── Time-aware row occupancy over pixel intervals ─────────────────────────────

type Interval = [number, number]

function isFree(occ: Map<number, Interval[]>, row: number, s: number, e: number): boolean {
  return !(occ.get(row) ?? []).some(([rs, re]) => s < re && e > rs)
}
function claim(occ: Map<number, Interval[]>, row: number, s: number, e: number): void {
  if (!occ.has(row)) occ.set(row, [])
  occ.get(row)!.push([s, e])
}
// Nearest free row at or BELOW `preferred` (staircase grows downward).
function pickRowDown(occ: Map<number, Interval[]>, preferred: number, s: number, e: number): number {
  for (let r = Math.max(0, preferred); r <= preferred + 400; r++) {
    if (isFree(occ, r, s, e)) return r
  }
  return preferred
}

// ─── Group layout ──────────────────────────────────────────────────────────────
//
// Lays out a set of sibling tasks + milestones sharing one timeline. x is pure
// time; prereq successors staircase down a row so chains read as a diagonal.

interface GroupInput {
  tasks: RuntimeTask[]
  milestones: RuntimeMilestone[]
  sectionStart: Date
  pxPerDay: number
  panelId: PanelId
  yBase: number
  dimmedIds?: Set<NodeId>
}

interface GroupOutput {
  nodes: LayoutNode[]
  connectors: LayoutConnector[]
  width: number
  rowCount: number
}

function layoutGroup(input: GroupInput): GroupOutput {
  const { tasks, milestones, sectionStart, pxPerDay, panelId, yBase, dimmedIds } = input

  const groupIds = new Set<NodeId>([...tasks.map(t => t.raw.id), ...milestones.map(m => m.raw.id)])
  const startMs = sectionStart.getTime()

  // No clamp: dimmed context tasks before the section start get a negative offset
  // (visible by scrolling left).
  const timeX = (d: Date | undefined): number =>
    d ? SECTION_PAD + ((d.getTime() - startMs) / MS) * pxPerDay : SECTION_PAD

  const widthOf = (id: NodeId, kind: LayoutKind): number => {
    if (kind === 'milestone') return MILESTONE_W
    const rt = tasks.find(t => t.raw.id === id)!
    // Milestone-tasks (containers) size to their real span; only tiny leaf tickets
    // get a minimum width so they stay clickable.
    const px = (rt.computed?.durationDays ?? 1) * pxPerDay
    return rt.raw.type === 'container' ? Math.max(px, 8) : Math.max(px, MIN_TASK_W)
  }

  const kindOf = (id: NodeId): LayoutKind => {
    const t = tasks.find(t => t.raw.id === id)
    if (t) return t.raw.type === 'container' ? 'container' : 'ticket'
    return 'milestone'
  }
  const computedOf = (id: NodeId) =>
    tasks.find(t => t.raw.id === id)?.computed ?? milestones.find(m => m.raw.id === id)?.computed ?? null
  const prereqsOf = (id: NodeId): NodeId[] =>
    (tasks.find(t => t.raw.id === id)?.raw.prerequisites
      ?? milestones.find(m => m.raw.id === id)?.raw.prerequisites
      ?? []).filter(p => groupIds.has(p))

  // Local topological order
  const inDeg = new Map<NodeId, number>()
  const adj = new Map<NodeId, NodeId[]>()
  for (const id of groupIds) { inDeg.set(id, 0); adj.set(id, []) }
  for (const id of groupIds) {
    for (const p of prereqsOf(id)) { adj.get(p)!.push(id); inDeg.set(id, inDeg.get(id)! + 1) }
  }
  const queue = [...inDeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const order: NodeId[] = []
  while (queue.length) {
    const cur = queue.shift()!
    order.push(cur)
    for (const n of adj.get(cur)!) { const d = inDeg.get(n)! - 1; inDeg.set(n, d); if (d === 0) queue.push(n) }
  }
  for (const id of groupIds) if (!order.includes(id)) order.push(id)

  // Pure time-based x: bars align exactly with the date axis, and milestones sit on
  // day boundaries. Visual separation of chained tasks comes from the staircase rows
  // (below), not from horizontal gaps — so nothing runs over a milestone line.
  const xLeft = new Map<NodeId, number>()
  const xRight = new Map<NodeId, number>()
  for (const id of order) {
    const kind = kindOf(id)
    const x = timeX(computedOf(id)?.start)
    xLeft.set(id, x)
    xRight.set(id, x + widthOf(id, kind))
  }

  // Staircase row assignment: a task sits one row BELOW its lowest (non-milestone)
  // prerequisite, so prereq chains step down-and-right and every bar has empty space
  // above it for its name. Milestones don't occupy rows.
  const occ = new Map<number, Interval[]>()
  const rowOf = new Map<NodeId, number>()
  for (const id of order) {
    if (kindOf(id) === 'milestone') { rowOf.set(id, 0); continue }
    const pres = prereqsOf(id).filter(p => kindOf(p) !== 'milestone')
    const preferred = pres.length === 0
      ? 0
      : Math.max(...pres.map(p => rowOf.get(p) ?? 0)) + 1
    const s = xLeft.get(id)!, e = xRight.get(id)!
    const row = pickRowDown(occ, preferred, s, e)
    claim(occ, row, s, e)
    rowOf.set(id, row)
  }

  const taskRows = [...rowOf.entries()].filter(([id]) => kindOf(id) !== 'milestone').map(([, r]) => r)
  const rowCount = taskRows.length ? Math.max(...taskRows) + 1 : 1

  // Build nodes
  const nodes: LayoutNode[] = []
  for (const id of groupIds) {
    const kind = kindOf(id)
    const x = xLeft.get(id)!
    if (kind === 'milestone') {
      nodes.push({
        id, kind, x, y: yBase, width: MILESTONE_W, height: rowCount * ROW_STRIDE,
        row: 0, panelId, dimmed: dimmedIds?.has(id),
      })
    } else {
      nodes.push({
        id, kind, x, y: yBase + (rowOf.get(id) ?? 0) * ROW_STRIDE,
        width: xRight.get(id)! - x, height: TASK_HEIGHT,
        row: rowOf.get(id) ?? 0, panelId, dimmed: dimmedIds?.has(id),
      })
    }
  }

  // Connectors (within group only)
  const connectors: LayoutConnector[] = []
  for (const id of groupIds) {
    for (const p of prereqsOf(id)) connectors.push({ fromId: p, toId: id, points: [] })
  }

  const width = Math.max(SECTION_PAD, ...[...xRight.values()]) + SECTION_PAD
  return { nodes, connectors, width, rowCount }
}

// ─── Top-level (panels) layout ─────────────────────────────────────────────────

export interface LayoutResult {
  panels: PanelLayout[]
  width: number
  height: number
  sectionStart: Date | null
}

function earliestStart(items: Array<{ computed: { start: Date } | null }>): Date | null {
  let s: Date | null = null
  for (const it of items) if (it.computed && (!s || it.computed.start < s)) s = it.computed.start
  return s
}

export function buildLayout(
  project: Project,
  drillId: TaskId | null,
  pxPerDay: number = PX_PER_DAY,
): LayoutResult {
  return drillId === null
    ? buildTopLevel(project, pxPerDay)
    : buildDrilled(project, drillId, pxPerDay)
}

function buildTopLevel(project: Project, pxPerDay: number): LayoutResult {
  const allTop = project.roots
  const sectionStart = earliestStart(allTop) ?? new Date()

  const panels: PanelLayout[] = []
  let yCursor = 0
  let maxWidth = 0

  for (const panel of project.panels) {
    const tasks = allTop.filter(t => t.raw.panel === panel.id)
    const ms = [...project.milestones.values()].filter(m => m.raw.parent === null && m.raw.panel === panel.id)

    const g = layoutGroup({
      tasks, milestones: ms, sectionStart, pxPerDay, panelId: panel.id, yBase: PANEL_V_PAD + LABEL_ABOVE_H,
    })
    const height = g.rowCount * ROW_STRIDE + PANEL_V_PAD * 2 + LABEL_ABOVE_H

    // Note: a container's completion milestone is intentionally NOT drawn at its own
    // level — it only appears as the terminal boundary when you drill into it.

    panels.push({
      panelId: panel.id, name: panel.name, color: panel.color,
      nodes: g.nodes, connectors: g.connectors,
      yOffset: yCursor, height, width: g.width,
    })
    yCursor += height + PANEL_GAP
    maxWidth = Math.max(maxWidth, g.width)
  }

  return { panels, width: maxWidth, height: Math.max(0, yCursor - PANEL_GAP), sectionStart }
}

function buildDrilled(project: Project, drillId: TaskId, pxPerDay: number): LayoutResult {
  const container = project.tasks.get(drillId)
  if (!container || container.raw.type !== 'container') return buildTopLevel(project, pxPerDay)

  const panelId = topPanelOf(project, container)
  const children = container.children
  const start = container.computed?.start ?? earliestStart(children) ?? new Date()
  const end   = container.computed?.end ?? start

  // Synthetic start boundary (= the container's prereq boundary)
  const startMs: RuntimeMilestone = {
    raw: { id: `__start_${drillId}`, name: `${container.raw.name} · start`, parent: drillId, panel: null, ownerId: null, prerequisites: [], order: 'a0' },
    computed: { start, end: start, durationDays: 0 },
  }

  const childMilestones = [...project.milestones.values()].filter(m => m.raw.parent === drillId)
  const hasRealCompletion = childMilestones.some(m => m.raw.ownerId === drillId)

  // Synthesise the end/completion boundary only if the user hasn't created a real one.
  const boundary: RuntimeMilestone[] = [startMs]
  if (!hasRealCompletion) {
    boundary.push({
      raw: { id: `__end_${drillId}`, name: container.raw.name, parent: drillId, panel: null, ownerId: drillId, prerequisites: [], order: 'z9' },
      computed: { start: end, end, durationDays: 0 },
    })
  }

  const childBase = PANEL_V_PAD + LABEL_ABOVE_H
  const g = layoutGroup({
    tasks: children,
    milestones: [...boundary, ...childMilestones],
    sectionStart: start, pxPerDay, panelId, yBase: childBase,
  })

  let nodes = g.nodes
  let connectors = g.connectors
  let bottomRows = g.rowCount

  // Dimmed context: the container's own siblings, shown at their real time positions
  // (scroll before/after the section to see them) below a divider lane.
  const siblingScope = container.raw.parent === null
    ? project.roots.filter(r => r.raw.panel === panelId)
    : (project.tasks.get(container.raw.parent)?.children ?? [])
  const siblings = siblingScope.filter(t => t.raw.id !== drillId)
  let contextTop = 0
  if (siblings.length > 0) {
    const ctxBase = childBase + g.rowCount * ROW_STRIDE + ROW_STRIDE   // one blank lane as a divider
    contextTop = ctxBase - ROW_STRIDE / 2
    const sg = layoutGroup({
      tasks: siblings, milestones: [], sectionStart: start, pxPerDay, panelId,
      yBase: ctxBase, dimmedIds: new Set(siblings.map(s => s.raw.id)),
    })
    nodes = [...nodes, ...sg.nodes]
    connectors = [...connectors, ...sg.connectors]
    bottomRows = g.rowCount + 1 + sg.rowCount
  }

  const height = bottomRows * ROW_STRIDE + PANEL_V_PAD * 2 + LABEL_ABOVE_H
  const panel = project.panels.find(p => p.id === panelId)
  return {
    panels: [{
      panelId, name: container.raw.name, color: panel?.color ?? '#2563eb',
      nodes, connectors, yOffset: 0, height, width: Math.max(g.width, 400),
      contextDividerY: siblings.length > 0 ? contextTop : undefined,
    }],
    width: Math.max(g.width, 400),
    height,
    sectionStart: start,
  }
}

function topPanelOf(project: Project, rt: RuntimeTask): PanelId {
  let cur: RuntimeTask | undefined = rt
  while (cur && cur.raw.parent !== null) cur = project.tasks.get(cur.raw.parent)
  return cur?.raw.panel ?? project.panels[0]?.id ?? 'pn_default'
}
