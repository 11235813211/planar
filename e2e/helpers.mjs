// Reusable Playwright harness for Planar.
//
// Usage:
//   import { withApp } from './helpers.mjs'
//   await withApp(async (app) => {
//     await app.loadExample()
//     console.log(await app.counts())
//   })
//
// Assumes the dev server is running (npm run dev). Override with PLANAR_URL.
// Run headed for debugging:  HEADED=1 node e2e/whatever.mjs

import { chromium } from 'playwright'

const URL = process.env.PLANAR_URL || 'http://localhost:5173/planar/'

export async function withApp(fn, opts = {}) {
  const {
    viewport = { width: 1300, height: 800 },
    headless = process.env.HEADED ? false : true,
  } = opts
  const browser = await chromium.launch({ headless })
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`) })
  await page.goto(URL, { waitUntil: 'networkidle' })
  const app = makeApp(page, errors)
  try {
    return await fn(app, page)
  } finally {
    await browser.close()
  }
}

function makeApp(page, errors) {
  const wait = (ms = 150) => page.waitForTimeout(ms)

  // Center of the nth element matching a selector (in client coords).
  const centerOf = (sel, i = 0) =>
    page.$$eval(sel, (els, i) => {
      const e = els[i]; if (!e) return null
      const r = e.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, i)

  const rectOf = (sel, i = 0) =>
    page.$$eval(sel, (els, i) => {
      const e = els[i]; if (!e) return null
      const r = e.getBoundingClientRect()
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
    }, i)

  const clickCenter = async (sel, i = 0) => {
    const c = await centerOf(sel, i)
    if (!c) throw new Error(`clickCenter: no element for ${sel}[${i}]`)
    await page.mouse.click(c.x, c.y); await wait(120)
  }
  const dblclickCenter = async (sel, i = 0) => {
    const c = await centerOf(sel, i)
    if (!c) throw new Error(`dblclickCenter: no element for ${sel}[${i}]`)
    await page.mouse.dblclick(c.x, c.y); await wait(160)
  }

  // Gantt task helpers (by data-id). Click near the left edge to avoid avatars.
  const taskPoint = (id) =>
    page.$eval(`.task-block[data-id="${id}"] .bar-rect`, e => {
      const r = e.getBoundingClientRect()
      return { x: r.left + Math.min(12, r.width / 2), y: r.top + r.height / 2 }
    })

  return {
    page, errors,
    wait,
    centerOf, rectOf,

    // --- app lifecycle ---
    // Always start from a fresh page so it works even after a project is loaded.
    async loadExample() {
      if (!(await page.isVisible('#su-example'))) { await page.goto(URL, { waitUntil: 'networkidle' }) }
      await page.click('#su-example'); await wait(350)
    },
    async newProject() {
      if (!(await page.isVisible('#su-new'))) { await page.goto(URL, { waitUntil: 'networkidle' }) }
      await page.click('#su-new'); await wait(350)
    },
    async gotoKanban() { await page.click('#btn-kanban'); await wait(250) },
    async gotoGantt() { await page.click('#btn-gantt'); await wait(250) },
    async openTags() { await page.click('#btn-tags'); await wait(200) },

    // --- generic interactions (real mouse at element center) ---
    click: clickCenter,
    dblclick: dblclickCenter,
    async hover(sel, i = 0) { const c = await centerOf(sel, i); if (c) { await page.mouse.move(c.x, c.y); await wait(80) } },

    // --- gantt task interactions ---
    async clickTask(id) { const pt = await taskPoint(id); await page.mouse.click(pt.x, pt.y); await wait(140) },
    async dblclickTask(id) { const pt = await taskPoint(id); await page.mouse.dblclick(pt.x, pt.y); await wait(160) },
    async hoverTask(id) { const pt = await taskPoint(id); await page.mouse.move(pt.x, pt.y); await wait(120) },
    // Click the +after / +before hover button on a task (0 = right/after, 1 = left/before).
    async clickAddBtn(id, which = 0) {
      await this.hoverTask(id)
      const c = await page.$$eval(`.task-block[data-id="${id}"] .add-btn`,
        (els, i) => { const r = els[i].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, which)
      await page.mouse.click(c.x, c.y); await wait(160)
    },

    // --- counts / state snapshot ---
    counts: () => page.evaluate(() => ({
      tasks: document.querySelectorAll('.task-block').length,
      containers: document.querySelectorAll('.container-task').length,
      milestones: document.querySelectorAll('.milestone-flag').length,
      panels: document.querySelectorAll('.panel-bar').length,
      kcols: document.querySelectorAll('.kanban-col').length,
      cards: document.querySelectorAll('.kanban-card').length,
      modalOpen: !!document.querySelector('.modal-overlay'),
      formatBarShown: document.getElementById('format-bar') ? getComputedStyle(document.getElementById('format-bar')).display !== 'none' : false,
      breadcrumb: document.getElementById('breadcrumb')?.textContent.trim() || '',
    })),

    // Data-model snapshot pulled from the running app (tasks + prereqs).
    model: () => page.evaluate(() => {
      const w = window
      const proj = w.__planar
      if (!proj) return { error: 'window.__planar not exposed' }
      const tasks = [...proj.tasks.values()].map(rt => ({
        id: rt.raw.id, name: rt.raw.name, type: rt.raw.type,
        parent: rt.raw.parent, prereqs: rt.raw.prerequisites,
        start: rt.computed?.start?.toISOString().slice(0, 10),
        end: rt.computed?.end?.toISOString().slice(0, 10),
      }))
      return { tasks, roots: proj.roots.map(r => r.raw.id) }
    }),

    // --- modal helpers ---
    modalOpen: () => page.$eval('body', () => !!document.querySelector('.modal-overlay')).catch(() => false),
    async fill(sel, val) { await page.fill(sel, String(val)); await wait(60) },

    // Re-run the scheduler on the live project; returns ScheduleConflict[].
    reschedule: () => page.evaluate(() => window.__reschedule()),
    // Mutate a task's raw fields directly, then reschedule (for scheduling tests).
    setRaw: (id, patch) => page.evaluate(({ id, patch }) => {
      const rt = window.__planar.tasks.get(id)
      Object.assign(rt.raw, patch)
      return window.__reschedule()
    }, { id, patch }),

    // --- misc ---
    eval: (fn, ...args) => page.evaluate(fn, ...args),
    elementAtCenterOf: async (sel, i = 0) => {
      const c = await centerOf(sel, i); if (!c) return null
      return page.evaluate(({ x, y }) => {
        const e = document.elementFromPoint(x, y)
        return e ? `${e.tagName}.${(e.getAttribute('class') || '').split(' ').join('.')}` : 'null'
      }, c)
    },
    async shot(name) { await page.screenshot({ path: `e2e/shots/${name}.png` }); return `e2e/shots/${name}.png` },
    dumpErrors() { return errors.length ? errors.join('\n') : '(none)' },
  }
}
