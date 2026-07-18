import type { Project, NodeId, TaskId, LayoutNode, RuntimeTask, Milestone, TicketTask, ContainerTask } from '../types'
import { buildLayout, PX_PER_DAY, PANEL_V_PAD, SECTION_PAD } from '../engine/layout'
import type { LayoutResult } from '../engine/layout'
import { renderTaskBlock } from '../render/TaskBlock'
import { renderMilestone } from '../render/MilestoneFlag'
import { renderConnectors } from '../render/Connector'
import { EditPopup } from './EditPopup'
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

const orderAfter = (o: string) => o + 'm'

// ─── GanttView ────────────────────────────────────────────────────────────────

export class GanttView {
  private container: HTMLElement
  private svg: SVGSVGElement
  private axisG: SVGGElement
  private contentG: SVGGElement
  private panelBars: HTMLElement

  private project: Project
  private popup: EditPopup
  private drillStack: Array<{ id: TaskId | null; label: string }> = []
  private drillId: TaskId | null = null
  private selectedId: NodeId | null = null
  private pxPerDay = PX_PER_DAY   // time density (horizontal-only zoom)
  private zoom = 1                // uniform zoom (all directions)
  private panX = 20
  private panY = 20
  private isPanning = false
  private last = { x: 0, y: 0 }
  private newlyCreatedId: TaskId | null = null
  private pickPrereqFor: NodeId | null = null
  private currentSectionStart: Date | null = null
  private dragPanelId: string | null = null
  private maximizedPanel: string | null = null
  private msAdd!: HTMLButtonElement
  private msAddTarget: string | null = null
  private ro: ResizeObserver

  constructor(container: HTMLElement, project: Project) {
    this.container = container
    this.project = project

    container.innerHTML = ''
    container.classList.add('gantt-root')
    this.popup = new EditPopup(container)

    this.svg = el('svg')
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;user-select:none;'
    container.appendChild(this.svg)

    // NOTE: no clip-path on contentG. A clip-path on a transformed <g> silently
    // disables pointer events for all its children in Chromium. The opaque date-bar
    // background masks content that scrolls under it, and the <svg> viewport clips
    // the rest — so an explicit clip is unnecessary.
    this.contentG = el('g')
    this.axisG = el('g')
    this.svg.appendChild(this.contentG)
    this.svg.appendChild(this.axisG)

    this.panelBars = document.createElement('div')
    this.panelBars.className = 'panel-bars'
    container.appendChild(this.panelBars)

    // Cursor-following "+" that appears when hovering near an addable milestone line.
    this.msAdd = document.createElement('button')
    this.msAdd.className = 'ms-cursor-add'
    this.msAdd.textContent = '+'
    this.msAdd.title = 'Add a task off this milestone'
    this.msAdd.style.display = 'none'
    this.msAdd.addEventListener('pointerdown', e => e.stopPropagation())
    this.msAdd.addEventListener('click', (e) => { e.stopPropagation(); if (this.msAddTarget) this.addTaskOffMilestone(this.msAddTarget) })
    container.appendChild(this.msAdd)

    this.drillStack = [{ id: null, label: project.meta.name }]
    this.bindEvents()
    this.ro = new ResizeObserver(() => this.render())
    this.ro.observe(container)
    this.render()
  }

  dispose() {
    this.ro.disconnect()
    document.removeEventListener('keydown', this.onKeyDown)
    const c = this.container
    c.removeEventListener('pointerdown', this.onPointerDown)
    c.removeEventListener('pointermove', this.onPointerMove)
    c.removeEventListener('pointerup', this.onPointerUp)
    c.removeEventListener('pointercancel', this.onPointerUp)
    c.removeEventListener('wheel', this.onWheel)
    document.removeEventListener('pointerdown', this.onOutsidePointer)
    c.classList.remove('gantt-root', 'panning')
  }

  private get dateBarH() { return DATE_BAR_BASE }   // constant; visually scaled by `zoom`
  private get W() { return this.container.clientWidth }
  private get H() { return this.container.clientHeight }

  // ─── Render ─────────────────────────────────────────────────────────────────

