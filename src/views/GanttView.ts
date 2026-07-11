import type { Project, NodeId, SectionLayout, LayoutNode } from '../types'
import { buildLayout } from '../engine/layout'
import { renderTaskBlock } from '../render/TaskBlock'
import { renderMilestoneFlag } from '../render/MilestoneFlag'
import { renderConnectors } from '../render/Connector'
import { openDetailModal } from './DetailModal'

const OUTER_PAD = 40   // px above/below the section content
const DATE_BAR_H = 36  // reserved height at top for date axis

export class GanttView {
  private svg: SVGSVGElement
  private root: SVGGElement   // pan/zoom transform applied here
  private project: Project
  private drillStack: Array<{ parentId: NodeId | null; label: string }> = []
  private currentParent: NodeId | null = null

  // pan state
  private panX = 0
  private panY = 0
  private isPanning = false
  private lastPointer = { x: 0, y: 0 }

  // time zoom (px per day multiplier)
  private timeZoom = 1.0

  constructor(container: HTMLElement, project: Project) {
    this.project = project

    container.innerHTML = ''
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('id', 'gantt-svg')
    container.appendChild(this.svg)

    this.root = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.root.setAttribute('id', 'root-g')
    this.svg.appendChild(this.root)

    this.drillStack = [{ parentId: null, label: project.meta.name }]
    this.render()
    this.bindEvents(container)
  }

  private render() {
    this.root.innerHTML = ''

    const layouts = buildLayout(this.project, this.currentParent)
    if (layouts.length === 0) return

    // Compute canvas size
    let totalW = 0
    let maxH = 0
    for (const sec of layouts) {
      totalW += sec.width
      if (sec.height > maxH) maxH = sec.height
    }

    const canvasH = maxH + DATE_BAR_H + OUTER_PAD * 2
    this.svg.setAttribute('viewBox', `0 0 ${totalW + 200} ${canvasH}`)

    // Date axis background
    const dateBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    dateBar.setAttribute('x', '0')
    dateBar.setAttribute('y', '0')
    dateBar.setAttribute('width', String(totalW + 200))
    dateBar.setAttribute('height', String(DATE_BAR_H))
    dateBar.setAttribute('fill', '#f8fafc')
    this.root.appendChild(dateBar)

    // Render each section
    let xCursor = 0
    for (const sec of layouts) {
      this.renderSection(sec, xCursor, DATE_BAR_H + OUTER_PAD)
      xCursor += sec.width
    }

    this.applyTransform()
  }

  private renderSection(sec: SectionLayout, xOff: number, yOff: number) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('transform', `translate(${xOff}, ${yOff})`)

    const nodeMap = new Map<string, LayoutNode>(sec.nodes.map(n => [n.id, n]))

    // Connectors first (drawn behind tasks)
    const connPaths = renderConnectors(sec.connectors, nodeMap, 0)
    for (const p of connPaths) g.appendChild(p)

    // Tasks and milestones
    for (const node of sec.nodes) {
      const rt = this.project.tasks.get(node.id)
      if (!rt) continue

      if (rt.raw.type === 'milestone') {
        const flag = renderMilestoneFlag(
          node, rt.raw.name, 0, sec.height,
          () => this.drillInto(node.id, rt.raw.name)
        )
        g.appendChild(flag)
      } else {
        const block = renderTaskBlock(
          node, rt, this.project, 0,
          () => openDetailModal(rt, this.project, () => this.render()),
          () => this.addTaskAfter(node.id),
          () => this.addTaskBefore(node.id)
        )
        g.appendChild(block)
      }
    }

    this.root.appendChild(g)
  }

  private drillInto(milestoneId: NodeId, name: string) {
    // Find the task this milestone terminates
    const ms = this.project.tasks.get(milestoneId)
    if (!ms || ms.raw.type !== 'milestone') return
    const terminates = ms.raw.terminates
    if (!terminates) return

    this.drillStack.push({ parentId: terminates, label: name })
    this.currentParent = terminates
    this.panX = 0; this.panY = 0
    this.render()
    this.updateBreadcrumb()
  }

  drillTo(depth: number) {
    this.drillStack = this.drillStack.slice(0, depth + 1)
    this.currentParent = this.drillStack[this.drillStack.length - 1].parentId
    this.panX = 0; this.panY = 0
    this.render()
    this.updateBreadcrumb()
  }

  getBreadcrumb(): Array<{ label: string; depth: number }> {
    return this.drillStack.map((e, i) => ({ label: e.label, depth: i }))
  }

  private updateBreadcrumb() {
    document.dispatchEvent(new CustomEvent('planar:breadcrumb', { detail: this.getBreadcrumb() }))
  }

  private addTaskAfter(_afterId: NodeId) {
    // Stub: will be wired up in interactions step
    alert('Add task after: coming soon')
  }

  private addTaskBefore(_beforeId: NodeId) {
    alert('Add prereq before: coming soon')
  }

  // ─── Pan / zoom ────────────────────────────────────────────────

  private applyTransform() {
    this.root.setAttribute('transform', `translate(${this.panX}, ${this.panY})`)
  }

  private bindEvents(container: HTMLElement) {
    // Pan: pointer drag
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

    // Scroll: pan left/right (and up/down)
    container.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (e.shiftKey) {
        // Time-axis zoom
        const factor = e.deltaY < 0 ? 1.1 : 0.9
        this.timeZoom = Math.max(0.2, Math.min(5, this.timeZoom * factor))
        // TODO: apply timeZoom to PX_PER_DAY and re-render
        this.render()
      } else {
        this.panX -= e.deltaX
        this.panY -= e.deltaY
        this.applyTransform()
      }
    }, { passive: false })
  }

  zoomIn()  { this.timeZoom = Math.min(5, this.timeZoom * 1.2); this.render() }
  zoomOut() { this.timeZoom = Math.max(0.2, this.timeZoom / 1.2); this.render() }
  zoomReset() { this.timeZoom = 1; this.panX = 0; this.panY = 0; this.render() }
}
