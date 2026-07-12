// Shared modal behaviours.

/** Pressing Enter (outside a textarea) triggers the primary button (.btn.active). */
export function bindModalEnter(overlay: HTMLElement) {
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
    const primary = overlay.querySelector<HTMLElement>('.btn.active')
    if (primary) { e.preventDefault(); primary.click() }
  })
}
