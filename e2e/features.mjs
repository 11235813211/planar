// Broad feature test suite. Run: npm run e2e:features  (dev server must be up)
// Exits non-zero if any check fails, so it's ready to drop into CI later.
import { withApp } from './helpers.mjs'

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ok   ${msg}`) } else { fail++; console.log(`  FAIL ${msg}`) } }
const section = (t) => console.log(`\n## ${t}`)

await withApp(async (app) => {
  // ── Scheduling ────────────────────────────────────────────────────────────
  section('scheduling: floor propagation + envelope + date mode')
  await app.loadExample()
  let m = await app.model()
  const t = id => m.tasks.find(x => x.id === id)
  ok(t('t_plan').start === '2026-01-05', 'Planning seeds at its anchor 2026-01-05')
  ok(t('t_build').start === '2026-01-17', 'Build starts after Planning ends (17th)')
  ok(t('t_api').start === '2026-01-17', 'Build child inherits container floor (17th)')
  ok(t('t_build').end === t('t_ui').end, 'Build envelope end == latest child end')
  ok(t('t_launch').start === '2026-02-16' && t('t_launch').end === '2026-02-20', 'date-fixed Launch keeps its fixed dates')

  section('scheduling: date-fixed overrun is reported as a conflict')
  let conflicts = await app.setRaw('t_launch', { timeMode: 'date', start: '2026-01-10', end: '2026-01-14' })
  ok(Array.isArray(conflicts) && conflicts.some(c => c.nodeId === 't_launch'), 'Launch fixed before prereq end → conflict')
  conflicts = await app.setRaw('t_launch', { timeMode: 'date', start: '2026-02-16', end: '2026-02-20' })
  ok(conflicts.length === 0, 'no conflict once the fixed date is after prereqs')

  // ── Edit popup ────────────────────────────────────────────────────────────
  section('edit popup: single click, no X, edit fields, convert, delete, outside-close')
  await app.loadExample()
  await app.clickTask('t_wire')
  ok(await app.eval(() => { const p = document.querySelector('.edit-popup'); return !!p && getComputedStyle(p).display !== 'none' }), 'single click opens popup')
  ok(await app.eval(() => !document.querySelector('.ep-close')), 'no X/close button')
  await app.fill('#ep-name', 'Arch X'); await app.wait(150)
  ok((await app.eval(() => document.querySelector('.task-name-label[data-id="t_wire"]').textContent)).includes('Arch X'), 'name edit reflects on bar')
  ok(!!(await app.eval(() => document.querySelector('.ep-mode'))), 'has Duration/Date-fixed switch')
  // switch to date-fixed shows date inputs
  await app.eval(() => document.querySelector('.ep-mode .seg-btn[data-mode="date"]').click()); await app.wait(150)
  ok(!!(await app.eval(() => document.querySelector('#ep-start'))), 'date-fixed shows start/end inputs')
  // outside click closes
  await app.eval(() => { const r = document.querySelector('#canvas-wrap svg').getBoundingClientRect(); return r })
  await app.page.mouse.click(650, 600); await app.wait(120)
  ok(await app.eval(() => getComputedStyle(document.querySelector('.edit-popup')).display === 'none'), 'click outside closes popup')

  section('type: single-click never drills; double-click drills containers only')
  await app.clickTask('t_plan'); await app.wait(120)
  ok((await app.counts()).breadcrumb === '', 'single click on container does not drill')
  await app.dblclickTask('t_plan')
  ok((await app.counts()).breadcrumb.includes('Planning'), 'double click on container drills')
  await app.eval(() => document.querySelectorAll('#breadcrumb span[data-depth]')[0]?.click()); await app.wait(150)

  // ── Add task threading + staircase ─────────────────────────────────────────
  section('add task: threading A→C→B + staircase rows + sane dates')
  await app.dblclickTask('t_build')
  await app.clickAddBtn('t_api', 0)
  await app.fill('#atm-name', 'Mid'); await app.page.click('#atm-add'); await app.wait(300)
  await app.eval(() => document.querySelector('.edit-popup') && document.querySelector('#canvas-wrap svg') && (document.querySelectorAll('#breadcrumb span[data-depth]'), 0))
  await app.page.mouse.click(700, 600); await app.wait(120) // close popup
  m = await app.model()
  const mid = m.tasks.find(x => x.name === 'Mid')
  ok(!!mid && mid.prereqs.includes('t_api'), 'new task depends on API')
  ok(m.tasks.find(x => x.id === 't_ui').prereqs.includes(mid.id), 'Web UI now depends on new task')
  ok(new Date(mid.start) >= new Date('2026-01-17'), `new task anchored to timeline (not today): ${mid.start}`)
  await app.eval(() => document.querySelectorAll('#breadcrumb span[data-depth]')[0]?.click()); await app.wait(150)

  // ── Panels ─────────────────────────────────────────────────────────────────
  section('panels: add / reorder / recolor')
  let p0 = (await app.counts()).panels
  await app.click('.panel-add-btn')
  ok((await app.counts()).panels === p0 + 1, 'add panel works')
  const before = await app.eval(() => [...document.querySelectorAll('.panel-bar-name')].map(n => n.textContent))
  await app.eval(() => { const bars = [...document.querySelectorAll('.panel-bar')]; const dt = new DataTransfer(); bars[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); bars[1].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt })) })
  await app.wait(150)
  const after = await app.eval(() => [...document.querySelectorAll('.panel-bar-name')].map(n => n.textContent))
  ok(JSON.stringify(before) !== JSON.stringify(after), `reorder changes order (${before[0]}→${after[0]})`)

  // ── Kanban ───────────────────────────────────────────────────────────────
  section('kanban: add column, config, card edit, avatars, tags')
  await app.gotoKanban()
  const k0 = (await app.counts()).kcols
  await app.click('.kanban-add-col')
  ok((await app.counts()).kcols === k0 + 1, 'add column')
  await app.click('.kc-config')
  ok(await app.modalOpen(), 'gear opens config')
  await app.eval(() => { document.querySelector('#cc-name').value = 'Renamed'; document.querySelector('.modal .btn.active').click() }); await app.wait(150)
  ok(await app.eval(() => [...document.querySelectorAll('.kc-label')].some(l => l.textContent === 'Renamed')), 'column rename via config (Enter/Save)')
  ok((await app.counts()).cards > 0 && await app.eval(() => !!document.querySelector('.card-avatar')), 'cards show avatars')
  ok(await app.eval(() => !!document.querySelector('.card-tag')), 'cards show tag chips')

  // ── Modal Enter shortcut ────────────────────────────────────────────────────
  section('Enter submits the primary button in modals')
  await app.gotoGantt()
  await app.clickAddBtn('t_launch', 0)
  await app.fill('#atm-name', 'ViaEnter')
  await app.page.keyboard.press('Enter'); await app.wait(250)
  ok(await app.eval(() => [...document.querySelectorAll('.task-name-label')].some(t => t.textContent.includes('ViaEnter'))), 'Add-task modal submits on Enter')
  await app.page.mouse.click(700, 600); await app.wait(100)

  // ── Gestures ────────────────────────────────────────────────────────────────
  section('gestures: pan / time-zoom / uniform-zoom')
  await app.loadExample()
  const read = () => app.eval(() => {
    const svg = document.querySelector('#canvas-wrap svg')
    const w = id => { const e = document.querySelector(`.task-block[data-id="${id}"] .bar-rect`); return e ? Math.round(e.getBoundingClientRect().width) : 0 }
    const h = id => { const e = document.querySelector(`.task-block[data-id="${id}"] .bar-rect`); return e ? Math.round(e.getBoundingClientRect().height) : 0 }
    return { scale: /scale\(([\d.]+)\)/.exec(svg.children[0].getAttribute('transform'))?.[1], w: w('t_plan'), h: h('t_plan') }
  })
  const g0 = await read()
  await app.page.mouse.move(500, 400)
  await app.page.keyboard.down('Shift'); await app.page.mouse.wheel(0, -120); await app.page.keyboard.up('Shift'); await app.wait(120)
  const g1 = await read()
  ok(g1.w > g0.w && g1.h === g0.h, 'shift-wheel time-zoom widens bars, height fixed')
  await app.page.keyboard.down('Control'); await app.page.mouse.wheel(0, -140); await app.page.keyboard.up('Control'); await app.wait(120)
  const g2 = await read()
  ok(Number(g2.scale) > 1 && g2.h > g1.h, 'ctrl-wheel uniform-zoom scales everything')

  console.log('\nERRORS:', app.dumpErrors())
})

console.log(`\n${fail === 0 ? 'ALL PASS' : 'SOME FAILED'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
