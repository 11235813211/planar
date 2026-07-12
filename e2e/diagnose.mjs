// Quick health check across the reported problem areas.
//   node e2e/diagnose.mjs
import { withApp } from './helpers.mjs'

await withApp(async (app) => {
  await app.loadExample()

  console.log('\n== GANTT: add ticket after a task that has a successor ==')
  // Drill into Build: t_api -> t_ui (Web UI depends on API). Add after API.
  await app.dblclickTask('t_build')
  console.log('drilled:', (await app.counts()).breadcrumb)
  const before = await app.model()
  console.log('before add — tasks:', before.tasks.filter(t => t.parent === 't_build').map(t => `${t.id}[${t.prereqs}]`).join(', '))
  await app.clickAddBtn('t_api', 0) // + after API
  if (await app.modalOpen()) {
    await app.fill('#atm-name', 'NEW-AFTER-API')
    await app.page.click('#atm-add'); await app.wait(300)
  } else {
    console.log('!! add-task modal did not open')
  }
  const after = await app.model()
  console.log('after add — tasks:', after.tasks.filter(t => t.parent === 't_build').map(t => `${t.id}(${t.name})[${t.prereqs}]`).join(', '))
  console.log('web-ui still present in DOM:', await app.eval(() => !!document.querySelector('.task-block[data-id="t_ui"]')))
  await app.shot('diag-gantt-add')

  console.log('\n== KANBAN: +column, gear config, dblclick edit ==')
  await app.gotoGantt(); await app.gotoKanban()
  const c0 = (await app.counts()).kcols
  await app.click('.kanban-add-col')
  const c1 = (await app.counts()).kcols
  console.log(`+column: ${c0} -> ${c1}`, c1 > c0 ? 'OK' : 'FAIL')
  console.log('gear rect:', await app.rectOf('.kc-config'))
  await app.click('.kc-config')
  console.log('gear opens config:', await app.modalOpen() ? 'OK' : 'FAIL')
  await app.eval(() => document.querySelector('.modal-overlay')?.remove())
  await app.dblclick('.kanban-card')
  console.log('card dblclick opens modal:', await app.modalOpen() ? 'OK' : 'FAIL')

  console.log('\nERRORS:', app.dumpErrors())
})
