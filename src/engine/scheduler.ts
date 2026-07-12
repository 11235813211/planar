import type { Project, NodeId, RuntimeTask, ScheduleConflict } from '../types'

const MS_PER_DAY = 86_400_000

function parseDate(s: string): Date { return new Date(s + 'T00:00:00Z') }
function addDays(d: Date, days: number): Date { return new Date(d.getTime() + days * MS_PER_DAY) }

/** Prerequisites of any node (task or milestone). */
function prereqsOf(project: Project, id: NodeId): NodeId[] {
  return project.tasks.get(id)?.raw.prerequisites
    ?? project.milestones.get(id)?.raw.prerequisites
    ?? []
}

/** Topological sort over the combined task + milestone prerequisite graph. */
function topoSort(project: Project): NodeId[] {
  const inDegree = new Map<NodeId, number>()
  const adj = new Map<NodeId, NodeId[]>()

  const allIds = [...project.tasks.keys(), ...project.milestones.keys()]
  for (const id of allIds) { inDegree.set(id, 0); adj.set(id, []) }
  for (const id of allIds) {
    for (const pre of prereqsOf(project, id)) {
      if (!adj.has(pre)) continue
      adj.get(pre)!.push(id)
      inDegree.set(id, inDegree.get(id)! + 1)
    }
  }

  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const order: NodeId[] = []
  while (queue.length) {
    const cur = queue.shift()!
    order.push(cur)
    for (const next of adj.get(cur)!) {
      const d = inDegree.get(next)! - 1
      inDegree.set(next, d)
      if (d === 0) queue.push(next)
    }
  }
  return order
}

/** Bottom-up: a container's span is the envelope of its children. */
function resolveContainers(project: Project): void {
  const visit = (rt: RuntimeTask) => {
    for (const c of rt.children) visit(c)
    if (rt.raw.type === 'container' && rt.children.length > 0) {
      let start: Date | null = null, end: Date | null = null
      for (const c of rt.children) {
        if (!c.computed) continue
        if (!start || c.computed.start < start) start = c.computed.start
        if (!end   || c.computed.end   > end)   end   = c.computed.end
      }
      if (start && end) {
        rt.computed = { start, end, durationDays: Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) }
      }
    }
  }
  for (const root of project.roots) visit(root)
}

/**
 * Compute start/end for every task + milestone and detect conflicts.
 * Mutates `.computed` in place; returns any detected conflicts.
 */
export function schedule(project: Project): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = []
  const order = topoSort(project)

  const runPass = () => {
    const earliestEnd = new Map<NodeId, Date>()

    const maxPrereqEnd = (id: NodeId): Date | null => {
      let acc: Date | null = null
      for (const pre of prereqsOf(project, id)) {
        const e = earliestEnd.get(pre)
        if (e && (!acc || e > acc)) acc = e
      }
      return acc
    }

    for (const id of order) {
      const prereqEnd = maxPrereqEnd(id)
      const t = project.tasks.get(id)

      if (t) {
        const raw = t.raw
        // Container whose span was already resolved from children — keep fixed.
        if (raw.type === 'container' && t.children.length > 0 && t.computed) {
          earliestEnd.set(id, t.computed.end)
          continue
        }
        if (raw.timeMode === 'date' && raw.start && raw.end) {
          const start = parseDate(raw.start), end = parseDate(raw.end)
          t.computed = { start, end, durationDays: Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) }
        } else {
          const dur = raw.duration ?? 7
          const anchor = raw.start ? parseDate(raw.start) : null
          const start = prereqEnd ? (anchor && anchor > prereqEnd ? anchor : prereqEnd) : (anchor ?? new Date())
          t.computed = { start, end: addDays(start, dur), durationDays: dur }
        }
        earliestEnd.set(id, t.computed.end)
      } else {
        const m = project.milestones.get(id)!
        let time = prereqEnd ?? new Date()
        if (m.raw.ownerId) {
          const owner = project.tasks.get(m.raw.ownerId)
          if (owner?.computed && owner.computed.end > time) time = owner.computed.end
        }
        m.computed = { start: time, end: time, durationDays: 0 }
        earliestEnd.set(id, time)
      }
    }
  }

  runPass()
  resolveContainers(project)
  runPass()

  return conflicts
}
