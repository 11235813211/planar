import type { Project, NodeId, LayoutNode, RuntimeTask, TicketTask, SectionLayout } from '../types'
import { buildLayout, PX_PER_DAY, SECTION_H_PAD, ROW_STRIDE, TASK_HEIGHT } from '../engine/layout'
import { renderTaskBlock } from '../render/TaskBlock'
import { renderMilestoneFlag } from '../render/MilestoneFlag'
import { renderConnectors } from '../render/Connector'
import { openDetailModal } from './DetailModal'
import { FormatBar } from './FormatBar'
import { schedule } from '../engine/scheduler'
import { newTaskId } from '../data/ids'
import { openAddTaskModal } from './AddTaskModal'
import type { NewTaskData } from './AddTaskModal'

// ─── Layout constants ─────────────────────────────────────────────────────────

const DATE_BAR_H = 56   // total height of the two-row date axis
const COARSE_H   = 22   // top row height (year / month label)
const OUTER_PAD  = 44   // space above tasks (flag floats here)
const MS         = 86_400_000

// ─── Adaptive date axis ───────────────────────────────────────────────────────

type Granularity = { coarse: 'year' | 'month', fine: 'quarter' | 'month' | 'week' | 'day' }

function granularity(pxPerDay: number): Granularity {
  if (pxPerDay >= 20) return { coarse: 'month',  fine: 'day'     }
  if (pxPerDay >= 5)  return { coarse: 'month',  fine: 'week'    }
  if (pxPerDay >= 1)  return { coarse: 'year',   fine: 'month'   }
  return                     { coarse: 'year',   fine: 'quarter' }
}

function addDays(d: Date, n: number): Date { return new Date(d.getTime() + n * MS) }

function advanceToNext(d: Date, unit: Granularity['fine'] | Granularity['coarse']): Date {
  const out = new Date(d)
  switch (unit) {
    case 'day':     out.setUTCDate(out.getUTCDate() + 1); break
    case 'week':    out.setUTCDate(out.getUTCDate() + 7); break
    case 'month':   out.setUTCMonth(out.getUTCMonth() + 1); out.setUTCDate(1); break
    case 'quarter': out.setUTCMonth(Math.floor(out.getUTCMonth() / 3) * 3 + 3); out.setUTCDate(1); break
    case 'year':    out.setUTCFullYear(out.getUTCFullYear() + 1); out.setUTCMonth(0); out.setUTCDate(1); break
  }
  return out
}

function snapTo(d: Date, unit: Granularity['fine'] | Granularity['coarse']): Date {
  const out = new Date(d)
  switch (unit) {
    case 'day':     break
    case 'week':    out.setUTCDate(out.getUTCDate() - out.getUTCDay()); break
    case 'month':   out.setUTCDate(1); break
    case 'quarter': out.setUTCMonth(Math.floor(out.getUTCMonth() / 3) * 3); out.setUTCDate(1); break
    case 'year':    out.setUTCMonth(0); out.setUTCDate(1); break
  }
  return out
}

function fineLabel(d: Date, unit: Granularity['fine']): string {
  switch (unit) {
    case 'day':     return String(d.getUTCDate())
    case 'week':    return `W${Math.ceil(d.getUTCDate() / 7)}`
    case 'month':   return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
    case 'quarter': return `Q${Math.floor(d.getUTCMonth() / 3) + 1}`
  }
}

function coarseLabel(d: Date, unit: Granularity['coarse']): string {
  switch (unit) {
    case 'month': return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    case 'year':  return String(d.getUTCFullYear())
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tag)
}