  render() {
    const W = this.W, H = this.H
    this.svg.setAttribute('width', String(W))
    this.svg.setAttribute('height', String(H))

    this.contentG.innerHTML = ''
    this.axisG.innerHTML = ''
    this.panelBars.innerHTML = ''

    const layout = buildLayout(this.project, this.drillId, this.pxPerDay, this.maximizedPanel)
    this.currentSectionStart = layout.sectionStart

    // Background (click to deselect / cancel pick)
    const bg = el('rect')
    bg.setAttribute('x', '0'); bg.setAttribute('y', '0')
    bg.setAttribute('width', String(Math.max(W, layout.width + 400)))
    bg.setAttribute('height', String(Math.max(H, layout.height + 400)))
    bg.setAttribute('fill', 'transparent')
    bg.addEventListener('click', () => {
      if (this.pickPrereqFor) { this.pickPrereqFor = null; this.render(); return }
      if (this.popup.isOpen) this.closeEdit()
      else this.select(null)
    })
    this.contentG.appendChild(bg)

    for (const panel of layout.panels) this.renderPanel(panel)

    if (layout.sectionStart) this.renderAxis(layout.sectionStart)
    this.renderPanelBars(layout)
    this.applyTransform()

    // A freshly created task auto-opens its editor.
    if (this.newlyCreatedId) {
      const id = this.newlyCreatedId; this.newlyCreatedId = null
      if (this.project.tasks.has(id)) this.openEdit(id)
    }
    // Keep an open popup anchored to its task (positions shift after edits/pan/zoom).
    if (this.popup.isOpen) {
      const id = this.popup.openFor!
      const anchor = this.taskAnchor(id)
      if (anchor) this.popup.reposition(anchor)
      else this.closeEdit()
    }
  }

  /** Screen-space anchor (below the bar) for a task's edit popup. */
  private taskAnchor(id: string): { x: number; y: number; bottom: number } | null {
    const rect = this.svg.querySelector<SVGRectElement>(`.task-block[data-id="${id}"] .bar-rect`)
    if (!rect) return null
    const r = rect.getBoundingClientRect()
    return { x: r.left, y: r.top, bottom: r.bottom }
  }

