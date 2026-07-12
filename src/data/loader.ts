import type {
  GanttFile, AnyTask, Person, Tag, Panel, Project, RuntimeTask, RuntimeMilestone,
  KanbanColumn, TicketTask, Milestone,
} from '../types'
import { validate } from './validator'
import { newTaskId, newPanelId } from './ids'

export function defaultColumns(): KanbanColumn[] {
  return [
    { id: 'todo',        label: 'To Do',       color: '#64748b', grayed: false, order: 'a0' },
    { id: 'in-progress', label: 'In Progress', color: '#2563eb', grayed: false, order: 'a1' },
    { id: 'done',        label: 'Done',        color: '#16a34a', grayed: true,  order: 'a2' },
  ]
}

const byOrder = <T extends { order: string }>(a: T, b: T) =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : 0

export function parseGanttFile(json: string): Project {
  const file = JSON.parse(json) as GanttFile

  if (file.schemaVersion !== 2)
    throw new Error(`Unsupported schemaVersion: ${file.schemaVersion} (expected 2)`)

  validate(file.tasks, file.milestones ?? [])

  const people = new Map<string, Person>()
  for (const p of file.people) people.set(p.id, p)

  const tags = new Map<string, Tag>()
  for (const g of file.tags ?? []) tags.set(g.id, g)

  const panels: Panel[] = [...(file.panels ?? [])].sort(byOrder)
  if (panels.length === 0) panels.push({ id: newPanelId(), name: 'Main', color: '#2563eb', order: 'a0' })

  // Tasks
  const tasks = new Map<string, RuntimeTask>()
  for (const t of file.tasks) tasks.set(t.id, { raw: t, children: [], computed: null })

  const roots: RuntimeTask[] = []
  for (const rt of tasks.values()) {
    const parentId = rt.raw.parent
    if (parentId === null) roots.push(rt)
    else tasks.get(parentId)?.children.push(rt)
  }

  const rtByOrder = (a: RuntimeTask, b: RuntimeTask) => byOrder(a.raw, b.raw)
  roots.sort(rtByOrder)
  for (const rt of tasks.values()) rt.children.sort(rtByOrder)

  // Milestones
  const milestones = new Map<string, RuntimeMilestone>()
  for (const m of file.milestones ?? []) milestones.set(m.id, { raw: m, computed: null })

  return {
    meta: file.project,
    panels,
    people,
    tags,
    tasks,
    milestones,
    roots,
    columns: (file.columns ?? defaultColumns()).slice().sort(byOrder),
    fileHandle: null,
    dirty: false,
  }
}

export function createBlankProject(): Project {
  const today = new Date().toISOString().split('T')[0]
  const panelId = newPanelId()
  const tid = newTaskId()

  const rawTask: TicketTask = {
    id: tid, name: 'First Task', type: 'ticket',
    parent: null, panel: panelId, order: 'a0',
    timeMode: 'duration', duration: 14, start: today,
    prerequisites: [], tags: [], assignees: [],
    status: 'todo', ticket: null,
    style: { background: '#1e3a5f', text: '#dbeafe' },
  }

  const taskRT: RuntimeTask = { raw: rawTask, children: [], computed: null }

  return {
    meta: { name: 'Untitled Project', timeUnit: 'day' },
    panels: [{ id: panelId, name: 'Main', color: '#2563eb', order: 'a0' }],
    people: new Map(),
    tags: new Map(),
    tasks: new Map([[tid, taskRT]]),
    milestones: new Map(),
    roots: [taskRT],
    columns: defaultColumns(),
    fileHandle: null,
    dirty: true,
  }
}

export function toGanttFile(project: Project): GanttFile {
  const tasks: AnyTask[] = []
  for (const rt of project.tasks.values()) tasks.push(rt.raw)

  const milestones: Milestone[] = []
  for (const rm of project.milestones.values()) milestones.push(rm.raw)

  return {
    schemaVersion: 2,
    project: project.meta,
    panels: project.panels,
    people: [...project.people.values()],
    tags: [...project.tags.values()],
    tasks,
    milestones,
    columns: project.columns,
  }
}
