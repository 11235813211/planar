import './styles/main.css'
import type { Project } from './types'
import { parseGanttFile } from './data/loader'
import { serialize } from './data/serializer'
import { schedule } from './engine/scheduler'
import { GanttView } from './views/GanttView'
import { KanbanView } from './views/KanbanView'
import { openFile, saveFile, tryReopenLast, requestPermission } from './persistence/fsa'
import { loadHandle } from './persistence/idb'

// ─── App state ────────────────────────────────────────────────────────────────

let project: Project | null = null
let ganttView: GanttView | null = null
let currentView: 'gantt' | 'kanban' = 'gantt'

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const app = document.getElementById('app')!

function buildShell(): {
  toolbar: HTMLElement
  breadcrumb: HTMLElement
  canvasWrap: HTMLElement
  startup: HTMLElement
} {
  app.innerHTML = `
    <div id="toolbar">
      <span class="project-name" id="proj-name">Planar</span>
      <div class="view-toggle">
        <button class="btn active" id="btn-gantt">Gantt</button>
        <button class="btn" id="btn-kanban">Kanban</button>
      </div>
      <button class="btn" id="btn-open">Open</button>
      <button class="btn" id="btn-save">Save</button>
      <div id="zoom-controls" style="position:static;flex-direction:row">
        <button class="btn btn-icon" id="btn-zoom-out">−</button>
        <button class="btn btn-icon" id="btn-zoom-reset">⊙</button>
        <button class="btn btn-icon" id="btn-zoom-in">+</button>
      </div>
    </div>
    <div id="breadcrumb" style="display:none"></div>
    <div id="canvas-wrap" style="display:none"></div>
    <div id="startup">
      <h1>Planar</h1>
      <p>Hierarchical Gantt + Kanban planner</p>
      <div class="startup-actions">
        <button class="btn active" id="su-reopen" style="display:none">Reopen last project</button>
        <button class="btn" id="su-open">Open project…</button>
        <button class="btn" id="su-example">Load example</button>
      </div>
    </div>
  `

  return {
    toolbar: document.getElementById('toolbar')!,
    breadcrumb: document.getElementById('breadcrumb')!,
    canvasWrap: document.getElementById('canvas-wrap')!,
    startup: document.getElementById('startup')!,
  }
}

// ─── Load project into app ────────────────────────────────────────────────────

function loadProject(json: string, handle: FileSystemFileHandle | null) {
  project = parseGanttFile(json)
  project.fileHandle = handle
  const conflicts = schedule(project)
  if (conflicts.length) {
    console.warn('Schedule conflicts detected:', conflicts)
    // TODO: route to conflict popup in step 9
  }

  const startup = document.getElementById('startup')!
  startup.style.display = 'none'
  const canvasWrap = document.getElementById('canvas-wrap')!
  canvasWrap.style.display = 'flex'
  canvasWrap.style.flexDirection = 'column'

  const projName = document.getElementById('proj-name')!
  projName.textContent = project.meta.name

  showView(currentView)
}

function showView(view: 'gantt' | 'kanban') {
  if (!project) return
  currentView = view
  const canvasWrap = document.getElementById('canvas-wrap')!

  document.getElementById('btn-gantt')!.classList.toggle('active', view === 'gantt')
  document.getElementById('btn-kanban')!.classList.toggle('active', view === 'kanban')

  const zoomControls = document.getElementById('zoom-controls')!
  zoomControls.style.display = view === 'gantt' ? 'flex' : 'none'

  if (view === 'gantt') {
    ganttView = new GanttView(canvasWrap, project)
  } else {
    ganttView = null
    new KanbanView(canvasWrap, project)
  }
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

document.addEventListener('planar:breadcrumb', (e) => {
  const crumbs = (e as CustomEvent).detail as Array<{ label: string; depth: number }>
  const bc = document.getElementById('breadcrumb')!
  bc.style.display = crumbs.length > 1 ? 'flex' : 'none'
  bc.innerHTML = crumbs.map((c, i) =>
    i < crumbs.length - 1
      ? `<span data-depth="${c.depth}">${c.label}</span> <span style="color:#ccc">/</span>`
      : `<span>${c.label}</span>`
  ).join(' ')

  bc.querySelectorAll('span[data-depth]').forEach(el => {
    el.addEventListener('click', () => {
      const depth = Number((el as HTMLElement).dataset.depth)
      ganttView?.drillTo(depth)
    })
  })
})

// ─── Wire up buttons ──────────────────────────────────────────────────────────

async function init() {
  buildShell()

  // Check for last handle in IndexedDB
  const lastHandle = await loadHandle()
  if (lastHandle) {
    const suReopen = document.getElementById('su-reopen')!
    suReopen.style.display = 'inline-flex'

    suReopen.addEventListener('click', async () => {
      // This is a user gesture — safe to request permission
      const granted = await requestPermission(lastHandle)
      if (granted) {
        const json = await tryReopenLast(lastHandle)
        if (json) loadProject(json, lastHandle)
      }
    })

    // Try to auto-reopen silently if already granted
    const json = await tryReopenLast(lastHandle)
    if (json) {
      loadProject(json, lastHandle)
      return
    }
  }

  document.getElementById('su-open')!.addEventListener('click', async () => {
    const { json, handle } = await openFile()
    loadProject(json, handle)
  })

  document.getElementById('su-example')!.addEventListener('click', async () => {
    const resp = await fetch(`${import.meta.env.BASE_URL}example.gantt.json`)
    const json = await resp.text()
    loadProject(json, null)
  })

  document.getElementById('btn-open')!.addEventListener('click', async () => {
    const { json, handle } = await openFile()
    loadProject(json, handle)
  })

  document.getElementById('btn-save')!.addEventListener('click', async () => {
    if (!project) return
    const json = serialize(project)
    const newHandle = await saveFile(json, project.fileHandle)
    if (newHandle) project.fileHandle = newHandle
    project.dirty = false
  })

  document.getElementById('btn-gantt')!.addEventListener('click', () => showView('gantt'))
  document.getElementById('btn-kanban')!.addEventListener('click', () => showView('kanban'))

  document.getElementById('btn-zoom-in')!.addEventListener('click', () => ganttView?.zoomIn())
  document.getElementById('btn-zoom-out')!.addEventListener('click', () => ganttView?.zoomOut())
  document.getElementById('btn-zoom-reset')!.addEventListener('click', () => ganttView?.zoomReset())
}

init().catch(console.error)