function renderDateAxis(
  g: SVGGElement,
  sectionStart: Date,
  canvasWidth: number,
  pxPerDay: number,
): void {
  const gr = granularity(pxPerDay)
  const totalDays = canvasWidth / pxPerDay

  // Background
  const bg = svgEl('rect')
  bg.setAttribute('x', '0'); bg.setAttribute('y', '0')
  bg.setAttribute('width', String(canvasWidth + 200))
  bg.setAttribute('height', String(DATE_BAR_H))
  bg.setAttribute('fill', '#f8fafc')
  g.appendChild(bg)

  // Bottom border line
  const border = svgEl('line')
  border.setAttribute('x1', '0'); border.setAttribute('y1', String(DATE_BAR_H))
  border.setAttribute('x2', String(canvasWidth + 200)); border.setAttribute('y2', String(DATE_BAR_H))
  border.setAttribute('stroke', '#e2e8f0'); border.setAttribute('stroke-width', '1')
  g.appendChild(border)

  // Mid divider between coarse/fine rows
  const mid = svgEl('line')
  mid.setAttribute('x1', '0'); mid.setAttribute('y1', String(COARSE_H))
  mid.setAttribute('x2', String(canvasWidth + 200)); mid.setAttribute('y2', String(COARSE_H))
  mid.setAttribute('stroke', '#e2e8f0'); mid.setAttribute('stroke-width', '1')
  g.appendChild(mid)

  function xOf(d: Date): number {
    return SECTION_H_PAD + ((d.getTime() - sectionStart.getTime()) / MS) * pxPerDay
  }

  // ── Coarse row ─────────────────────────────────────────────────────────────
  {
    let d = snapTo(sectionStart, gr.coarse)
    if (d > sectionStart) d = snapTo(addDays(sectionStart, -1), gr.coarse)
    const end = addDays(sectionStart, totalDays + 60)

    while (d <= end) {
      const x = Math.max(0, xOf(d))
      const next = advanceToNext(d, gr.coarse)
      const xNext = xOf(next)
      const w = Math.max(0, xNext - x)

      if (x < canvasWidth + 200) {
        // Vertical separator
        if (x > 0) {
          const sep = svgEl('line')
          sep.setAttribute('x1', String(x)); sep.setAttribute('y1', '0')
          sep.setAttribute('x2', String(x)); sep.setAttribute('y2', String(COARSE_H))
          sep.setAttribute('stroke', '#cbd5e1'); sep.setAttribute('stroke-width', '1')
          g.appendChild(sep)
        }
        // Label centred in band
        const lbl = svgEl('text')
        lbl.setAttribute('x', String(x + Math.min(w, canvasWidth + 200 - x) / 2))
        lbl.setAttribute('y', String(COARSE_H / 2 + 4))
        lbl.setAttribute('text-anchor', 'middle')
        lbl.setAttribute('fill', '#475569'); lbl.setAttribute('font-size', '11')
        lbl.setAttribute('font-weight', '600')
        lbl.textContent = coarseLabel(d, gr.coarse)
        g.appendChild(lbl)
      }
      d = next
    }
  }

  // ── Fine row ────────────────────────────────────────────────────────────────
  {
    let d = snapTo(sectionStart, gr.fine)
    if (d > sectionStart) d = snapTo(addDays(sectionStart, -1), gr.fine)
    const end = addDays(sectionStart, totalDays + 60)

    while (d <= end) {
      const x = xOf(d)
      const next = advanceToNext(d, gr.fine)
      const xNext = xOf(next)
      const bandW = xNext - x

      if (x < canvasWidth + 200 && xNext > 0) {
        // Tick + separator
        const sep = svgEl('line')
        sep.setAttribute('x1', String(x)); sep.setAttribute('y1', String(COARSE_H))
        sep.setAttribute('x2', String(x)); sep.setAttribute('y2', String(DATE_BAR_H))
        sep.setAttribute('stroke', '#e2e8f0'); sep.setAttribute('stroke-width', '1')
        g.appendChild(sep)

        // Label — only if band is wide enough
        if (bandW > 18) {
          const lbl = svgEl('text')
          lbl.setAttribute('x', String(x + Math.min(bandW, 200) / 2))
          lbl.setAttribute('y', String(COARSE_H + (DATE_BAR_H - COARSE_H) / 2 + 4))
          lbl.setAttribute('text-anchor', 'middle')
          lbl.setAttribute('fill', '#64748b'); lbl.setAttribute('font-size', '10')
          lbl.textContent = fineLabel(d, gr.fine)
          g.appendChild(lbl)
        }
      }
      d = next
    }
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

  const existing = document.getElementById('inline-title-input')
  if (existing) existing.remove()

  const rect    = labelEl.getBoundingClientRect()
  const input   = document.createElement('input')
  input.id      = 'inline-title-input'
  input.value   = rt.raw.name
  input.style.cssText = [
    `position:fixed`,
    `left:${rect.left - 4}px`, `top:${rect.top - 4}px`,
    `width:${Math.max(rect.width + 8, 120)}px`, `height:22px`,
    `font:12px system-ui,sans-serif`,
    `border:2px solid #2563eb`, `border-radius:4px`,
    `padding:0 4px`, `outline:none`, `z-index:200`,
    `background:#fff`, `color:#111`,
  ].join(';')

  labelEl.style.display = 'none'
  const stop = (e: Event) => e.stopPropagation()
  input.addEventListener('pointerdown', stop)
  input.addEventListener('pointermove', stop)
  void svgEl

  const commit = () => {
    const val = input.value.trim()
    if (val) { (rt.raw as TicketTask).name = val; project.dirty = true }
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

// ─── Screen → content coordinates ────────────────────────────────────────────

function screenToContent(
  svg: SVGSVGElement,
  clientX: number, clientY: number,
  panX: number, panY: number,
): { x: number; y: number } {
  const r  = svg.getBoundingClientRect()
  const vb = svg.viewBox.baseVal
  if (!vb || vb.width === 0) return { x: clientX - panX, y: clientY - panY }
  const sx = vb.width  / r.width
  const sy = vb.height / r.height
  return {
    x: (clientX - r.left) * sx - panX,
    y: (clientY - r.top)  * sy - DATE_BAR_H - panY,
  }
}

// ─── Order string ─────────────────────────────────────────────────────────────

function orderAfter(order: string): string { return order + 'm' }

// ─── GanttView ────────────────────────────────────────────────────────────────

type PlacementState = {
  data: NewTaskData
  snapTargetId: NodeId | null
  snapSide: 'after' | 'before'
}

export class GanttView {
  private container: HTMLElement
  private svg: SVGSVGElement
  private defs: SVGDefsElement
  private axisG: SVGGElement    // only panX applied
  private contentG: SVGGElement // panX + panY applied
  private ghostG: SVGGElement   // fixed overlay for placement ghost

  private project: Project
  private formatBar: FormatBar
  private drillStack: Array<{ parentId: NodeId | null; label: string }> = []
  private currentParent: NodeId | null = null
  private selectedId: NodeId | null = null
  private pxPerDay = PX_PER_DAY
  private panX = 0
  private panY = 0
  private isPanning = false
  private lastPointer = { x: 0, y: 0 }
  private pendingEditId: NodeId | null = null
  private placement: PlacementState | null = null

  // Cached layout info used by placement ghost
  private lastLayouts: SectionLayout[] = []

  constructor(container: HTMLElement, project: Project, formatBar: FormatBar) {
    this.container = container
    this.project   = project
    this.formatBar = formatBar
    this.formatBar.bind(project, () => this.render())

    container.innerHTML = ''

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement
    this.svg.style.cssText = 'width:100%;height:100%;display:block;'
    container.appendChild(this.svg)

    this.defs = svgEl('defs')
    this.svg.appendChild(this.defs)

    this.axisG    = svgEl('g')
    this.contentG = svgEl('g')
    this.ghostG   = svgEl('g')
    this.ghostG.setAttribute('pointer-events', 'none')

    this.svg.appendChild(this.axisG)
    this.svg.appendChild(this.contentG)
    this.svg.appendChild(this.ghostG)

    // Clip path so content never scrolls under the axis
    const clip = svgEl('clipPath')
    clip.setAttribute('id', 'content-clip')
    const clipRect = svgEl('rect')
    clipRect.setAttribute('x', '-10000')
    clipRect.setAttribute('y', String(DATE_BAR_H))
    clipRect.setAttribute('width', '20000')
    clipRect.setAttribute('height', '99999')
    clip.appendChild(clipRect)
    this.defs.appendChild(clip)
    this.contentG.setAttribute('clip-path', 'url(#content-clip)')

    this.drillStack = [{ parentId: null, label: project.meta.name }]
    this.render()
    this.bindEvents(container)
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  render() {
    this.axisG.innerHTML    = ''
    this.contentG.innerHTML = ''
    this.ghostG.innerHTML   = ''

    const layouts = buildLayout(this.project, this.currentParent, this.pxPerDay)
    this.lastLayouts = layouts

    // Find earliest date for axis alignment
    let sectionStart: Date | null = null
    let totalW = 0, maxH = 0
    for (const sec of layouts) {
      totalW += sec.width
      maxH = Math.max(maxH, sec.height)
      for (const node of sec.nodes) {
        const c = this.project.tasks.get(node.id)?.computed
        if (c && (!sectionStart || c.start < sectionStart)) sectionStart = c.start
      }
    }
    const canvasW = totalW + 200
    const canvasH = DATE_BAR_H + OUTER_PAD + maxH + ROW_STRIDE + 60
    this.svg.setAttribute('viewBox', `0 0 ${canvasW} ${canvasH}`)

    // ── Date axis ────────────────────────────────────────────────────────────
    if (sectionStart) {
      renderDateAxis(this.axisG, sectionStart, totalW, this.pxPerDay)
    }

    // ── Background (deselect on click) ────────────────────────────────────────
    const bg = svgEl('rect')
    bg.setAttribute('x', '0'); bg.setAttribute('y', String(DATE_BAR_H))
    bg.setAttribute('width', String(canvasW)); bg.setAttribute('height', String(canvasH))
    bg.setAttribute('fill', 'transparent')
    bg.addEventListener('click', () => {
      if (this.placement) { this.commitPlacement(null); return }
      this.selectTask(null)
    })
    this.contentG.appendChild(bg)

    // ── Task sections ─────────────────────────────────────────────────────────
    const contentOffset = DATE_BAR_H + OUTER_PAD
    let xCursor = 0
    for (const sec of layouts) {
      this.renderSection(sec, xCursor, contentOffset, maxH)
      xCursor += sec.width
    }

    // ── Placement ghost ───────────────────────────────────────────────────────
    if (this.placement) this.renderGhost()

    // ── Pending inline edit ───────────────────────────────────────────────────
    if (this.pendingEditId) {
      const el = this.svg.querySelector<SVGTextElement>(
        `.task-name-label[data-id="${this.pendingEditId}"]`
      )
      if (el) {
        const taskRT = this.project.tasks.get(this.pendingEditId)!
        startInlineEdit(el, this.svg, taskRT, this.project, () => this.render())
      }
      this.pendingEditId = null
    }

    this.applyTransform()
  }

  private renderSection(
    sec: SectionLayout, xOff: number, yOff: number, sectionH: number,
  ) {
    const g = svgEl('g')
    g.setAttribute('transform', `translate(${xOff}, ${yOff})`)

    const nodeMap = new Map<string, LayoutNode>(sec.nodes.map(n => [n.id, n]))
    for (const p of renderConnectors(sec.connectors, nodeMap, 0)) g.appendChild(p)

    for (const node of sec.nodes) {
      const rt = this.project.tasks.get(node.id)
      if (!rt) continue

      if (rt.raw.type === 'milestone') {
        const flag = renderMilestoneFlag(
          node, rt.raw.name, 0, sectionH,
          rt.raw.style.background || '#7c3aed',
          () => this.drillInto(node.id, rt.raw.name),
        )
        // Highlight snap target in placement mode
        if (this.placement?.snapTargetId === node.id) {
          flag.style.filter = 'brightness(1.3)'
        }
        g.appendChild(flag)
      } else {
        const isSnap   = this.placement?.snapTargetId === node.id
        const snapSide = this.placement?.snapSide ?? 'after'

        const block = renderTaskBlock(
          node, rt, this.project, 0,
          this.selectedId === node.id,
          () => {
            if (this.placement) { this.commitPlacement(node.id); return }
            this.selectTask(node.id)
          },
          () => {
            if (!this.placement) openDetailModal(rt, this.project, () => this.render())
          },
          (labelEl) => startInlineEdit(labelEl, this.svg, rt, this.project, () => this.render()),
          () => this.addTask(node.id, 'after'),
          () => this.addTask(node.id, 'before'),
        )

        // Snap highlight overlay in placement mode
        if (isSnap) {
          const hl = svgEl('rect')
          hl.setAttribute('x', String(node.x + (snapSide === 'after' ? node.width * 0.5 : 0)))
          hl.setAttribute('y', String(node.y - 2))
          hl.setAttribute('width', String(node.width * 0.5 + 4))
          hl.setAttribute('height', String(TASK_HEIGHT + 4))
          hl.setAttribute('rx', '6')
          hl.setAttribute('fill', '#2563eb')
          hl.setAttribute('opacity', '0.25')
          hl.setAttribute('pointer-events', 'none')
          block.appendChild(hl)
        }

        // In placement mode, hover sets snap target
        if (this.placement) {
          block.style.cursor = 'crosshair'
          block.addEventListener('mousemove', (e) => {
            const br = block.getBoundingClientRect()
            const side: 'before' | 'after' = e.clientX < br.left + br.width / 2 ? 'before' : 'after'
            if (
              this.placement?.snapTargetId !== node.id ||
              this.placement?.snapSide !== side
            ) {
              this.placement!.snapTargetId = node.id
              this.placement!.snapSide = side
              this.render()
            }
          })
          block.addEventListener('mouseleave', () => {
            if (this.placement?.snapTargetId === node.id) {
              this.placement!.snapTargetId = null
              this.render()
            }
          })
        }

        g.appendChild(block)
      }
    }
    this.contentG.appendChild(g)
  }

  private renderGhost() {
    if (!this.placement) return
    const { data } = this.placement
    const ghostW = Math.max(data.duration * this.pxPerDay, 80)
    const ghostH = TASK_HEIGHT

    const g = svgEl('g')
    g.setAttribute('id', 'placement-ghost')

    const rect = svgEl('rect')
    rect.setAttribute('width', String(ghostW))
    rect.setAttribute('height', String(ghostH))
    rect.setAttribute('rx', '6')
    rect.setAttribute('fill', '#2563eb')
    rect.setAttribute('opacity', '0.15')
    rect.setAttribute('stroke', '#2563eb')
    rect.setAttribute('stroke-width', '2')
    rect.setAttribute('stroke-dasharray', '6 3')

    const lbl = svgEl('text')
    lbl.setAttribute('x', '8')
    lbl.setAttribute('y', String(ghostH / 2 + 4))
    lbl.setAttribute('fill', '#1d4ed8')
    lbl.setAttribute('font-size', '12')
    lbl.setAttribute('font-weight', '500')
    lbl.textContent = data.name

    g.appendChild(rect); g.appendChild(lbl)

    // Position ghost at snap target + side, or at centre of viewport
    const layouts = this.lastLayouts
    const snap = this.placement.snapTargetId
    let placed = false

    if (snap) {
      for (const sec of layouts) {
        const node = sec.nodes.find(n => n.id === snap)
        if (node) {
          const absX = sec.xOffset + node.x +
            (this.placement.snapSide === 'after' ? node.width + 16 : -ghostW - 16)
          const absY = node.y
          // Convert from content space to SVG space (add panX and offset)
          const svgX = this.panX + absX
          const svgY = this.panY + DATE_BAR_H + OUTER_PAD + absY
          g.setAttribute('transform', `translate(${svgX}, ${svgY})`)
          placed = true

          // Preview connector
          const cx1 = this.placement.snapSide === 'after'
            ? svgX - 16 : svgX + ghostW + 16
          const cy1 = svgY + ghostH / 2
          const cx2 = this.placement.snapSide === 'after'
            ? svgX : svgX + ghostW
          const cy2 = svgY + ghostH / 2
          const line = svgEl('line')
          line.setAttribute('x1', String(cx1)); line.setAttribute('y1', String(cy1))
          line.setAttribute('x2', String(cx2)); line.setAttribute('y2', String(cy2))
          line.setAttribute('stroke', '#2563eb'); line.setAttribute('stroke-width', '2')
          line.setAttribute('stroke-dasharray', '5 3')
          this.ghostG.appendChild(line)
          break
        }
      }
    }

    if (!placed) {
      // Float near top-centre of viewport
      const vb = this.svg.viewBox.baseVal
      const cx = vb ? vb.width / 2 : 400
      g.setAttribute('transform', `translate(${cx - ghostW / 2}, ${DATE_BAR_H + OUTER_PAD + 20})`)
    }

    this.ghostG.appendChild(g)
  }

  // ─── Task creation ───────────────────────────────────────────────────────────

  /** Called by the toolbar "Add Task" button — opens modal then enters placement mode. */
  openAddTaskModal() {
    openAddTaskModal(
      (data) => this.enterPlacementMode(data),
      () => { /* cancelled */ },
    )
  }

  private enterPlacementMode(data: NewTaskData) {
    this.placement = { data, snapTargetId: null, snapSide: 'after' }
    this.container.classList.add('placing')
    document.dispatchEvent(new CustomEvent('planar:placement', { detail: { active: true, hint: 'Click a task to place after it (left half = before), or click empty space to append. Esc to cancel.' } }))
    this.render()
  }

  private exitPlacementMode() {
    this.placement = null
    this.container.classList.remove('placing')
    document.dispatchEvent(new CustomEvent('planar:placement', { detail: { active: false, hint: '' } }))
    this.render()
  }

  private commitPlacement(targetId: NodeId | null) {
    if (!this.placement) return
    const { data, snapSide } = this.placement
    const afterId = targetId && snapSide === 'after' ? targetId : null
    const beforeId = targetId && snapSide === 'before' ? targetId : null
    this.exitPlacementMode()
    this.createTask(data, afterId, beforeId)
  }

  private createTask(data: NewTaskData, afterId: NodeId | null, beforeId: NodeId | null) {
    const siblings = this.currentParent === null
      ? this.project.roots
      : (this.project.tasks.get(this.currentParent)?.children ?? [])

    const today = new Date().toISOString().split('T')[0]
    const id    = newTaskId()

    // Determine insertion order and prerequisites
    let order: string
    let prereqs: NodeId[] = []

    if (afterId) {
      const afterRT  = this.project.tasks.get(afterId)
      const afterIdx = siblings.findIndex(s => s.raw.id === afterId)
      order   = orderAfter(afterRT?.raw.order ?? 'a0')
      prereqs = [afterId]

      // Thread: successors of afterId now point to the new task (#3)
      const successors = siblings.filter(s =>
        s.raw.id !== id && s.raw.prerequisites.includes(afterId)
      )
      for (const succ of successors) {
        succ.raw.prerequisites = succ.raw.prerequisites.map(p => p === afterId ? id : p)
      }

      const raw: TicketTask = {
        id, name: data.name, type: 'task',
        parent: this.currentParent, order,
        timeMode: 'duration', duration: data.duration, start: today,
        prerequisites: prereqs,
        assignees: [], status: 'todo', ticket: data.ticket,
        style: { background: '#334155', text: '#f1f5f9' },
      }
      const rt: RuntimeTask = { raw, children: [], computed: null }
      this.project.tasks.set(id, rt)
      siblings.splice(afterIdx + 1, 0, rt)

    } else if (beforeId) {
      const beforeRT  = this.project.tasks.get(beforeId)
      const beforeIdx = siblings.findIndex(s => s.raw.id === beforeId)
      // New task takes the beforeId's prereqs; beforeId now depends on new task
      const prevPrereqs = beforeRT?.raw.prerequisites ?? []
      order   = String(beforeRT?.raw.order ?? 'a0') + 'a'  // sort before
      prereqs = [...prevPrereqs]

      if (beforeRT) beforeRT.raw.prerequisites = [id]

      const raw: TicketTask = {
        id, name: data.name, type: 'task',
        parent: this.currentParent, order,
        timeMode: 'duration', duration: data.duration, start: today,
        prerequisites: prereqs,
        assignees: [], status: 'todo', ticket: data.ticket,
        style: { background: '#334155', text: '#f1f5f9' },
      }
      const rt: RuntimeTask = { raw, children: [], computed: null }
      this.project.tasks.set(id, rt)
      siblings.splice(beforeIdx, 0, rt)

    } else {
      // Append to end
      const last  = siblings[siblings.length - 1]
      order  = last ? orderAfter(last.raw.order) : 'a0'
      prereqs = last && last.raw.type === 'task' ? [last.raw.id] : []

      const raw: TicketTask = {
        id, name: data.name, type: 'task',
        parent: this.currentParent, order,
        timeMode: 'duration', duration: data.duration, start: today,
        prerequisites: prereqs,
        assignees: [], status: 'todo', ticket: data.ticket,
        style: { background: '#334155', text: '#f1f5f9' },
      }
      const rt: RuntimeTask = { raw, children: [], computed: null }
      this.project.tasks.set(id, rt)
      siblings.push(rt)
    }

    this.project.dirty = true
    schedule(this.project)
    this.pendingEditId = id
    this.render()
  }

  /** Quick inline add from the + hover buttons — uses threading. */
  addTask(adjacentId: NodeId, direction: 'after' | 'before') {
    this.createTask({ name: 'New Task', duration: 7, ticket: null },
      direction === 'after' ? adjacentId : null,
      direction === 'before' ? adjacentId : null,
    )
  }

  // ─── Selection ───────────────────────────────────────────────────────────────

  private selectTask(id: NodeId | null) {
    this.selectedId = id
    const rt = id ? (this.project.tasks.get(id) ?? null) : null
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
    this.axisG.setAttribute('transform', `translate(${this.panX}, 0)`)
    this.contentG.setAttribute('transform', `translate(${this.panX}, ${this.panY})`)
  }

  private bindEvents(container: HTMLElement) {
    container.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('.task-block, .milestone-flag, .add-btn')) return
      if (this.placement) return  // let click bubble to bg rect
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
        this.pxPerDay = Math.max(1.5, Math.min(60, this.pxPerDay * factor))
        this.render()
      } else {
        this.panX -= e.deltaX
        this.panY -= e.deltaY
        this.applyTransform()
      }
    }, { passive: false })

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.placement) {
        this.exitPlacementMode()
      }
    })

    // Ghost follows mouse in placement mode
    container.addEventListener('mousemove', (e) => {
      if (!this.placement || this.placement.snapTargetId) return
      // Ghost is already positioned to snap target when snap is active.
      // When no snap target, update ghost position each frame (lightweight: just re-render).
      void screenToContent(this.svg, e.clientX, e.clientY, this.panX, this.panY)
    })
  }

  zoomIn()    { this.pxPerDay = Math.min(60,  this.pxPerDay * 1.2); this.render() }
  zoomOut()   { this.pxPerDay = Math.max(1.5, this.pxPerDay / 1.2); this.render() }
  zoomReset() { this.pxPerDay = PX_PER_DAY; this.panX = 0; this.panY = 0; this.render() }
}
