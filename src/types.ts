// ─── Primitive IDs ────────────────────────────────────────────────────────────

export type TaskId = string      // t_xxxx
export type MilestoneId = string // m_xxxx
export type PersonId = string    // p_xxxx
export type NodeId = TaskId | MilestoneId

// ─── Persisted model (mirrors .gantt.json exactly) ───────────────────────────

export type Status = string // open-ended; maps to a KanbanColumn id

export interface Person {
  id: PersonId
  name: string
}

export interface TaskStyle {
  background: string
  text: string
}

export interface TaskBase {
  id: NodeId
  name: string
  parent: NodeId | null
  order: string
  prerequisites: NodeId[]
  style: TaskStyle
}

export interface TicketTask extends TaskBase {
  type: 'task'
  timeMode: 'date' | 'duration'
  // timeMode === 'date'
  start?: string     // ISO date
  end?: string       // ISO date
  // timeMode === 'duration'
  duration?: number  // days
  // start is also present for duration mode (the anchor)
  assignees: PersonId[]
  status: Status
  ticket: string | null
}

export interface MilestoneTask extends TaskBase {
  type: 'milestone'
  timeMode: 'date' | 'duration'
  date?: string         // ISO date — used when timeMode === 'date'
  terminates: NodeId | null  // the task/scope this milestone caps
  generated: boolean
}

export type AnyTask = TicketTask | MilestoneTask

export interface KanbanColumn {
  id: string
  label: string
  order: string
}

export interface ProjectMeta {
  name: string
  timeUnit: 'day' | 'week'
}

export interface GanttFile {
  schemaVersion: number
  project: ProjectMeta
  people: Person[]
  tasks: AnyTask[]
  columns?: KanbanColumn[]
}

// ─── In-memory enriched model ─────────────────────────────────────────────────

/** Runtime-computed timing for any node. */
export interface ComputedTiming {
  start: Date
  end: Date
  durationDays: number
}

/** A task node as it lives in memory after loading + scheduling. */
export interface RuntimeTask {
  raw: AnyTask
  children: RuntimeTask[]     // ordered by .order
  computed: ComputedTiming | null
}

/** The in-memory project state. */
export interface Project {
  meta: ProjectMeta
  people: Map<PersonId, Person>
  tasks: Map<NodeId, RuntimeTask>
  roots: RuntimeTask[]             // top-level tasks/milestones ordered by .order
  columns: KanbanColumn[]
  fileHandle: FileSystemFileHandle | null
  dirty: boolean
}

// ─── Layout ──────────────────────────────────────────────────────────────────

export interface LayoutNode {
  id: NodeId
  x: number        // px from section origin
  y: number        // px from section origin
  width: number    // px
  height: number   // px (constant for tasks; 0 for milestones — they use a flag)
  row: number      // logical row index within section
  sectionId: string
}

export interface LayoutConnector {
  fromId: NodeId
  toId: NodeId
  points: Array<{ x: number; y: number }>  // orthogonal waypoints
}

export interface SectionLayout {
  id: string
  parentTaskId: NodeId | null   // null = root section
  startMilestoneId: NodeId | null  // null for first-ever section
  endMilestoneId: NodeId | null
  nodes: LayoutNode[]
  connectors: LayoutConnector[]
  xOffset: number  // px from canvas origin
  width: number
  height: number
}

// ─── Conflict detection ───────────────────────────────────────────────────────

export type ConflictChoice = 'compress' | 'push' | 'cancel'

export interface ScheduleConflict {
  milestoneId: MilestoneId
  milestoneName: string
  overflowDays: number
}