  private renderPanel(panel: LayoutResult['panels'][number]) {
    const g = el('g')
    g.setAttribute('transform', `translate(0, ${panel.yOffset})`)

    // When a panel is maximized it fills the viewport height.
    const bandHeight = this.maximizedPanel ? Math.max(panel.height, this.H - this.dateBarH - 40) : panel.height

    // Panel band background
    const band = el('rect')
    band.setAttribute('x', String(-2000)); band.setAttribute('y', '0')
    band.setAttribute('width', String(panel.width + 4000)); band.setAttribute('height', String(bandHeight))
    band.setAttribute('fill', panel.color); band.setAttribute('opacity', '0.04')
    g.appendChild(band)

    const nodeMap = new Map<string, LayoutNode>(panel.nodes.map(n => [n.id, n]))
    for (const p of renderConnectors(panel.connectors, nodeMap)) g.appendChild(p)

    for (const node of panel.nodes) {
      if (node.kind === 'milestone') {
        const name = this.milestoneName(node.id)
        const canAddPrereq = !node.id.startsWith('__start_') && !node.id.startsWith('__end_')
        const flag = renderMilestone(
          node, name, panel.color, bandHeight - PANEL_V_PAD,
          canAddPrereq ? () => this.beginPickPrereq(node.id) : undefined,
        )
        if (this.pickPrereqFor === node.id) flag.classList.add('pick-target')
        // Milestones you can spawn a new task off of (root Start + real milestones).
        if (node.id.startsWith('__rootstart_') || this.project.milestones.has(node.id))
          flag.classList.add('ms-addable')
        g.appendChild(flag)
      } else {
        const block = renderTaskBlock(node, this.project, this.selectedId === node.id, {
          // Single click → select + open the edit popup (works for both task types).
          onSelect: () => { if (this.pickPrereqFor) this.completePickPrereq(node.id); else this.openEdit(node.id) },
          // Double click → drill in (containers only; reserved for milestone-tasks).
          onOpen: () => {
            const rt = this.project.tasks.get(node.id)!
            if (rt.raw.type === 'container') this.drillInto(node.id, rt.raw.name)
          },
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

    // Axis group is translate(panX,0) scale(zoom). Screen x = panX + localX*zoom,
    // so local coords covering the viewport [0, W] run from -panX/zoom to (W-panX)/zoom.
    const z = this.zoom
    const localLeft = -this.panX / z
    const localRight = (this.W - this.panX) / z
    const bg = el('rect')
    bg.setAttribute('x', String(localLeft - 200)); bg.setAttribute('y', '0')
    bg.setAttribute('width', String(localRight - localLeft + 400)); bg.setAttribute('height', String(H))
    bg.setAttribute('fill', '#f8fafc')
    g.appendChild(bg)
    for (const yy of [coarseH, H]) {
      const ln = el('line')
      ln.setAttribute('x1', String(localLeft - 200)); ln.setAttribute('y1', String(yy))
      ln.setAttribute('x2', String(localRight + 200)); ln.setAttribute('y2', String(yy))
      ln.setAttribute('stroke', '#e2e8f0'); g.appendChild(ln)
    }

    const visDaysLeft = (localLeft - SECTION_PAD) / this.pxPerDay - 40
    const visDaysRight = (localRight - SECTION_PAD) / this.pxPerDay + 40
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
      lbl.setAttribute('fill', '#475569'); lbl.setAttribute('font-size', '11')
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
        lbl.setAttribute('fill', '#64748b'); lbl.setAttribute('font-size', '10')
        lbl.textContent = fineLabel(d, gr.fine)
        g.appendChild(lbl)
      }
      d = next
    }
  }

  private renderPanelBars(layout: LayoutResult) {
    const z = this.zoom
    const inner = document.createElement('div')
    inner.className = 'panel-bars-inner'
    inner.style.transform = `translateY(${this.panY}px)`
    this.panelBars.style.top = `${this.dateBarH * z}px`

    const reorderable = this.drillId === null && layout.panels.length > 1
    layout.panels.forEach((panel) => {
      const bar = document.createElement('div')
      bar.className = 'panel-bar'
      bar.style.top = `${panel.yOffset * z}px`
      bar.style.height = `${panel.height * z}px`
      bar.style.background = panel.color
      bar.dataset.panelId = panel.panelId
      bar.innerHTML = `<span class="panel-bar-name">${panel.name}</span>`

      // Single click → name/colour popup. Double click → maximize/restore.
      // (Distinguish via a short timer so the single click doesn't fire on a dblclick.)
      let clickTimer: ReturnType<typeof setTimeout> | null = null
      bar.addEventListener('click', (e) => {
        e.stopPropagation()
        if (clickTimer) return
        clickTimer = setTimeout(() => { clickTimer = null; this.openPanelPopup(panel.panelId, bar) }, 220)
      })
      bar.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
        this.toggleMaximizePanel(panel.panelId)
      })

      if (reorderable && !this.maximizedPanel) {
        bar.draggable = true
        bar.addEventListener('dragstart', (e) => { this.dragPanelId = panel.panelId; e.dataTransfer!.effectAllowed = 'move'; bar.classList.add('dragging') })
        bar.addEventListener('dragend', () => { this.dragPanelId = null; bar.classList.remove('dragging') })
        bar.addEventListener('dragover', (e) => { e.preventDefault(); bar.classList.add('drag-over') })
        bar.addEventListener('dragleave', () => bar.classList.remove('drag-over'))
        bar.addEventListener('drop', (e) => {
          e.preventDefault(); bar.classList.remove('drag-over')
          if (this.dragPanelId && this.dragPanelId !== panel.panelId) this.movePanelBefore(this.dragPanelId, panel.panelId)
        })
      }
      inner.appendChild(bar)
    })

    // "+ add panel" button at the very bottom (top level, not maximized)
    if (this.drillId === null && !this.maximizedPanel) {
      const add = document.createElement('button')
      add.className = 'panel-add-btn'
      add.textContent = '+'
      add.title = 'Add panel below'
      add.style.top = `${layout.height * this.zoom + 8}px`
      add.addEventListener('click', () => this.addPanel())
      inner.appendChild(add)
    }

    this.panelBars.appendChild(inner)
  }

  private toggleMaximizePanel(panelId: string) {
    this.maximizedPanel = this.maximizedPanel === panelId ? null : panelId
    this.panY = 20
    this.render()
  }

