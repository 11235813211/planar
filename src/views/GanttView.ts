import type { Project, NodeId, TaskId, LayoutNode, RuntimeTask, Milestone } from '../types'
import { buildLayout, PX_PER_DAY, PANEL_V_PAD, SECTION_PAD } from '../engine/layout'
import type { LayoutResult } from '../engine/layout'
import { renderTaskBlock } from '../render/TaskBlock'
import { renderMilestone } from '../render/MilestoneFlag'
import { renderConnectors } from '../render/Connector'
import { openDetailModal } from './DetailModal'
import { FormatBar } from './FormatBar'
import { schedule } from '../engine/scheduler'
import { newTaskId, newMilestoneId } from '../data/ids'
import { openAddTaskModal } from './AddTaskModal'
import type { NewTaskData } from './AddTaskModal'

const SVGNS = 'http://www.w3.org/2000/svg'
const MS = 86_400_000
const DATE_BAR_BASE = 50

function el<K extends keyof SVGElementTagNameMap>(t: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVGNS, t)
}

// ─── Adaptive date axis ───────────────────────────────────────────────────────

type Gran = { coarse: 'year' | 'month'; fine: 'quarter' | 'month' | 'week' | 'day' }
function granularity(ppd: number): Gran {
  if (ppd >= 22) return { coarse: 'month', fine: 'day' }
  if (ppd >= 6)  return { coarse: 'month', fine: 'week' }
  if (ppd >= 1.2) return { coarse: 'year', fine: 'month' }
  return { coarse: 'year', fine: 'quarter' }
}
function advance(d: Date, u: Gran['fine'] | Gran['coarse']): Date {
  const o = new Date(d)
  if (u === 'day') o.setUTCDate(o.getUTCDate() + 1)
  else if (u === 'week') o.setUTCDate(o.getUTCDate() + 7)
  else if (u === 'month') { o.setUTCMonth(o.getUTCMonth() + 1); o.setUTCDate(1) }
  else if (u === 'quarter') { o.setUTCMonth(Math.floor(o.getUTCMonth() / 3) * 3 + 3); o.setUTCDate(1) }
  else { o.setUTCFullYear(o.getUTCFullYear() + 1); o.setUTCMonth(0); o.setUTCDate(1) }
  return o
}
function snap(d: Date, u: Gran['fine'] | Gran['coarse']): Date {
  const o = new Date(d)
  if (u === 'week') o.setUTCDate(o.getUTCDate() - o.getUTCDay())
  else if (u === 'month') o.setUTCDate(1)
  else if (u === 'quarter') { o.setUTCMonth(Math.floor(o.getUTCMonth() / 3) * 3); o.setUTCDate(1) }
  else if (u === 'year') { o.setUTCMonth(0); o.setUTCDate(1) }
  return o
}
function fineLabel(d: Date, u: Gran['fine']): string {
  if (u === 'day') return String(d.getUTCDate())
  if (u === 'week') return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
  if (u === 'month') return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1}`
}
function coarseLabel(d: Date, u: Gran['coarse']): string {
  return u === 'month'
    ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : String(d.getUTCFullYear())
}

// ─── Inline edit ──────────────────────────────────────────────────────────────

function startInlineEdit(labelEl: SVGTextElement, rt: RuntimeTask, project: Project, onCommit: () => void) {
  document.getElementById('inline-title-input')?.remove()
  const r = labelEl.getBoundingClientRect()
  const input = document.createElement('input')
  input.id = 'inline-title-input'
  input.value = rt.raw.name
  input.style.cssText = [
    'position:fixed', `left:${r.left - 4}px`, `top:${r.top - 4}px`,
    `width:${Math.max(r.width + 20, 120)}px`, 'height:22px',
    'font:12px system-ui,sans-serif', 'border:2px solid #2563eb', 'border-radius:4px',
    'padding:0 4px', 'outline:none', 'z-index:300', 'background:#fff', 'color:#111',
  ].join(';')
  labelEl.style.display = 'none'
  const commit = () => {
    const v = input.value.trim()
    if (v) { rt.raw.name = v; project.dirty = true }
    input.remove(); labelEl.style.display = ''; onCommit()
  }
  const cancel = () => { input.remove(); labelEl.style.display = '' }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') cancel()
    e.stopPropagation()
  })
  input.addEventListener('blur', commit)
  document.body.appendChild(input)
  input.focus(); input.select()
}

const orderAfter = (o: string) => o + 'm'

// ─── GanttView ────────────────────────────────────────────────────────────────

export class GanttView {
  private container: HTMLElement
  private svg: SVGSVGElement
  private axisG: SVGGElement
  private contentG: SVGGElement
  private clipRect: SVGRectElement
  private panelBars: HTMLElement

  private project: Project
  private formatBar: FormatBar
  private drillStack: Array<{ id: TaskId | null; label: string }> = []
  private drillId: TaskId | null = null
  private selectedId: NodeId | null = null
  private pxPerDay = PX_PER_DAY
  private panX = 20
  private panY = 20
  private chromeScale = 1
  private isPanning = false
  private last = { x: 0, y: 0 }
  private pendingEditId: TaskId | null = null
  private pickPrereqFor: NodeId | null = null
  private currentSectionStart: Date | null = null
  private ro: ResizeObserver

  constructor(container: HTMLElement, project: Project, formatBar: FormatBar) {
    this.container = container
    this.project = project
    this.formatBar = formatBar
    this.formatBar.bind(project, () => this.render())

    container.innerHTML = ''
    container.classList.add('gantt-root')

    this.svg = el('svg')
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;user-select:none;'
    container.appendChild(this.svg)

    const defs = el('defs')
    const clip = el('clipPath'); clip.setAttribute('id', 'content-clip')
    this.clipRect = el('rect')
    clip.appendChild(this.clipRect); defs.appendChild(clip)
    this.svg.appendChild(defs)

    this.contentG = el('g'); this.contentG.setAttribute('clip-path', 'url(#content-clip)')
    this.axisG = el('g')
    this.svg.appendChild(this.contentG)
    this.svg.appendChild(this.axisG)

    this.panelBars = document.createElement('div')
    this.panelBars.className = 'panel-bars'
    container.appendChild(this.panelBars)

    this.drillStack = [{ id: null, label: project.meta.name }]
    this.bindEvents()
    this.ro = new ResizeObserver(() => this.render())
    this.ro.observe(container)
    this.render()
  }

  dispose() { this.ro.disconnect(); document.removeEventListener('keydown', this.onKeyDown) }

  private get dateBarH() { return DATE_BAR_BASE * this.chromeScale }
  private get W() { return this.container.clientWidth }
  private get H() { return this.container.clientHeight }

  // ─── Render ─────────────────────────────────────────────────────────────────

  render() {
    const W = this.W, H = this.H
    this.svg.setAttribute('width', String(W))
    this.svg.setAttribute('height', String(H))
    this.clipRect.setAttribute('x', '0'); this.clipRect.setAttribute('y', String(this.dateBarH))
    this.clipRect.setAttribute('width', String(W)); this.clipRect.setAttribute('height', String(Math.max(0, H - this.dateBarH)))

    this.contentG.innerHTML = ''
    this.axisG.innerHTML = ''
    this.panelBars.innerHTML = ''

    const layout = buildLayout(this.project, this.drillId, this.pxPerDay)
    this.currentSectionStart = layout.sectionStart

    // Background (click to deselect / cancel pick)
    const bg = el('rect')
    bg.setAttribute('x', '0'); bg.setAttribute('y', '0')
    bg.setAttribute('width', String(Math.max(W, layout.width + 400)))
    bg.setAttribute('height', String(Math.max(H, layout.height + 400)))
    bg.setAttribute('fill', 'transparent')
    bg.addEventListener('click', () => {
      if (this.pickPrereqFor) { this.pickPrereqFor = null; this.render(); return }
      this.select(null)
    })
    this.contentG.appendChild(bg)

    for (const panel of layout.panels) this.renderPanel(panel)

    if (layout.sectionStart) this.renderAxis(layout.sectionStart)
    this.renderPanelBars(layout)
    this.applyTransform()

    if (this.pendingEditId) {
      const lbl = this.svg.querySelector<SVGTextElement>(`.task-name-label[data-id="${this.pendingEditId}"]`)
      const rt = this.project.tasks.get(this.pendingEditId)
      if (lbl && rt) startInlineEdit(lbl, rt, this.project, () => this.render())
      this.pendingEditId = null
    }
  }

  private renderPanel(panel: LayoutResult['panels'][number]) {
    const g = el('g')
    g.setAttribute('transform', `translate(0, ${panel.yOffset})`)

    // Panel band background
    const band = el('rect')
    band.setAttribute('x', String(-2000)); band.setAttribute('y', '0')
    band.setAttribute('width', String(panel.width + 4000)); band.setAttribute('height', String(panel.height))
    band.setAttribute('fill', panel.color); band.setAttribute('opacity', '0.04')
    g.appendChild(band)

    const nodeMap = new Map<string, LayoutNode>(panel.nodes.map(n => [n.id, n]))
    for (const p of renderConnectors(panel.connectors, nodeMap)) g.appendChild(p)

    for (const node of panel.nodes) {
      if (node.kind === 'milestone') {
        const name = this.milestoneName(node.id)
        const canAddPrereq = !node.id.startsWith('__start_')
        const flag = renderMilestone(
          node, name, panel.color, panel.height - PANEL_V_PAD,
          canAddPrereq ? () => this.beginPickPrereq(node.id) : undefined,
        )
        if (this.pickPrereqFor === node.id) flag.classList.add('pick-target')
        g.appendChild(flag)
      } else {
        const block = renderTaskBlock(node, this.project, this.selectedId === node.id, {
          onSelect: () => { if (this.pickPrereqFor) this.completePickPrereq(node.id); else this.select(node.id) },
          onOpen: () => {
            const rt = this.project.tasks.get(node.id)!
            if (rt.raw.type === 'container') this.drillInto(node.id, rt.raw.name)
            else openDetailModal(rt, this.project, () => { schedule(this.project); this.render() })
          },
          onLabelClick: (lbl) => startInlineEdit(lbl, this.project.tasks.get(node.id)!, this.project, () => { schedule(this.project); this.render() }),
          onAddRight: () => this.promptAddTask(node.id, 'after'),
          onAddLeft: () => this.promptAddTask(node.id, 'before'),
        })
        if (this.pickPrereqFor && this.pickPrereqFor !== node.id) block.classList.add('pick-candidate')
        g.appendChild(block)
      }
    }
    this.contentG.appendChild(g)
  }

  private milestoneName(id: NodeId): string {
    const real = this.project.milestones.get(id)
    if (real) return real.raw.name
    if (id.startsWith('__end_')) {
      const c = this.project.tasks.get(id.slice('__end_'.length))
      return c?.raw.name ?? 'Milestone'
    }
    return 'Start'
  }

  private renderAxis(sectionStart: Date) {
    const g = this.axisG
    const H = this.dateBarH
    const coarseH = H * 0.42
    const startMs = sectionStart.getTime()
    const xOf = (d: Date) => SECTION_PAD + ((d.getTime() - startMs) / MS) * this.pxPerDay
    const gr = granularity(this.pxPerDay)

    // Axis group is translated by panX only. To cover the viewport [0, W] in
    // screen space we draw from local x = -panX-200 across W+400.
    const localX0 = -this.panX - 200
    const spanW = this.W + 400
    const bg = el('rect')
    bg.setAttribute('x', String(localX0)); bg.setAttribute('y', '0')
    bg.setAttribute('width', String(spanW)); bg.setAttribute('height', String(H))
    bg.setAttribute('fill', '#f8fafc')
    g.appendChild(bg)
    for (const yy of [coarseH, H]) {
      const ln = el('line')
      ln.setAttribute('x1', String(localX0)); ln.setAttribute('y1', String(yy))
      ln.setAttribute('x2', String(localX0 + spanW)); ln.setAttribute('y2', String(yy))
      ln.setAttribute('stroke', '#e2e8f0'); g.appendChild(ln)
    }

    const visDaysLeft = (-this.panX - SECTION_PAD) / this.pxPerDay - 40
    const visDaysRight = (this.W - this.panX - SECTION_PAD) / this.pxPerDay + 40
    const leftDate = new Date(startMs + visDaysLeft * MS)
    const rightDate = new Date(startMs + visDaysRight * MS)

    // Coarse row
    let d = snap(leftDate, gr.coarse)
    while (d <= rightDate) {
      const x = xOf(d), next = advance(d, gr.coarse)
      const sep = el('line')
      sep.setAttribute('x1', String(x)); sep.setAttribute('y1', '0')
      sep.setAttribute('x2', String(x)); sep.setAttribute('y2', String(coarseH))
      sep.setAttribute('stroke', '#cbd5e1'); g.appendChild(sep)
      const lbl = el('text')
      lbl.setAttribute('x', String(x + 6)); lbl.setAttribute('y', String(coarseH / 2 + 4))
      lbl.setAttribute('fill', '#475569'); lbl.setAttribute('font-size', String(11 * this.chromeScale))
      lbl.setAttribute('font-weight', '600'); lbl.textContent = coarseLabel(d, gr.coarse)
      g.appendChild(lbl)
      d = next
    }
    // Fine row
    d = snap(leftDate, gr.fine)
    while (d <= rightDate) {
      const x = xOf(d), next = advance(d, gr.fine)
      const bandW = xOf(next) - x
      const sep = el('line')
      sep.setAttribute('x1', String(x)); sep.setAttribute('y1', String(coarseH))
      sep.setAttribute('x2', String(x)); sep.setAttribute('y2', String(H))
      sep.setAttribute('stroke', '#eef2f6'); g.appendChild(sep)
      if (bandW > 16) {
        const lbl = el('text')
        lbl.setAttribute('x', String(x + 4)); lbl.setAttribute('y', String(coarseH + (H - coarseH) / 2 + 4))
        lbl.setAttribute('fill', '#64748b'); lbl.setAttribute('font-size', String(10 * this.chromeScale))
        lbl.textContent = fineLabel(d, gr.fine)
        g.appendChild(lbl)
      }
      d = next
    }
  }

  private renderPanelBars(layout: LayoutResult) {
    const inner = document.createElement('div')
    inner.className = 'panel-bars-inner'
    inner.style.transform = `translateY(${this.panY}px)`
    this.panelBars.style.top = `${this.dateBarH}px`

    const reorderable = this.drillId === null && layout.panels.length > 1
    layout.panels.forEach((panel) => {
      const bar = document.createElement('div')
      bar.className = 'panel-bar'
      bar.style.top = `${panel.yOffset}px`
      bar.style.height = `${panel.height}px`
      bar.style.background = panel.color
      bar.innerHTML = `<span class="panel-bar-name">${panel.name}</span>`

      if (reorderable) {
        const ctrl = document.createElement('div')
        ctrl.className = 'panel-bar-ctrl'
        ctrl.innerHTML = `
          <button title="Move up" data-act="up">▲</button>
          <button title="Colour"  data-act="color"><input type="color" value="${panel.color}" /></button>
          <button title="Move down" data-act="down">▼</button>`
        ctrl.querySelector('[data-act="up"]')!.addEventListener('click', (e) => { e.stopPropagation(); this.reorderPanel(panel.panelId, -1) })
        ctrl.querySelector('[data-act="down"]')!.addEventListener('click', (e) => { e.stopPropagation(); this.reorderPanel(panel.panelId, +1) })
        const colorInput = ctrl.querySelector<HTMLInputElement>('input[type=color]')!
        colorInput.addEventListener('input', () => this.recolorPanel(panel.panelId, colorInput.value))
        bar.appendChild(ctrl)
      }
      inner.appendChild(bar)
    })

    // "+ add panel" button at the very bottom (top level only)
    if (this.drillId === null) {
      const add = document.createElement('button')
      add.className = 'panel-add-btn'
      add.textContent = '+'
      add.title = 'Add panel below'
      add.style.top = `${layout.height + 8}px`
      add.addEventListener('click', () => this.addPanel())
      inner.appendChild(add)
    }

    this.panelBars.appendChild(inner)
  }

  // ─── Transform / pan / zoom ───────────────────────────────────────────────────

  private applyTransform() {
    this.axisG.setAttribute('transform', `translate(${this.panX}, 0)`)
    this.contentG.setAttribute('transform', `translate(${this.panX}, ${this.dateBarH + this.panY})`)
    const inner = this.panelBars.querySelector<HTMLElement>('.panel-bars-inner')
    if (inner) inner.style.transform = `translateY(${this.panY}px)`
  }

  /** Lightweight pan: shift transforms and redraw only the axis (labels recycle). */
  private lightPan() {
    this.applyTransform()
    this.axisG.innerHTML = ''
    if (this.currentSectionStart) this.renderAxis(this.currentSectionStart)
  }

  private bindEvents() {
    const c = this.container
    c.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('.task-block, .milestone-flag, .add-btn')) return
      if (this.pickPrereqFor) return
      this.isPanning = true; this.last = { x: e.clientX, y: e.clientY }
      c.classList.add('panning'); c.setPointerCapture(e.pointerId)
    })
    c.addEventListener('pointermove', (e) => {
      if (!this.isPanning) return
      this.panX += e.clientX - this.last.x
      this.panY += e.clientY - this.last.y
      this.last = { x: e.clientX, y: e.clientY }
      this.lightPan()
    })
    const end = () => { this.isPanning = false; c.classList.remove('panning') }
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)

    c.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (e.shiftKey) {
        // Smooth time zoom around cursor (gentle)
        const rect = this.svg.getBoundingClientRect()
        const cursorX = e.clientX - rect.left
        const cxOld = cursorX - this.panX
        const factor = Math.exp(-e.deltaY * 0.0016)
        const next = Math.max(1.2, Math.min(60, this.pxPerDay * factor))
        const ratio = next / this.pxPerDay
        const cxNew = SECTION_PAD + (cxOld - SECTION_PAD) * ratio
        this.panX = cursorX - cxNew
        this.pxPerDay = next
        this.render()
      } else {
        this.panX -= e.deltaX
        this.panY -= e.deltaY
        this.lightPan()
      }
    }, { passive: false })

    document.addEventListener('keydown', this.onKeyDown)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (this.pickPrereqFor) { this.pickPrereqFor = null; this.render() }
      else if (this.selectedId) this.select(null)
    }
    // Cmd/Ctrl +/- → chrome density (date bar + menu bar)
    if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_')) {
      e.preventDefault()
      const dir = (e.key === '-' || e.key === '_') ? -1 : 1
      this.chromeScale = Math.max(0.7, Math.min(1.6, this.chromeScale + dir * 0.1))
      document.documentElement.style.setProperty('--chrome-scale', String(this.chromeScale))
      this.render()
    }
  }

  // ─── Selection / drill ────────────────────────────────────────────────────────

  private select(id: NodeId | null) {
    this.selectedId = id
    const rt = id ? this.project.tasks.get(id) ?? null : null
    this.formatBar.selectTask(rt)
    this.render()
  }

  private drillInto(id: TaskId, label: string) {
    this.drillStack.push({ id, label })
    this.drillId = id
    this.panX = 20; this.panY = 20; this.selectedId = null
    this.formatBar.selectTask(null)
    this.render(); this.emitBreadcrumb()
  }

  drillTo(depth: number) {
    this.drillStack = this.drillStack.slice(0, depth + 1)
    this.drillId = this.drillStack[this.drillStack.length - 1].id
    this.panX = 20; this.panY = 20; this.selectedId = null
    this.formatBar.selectTask(null)
    this.render(); this.emitBreadcrumb()
  }

  private emitBreadcrumb() {
    document.dispatchEvent(new CustomEvent('planar:breadcrumb', {
      detail: this.drillStack.map((e, i) => ({ label: e.label, depth: i })),
    }))
  }

  // ─── Add task (from + buttons) ────────────────────────────────────────────────

  private promptAddTask(adjacentId: TaskId, dir: 'after' | 'before') {
    openAddTaskModal(
      (data) => this.createTask(data, dir === 'after' ? adjacentId : null, dir === 'before' ? adjacentId : null),
      () => {},
    )
  }

  private siblingsOf(taskId: TaskId | null): RuntimeTask[] {
    if (taskId === null) {
      // top-level tasks in the current drill's... at top level use all roots
      return this.drillId === null ? this.project.roots : (this.project.tasks.get(this.drillId)?.children ?? [])
    }
    const parent = this.project.tasks.get(taskId)?.raw.parent ?? null
    return parent === null ? this.project.roots : (this.project.tasks.get(parent)?.children ?? [])
  }

  private createTask(data: NewTaskData, afterId: TaskId | null, beforeId: TaskId | null) {
    const anchor = afterId ?? beforeId
    const parentId = anchor ? (this.project.tasks.get(anchor)?.raw.parent ?? null) : this.drillId
    const panelId = anchor
      ? this.project.tasks.get(anchor)?.raw.panel ?? null
      : (parentId === null ? this.project.panels[0]?.id ?? null : null)
    const siblings = this.siblingsOf(anchor)
    const today = new Date().toISOString().split('T')[0]
    const id = newTaskId()

    let order: string
    let prerequisites: NodeId[] = []

    if (afterId) {
      const a = this.project.tasks.get(afterId)!
      order = orderAfter(a.raw.order)
      prerequisites = [afterId]
      // Thread: successors of afterId now depend on the new task instead
      for (const s of siblings) {
        if (s.raw.id !== id && s.raw.prerequisites.includes(afterId))
          s.raw.prerequisites = s.raw.prerequisites.map(p => p === afterId ? id : p)
      }
    } else if (beforeId) {
      const b = this.project.tasks.get(beforeId)!
      order = b.raw.order + 'a'
      prerequisites = [...b.raw.prerequisites]
      b.raw.prerequisites = [id]
    } else {
      const last = siblings[siblings.length - 1]
      order = last ? orderAfter(last.raw.order) : 'a0'
      prerequisites = last ? [last.raw.id] : []
    }

    const base = {
      id, name: data.name, parent: parentId, panel: parentId === null ? panelId : null,
      order, prerequisites, tags: [] as string[],
      timeMode: 'duration' as const, duration: data.duration, start: today,
      style: data.type === 'container'
        ? { background: '#334155', text: '#f8fafc' }
        : { background: '#1e3a5f', text: '#dbeafe' },
    }
    const raw = data.type === 'container'
      ? { ...base, type: 'container' as const }
      : { ...base, type: 'ticket' as const, assignees: [], status: this.project.columns[0]?.id ?? 'todo', ticket: data.ticket }

    const rt: RuntimeTask = { raw, children: [], computed: null }
    this.project.tasks.set(id, rt)
    const idx = anchor ? siblings.findIndex(s => s.raw.id === anchor) : siblings.length - 1
    if (afterId) siblings.splice(idx + 1, 0, rt)
    else if (beforeId) siblings.splice(idx, 0, rt)
    else siblings.push(rt)

    this.project.dirty = true
    schedule(this.project)
    this.pendingEditId = id
    this.render()
  }

  // ─── Milestone prereq picking ─────────────────────────────────────────────────

  private beginPickPrereq(milestoneId: NodeId) {
    // Resolve synthetic end-milestone to a real persisted completion milestone.
    let target = milestoneId
    if (milestoneId.startsWith('__end_')) {
      const containerId = milestoneId.slice('__end_'.length)
      target = this.getOrCreateCompletion(containerId).id
    }
    this.pickPrereqFor = target
    document.dispatchEvent(new CustomEvent('planar:placement', {
      detail: { active: true, hint: 'Pick a task to add as a prerequisite of this milestone. Esc to cancel.' },
    }))
    this.render()
  }

  private completePickPrereq(taskId: TaskId) {
    const target = this.pickPrereqFor
    this.pickPrereqFor = null
    document.dispatchEvent(new CustomEvent('planar:placement', { detail: { active: false, hint: '' } }))
    if (!target) return
    const ms = this.project.milestones.get(target)
    if (ms && !ms.raw.prerequisites.includes(taskId)) {
      ms.raw.prerequisites.push(taskId)
      this.project.dirty = true
      schedule(this.project)
    }
    this.render()
  }

  private getOrCreateCompletion(containerId: TaskId) {
    for (const rm of this.project.milestones.values())
      if (rm.raw.ownerId === containerId) return rm.raw
    const container = this.project.tasks.get(containerId)!
    const m: Milestone = {
      id: newMilestoneId(), name: container.raw.name, parent: containerId,
      panel: null, ownerId: containerId, prerequisites: [], order: 'z9',
    }
    this.project.milestones.set(m.id, { raw: m, computed: null })
    return m
  }

  // ─── Panels ────────────────────────────────────────────────────────────────────

  private addPanel() {
    const last = this.project.panels[this.project.panels.length - 1]
    const id = `pn_${Math.random().toString(36).slice(2, 10)}`
    this.project.panels.push({
      id, name: `Panel ${this.project.panels.length + 1}`,
      color: ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#dc2626'][this.project.panels.length % 5],
      order: orderAfter(last?.order ?? 'a0'),
    })
    this.project.dirty = true
    this.render()
  }

  private reorderPanel(panelId: string, dir: -1 | 1) {
    const panels = this.project.panels
    const i = panels.findIndex(p => p.id === panelId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= panels.length) return
    ;[panels[i], panels[j]] = [panels[j], panels[i]]
    // Rewrite order keys to reflect the new sequence
    panels.forEach((p, k) => { p.order = 'a' + String.fromCharCode(97 + k) })
    this.project.dirty = true
    this.render()
  }

  private recolorPanel(panelId: string, color: string) {
    const p = this.project.panels.find(p => p.id === panelId)
    if (p) { p.color = color; this.project.dirty = true; this.render() }
  }

  // External API
  openAddTaskModal() {
    openAddTaskModal((data) => this.createTask(data, null, null), () => {})
  }
}
