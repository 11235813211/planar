// IndexedDB store for file handles and recent project list

const DB_NAME = 'planar'
const DB_VERSION = 1
const STORE_HANDLES = 'handles'
const KEY_LAST = 'last'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_HANDLES)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readwrite')
    tx.objectStore(STORE_HANDLES).put(handle, KEY_LAST)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadHandle(): Promise<FileSystemFileHandle | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readonly')
    const req = tx.objectStore(STORE_HANDLES).get(KEY_LAST)
    req.onsuccess = () => resolve((req.result as FileSystemFileHandle) ?? null)
    req.onerror = () => reject(req.error)
  })
}
