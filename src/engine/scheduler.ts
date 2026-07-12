import type { Project, NodeId, RuntimeTask, RuntimeMilestone, ScheduleConflict } from '../types'

const MS = 86_400_000
const parseDate = (s: string) => new Date(s + 'T00:00:00Z')
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * MS)
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / MS)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const maxDate = (ds: Date[]) => new Date(Math.max(...ds.map(d => d.getTime())))

const DEFAULT_EPOCH = () => parseDate(new Date().toISOString().slice(0, 10))

/**
 * Hierarchical, top-down schedule.
 *
 * Each scope (top-level roots, or one container's children) is scheduled with a
 * `floor` — the earliest date anything in it may start. A container's floor is
 * derived from its own prerequisites and pushed DOWN to its children, so drilling
 * into a container shows its children starting at the container's real start (not
 * the project origin). A container's span is the envelope of its children.
 *
 * Tasks/containers can be `duration` (floating, flows from prereqs) or `date`
 * (fixed start/end). A date-fixed node whose prerequisites finish after its fixed
 * date is reported as a conflict.
 */
export function schedule(project: Project): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = []
  const rootMilestones = [...project.milestones.values()].filter(m => m.raw.parent === null)
  scheduleScope(project, project.roots, rootMilestones, null, conflicts)
  return conflicts
}

function scheduleScope(
  project: Project,
  tasks: RuntimeTask[],
  milestones: RuntimeMilestone[],
  floor: Date | null,
  conflicts: ScheduleConflict[],
): void {
  const ids = new Set<NodeId>([...tasks.map(t => t.raw.id), ...milestones.map(m => m.raw.id)])
  const nodeById = new Map<NodeId, RuntimeTask | RuntimeMilestone>()
  for (const t of tasks) nodeById.set(t.raw.id, t)
  for (const m of milestones) nodeById.set(m.raw.id, m)

  const prereqsOf = (id: NodeId) => (nodeById.get(id)?.raw.prerequisites ?? []).filter(p => ids.has(p))

  // Local topological order
  const inDeg = new Map<NodeId, number>()
  const adj = new Map<NodeId, NodeId[]>()
  for (const id of ids) { inDeg.set(id, 0); adj.set(id, []) }
  for (const id of ids) for (const p of prereqsOf(id)) { adj.get(p)!.push(id); inDeg.set(id, inDeg.get(id)! + 1) }
  const queue = [...inDeg].filter(([, d]) => d === 0).map(([id]) => id)
  const order: NodeId[] = []
  while (queue.length) {
    const c = queue.shift()!
    order.push(c)
    for (const n of adj.get(c)!) { const d = inDeg.get(n)! - 1; inDeg.set(n, d); if (d === 0) queue.push(n) }
  }
  for (const id of ids) if (!order.includes(id)) order.push(id)

  const endOf = new Map<NodeId, Date>()

  for (const id of order) {
    const node = nodeById.get(id)!
    // Lower bound = max(scope floor, prerequisite ends)
    const bounds: Date[] = []
    if (floor) bounds.push(floor)
    for (const p of prereqsOf(id)) { const e = endOf.get(p); if (e) bounds.push(e) }
    const earliest = bounds.length ? maxDate(bounds) : null

    if ('children' in node) {
      const raw = node.raw
      const anchor = raw.start ? parseDate(raw.start) : null

      if (raw.type === 'container') {
        // Floor pushed to children: fixed start if date-mode, else earliest, else anchor.
        const containerFloor = (raw.timeMode === 'date' && raw.start)
          ? parseDate(raw.start)
          : (earliest ?? anchor ?? DEFAULT_EPOCH())
        const childMs = [...project.milestones.values()].filter(m => m.raw.parent === raw.id)
        scheduleScope(project, node.children, childMs, containerFloor, conflicts)

        // Envelope of children
        let s: Date | null = null, e: Date | null = null
        for (const c of node.children) {
          if (!c.computed) continue
          if (!s || c.computed.start < s) s = c.computed.start
          if (!e || c.computed.end > e) e = c.computed.end
        }
        if (!s || !e) {
          s = containerFloor
          e = raw.timeMode === 'date' && raw.end ? parseDate(raw.end) : addDays(s, raw.duration ?? 7)
        }

        if (raw.timeMode === 'date' && raw.start && raw.end) {
          const fs = parseDate(raw.start), fe = parseDate(raw.end)
          if (e > fe) conflicts.push({ nodeId: id, nodeName: raw.name, fixedDate: iso(fe), requiredDate: iso(e), overflowDays: daysBetween(fe, e) })
          node.computed = { start: fs, end: fe, durationDays: daysBetween(fs, fe) }
          endOf.set(id, fe)
        } else {
          node.computed = { start: s, end: e, durationDays: daysBetween(s, e) }
          endOf.set(id, e)
        }
      } else {
        // Ticket
        if (raw.timeMode === 'date' && raw.start && raw.end) {
          const fs = parseDate(raw.start), fe = parseDate(raw.end)
          if (earliest && earliest > fs) conflicts.push({ nodeId: id, nodeName: raw.name, fixedDate: iso(fs), requiredDate: iso(earliest), overflowDays: daysBetween(fs, earliest) })
          node.computed = { start: fs, end: fe, durationDays: Math.max(0, daysBetween(fs, fe)) }
          endOf.set(id, fe)
        } else {
          const dur = raw.duration ?? 7
          const start = earliest ?? anchor ?? DEFAULT_EPOCH()
          const end = addDays(start, dur)
          node.computed = { start, end, durationDays: dur }
          endOf.set(id, end)
        }
      }
    } else {
      // Milestone (zero duration)
      const time = earliest ?? DEFAULT_EPOCH()
      node.computed = { start: time, end: time, durationDays: 0 }
      endOf.set(id, time)
    }
  }
}
