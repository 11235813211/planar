import './styles/main.css'
import type { Project } from './types'
import { parseGanttFile, createBlankProject } from './data/loader'
import { serialize } from './data/serializer'
import { schedule } from './engine/scheduler'
import { GanttView } from './views/GanttView'
import { KanbanView } from './views/KanbanView'
import { FormatBar } from './views/FormatBar'
import { openFile, saveFile, tryReopenLast, requestPermission } from './persistence/fsa'
import { loadHandle } from './persistence/idb'

// ─── App state ────────────────────────────────────────────────────────────────

let project: Project | null = null
let ganttView: GanttView | null = null
let currentView: 'gantt' | 'kanban' = 'gantt'
let formatBar: FormatBar | null = null

// ─── Build shell ──────────────────────────────────────────────────────────────

function buildShell() {
  document.getElementById('app')!.innerHTML = `
    <div id="toolbar">
      <span class="project-name" id="proj-name">Planar</span>
      <div class="view-toggle">
        <button class="btn active" id="btn-gantt">Gantt</button>
        <button class="btn" id="btn-kanban">Kanban</button>
      </div>
      <button class="btn" id="btn-add-task" style="display:none">+ Add Task</button>
      <div style="flex:1"></div>
      <button class="btn" id="btn-new">New</button>
      <button class="btn" id="btn-open">Open</button>
      <button class="btn" id="btn-save">Save</button>
      <div id="zoom-wrap" style="display:flex;gap:4px">
        <button class="btn btn-icon" id="btn-zoom-out">−</button>
        <button class="btn btn-icon" id="btn-zoom-reset" title="Reset zoom">⊙</button>
        <button class="btn btn-icon" id="btn-zoom-in">+</button>
      </div>
    </div>
    <div id="format-bar-wrap"></div>
    <div id="breadcrumb" style="display:none"></div>
    <div id="canvas-wrap" style="display:none;flex:1;overflow:hidden;position:relative"></div>
    <div id="startup">
      <h1>Planar</h1>
      <p>Hierarchical Gantt + Kanban planner</p>
      <div class="startup-actions">
        <button class="btn active" id="su-reopen" style="display:none">Reopen last project</button>
        <button class="btn active" id="su-new">New project</button>
        <button class="btn" id="su-open">Open project…</button>
        <button class="btn" id="su-example">Load example</button>
      </div>
    </div>
  `

  formatBar = new FormatBar(document.getElementById('format-bar-wrap')!)
}

// ─── Load project ─────────────────────────────────────────────────────────────

function loadProject(p: Project) {
  project = p
  const conflicts = schedule(project)
  if (conflicts.length) console.warn('Schedule conflicts:', conflicts)

  document.getElementById('startup')!.style.display = 'none'
  const canvasWrap = document.getElementById('canvas-wrap')!
  canvasWrap.style.display = 'block'
  document.getElementById('proj-name')!.textContent = project.meta.name
  showView(currentView)
}

function showView(view: 'gantt' | 'kanban') {
  if (!project || !formatBar) return
  currentView = view
  const canvasWrap = document.getElementById('canvas-wrap')!

  document.getElementById('btn-gantt')!.classList.toggle('active', view === 'gantt')
  document.getElementById('btn-kanban')!.classList.toggle('active', view === 'kanban')
  document.getElementById('zoom-wrap')!.style.display = view === 'gantt' ? 'flex' : 'none'
  document.getElementById('btn-add-task')!.style.display = view === 'gantt' ? 'inline-flex' : 'none'

  canvasWrap.innerHTML = ''

  if (view === 'gantt') {
    ganttView = new GanttView(canvasWrap, project, formatBar)
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
      ? `<span data-depth="${c.depth}">${c.label}</span><span style="color:#ccc;margin:0 4px">/</span>`
      : `<span>${c.label}</span>`
  ).join('')
  bc.querySelectorAll<HTMLElement>('span[data-depth]').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', () => ganttView?.drillTo(Number(el.dataset.depth)))
  })
})

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  buildShell()

  // Try to silently reopen last file
  const lastHandle = await loadHandle()
  if (lastHandle) {
    const json = await tryReopenLast(lastHandle)
    if (json) {
      const p = parseGanttFile(json)
      p.fileHandle = lastHandle
      loadProject(p)
      return
    }
    // Permission not yet granted — show reopen button
    const suReopen = document.getElementById('su-reopen')!
    suReopen.style.display = 'inline-flex'
    suReopen.addEventListener('click', async () => {
      const granted = await requestPermission(lastHandle)
      if (!granted) return
      const json2 = await tryReopenLast(lastHandle)
      if (json2) { const p = parseGanttFile(json2); p.fileHandle = lastHandle; loadProject(p) }
    })
  }

  // Startup buttons
  document.getElementById('su-new')!.addEventListener('click', () => {
    loadProject(createBlankProject())
  })

  document.getElementById('su-open')!.addEventListener('click', async () => {
    const { json, handle } = await openFile()
    const p = parseGanttFile(json)
    p.fileHandle = handle
    loadProject(p)
  })

  document.getElementById('su-example')!.addEventListener('click', async () => {
    const resp = await fetch(`${import.meta.env.BASE_URL}example.gantt.json`, { cache: 'no-cache' })
    const json = await resp.text()
    loadProject(parseGanttFile(json))
  })

  // Toolbar buttons
  document.getElementById('btn-new')!.addEventListener('click', () => {
    if (project?.dirty) {
      if (!confirm('You have unsaved changes. Start a new project anyway?')) return
    }
    loadProject(createBlankProject())
  })

  document.getElementById('btn-open')!.addEventListener('click', async () => {
    const { json, handle } = await openFile()
    const p = parseGanttFile(json)
    p.fileHandle = handle
    loadProject(p)
  })

  document.getElementById('btn-save')!.addEventListener('click', async () => {
    if (!project) return
    const json = serialize(project)
    const handle = await saveFile(json, project.fileHandle)
    if (handle) project.fileHandle = handle
    project.dirty = false
  })

  document.getElementById('btn-gantt')!.addEventListener('click', () => showView('gantt'))
  document.getElementById('btn-kanban')!.addEventListener('click', () => showView('kanban'))

  document.getElementById('btn-add-task')!.addEventListener('click', () => {
    ganttView?.addTaskToCurrentSection()
  })

  document.getElementById('btn-zoom-in')!.addEventListener('click', ()    => ganttView?.zoomIn())
  document.getElementById('btn-zoom-out')!.addEventListener('click', ()   => ganttView?.zoomOut())
  document.getElementById('btn-zoom-reset')!.addEventListener('click', () => ganttView?.zoomReset())
}

init().catch(console.error)
