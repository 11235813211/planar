import type { GanttFile, AnyTask, NodeId, Person, Project, RuntimeTask, KanbanColumn } from '../types'
import { validate } from './validator'

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