  /** Small popup to rename / recolour a panel (single click on its bar). */
  private openPanelPopup(panelId: string, barEl: HTMLElement) {
    const panel = this.project.panels.find(p => p.id === panelId)
    if (!panel) return
    document.querySelector('.panel-popup')?.remove()
    const pop = document.createElement('div')
    pop.className = 'panel-popup'
    pop.innerHTML = `
      <label class="ep-l">Panel name</label>
      <input class="ep-in" id="pp-name" value="${panel.name.replace(/"/g, '&quot;')}" />
      <label class="ep-l">Colour</label>
      <input type="color" id="pp-color" value="${panel.color}" />
      <div class="ep-foot"><button class="btn ep-del" id="pp-del">Delete panel</button></div>`
    const r = barEl.getBoundingClientRect()
    const hostR = this.container.getBoundingClientRect()
    pop.style.left = `${Math.max(8, r.left - hostR.left - 200)}px`
    pop.style.top = `${r.top - hostR.top + 4}px`
    pop.addEventListener('pointerdown', e => e.stopPropagation())
    pop.addEventListener('click', e => e.stopPropagation())
    this.container.appendChild(pop)

    const nameIn = pop.querySelector<HTMLInputElement>('#pp-name')!
    nameIn.addEventListener('input', () => { panel.name = nameIn.value; this.project.dirty = true; barEl.querySelector('.panel-bar-name')!.textContent = panel.name })
    const colIn = pop.querySelector<HTMLInputElement>('#pp-color')!
    colIn.addEventListener('input', () => this.recolorPanel(panelId, colIn.value))
    pop.querySelector('#pp-del')!.addEventListener('click', () => {
      if (this.project.panels.length <= 1) { alert('Keep at least one panel.'); return }
      // Move this panel's tasks to the first remaining panel.
      const fallback = this.project.panels.find(p => p.id !== panelId)!.id
      for (const rt of this.project.tasks.values()) if (rt.raw.panel === panelId) rt.raw.panel = fallback
      this.project.panels = this.project.panels.filter(p => p.id !== panelId)
      this.project.dirty = true; pop.remove(); this.render()
    })
    setTimeout(() => nameIn.focus(), 0)
    const off = (e: PointerEvent) => { if (!pop.contains(e.target as Node)) { pop.remove(); document.removeEventListener('pointerdown', off) } }
    setTimeout(() => document.addEventListener('pointerdown', off), 0)
  }

  // ─── Transform / pan / zoom ───────────────────────────────────────────────────

  private applyTransform() {
    const z = this.zoom
    this.axisG.setAttribute('transform', `translate(${this.panX}, 0) scale(${z})`)
    this.contentG.setAttribute('transform', `translate(${this.panX}, ${this.dateBarH * z + this.panY}) scale(${z})`)
    const inner = this.panelBars.querySelector<HTMLElement>('.panel-bars-inner')
    if (inner) inner.style.transform = `translateY(${this.panY}px)`
  }

  /** Lightweight pan: shift transforms and redraw only the axis (labels recycle). */
  private lightPan() {
    this.applyTransform()
    this.axisG.innerHTML = ''
    if (this.currentSectionStart) this.renderAxis(this.currentSectionStart)
  }

  // Handlers are stored as fields so dispose() can remove them — the container
  // (#canvas-wrap) is shared/reused across views, so leaked listeners (esp. the
  // pointer-capture on pointerdown) would otherwise swallow clicks in other views.
  private onPointerDown = (e: PointerEvent) => {
    // Don't start a pan (which captures the pointer) when the press is on an
    // interactive overlay — doing so would steal the click from it.
    if ((e.target as Element).closest('.task-block, .milestone-flag, .add-btn, .panel-bars, .edit-popup')) return
    if (this.pickPrereqFor) return
    this.isPanning = true; this.last = { x: e.clientX, y: e.clientY }
    this.container.classList.add('panning'); this.container.setPointerCapture(e.pointerId)
  }
  private onPointerMove = (e: PointerEvent) => {
    if (this.isPanning) {
      this.panX += e.clientX - this.last.x
      this.panY += e.clientY - this.last.y
      this.last = { x: e.clientX, y: e.clientY }
      this.lightPan()
      return
    }
    this.updateMilestoneAddButton(e.clientX, e.clientY)
  }

