// ─── Primitive IDs ────────────────────────────────────────────────────────────

export type TaskId = string       // t_xxxx
export type MilestoneId = string  // m_xxxx  (boundary marker; derived/auto)
export type PanelId = string      // pn_xxxx
export type PersonId = string     // p_xxxx
export type TagId = string        // g_xxxx
export type ColumnId = string     // c_xxxx
export type NodeId = TaskId | MilestoneId

// ─── Task types ───────────────────────────────────────────────────────────────
//
// Two task kinds, both drawn as rectangles in the Gantt chart:
//   • ticket    — a leaf. Double-click opens a detail popup. Appears on Kanban.
//   • container — a "milestone-task". Has children. Double-click drills in.
//                 Never appears on the Kanban.
//
// A "milestone" (below) is NOT a task — it's an auto-generated boundary marker
// at the start/end of a drilled container. Milestones can gain prerequisites
// (via a + button) and can themselves be a prerequisite of a task.

export type TaskType = 'ticket' | 'container'

export interface TaskStyle {
  background: string
  text: string
}

export interface TaskBase {
  id: TaskId
  name: string
  parent: TaskId | null   // container parent; null ⇒ top-level (see `panel`)
  panel: PanelId | null   // set iff parent === null — which panel it lives in
  order: string           // fractional lexical order among siblings
  prerequisites: NodeId[] // sibling task ids or milestone ids
  tags: TagId[]
  style: TaskStyle
  timeMode: 'date' | 'duration'
  start?: string          // ISO date (anchor for duration, or explicit start)
  end?: string            // ISO date (date mode)
  duration?: number       // days (duration mode)
}

export interface TicketTask extends TaskBase {
  type: 'ticket'
  assignees: PersonId[]
  status: ColumnId        // maps to a KanbanColumn id
  ticket: string | null
}

export interface ContainerTask extends TaskBase {
  type: 'container'
  // Children are discovered via parent pointers.
  // Each container owns an auto completion-milestone (see Milestone.ownerId).
}

export type AnyTask = TicketTask | ContainerTask

// ─── Milestones (boundary markers) ─────────────────────────────────────────────

export interface Milestone {
  id: MilestoneId
  name: string
  parent: TaskId | null      // the container this milestone lives inside (null = a panel's terminal)
  panel: PanelId | null      // set iff parent === null
  ownerId: TaskId | null     // the container task whose completion this caps (null = manual/panel terminal)
  prerequisites: NodeId[]    // user-added prereqs (via the + button) — never post-reqs
  order: string
}

// ─── Panels (top-level vertical stacking) ──────────────────────────────────────

export interface Panel {
  id: PanelId
  name: string
  color: string
  order: string
}

// ─── Tags ───────────────────────────────────────────────────────────────────────

export interface Tag {
  id: TagId
  name: string
  color: string
}

// ─── People ─────────────────────────────────────────────────────────────────────

export interface Person {
  id: PersonId
  name: string
}

// ─── Kanban columns ─────────────────────────────────────────────────────────────

export interface KanbanColumn {
  id: ColumnId
  label: string
  color: string
  grayed: boolean   // tasks in this column render greyed-out everywhere (e.g. "Done")
  order: string
}

// ─── Persisted file (mirrors .gantt.json exactly) ──────────────────────────────

export interface ProjectMeta {
  name: string
  timeUnit: 'day' | 'week'
}

export interface GanttFile {
  schemaVersion: number
  project: ProjectMeta
  panels: Panel[]
  people: Person[]
  tags: Tag[]
  tasks: AnyTask[]
  milestones: Milestone[]
  columns: KanbanColumn[]
}

// ─── In-memory enriched model ─────────────────────────────────────────────────

export interface ComputedTiming {
  start: Date
  end: Date
  durationDays: number
}

/** A task as it lives in memory after loading + scheduling. */
export interface RuntimeTask {
  raw: AnyTask
  children: RuntimeTask[]      // ordered by .order
  computed: ComputedTiming | null
}

/** A milestone as it lives in memory after scheduling. */
export interface RuntimeMilestone {
  raw: Milestone
  computed: ComputedTiming | null   // a milestone has zero duration; start === end
}

/** The in-memory project state. */
export interface Project {
  meta: ProjectMeta
  panels: Panel[]                          // ordered by .order
  people: Map<PersonId, Person>
  tags: Map<TagId, Tag>
  tasks: Map<TaskId, RuntimeTask>
  milestones: Map<MilestoneId, RuntimeMilestone>
  roots: RuntimeTask[]                     // top-level tasks ordered by (panel, order)
  columns: KanbanColumn[]
  fileHandle: FileSystemFileHandle | null
  dirty: boolean
}

// ─── Layout ──────────────────────────────────────────────────────────────────

export type LayoutKind = 'ticket' | 'container' | 'milestone'

export interface LayoutNode {
  id: NodeId
  kind: LayoutKind
  x: number        // px from panel origin
  y: number        // px from panel origin
  width: number
  height: number
  row: number
  panelId: PanelId
  dimmed?: boolean // sibling shown for context while drilled in
}

export interface LayoutConnector {
  fromId: NodeId
  toId: NodeId
  points: Array<{ x: number; y: number }>
}

/** One panel's worth of laid-out content. */
export interface PanelLayout {
  panelId: PanelId
  name: string
  color: string
  nodes: LayoutNode[]
  connectors: LayoutConnector[]
  yOffset: number   // px from canvas top
  height: number
  width: number
  contextDividerY?: number  // y of the dimmed-context divider (drilled view only)
}

// ─── Conflict detection ───────────────────────────────────────────────────────

export type ConflictChoice = 'compress' | 'push' | 'cancel'

/** A date-fixed task/milestone whose prerequisites can't finish in time. */
export interface ScheduleConflict {
  nodeId: NodeId
  nodeName: string
  fixedDate: string     // ISO — the fixed start/end that was overrun
  requiredDate: string  // ISO — when prerequisites actually allow it
  overflowDays: number
}
