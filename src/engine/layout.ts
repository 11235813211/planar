import type {
  Project, NodeId, TaskId, PanelId, RuntimeTask, RuntimeMilestone,
  LayoutNode, LayoutConnector, PanelLayout, LayoutKind,
} from '../types'

// ─── Constants (fixed element sizes — never scale with time zoom) ──────────────

export const TASK_HEIGHT   = 30
export const LABEL_ABOVE_H = 15   // room for the task name rendered above the bar
export const ROW_GAP       = 7
export const ROW_STRIDE    = LABEL_ABOVE_H + TASK_HEIGHT + ROW_GAP   // gentler staircase drop
export const PX_PER_DAY    = 10
export const MIN_TASK_W    = 16   // tiny leaf tickets stay clickable (kept small to avoid overrun)
export const MS_INSET      = 10   // gap between a milestone line and a task that starts on it
export const SECTION_PAD   = 48   // left padding inside a panel
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
  prereqOverride?: Map<NodeId, NodeId[]>   // used by expand-in-place drilling
}

interface GroupOutput {
  nodes: LayoutNode[]
  connectors: LayoutConnector[]
  width: number
  rowCount: number
}

function layoutGroup(input: GroupInput): GroupOutput {
  const { tasks, milestones, sectionStart, pxPerDay, panelId, yBase, prereqOverride } = input

  const groupIds = new Set<NodeId>([...tasks.map(t => t.raw.id), ...milestones.map(m => m.raw.id)])
  const startMs = sectionStart.getTime()
  const timeX = (d: Date | undefined): number =>
    d ? SECTION_PAD + ((d.getTime() - startMs) / MS) * pxPerDay : SECTION_PAD

  const widthOf = (id: NodeId, kind: LayoutKind): number => {
    if (kind === 'milestone') return MILESTONE_W
    const rt = tasks.find(t => t.raw.id === id)!
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
  const rawPrereqs = (id: NodeId): NodeId[] =>
    tasks.find(t => t.raw.id === id)?.raw.prerequisites
      ?? milestones.find(m => m.raw.id === id)?.raw.prerequisites ?? []
  const prereqsOf = (id: NodeId): NodeId[] =>
    (prereqOverride?.get(id) ?? rawPrereqs(id)).filter(p => groupIds.has(p))

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

  // Milestone x positions (day-aligned pure time). Tasks that start on a milestone
  // are inset so there's a visible gap + connector between the line and the bar.
  const milestoneXs: number[] = milestones.map(m => timeX(m.computed?.start)).sort((a, b) => a - b)

  const xLeft = new Map<NodeId, number>()
  const xRight = new Map<NodeId, number>()
  for (const id of order) {
    const kind = kindOf(id)
    let x = timeX(computedOf(id)?.start)
    if (kind !== 'milestone' && milestoneXs.some(mx => Math.abs(mx - x) < 1)) x += MS_INSET
    xLeft.set(id, x)
    xRight.set(id, x + widthOf(id, kind))
  }

  // Staircase rows (down + right), milestones don't occupy rows.
  const occ = new Map<number, Interval[]>()
  const rowOf = new Map<NodeId, number>()
  for (const id of order) {
    if (kindOf(id) === 'milestone') { rowOf.set(id, 0); continue }
    const pres = prereqsOf(id).filter(p => kindOf(p) !== 'milestone')
    const preferred = pres.length === 0 ? 0 : Math.max(...pres.map(p => rowOf.get(p) ?? 0)) + 1
    const s = xLeft.get(id)!, e = xRight.get(id)!
    const row = pickRowDown(occ, preferred, s, e)
    claim(occ, row, s, e)
    rowOf.set(id, row)
  }

  const taskRows = [...rowOf.entries()].filter(([id]) => kindOf(id) !== 'milestone').map(([, r]) => r)
  const rowCount = taskRows.length ? Math.max(...taskRows) + 1 : 1

  const nodes: LayoutNode[] = []
  for (const id of groupIds) {
    const kind = kindOf(id)
    const x = xLeft.get(id)!
    if (kind === 'milestone') {
      nodes.push({ id, kind, x, y: yBase, width: MILESTONE_W, height: rowCount * ROW_STRIDE, row: 0, panelId })
    } else {
      // Title must stop before the next milestone to its right.
      const nextMs = milestoneXs.filter(mx => mx > x + 6).sort((a, b) => a - b)[0]
      nodes.push({
        id, kind, x, y: yBase + (rowOf.get(id) ?? 0) * ROW_STRIDE,
        width: xRight.get(id)! - x, height: TASK_HEIGHT,
        row: rowOf.get(id) ?? 0, panelId,
        titleClipX: nextMs != null ? nextMs - 4 : undefined,
      })
    }
  }

  const connectors: LayoutConnector[] = []
  for (const id of groupIds) for (const p of prereqsOf(id)) connectors.push({ fromId: p, toId: id, points: [] })

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
  expandId: TaskId | null,
  pxPerDay: number = PX_PER_DAY,
  maximizedPanel: PanelId | null = null,
): LayoutResult {
  // Global section start so all panels share one date axis.
  const allStarts: Array<{ computed: { start: Date } | null }> = [
    ...project.roots,
    ...[...project.milestones.values()],
  ]
  const sectionStart = earliestStart(allStarts) ?? new Date()

  const expand = expandId ? project.tasks.get(expandId) ?? null : null
  const expandPanel = expand ? topPanelOf(project, expand) : null

  const panels: PanelLayout[] = []
  let yCursor = 0
  let maxWidth = 0

  const visiblePanels = maximizedPanel
    ? project.panels.filter(p => p.id === maximizedPanel)
    : project.panels

  for (const panel of visiblePanels) {
    const g = (expand && expandPanel === panel.id)
      ? layoutPanelExpanded(project, panel.id, expand, sectionStart, pxPerDay)
      : layoutPanelNormal(project, panel.id, sectionStart, pxPerDay)

    const height = g.rowCount * ROW_STRIDE + PANEL_V_PAD * 2 + LABEL_ABOVE_H
    panels.push({
      panelId: panel.id, name: panel.name, color: panel.color,
      nodes: g.nodes, connectors: g.connectors, yOffset: yCursor, height, width: g.width,
    })
    yCursor += height + PANEL_GAP
    maxWidth = Math.max(maxWidth, g.width)
  }
  return { panels, width: maxWidth, height: Math.max(0, yCursor - PANEL_GAP), sectionStart }
}

function rootStartMilestone(panelId: PanelId, at: Date): RuntimeMilestone {
  return {
    raw: { id: `__rootstart_${panelId}`, name: 'Start', parent: null, panel: panelId, ownerId: null, prerequisites: [], order: 'a0' },
    computed: { start: at, end: at, durationDays: 0 },
  }
}

function layoutPanelNormal(project: Project, panelId: PanelId, sectionStart: Date, pxPerDay: number): GroupOutput {
  const tasks = project.roots.filter(t => t.raw.panel === panelId)
  const userMs = [...project.milestones.values()].filter(m => m.raw.parent === null && m.raw.panel === panelId)
  // Every root has a default "Start" milestone that everything originates from.
  const start = rootStartMilestone(panelId, sectionStart)
  const override = new Map<NodeId, NodeId[]>()
  for (const t of tasks) if (t.raw.prerequisites.length === 0) override.set(t.raw.id, [start.raw.id])
  return layoutGroup({ tasks, milestones: [start, ...userMs], sectionStart, pxPerDay, panelId, yBase: PANEL_V_PAD + LABEL_ABOVE_H, prereqOverride: override })
}

/**
 * Expand a container in place: its sibling scope is shown normally, but the
 * container itself is replaced by its children bounded by start/end milestones.
 * No graying, no divider — children and siblings share the same y-levels.
 */
function layoutPanelExpanded(project: Project, panelId: PanelId, container: RuntimeTask, sectionStart: Date, pxPerDay: number): GroupOutput {
  const drillId = container.raw.id
  const scope = container.raw.parent === null
    ? project.roots.filter(t => t.raw.panel === panelId)
    : (project.tasks.get(container.raw.parent)?.children ?? [])
  const scopeMs = [...project.milestones.values()].filter(m => m.raw.parent === container.raw.parent)
  const siblings = scope.filter(t => t.raw.id !== drillId)
  const children = container.children
  const start = container.computed?.start ?? sectionStart
  const end = container.computed?.end ?? start

  const startMs: RuntimeMilestone = {
    raw: { id: `__start_${drillId}`, name: `${container.raw.name} · start`, parent: container.raw.parent, panel: null, ownerId: null, prerequisites: [], order: 'a0' },
    computed: { start, end: start, durationDays: 0 },
  }
  const endMs: RuntimeMilestone = {
    raw: { id: `__end_${drillId}`, name: container.raw.name, parent: container.raw.parent, panel: null, ownerId: drillId, prerequisites: [], order: 'z9' },
    computed: { start: end, end, durationDays: 0 },
  }

  const childIds = new Set(children.map(c => c.raw.id))
  const leafChildren = children.filter(c => !children.some(o => o.raw.prerequisites.includes(c.raw.id)))

  // Prerequisite override wiring the boundary milestones into the graph.
  const override = new Map<NodeId, NodeId[]>()
  override.set(startMs.raw.id, container.raw.prerequisites.filter(p => scope.some(s => s.raw.id === p) || scopeMs.some(m => m.raw.id === p)))
  override.set(endMs.raw.id, leafChildren.map(c => c.raw.id))
  for (const c of children) {
    const intra = c.raw.prerequisites.filter(p => childIds.has(p))
    override.set(c.raw.id, intra.length ? intra : [startMs.raw.id])
  }
  for (const s of siblings) {
    if (s.raw.prerequisites.includes(drillId))
      override.set(s.raw.id, s.raw.prerequisites.map(p => p === drillId ? endMs.raw.id : p))
  }
  // At root, everything originates from the default Start milestone.
  const rootScope = container.raw.parent === null
  const extraMs: RuntimeMilestone[] = []
  if (rootScope) {
    const rs = rootStartMilestone(panelId, sectionStart)
    extraMs.push(rs)
    for (const s of siblings) if (s.raw.prerequisites.length === 0) override.set(s.raw.id, [rs.raw.id])
    if ((override.get(startMs.raw.id) ?? []).length === 0) override.set(startMs.raw.id, [rs.raw.id])
  }

  return layoutGroup({
    tasks: [...siblings, ...children],
    milestones: [...scopeMs, ...extraMs, startMs, endMs],
    sectionStart, pxPerDay, panelId, yBase: PANEL_V_PAD + LABEL_ABOVE_H, prereqOverride: override,
  })
}

function topPanelOf(project: Project, rt: RuntimeTask): PanelId {
  let cur: RuntimeTask | undefined = rt
  while (cur && cur.raw.parent !== null) cur = project.tasks.get(cur.raw.parent)
  return cur?.raw.panel ?? project.panels[0]?.id ?? 'pn_default'
}
