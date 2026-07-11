import type { GanttFile, AnyTask, NodeId, Person, Project, RuntimeTask, KanbanColumn, TicketTask, MilestoneTask } from '../types'
import { validate } from './validator'
import { newTaskId, newMilestone } from './ids'

function defaultColumns(): KanbanColumn[] {
  return [
    { id: 'todo',        label: 'To Do',       order: 'a0' },
    { id: 'in-progress', label: 'In Progress',  order: 'a1' },
    { id: 'done',        label: 'Done',         order: 'a2' },
  ]
}

export function parseGanttFile(json: string): Project {
  const file = JSON.parse(json) as GanttFile

  if (file.schemaVersion !== 1)
    throw new Error(`Unsupported schemaVersion: ${file.schemaVersion}`)

  validate(file.tasks)

  const people = new Map<string, Person>()
  for (const p of file.people) people.set(p.id, p)

  // Build RuntimeTask map (no children yet)
  const tasks = new Map<NodeId, RuntimeTask>()
  for (const t of file.tasks) {
    tasks.set(t.id, { raw: t, children: [], computed: null })
  }

  // Wire children
  const roots: RuntimeTask[] = []
  for (const rt of tasks.values()) {
    const parentId = rt.raw.parent
    if (parentId === null) {
      roots.push(rt)
    } else {
      tasks.get(parentId)!.children.push(rt)
    }
  }

  // Sort children (and roots) by order key
  const byOrder = (a: RuntimeTask, b: RuntimeTask) =>
    a.raw.order < b.raw.order ? -1 : a.raw.order > b.raw.order ? 1 : 0
  roots.sort(byOrder)
  for (const rt of tasks.values()) rt.children.sort(byOrder)

  return {
    meta: file.project,
    people,
    tasks,
    roots,
    columns: file.columns ?? defaultColumns(),
    fileHandle: null,
    dirty: false,
  }
}

export function createBlankProject(): Project {
  const today = new Date().toISOString().split('T')[0]
  const tid = newTaskId()
  const mid = newMilestone()

  const rawTask: TicketTask = {
    id: tid, name: 'First Task', type: 'task',
    parent: null, order: 'a0',
    timeMode: 'duration', duration: 14, start: today,
    prerequisites: [], assignees: [],
    status: 'todo', ticket: null,
    style: { background: '#1e3a5f', text: '#dbeafe' },
  }
  const rawMs: MilestoneTask = {
    id: mid, name: 'Milestone', type: 'milestone',
    parent: null, order: 'a1',
    timeMode: 'duration',
    terminates: tid, generated: false,
    prerequisites: [tid],
    style: { background: '#5A2D82', text: '#FFFFFF' },
  }

  const taskRT: RuntimeTask = { raw: rawTask, children: [], computed: null }
  const msRT: RuntimeTask   = { raw: rawMs,  children: [], computed: null }

  return {
    meta: { name: 'Untitled Project', timeUnit: 'day' },
    people: new Map(),
    tasks: new Map([[tid, taskRT], [mid, msRT]]),
    roots: [taskRT, msRT],
    columns: defaultColumns(),
    fileHandle: null,
    dirty: true,
  }
}

export function toGanttFile(project: Project): GanttFile {
  const tasks: AnyTask[] = []
  for (const rt of project.tasks.values()) tasks.push(rt.raw)

  return {
    schemaVersion: 1,
    project: project.meta,
    people: [...project.people.values()],
    tasks,
    columns: project.columns,
  }
}
