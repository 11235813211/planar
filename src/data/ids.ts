const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'

function rand(len: number): string {
  let s = ''
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  for (const b of arr) s += chars[b % chars.length]
  return s
}

export const newTaskId     = () => `t_${rand(8)}` as string
export const newMilestone  = () => `m_${rand(8)}` as string
export const newPersonId   = () => `p_${rand(8)}` as string
export const newColumnId   = () => `c_${rand(8)}` as string
