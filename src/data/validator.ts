import type { AnyTask, Milestone, NodeId } from '../types'

export class ValidationError extends Error {}

export function validate(tasks: AnyTask[], milestones: Milestone[] = []): void {
  const ids = new Set<NodeId>()

  // duplicate ids (tasks + milestones share the NodeId space)
  for (const t of tasks) {
    if (ids.has(t.id)) throw new ValidationError(`Duplicate id: ${t.id}`)
    ids.add(t.id)
  }
  for (const m of milestones) {
    if (ids.has(m.id)) throw new ValidationError(`Duplicate id: ${m.id}`)
    ids.add(m.id)
  }

  // dangling references
  for (const t of tasks) {
    if (t.parent !== null && !ids.has(t.parent))
      throw new ValidationError(`Task ${t.id} has dangling parent ${t.parent}`)
    for (const p of t.prerequisites)
      if (!ids.has(p))
        throw new ValidationError(`Task ${t.id} has dangling prerequisite ${p}`)
    if (t.type === 'ticket') {
      for (const a of t.assignees)
        if (!a.startsWith('p_'))
          throw new ValidationError(`Task ${t.id} has invalid assignee ${a}`)
    }
  }
  for (const m of milestones) {
    if (m.parent !== null && !ids.has(m.parent))
      throw new ValidationError(`Milestone ${m.id} has dangling parent ${m.parent}`)
    if (m.ownerId !== null && !ids.has(m.ownerId))
      throw new ValidationError(`Milestone ${m.id} has dangling owner ${m.ownerId}`)
    for (const p of m.prerequisites)
      if (!ids.has(p))
        throw new ValidationError(`Milestone ${m.id} has dangling prerequisite ${p}`)
  }

  // prerequisite cycles (Kahn's algorithm) over tasks + milestones
  const inDegree = new Map<NodeId, number>()
  const adj = new Map<NodeId, NodeId[]>()
  const register = (id: NodeId) => { if (!inDegree.has(id)) inDegree.set(id, 0); if (!adj.has(id)) adj.set(id, []) }
  const prereqs: Array<{ id: NodeId; pres: NodeId[] }> = [
    ...tasks.map(t => ({ id: t.id, pres: t.prerequisites })),
    ...milestones.map(m => ({ id: m.id, pres: m.prerequisites })),
  ]
  for (const { id } of prereqs) register(id)
  for (const { id, pres } of prereqs) {
    for (const p of pres) {
      register(p)
      adj.get(p)!.push(id)
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1)
    }
  }
  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  let visited = 0
  while (queue.length) {
    const cur = queue.shift()!
    visited++
    for (const next of adj.get(cur) ?? []) {
      const d = inDegree.get(next)! - 1
      inDegree.set(next, d)
      if (d === 0) queue.push(next)
    }
  }
  if (visited !== inDegree.size)
    throw new ValidationError('Prerequisite graph contains a cycle')
}
