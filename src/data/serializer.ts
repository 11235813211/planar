import type { GanttFile, AnyTask, Milestone, Project } from '../types'
import { toGanttFile } from './loader'

function cleanTask(t: AnyTask): AnyTask {
  // Never persist computed/derived fields — only authoritative fields.
  const base = {
    id: t.id, name: t.name, type: t.type, parent: t.parent, panel: t.panel,
    order: t.order, prerequisites: t.prerequisites, tags: t.tags, style: t.style,
  }
  if (t.type === 'container') {
    return t.timeMode === 'date'
      ? { ...base, type: 'container', timeMode: 'date', start: t.start, end: t.end }
      : { ...base, type: 'container', timeMode: 'duration', start: t.start, duration: t.duration }
  }
  // ticket
  const ticketExtra = { assignees: t.assignees, status: t.status, ticket: t.ticket }
  return t.timeMode === 'date'
    ? { ...base, type: 'ticket', timeMode: 'date', start: t.start, end: t.end, ...ticketExtra }
    : { ...base, type: 'ticket', timeMode: 'duration', start: t.start, duration: t.duration, ...ticketExtra }
}

function cleanMilestone(m: Milestone): Milestone {
  const { id, name, parent, panel, ownerId, prerequisites, order } = m
  return { id, name, parent, panel, ownerId, prerequisites, order }
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function serialize(project: Project): string {
  const file = toGanttFile(project)

  const out: GanttFile = {
    schemaVersion: file.schemaVersion,
    project: file.project,
    panels: [...file.panels].sort(byId),
    people: [...file.people].sort(byId),
    tags: [...file.tags].sort(byId),
    tasks: [...file.tasks].map(cleanTask).sort(byId),
    milestones: [...file.milestones].map(cleanMilestone).sort(byId),
    columns: [...file.columns].sort(byId),
  }

  return JSON.stringify(out, null, 2) + '\n'
}