  /** Show a "+" on the nearest addable milestone line, following the cursor vertically. */
  private updateMilestoneAddButton(clientX: number, clientY: number) {
    const hostR = this.container.getBoundingClientRect()
    let best: { id: string; x: number; y0: number; y1: number } | null = null
    this.svg.querySelectorAll('.milestone-flag.ms-addable .milestone-line').forEach(ln => {
      const r = (ln as SVGLineElement).getBoundingClientRect()
      const dx = Math.abs(clientX - (r.left + r.width / 2))
      if (dx < 16 && clientY >= r.top - 4 && clientY <= r.bottom + 4) {
        best = { id: (ln.parentElement as Element).getAttribute('data-id')!, x: r.left + r.width / 2, y0: r.top, y1: r.bottom }
      }
    })
    if (best) {
      const b = best as { id: string; x: number; y0: number; y1: number }
      this.msAddTarget = b.id
      this.msAdd.style.display = 'flex'
      this.msAdd.style.left = `${b.x - hostR.left + 6}px`
      this.msAdd.style.top = `${Math.min(Math.max(clientY, b.y0), b.y1) - hostR.top - 10}px`
    } else if (this.msAddTarget) {
      this.msAddTarget = null
      this.msAdd.style.display = 'none'
    }
  }
  private onPointerUp = () => { this.isPanning = false; this.container.classList.remove('panning') }
  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const rect = this.svg.getBoundingClientRect()
    const cursorX = e.clientX - rect.left
    const cursorY = e.clientY - rect.top
    if (e.ctrlKey || e.metaKey) {
      this.applyUniformZoom(Math.exp(-e.deltaY * 0.0022), cursorX, cursorY)
    } else if (e.shiftKey) {
      this.applyTimeZoom(Math.exp(-e.deltaY * 0.0018), cursorX)
    } else {
      this.panX -= e.deltaX; this.panY -= e.deltaY; this.lightPan()
    }
  }

  private bindEvents() {
    const c = this.container
    c.addEventListener('pointerdown', this.onPointerDown)
    c.addEventListener('pointermove', this.onPointerMove)
    c.addEventListener('pointerup', this.onPointerUp)
    c.addEventListener('pointercancel', this.onPointerUp)
    c.addEventListener('wheel', this.onWheel, { passive: false })
    document.addEventListener('keydown', this.onKeyDown)
  }

  /** Uniform zoom keeping the point under (sx,sy) fixed on screen. */
  private applyUniformZoom(factor: number, sx: number, sy: number) {
    const z0 = this.zoom
    const z1 = Math.max(0.2, Math.min(4, z0 * factor))
    if (z1 === z0) return
    // screen = pan + local*z + (x: 0 | y: dateBarH*z)
    const lx = (sx - this.panX) / z0
    const ly = (sy - this.dateBarH * z0 - this.panY) / z0
    this.zoom = z1
    this.panX = sx - lx * z1
    this.panY = sy - this.dateBarH * z1 - ly * z1
    this.render()
  }

  /** Time-density zoom keeping the date under cursor fixed. */
  private applyTimeZoom(factor: number, sx: number) {
    const z = this.zoom
    const localX = (sx - this.panX) / z
    const day = (localX - SECTION_PAD) / this.pxPerDay
    const next = Math.max(1.2, Math.min(80, this.pxPerDay * factor))
    if (next === this.pxPerDay) return
    this.pxPerDay = next
    const localXNew = SECTION_PAD + day * next
    this.panX = sx - localXNew * z
    this.render()
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (this.pickPrereqFor) { this.pickPrereqFor = null; this.render() }
      else if (this.popup.isOpen) this.closeEdit()
      else if (this.selectedId) this.select(null)
    }
    // Cmd/Ctrl +/- → uniform zoom in/out (centred on the viewport).
    if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_')) {
      e.preventDefault()
      const factor = (e.key === '-' || e.key === '_') ? 1 / 1.15 : 1.15
      this.applyUniformZoom(factor, this.W / 2, this.H / 2)
    }
    // Cmd/Ctrl + 0 → reset zoom.
    if ((e.metaKey || e.ctrlKey) && e.key === '0') {
      e.preventDefault()
      this.zoom = 1; this.pxPerDay = PX_PER_DAY; this.panX = 20; this.panY = 20; this.render()
    }
  }

  // ─── Selection / drill ────────────────────────────────────────────────────────

  private select(id: NodeId | null) {
    // Incremental — no full re-render (that would break dblclick detection).
    this.selectedId = id
    this.contentG.querySelectorAll('.task-block.selected').forEach(e => e.classList.remove('selected'))
    if (id) this.contentG.querySelector(`.task-block[data-id="${id}"]`)?.classList.add('selected')
  }

  // ─── Edit popup ────────────────────────────────────────────────────────────────

  private openEdit(id: TaskId) {
    const rt = this.project.tasks.get(id)
    if (!rt) return
    this.select(id)
    const anchor = this.taskAnchor(id)
    if (!anchor) return
    this.popup.open(rt, this.project, anchor, {
      onChange: () => { this.project.dirty = true; schedule(this.project); this.render() },
      onConvert: (to) => this.convertType(id, to),
      onDelete: () => this.deleteTask(id),
      onClose: () => this.closeEdit(),
    })
    // Close when the user interacts anywhere outside the popup (next tick so this
    // opening click doesn't immediately dismiss it).
    setTimeout(() => document.addEventListener('pointerdown', this.onOutsidePointer), 0)
  }

  private onOutsidePointer = (e: PointerEvent) => {
    if (this.popup.contains(e.target as Node)) return
    // A click on another task will re-open for that task via its own handler.
    this.closeEdit()
  }

  private closeEdit() {
    document.removeEventListener('pointerdown', this.onOutsidePointer)
    this.popup.close()
    this.select(null)
  }

  private convertType(id: TaskId, to: 'ticket' | 'container') {
    const rt = this.project.tasks.get(id)
    if (!rt || rt.raw.type === to) return
    if (to === 'ticket' && rt.children.length > 0) {
      alert('This milestone-task has sub-tasks. Remove or move them before converting it to a ticket.')
      return
    }
    const b = rt.raw
    if (to === 'container') {
      const c: ContainerTask = {
        id: b.id, name: b.name, type: 'container', parent: b.parent, panel: b.panel,
        order: b.order, prerequisites: b.prerequisites, tags: b.tags, style: b.style,
        timeMode: b.timeMode, start: b.start, end: b.end, duration: b.duration,
      }
      rt.raw = c
    } else {
      const t: TicketTask = {
        id: b.id, name: b.name, type: 'ticket', parent: b.parent, panel: b.panel,
        order: b.order, prerequisites: b.prerequisites, tags: b.tags, style: b.style,
        timeMode: b.timeMode, start: b.start, end: b.end, duration: b.duration ?? 7,
        assignees: [], status: this.project.columns[0]?.id ?? 'todo', ticket: null,
      }
      rt.raw = t
    }
    this.project.dirty = true
    schedule(this.project)
    this.render()
    this.openEdit(id)   // reopen with the new type's fields
  }

  private deleteTask(id: TaskId) {
    const rt = this.project.tasks.get(id)
    if (!rt) return
    // Rewire: successors that depended on this task inherit its prerequisites.
    const inherited = rt.raw.prerequisites
    for (const other of this.project.tasks.values()) {
      if (other.raw.prerequisites.includes(id)) {
        other.raw.prerequisites = other.raw.prerequisites.flatMap(p => p === id ? inherited : [p])
          .filter((p, i, a) => a.indexOf(p) === i && p !== other.raw.id)
      }
    }
    for (const m of this.project.milestones.values()) {
      if (m.raw.prerequisites.includes(id))
        m.raw.prerequisites = m.raw.prerequisites.filter(p => p !== id)
    }
    // Remove from sibling array + map (and any children recursively).
    const removeRec = (t: RuntimeTask) => {
      for (const c of [...t.children]) removeRec(c)
      this.project.tasks.delete(t.raw.id)
    }
    const siblings = this.siblingsOf(id)
    const idx = siblings.findIndex(s => s.raw.id === id)
    if (idx >= 0) siblings.splice(idx, 1)
    removeRec(rt)

    this.project.dirty = true
    this.closeEdit()
    schedule(this.project)
    this.render()
  }

  private drillInto(id: TaskId, _label: string) {
    this.closeEdit()
    // Breadcrumb = the container's real ancestry (root → … → id), rebuilt each time
    // so re-expanding a sibling replaces the path instead of appending to it.
    const path: Array<{ id: TaskId | null; label: string }> = []
    let cur: RuntimeTask | undefined = this.project.tasks.get(id)
    while (cur) {
      path.unshift({ id: cur.raw.id, label: cur.raw.name })
      cur = cur.raw.parent ? this.project.tasks.get(cur.raw.parent) : undefined
    }
    this.drillStack = [{ id: null, label: this.project.meta.name }, ...path]
    this.drillId = id
    this.panX = 20; this.panY = 20; this.selectedId = null
    this.render(); this.emitBreadcrumb()
  }

  drillTo(depth: number) {
    this.closeEdit()
    this.drillStack = this.drillStack.slice(0, depth + 1)
    this.drillId = this.drillStack[this.drillStack.length - 1].id
    this.panX = 20; this.panY = 20; this.selectedId = null
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
    const id = newTaskId()

    // Anchor the new task to the timeline it's being inserted into — NOT "today",
    // which would jump it far from an example that lives in the past/future. The
    // scheduler floors start at max(anchor, prereqEnd), so any date <= context works.
    const anchorRt = anchor ? this.project.tasks.get(anchor) : null
    const contextStart =
      anchorRt?.computed?.start ??
      siblings.map(s => s.computed?.start).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ??
      new Date()
    const startAnchor = contextStart.toISOString().split('T')[0]

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

    const timing = data.timeMode === 'date'
      ? { timeMode: 'date' as const, start: data.start ?? startAnchor, end: data.end ?? data.start ?? startAnchor }
      : { timeMode: 'duration' as const, duration: data.duration, start: startAnchor }
    const base = {
      id, name: data.name, parent: parentId, panel: parentId === null ? panelId : null,
      order, prerequisites, tags: [] as string[],
      ...timing,
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
    this.newlyCreatedId = id
    this.render()
  }

  /** Create a new root-level task in a panel, off a milestone (opens the add modal). */
  private addTaskOffMilestone(milestoneId: string) {
    this.msAdd.style.display = 'none'; this.msAddTarget = null
    let panelId: string
    let prereqs: NodeId[]
    if (milestoneId.startsWith('__rootstart_')) {
      panelId = milestoneId.slice('__rootstart_'.length)
      prereqs = []   // originates from Start by default
    } else {
      const ms = this.project.milestones.get(milestoneId)
      if (!ms) return
      panelId = ms.raw.panel ?? this.project.panels[0]?.id ?? ''
      prereqs = [milestoneId]
    }
    openAddTaskModal((data) => {
      const id = newTaskId()
      const roots = this.project.roots.filter(r => r.raw.panel === panelId)
      const last = roots[roots.length - 1]
      const order = last ? orderAfter(last.raw.order) : 'a0'
      const anchor = this.currentSectionStart?.toISOString().split('T')[0] ?? new Date().toISOString().split('T')[0]
      const timing = data.timeMode === 'date'
        ? { timeMode: 'date' as const, start: data.start ?? anchor, end: data.end ?? data.start ?? anchor }
        : { timeMode: 'duration' as const, duration: data.duration, start: anchor }
      const base = {
        id, name: data.name, parent: null, panel: panelId, order, prerequisites: prereqs, tags: [] as string[], ...timing,
        style: data.type === 'container' ? { background: '#334155', text: '#f8fafc' } : { background: '#1e3a5f', text: '#dbeafe' },
      }
      const raw = data.type === 'container'
        ? { ...base, type: 'container' as const }
        : { ...base, type: 'ticket' as const, assignees: [], status: this.project.columns[0]?.id ?? 'todo', ticket: data.ticket }
      const rt: RuntimeTask = { raw, children: [], computed: null }
      this.project.tasks.set(id, rt)
      this.project.roots.push(rt)
      this.project.dirty = true
      schedule(this.project)
      this.newlyCreatedId = id
      this.render()
    }, () => {})
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

  /** Reorder: drop the dragged panel onto a target. Dragging down drops after; up drops before. */
  private movePanelBefore(dragId: string, targetId: string) {
    const panels = this.project.panels
    const from = panels.findIndex(p => p.id === dragId)
    const to = panels.findIndex(p => p.id === targetId)
    if (from < 0 || to < 0 || from === to) return
    const [moved] = panels.splice(from, 1)
    const t = panels.findIndex(p => p.id === targetId)
    panels.splice(from < to ? t + 1 : t, 0, moved)
    panels.forEach((p, k) => { p.order = 'a' + String(k).padStart(3, '0') })
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
