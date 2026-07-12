// End-to-end verification of the new interaction model.
//   node e2e/verify.mjs
import { withApp } from './helpers.mjs'

const ok = (cond, msg) => console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`)

await withApp(async (app) => {
  await app.loadExample()

  console.log('\n== single click opens edit popup below task ==')
  await app.clickTask('t_launch')
  const popup = await app.eval(() => {
    const p = document.querySelector('.edit-popup')
    if (!p || getComputedStyle(p).display === 'none') return null
    const r = p.getBoundingClientRect(); return { y: Math.round(r.top), h: Math.round(r.height) }
  })
  ok(!!popup, `edit popup shown (${JSON.stringify(popup)})`)

  console.log('\n== edit name via popup updates the bar label ==')
  await app.fill('#ep-name', 'Launch v2')
  await app.wait(200)
  const label = await app.eval(() => document.querySelector('.task-name-label[data-id="t_launch"]')?.textContent)
  ok(label === 'Launch v2', `label = "${label}"`)

  console.log('\n== change duration widens the bar ==')
  const w0 = await app.eval(() => Math.round(document.querySelector('.task-block[data-id="t_launch"] .bar-rect').getBoundingClientRect().width))
  await app.fill('#ep-dur', '20'); await app.wait(200)
  const w1 = await app.eval(() => Math.round(document.querySelector('.task-block[data-id="t_launch"] .bar-rect').getBoundingClientRect().width))
  ok(w1 > w0, `width ${w0} -> ${w1}`)

  console.log('\n== convert ticket -> milestone-task ==')
  await app.eval(() => document.querySelector('.ep-type .seg-btn[data-type="container"]').click())
  await app.wait(250)
  const isContainer = await app.eval(() => document.querySelector('.task-block[data-id="t_launch"]')?.classList.contains('container-task'))
  ok(isContainer, 'launch is now a container-task')

  console.log('\n== double-click drills only containers ==')
  await app.eval(() => document.querySelector('.edit-popup .ep-close')?.click())
  await app.dblclickTask('t_launch')
  ok((await app.counts()).breadcrumb.includes('Launch'), `drilled into Launch (${(await app.counts()).breadcrumb})`)
  await app.eval(() => document.querySelectorAll('#breadcrumb span[data-depth]')[0]?.click()) // back to root
  await app.wait(200)

  console.log('\n== add ticket after a task that has a successor (staircase + preserve post-req) ==')
  await app.dblclickTask('t_build')
  await app.clickAddBtn('t_api', 0)
  if (await app.modalOpen()) { await app.fill('#atm-name', 'Mid Task'); await app.page.click('#atm-add'); await app.wait(300) }
  // close the auto-opened edit popup
  await app.eval(() => document.querySelector('.edit-popup .ep-close')?.click())
  const m = await app.model()
  const build = m.tasks.filter(t => t.parent === 't_build')
  const mid = build.find(t => t.name === 'Mid Task')
  const ui = build.find(t => t.id === 't_ui')
  ok(!!mid, 'new task exists in data')
  ok(!!mid && mid.prereqs.includes('t_api'), 'new task depends on API')
  ok(!!ui && ui.prereqs.includes(mid?.id), 'Web UI now depends on new task (thread preserved)')
  ok(await app.eval(() => !!document.querySelector('.task-block[data-id="t_ui"]')), 'Web UI still rendered')
  // staircase: rows should differ (down+right)
  const rows = await app.eval(() => {
    const y = id => { const e = document.querySelector(`.task-block[data-id="${id}"] .bar-rect`); return e ? Math.round(e.getBoundingClientRect().top) : null }
    return { api: y('t_api'), ui: y('t_ui') }
  })
  ok(rows.ui !== null && rows.api !== null && rows.ui > rows.api, `staircase: API top ${rows.api} < Web UI top ${rows.ui}`)
  await app.shot('verify-drilled-staircase')

  console.log('\n== back to top level, screenshot names-on-top ==')
  await app.eval(() => document.querySelectorAll('#breadcrumb span[data-depth]')[0]?.click())
  await app.wait(200)
  await app.shot('verify-toplevel')

  console.log('\n== kanban still fully interactive ==')
  await app.gotoKanban()
  const c0 = (await app.counts()).kcols
  await app.click('.kanban-add-col')
  ok((await app.counts()).kcols === c0 + 1, 'add column works')
  await app.click('.kc-config')
  ok(await app.modalOpen(), 'gear opens config')

  console.log('\nERRORS:', app.dumpErrors())
})
