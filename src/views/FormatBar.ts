import type { RuntimeTask, Project } from '../types'

const COLOR_PRESETS: Array<{ bg: string; text: string; label: string }> = [
  { bg: '#1e3a5f', text: '#dbeafe', label: 'Navy' },
  { bg: '#052e16', text: '#d1fae5', label: 'Forest' },
  { bg: '#3b0764', text: '#ede9fe', label: 'Plum' },
  { bg: '#450a0a', text: '#fee2e2', label: 'Crimson' },
  { bg: '#1c1917', text: '#fafaf9', label: 'Slate' },
  { bg: '#713f12', text: '#fef3c7', label: 'Amber' },
  { bg: '#0c4a6e', text: '#e0f2fe', label: 'Sky' },
  { bg: '#134e4a', text: '#ccfbf1', label: 'Teal' },
  { bg: '#f1f5f9', text: '#1e293b', label: 'Light' },
  { bg: '#ffffff', text: '#111111', label: 'White' },
]

export class FormatBar {
  private el: HTMLElement
  private selectedTask: RuntimeTask | null = null
  private onChangeCallback: (() => void) | null = null
  private _project: Project | null = null

  constructor(container: HTMLElement) {
    this.el = document.createElement('div')
    this.el.id = 'format-bar'
    this.el.style.display = 'none'
    container.appendChild(this.el)
  }

  bind(project: Project, onChange: () => void) {
    this.onChangeCallback = onChange
    this._project = project
  }

  selectTask(rt: RuntimeTask | null) {
    // Milestones are not tasks; only ticket/container tasks are styleable.
    this.selectedTask = rt
    if (!rt) { this.el.style.display = 'none'; return }
    this.el.style.display = 'flex'
    this.render()
  }

  private render() {
    const rt = this.selectedTask
    const project = this._project
    if (!rt || !project) return

    const tags = [...project.tags.values()]
    this.el.innerHTML = `
      <span class="fb-label">${rt.raw.name}</span>
      <span class="fb-sep"></span>
      <span class="fb-group-label">Color</span>
      <div class="fb-swatches" id="fb-swatches"></div>
      <span class="fb-sep"></span>
      <span class="fb-group-label">Tags</span>
      <div class="fb-tags" id="fb-tags"></div>
    `

    const swatchWrap = this.el.querySelector('#fb-swatches')!
    for (const preset of COLOR_PRESETS) {
      const swatch = document.createElement('button')
      swatch.className = 'fb-swatch'
      swatch.title = preset.label
      swatch.style.background = preset.bg
      swatch.style.outline = rt.raw.style.background === preset.bg ? '2px solid #2563eb' : 'none'
      swatch.addEventListener('click', () => {
        rt.raw.style.background = preset.bg
        rt.raw.style.text = preset.text
        project.dirty = true
        this.onChangeCallback?.()
        this.render()
      })
      swatchWrap.appendChild(swatch)
    }

    const tagWrap = this.el.querySelector('#fb-tags')!
    if (tags.length === 0) {
      tagWrap.innerHTML = '<span class="muted" style="font-size:11px">none — add via Tags menu</span>'
    }
    for (const tag of tags) {
      const chip = document.createElement('button')
      chip.className = 'chip' + (rt.raw.tags.includes(tag.id) ? ' on' : '')
      chip.style.setProperty('--chip', tag.color)
      chip.textContent = tag.name
      chip.addEventListener('click', () => {
        const i = rt.raw.tags.indexOf(tag.id)
        if (i >= 0) rt.raw.tags.splice(i, 1)
        else rt.raw.tags.push(tag.id)
        project.dirty = true
        this.onChangeCallback?.()
        this.render()
      })
      tagWrap.appendChild(chip)
    }
  }
}
