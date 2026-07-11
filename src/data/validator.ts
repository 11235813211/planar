import type { AnyTask, NodeId } from '../types'

export class ValidationError extends Error {}

export function validate(tasks: AnyTask[]): void {
  const ids = new Set<NodeId>()

  // duplicate ids
  for (const t of tasks) {
    if (ids.has(t.id)) throw new ValidationError(`Duplicate id: ${t.id}`)
    ids.add(t.id)
  }

  // dangling references
  for (const t of tasks) {
    if (t.parent !== null && !ids.has(t.parent))
      throw new ValidationError(`Task ${t.id} has dangling parent ${t.parent}`)
    for (const p of t.prerequisites)
      if (!ids.has(p))
        throw new ValidationError(`Task ${t.id} has dangling prerequisite ${p}`)
    if (t.type === 'task') {
      for (const a of t.assignees)
        if (!a.startsWith('p_'))
          throw new ValidationError(`Task ${t.id} has invalid assignee ${a}`)
    }
  }

  // prerequisite cycles (Kahn's algorithm)
  const inDegree = new Map<NodeId, number>()
  const adj = new Map<NodeId, NodeId[]>()
  for (const t of tasks) {
    if (!inDegree.has(t.id)) inDegree.set(t.id, 0)
    adj.set(t.id, [])
  }
  for (const t of tasks) {
    for (const p of t.prerequisites) {
      adj.get(p)!.push(t.id)
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1)
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
  if (visited !== tasks.length)
    throw new ValidationError('Prerequisite graph contains a cycle')
}
