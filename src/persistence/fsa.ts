import { saveHandle } from './idb'

const HAS_FSA = typeof window !== 'undefined' && 'showOpenFilePicker' in window

export async function openFile(): Promise<{ json: string; handle: FileSystemFileHandle | null }> {
  if (HAS_FSA) {
    const [handle] = await (window as any).showOpenFilePicker({
      types: [{ description: 'Gantt JSON', accept: { 'application/json': ['.gantt.json', '.json'] } }],
    }) as FileSystemFileHandle[]
    const file = await handle.getFile()
    const json = await file.text()
    await saveHandle(handle)
    return { json, handle }
  }

  // Fallback: <input type="file">
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.gantt.json,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) { reject(new Error('No file selected')); return }
      const json = await file.text()
      resolve({ json, handle: null })
    }
    input.click()
  })
}

export async function saveFile(json: string, handle: FileSystemFileHandle | null): Promise<FileSystemFileHandle | null> {
  if (handle && HAS_FSA) {
    const writable = await handle.createWritable()
    await writable.write(json)
    await writable.close()
    return handle
  }

  if (HAS_FSA) {
    const newHandle = await (window as any).showSaveFilePicker({
      suggestedName: 'project.gantt.json',
      types: [{ description: 'Gantt JSON', accept: { 'application/json': ['.gantt.json'] } }],
    }) as FileSystemFileHandle
    const writable = await newHandle.createWritable()
    await writable.write(json)
    await writable.close()
    await saveHandle(newHandle)
    return newHandle
  }

  // Fallback: blob download
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'project.gantt.json'
  a.click()
  URL.revokeObjectURL(url)
  return null
}

export async function tryReopenLast(handle: FileSystemFileHandle): Promise<string | null> {
  if (!HAS_FSA) return null
  const perm = await (handle as any).queryPermission({ mode: 'readwrite' })
  if (perm === 'granted') {
    const file = await handle.getFile()
    return file.text()
  }
  return null
}

export async function requestPermission(handle: FileSystemFileHandle): Promise<boolean> {
  if (!HAS_FSA) return false
  const perm = await (handle as any).requestPermission({ mode: 'readwrite' })
  return perm === 'granted'
}

export { HAS_FSA }
