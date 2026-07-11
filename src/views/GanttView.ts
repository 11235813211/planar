import type { Project, NodeId, LayoutNode, RuntimeTask, TicketTask } from '../types'
import { buildLayout, PX_PER_DAY, SECTION_H_PAD } from '../engine/layout'
import { renderTaskBlock } from '../render/TaskBlock'
import { renderMilestoneFlag } from '../render/MilestoneFlag'
import { renderConnectors } from '../render/Connector'
import { openDetailModal } from './DetailModal'
import { FormatBar } from './FormatBar'
import { schedule } from '../engine/scheduler'
import { newTaskId } from '../data/ids'

const DATE_BAR_H = 40   // height of the date axis strip
const OUTER_PAD  = 48   // space above tasks (flag lives here)

// ─── Date axis helpers ────────────────────────────────────────────────────────

function formatMonth(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function renderDateAxis(
  g: SVGGElement,
  sectionStart: Date | null,
  totalWidth: number,
  pxPerDay: number,
): void {
  if (!sectionStart) return

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('x', '0')
  bg.setAttribute('y', '0')
  bg.setAttribute('width', String(totalWidth))
  bg.setAttribute('height', String(DATE_BAR_H))
  bg.setAttribute('fill', '#f8fafc')
  g.appendChild(bg)

  const bottomLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  bottomLine.setAttribute('x1', '0')
  bottomLine.setAttribute('y1', String(DATE_BAR_H))
  bottomLine.setAttribute('x2', String(totalWidth))
  bottomLine.setAttribute('y2', String(DATE_BAR_H))
  bottomLine.setAttribute('stroke', '#e2e8f0')
  bottomLine.setAttribute('stroke-width', '1')
  g.appendChild(bottomLine)

  // Tick marks at month boundaries
  const cursor = new Date(sectionStart)
  cursor.setUTCDate(1)
  // start a month back so first label is visible
  const endDate = new Date(sectionStart.getTime() + (totalWidth / pxPerDay) * 86_400_000)

  while (cursor <= endDate) {
    const days = (cursor.getTime() - sectionStart.getTime()) / 86_400_000
    const tickX = SECTION_H_PAD + days * pxPerDay

    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    tick.setAttribute('x1', String(tickX))
    tick.setAttribute('y1', String(DATE_BAR_H - 8))
    tick.setAttribute('x2', String(tickX))
    tick.setAttribute('y2', String(DATE_BAR_H))
    tick.setAttribute('stroke', '#94a3b8')
    tick.setAttribute('stroke-width', '1')
    g.appendChild(tick)

    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    lbl.setAttribute('x', String(tickX + 4))
    lbl.setAttribute('y', String(DATE_BAR_H - 12))
    lbl.setAttribute('fill', '#64748b')
    lbl.setAttribute('font-size', '10')
    lbl.textContent = formatMonth(cursor)
    g.appendChild(lbl)

    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
}

// ─── Inline title editing ─────────────────────────────────────────────────────

function startInlineEdit(
  labelEl: SVGTextElement,
  svgEl: SVGSVGElement,
  rt: RuntimeTask,
  project: Project,
  onCommit: () => void,
): void {
  if (rt.raw.type !== 'task') return

  const rect = labelEl.getBoundingClientRect()
  const svgRect = svgEl.getBoundingClientRect()

  // Check if an edit is already open
  const existing = document.getElementById('inline-title-input')
  if (existing) existing.remove()

  const input = document.createElement('input')
  input.id = 'inline-title-input'
  input.value = rt.raw.name
  input.style.position = 'fixed'
  input.style.left   = String(rect.left - 4) + 'px'
  input.style.top    = String(rect.top  - 4) + 'px'
  input.style.width  = String(Math.max(rect.width + 8, 120)) + 'px'
  input.style.height = '22px'
  input.style.fontSize = '12px'
  input.style.fontFamily = 'system-ui, sans-serif'
  input.style.textAlign = 'center'
  input.style.border = '2px solid #2563eb'
  input.style.borderRadius = '4px'
  input.style.padding = '0 4px'
  input.style.outline = 'none'
  input.style.zIndex = '200'
  input.style.background = '#fff'
  input.style.color = '#111'

  // Hide the SVG text while editing
  labelEl.style.display = 'none'

  // Prevent SVG pan from stealing pointer events
  const stopProp = (e: Event) => e.stopPropagation()
  input.addEventListener('pointerdown', stopProp)
  input.addEventListener('pointermove', stopProp)

  void svgRect  // keep reference alive

  const commit = () => {
    const val = input.value.trim()
    if (val) {
      (rt.raw as TicketTask).name = val
      project.dirty = true
    }
    input.remove()
    labelEl.style.display = ''
    onCommit()
  }

  const cancel = () => {
    input.remove()
    labelEl.style.display = ''
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') cancel()
    e.stopPropagation()
  })
  input.addEventListener('blur', commit)

  document.body.appendChild(input)
  input.focus()
  input.select()
}

// ─── Order string helpers ─────────────────────────────────────────────────────

function nextOrderAfter(order: string): string {
  // Append 'm' — lexicographically between `order` and `order` with next char
  return order + 'm'
}

// ─── GanttView ────────────────────────────────────────────────────────────────

export class GanttView {
  private svg: SVGSVGElement
  private root: SVGGElement
  private project: Project
  private drillStack: Array<{ parentId: NodeId | null; label: string }> = []
  private currentParent: NodeId | null = null
  private selectedId: NodeId | null = null
  private formatBar: FormatBar
  private pxPerDay: number = PX_PER_DAY
  private panX = 0
  private panY = 0
  private isPanning = false
  private lastPointer = { x: 0, y: 0 }
  private pendingEditId: NodeId | null = null

  constructor(container: HTMLElement, project: Project, formatBar: FormatBar) {
    this.project = project
    this.formatBar = formatBar
    this.formatBar.bind(project, () => this.render())

    container.innerHTML = ''
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('id', 'gantt-svg')
    this.svg.style.width  = '100%'
    this.svg.style.height = '100%'
    this.svg.style.display = 'block'
    container.appendChild(this.svg)

    this.root = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.svg.appendChild(this.root)

    this.drillStack = [{ parentId: null, label: project.meta.name }]
    this.render()
    this.bindEvents(container)
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  render() {
    this.root.innerHTML = ''

    const layouts = buildLayout(this.project, this.currentParent, this.pxPerDay)
    if (layouts.length === 0) return

    // Compute earliest section start date for date axis
    let sectionStartDate: Date | null = null
    for (const sec of layouts) {
      for (const node of sec.nodes) {
        const rt = this.project.tasks.get(node.id)
        if (rt?.computed && (!sectionStartDate || rt.computed.start < sectionStartDate)) {
          sectionStartDate = rt.computed.start
        }
      }
    }

    let totalW = 0
    let maxH = 0
    for (const sec of layouts) {
      totalW += sec.width
      if (sec.height > maxH) maxH = sec.height
    }
    totalW += 120  // right margin

    const canvasH = maxH + DATE_BAR_H + OUTER_PAD + 60

    // Date axis group (fixed — not translated with content)
    const dateAxisG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    renderDateAxis(dateAxisG, sectionStartDate, totalW, this.pxPerDay)
    this.root.appendChild(dateAxisG)

    // Click canvas background to deselect
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('x', '0')
    bgRect.setAttribute('y', String(DATE_BAR_H))
    bgRect.setAttribute('width', String(totalW))
    bgRect.setAttribute('height', String(canvasH))
    bgRect.setAttribute('fill', 'transparent')
    bgRect.addEventListener('click', () => this.selectTask(null))
    this.root.appendChild(bgRect)

    // Content group (tasks sit below date bar + outer pad)
    const contentG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    contentG.setAttribute('transform', `translate(0, ${DATE_BAR_H + OUTER_PAD})`)

    let xCursor = 0
    for (const sec of layouts) {
      this.renderSection(sec, xCursor, contentG, maxH)
      xCursor += sec.width
    }

    this.root.appendChild(contentG)
    this.svg.setAttribute('viewBox', `0 0 ${totalW} ${canvasH}`)
    this.applyTransform()

    // Trigger inline edit on newly created task
    if (this.pendingEditId) {
      const labelEl = this.svg.querySelector<SVGTextElement>(
        `.task-name-label[data-id="${this.pendingEditId}"]`
      )
      if (labelEl) {
        const taskRT = this.project.tasks.get(this.pendingEditId)!
        startInlineEdit(labelEl, this.svg, taskRT, this.project, () => this.render())
      }
      this.pendingEditId = null
    }
  }

  private renderSection(
    sec: ReturnType<typeof buildLayout>[0],
    xOff: number,
    parent: SVGGElement,
    sectionHeight: number,
  ) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('transform', `translate(${xOff}, 0)`)

    const nodeMap = new Map<string, LayoutNode>(sec.nodes.map(n => [n.id, n]))

    // Connectors behind tasks
    for (const p of renderConnectors(sec.connectors, nodeMap, 0)) g.appendChild(p)

    for (const node of sec.nodes) {
      const rt = this.project.tasks.get(node.id)
      if (!rt) continue

      if (rt.raw.type === 'milestone') {
        const milestoneColor = rt.raw.style.background || '#7c3aed'
        const flag = renderMilestoneFlag(
          node, rt.raw.name, 0, sectionHeight, milestoneColor,
          () => this.drillInto(node.id, rt.raw.name),
        )
        g.appendChild(flag)
      } else {
        const block = renderTaskBlock(
          node, rt, this.project, 0,
          this.selectedId === node.id,
          () => this.selectTask(node.id),
          () => openDetailModal(rt, this.project, () => this.render()),
          (labelEl) => startInlineEdit(labelEl, this.svg, rt, this.project, () => this.render()),
          () => this.addTask(node.id, 'after'),
          () => this.addTask(node.id, 'before'),
        )
        g.appendChild(block)
      }
    }

    parent.appendChild(g)
  }

  // ─── Task creation ───────────────────────────────────────────────────────────

  addTaskToCurrentSection() {
    const siblings = this.currentParent === null
      ? this.project.roots
      : (this.project.tasks.get(this.currentParent)?.children ?? [])

    // Insert after the last non-milestone task, or at end
    const lastTask = [...siblings].reverse().find(s => s.raw.type === 'task')
    const afterId = lastTask?.raw.id ?? null
    this.addTask(afterId, 'after')
  }

  private addTask(afterId: NodeId | null, _direction: 'after' | 'before') {
    const siblings = this.currentParent === null
      ? this.project.roots
      : (this.project.tasks.get(this.currentParent)?.children ?? [])

    const today = new Date().toISOString().split('T')[0]
    const id = newTaskId()

    let order = 'a0'
    let prereqs: NodeId[] = []

    if (afterId) {
      const afterRT = this.project.tasks.get(afterId)
      if (afterRT) {
        order = nextOrderAfter(afterRT.raw.order)
        if (afterRT.raw.type === 'task') prereqs = [afterId]
      }
    } else if (siblings.length > 0) {
      order = nextOrderAfter(siblings[siblings.length - 1].raw.order)
    }

    const raw: TicketTask = {
      id, name: 'New Task', type: 'task',
      parent: this.currentParent,
      order,
      timeMode: 'duration', duration: 7, start: today,
      prerequisites: prereqs,
      assignees: [],
      status: 'todo', ticket: null,
      style: { background: '#334155', text: '#f1f5f9' },
    }
    const rt: RuntimeTask = { raw, children: [], computed: null }

    this.project.tasks.set(id, rt)

    // Insert into siblings at right position (after `afterId` or at end)
    if (afterId) {
      const idx = siblings.findIndex(s => s.raw.id === afterId)
      siblings.splice(idx + 1, 0, rt)
    } else {
      siblings.push(rt)
    }

    this.project.dirty = true
    schedule(this.project)
    this.pendingEditId = id
    this.render()
  }

  // ─── Selection ───────────────────────────────────────────────────────────────

  private selectTask(id: NodeId | null) {
    this.selectedId = id
    const rt = id ? this.project.tasks.get(id) ?? null : null
    this.formatBar.selectTask(rt)
    this.render()
  }

  // ─── Drill-down ──────────────────────────────────────────────────────────────

  private drillInto(milestoneId: NodeId, name: string) {
    const ms = this.project.tasks.get(milestoneId)
    if (!ms || ms.raw.type !== 'milestone') return
    const terminates = ms.raw.terminates
    if (!terminates) return

    this.drillStack.push({ parentId: terminates, label: name })
    this.currentParent = terminates
    this.panX = 0; this.panY = 0
    this.selectedId = null
    this.formatBar.selectTask(null)
    this.render()
    this.updateBreadcrumb()
  }

  drillTo(depth: number) {
    this.drillStack = this.drillStack.slice(0, depth + 1)
    this.currentParent = this.drillStack[this.drillStack.length - 1].parentId
    this.panX = 0; this.panY = 0
    this.selectedId = null
    this.formatBar.selectTask(null)
    this.render()
    this.updateBreadcrumb()
  }

  getBreadcrumb() {
    return this.drillStack.map((e, i) => ({ label: e.label, depth: i }))
  }

  private updateBreadcrumb() {
    document.dispatchEvent(new CustomEvent('planar:breadcrumb', { detail: this.getBreadcrumb() }))
  }

  // ─── Pan / zoom ──────────────────────────────────────────────────────────────

  private applyTransform() {
    this.root.setAttribute('transform', `translate(${this.panX}, ${this.panY})`)
  }

  private bindEvents(container: HTMLElement) {
    container.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('.task-block, .milestone-flag, .add-btn')) return
      this.isPanning = true
      this.lastPointer = { x: e.clientX, y: e.clientY }
      container.classList.add('panning')
      container.setPointerCapture(e.pointerId)
    })

    container.addEventListener('pointermove', (e) => {
      if (!this.isPanning) return
      this.panX += e.clientX - this.lastPointer.x
      this.panY += e.clientY - this.lastPointer.y
      this.lastPointer = { x: e.clientX, y: e.clientY }
      this.applyTransform()
    })

    const endPan = () => { this.isPanning = false; container.classList.remove('panning') }
    container.addEventListener('pointerup', endPan)
    container.addEventListener('pointercancel', endPan)

    container.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (e.shiftKey) {
        const factor = e.deltaY < 0 ? 1.12 : 0.9
        this.pxPerDay = Math.max(2, Math.min(40, this.pxPerDay * factor))
        this.render()
      } else {
        this.panX -= e.deltaX
        this.panY -= e.deltaY
        this.applyTransform()
      }
    }, { passive: false })
  }

  zoomIn()    { this.pxPerDay = Math.min(40, this.pxPerDay * 1.2); this.render() }
  zoomOut()   { this.pxPerDay = Math.max(2,  this.pxPerDay / 1.2); this.render() }
  zoomReset() { this.pxPerDay = PX_PER_DAY; this.panX = 0; this.panY = 0; this.render() }
}
