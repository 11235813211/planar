import type { Project, NodeId, ScheduleConflict } from '../types'

const MS_PER_DAY = 86_400_000

function parseDate(s: string): Date {
  return new Date(s + 'T00:00:00Z')
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY)
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY)
}

/**
 * Topological sort of all tasks across the entire project.
 * Returns ids in dependency-first order.
 */
function topoSort(project: Project): NodeId[] {
  const inDegree = new Map<NodeId, number>()
  const adj = new Map<NodeId, NodeId[]>()

  for (const id of project.tasks.keys()) {
    inDegree.set(id, 0)
    adj.set(id, [])
  }
  for (const [id, rt] of project.tasks) {
    for (const pre of rt.raw.prerequisites) {
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

/**
 * Compute start/end for every task and detect conflicts.
 * Mutates rt.computed in-place; returns any detected conflicts.
 */
export function schedule(project: Project): ScheduleConflict[] {
  const order = topoSort(project)
  const conflicts: ScheduleConflict[] = []

  // Compute earliest-possible start for each task based on prerequisites
  const earliestEnd = new Map<NodeId, Date>()

  for (const id of order) {
    const rt = project.tasks.get(id)!
    const raw = rt.raw

    // Earliest start = max end of all prerequisites
    let prereqEnd: Date | null = null
    for (const pre of raw.prerequisites) {
      const e = earliestEnd.get(pre)
      if (e) {
        if (!prereqEnd || e > prereqEnd) prereqEnd = e
      }
    }

    if (raw.type === 'milestone') {
      let milestoneDate: Date
      if (raw.timeMode === 'date' && raw.date) {
        milestoneDate = parseDate(raw.date)
        // Conflict check: did prerequisites finish before this date?
        if (prereqEnd && prereqEnd > milestoneDate) {
          conflicts.push({
            milestoneId: id,
            milestoneName: raw.name,
            overflowDays: daysBetween(milestoneDate, prereqEnd),
          })
        }
      } else {
        // Duration mode milestone: place immediately after prerequisites
        milestoneDate = prereqEnd ?? new Date()
      }
      rt.computed = { start: milestoneDate, end: milestoneDate, durationDays: 0 }
      earliestEnd.set(id, milestoneDate)
    } else {
      // TicketTask
      if (raw.timeMode === 'date' && raw.start && raw.end) {
        const start = parseDate(raw.start)
        const end = parseDate(raw.end)
        rt.computed = { start, end, durationDays: daysBetween(start, end) }
        earliestEnd.set(id, end)
      } else if (raw.timeMode === 'duration' && raw.duration != null) {
        const anchor = raw.start ? parseDate(raw.start) : null
        const start = prereqEnd
          ? (anchor && anchor > prereqEnd ? anchor : prereqEnd)
          : (anchor ?? new Date())
        const end = addDays(start, raw.duration)
        rt.computed = { start, end, durationDays: raw.duration }
        earliestEnd.set(id, end)
      } else {
        // Fallback: zero-duration at prereq end or epoch
        const start = prereqEnd ?? new Date()
        rt.computed = { start, end: start, durationDays: 0 }
        earliestEnd.set(id, start)
      }
    }
  }

  return conflicts
}
