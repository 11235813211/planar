import type { GanttFile, AnyTask } from '../types'
import { toGanttFile } from './loader'
import type { Project } from '../types'

function cleanTask(t: AnyTask): AnyTask {
  // Never persist computed/derived fields — only authoritative fields
  if (t.type === 'milestone') {
    const { id, name, type, parent, order, prerequisites, style, timeMode, date, terminates, generated } = t
    return { id, name, type, parent, order, prerequisites, style, timeMode, date, terminates, generated }
  }
  if (t.timeMode === 'date') {
    const { id, name, type, parent, order, prerequisites, style, timeMode, start, end, assignees, status, ticket } = t
    return { id, name, type, parent, order, prerequisites, style, timeMode, start, end, assignees, status, ticket }
  }
  // duration mode
  const { id, name, type, parent, order, prerequisites, style, timeMode, duration, start, assignees, status, ticket } = t
  return { id, name, type, parent, order, prerequisites, style, timeMode, duration, start, assignees, status, ticket }
}

export function serialize(project: Project): string {
  const file = toGanttFile(project)

  const sorted: AnyTask[] = [...file.tasks]
    .map(cleanTask)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const out: GanttFile = {
    schemaVersion: file.schemaVersion,
    project: file.project,
    people: [...file.people].sort((a, b) => (a.id < b.id ? -1 : 1)),
    tasks: sorted,
    columns: [...file.columns ?? []].sort((a, b) => (a.id < b.id ? -1 : 1)),
  }

  return JSON.stringify(out, null, 2) + '\n'
}
