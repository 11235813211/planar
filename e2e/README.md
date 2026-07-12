# e2e — Playwright harness

Reusable browser-driven checks for Planar. The dev server must be running.

```bash
npm run dev            # in one terminal (serves http://localhost:5173/planar/)
npm run e2e:features   # broad suite — 28 checks across scheduling, popup, panels, kanban, gestures
npm run e2e:verify     # interaction verification (+ screenshots in e2e/shots)
npm run e2e:diagnose   # quick health check of the common problem areas
HEADED=1 node e2e/features.mjs # watch it run in a real window
```

`e2e/features.mjs` exits non-zero on any failure, so it's ready to drop into CI later.

## Writing a check

`helpers.mjs` exports `withApp(fn)` which boots a page and passes a rich `app`:

```js
import { withApp } from './helpers.mjs'

await withApp(async (app) => {
  await app.loadExample()          // or app.newProject()
  await app.clickTask('t_api')     // single-click a gantt task by id → edit popup
  await app.dblclickTask('t_build')// double-click → drill into a container
  await app.clickAddBtn('t_api', 0)// 0 = +after, 1 = +before
  await app.gotoKanban()
  console.log(await app.counts())  // { tasks, containers, milestones, panels, kcols, cards, modalOpen, breadcrumb, ... }
  console.log(await app.model())   // live data model: tasks + prereqs + computed dates (via window.__planar)
  await app.shot('my-check')       // screenshot → e2e/shots/my-check.png
  console.log(app.dumpErrors())    // collected pageerror / console.error
})
```

Key helpers: `click/dblclick/hover(sel)`, `clickTask/dblclickTask/hoverTask/clickAddBtn(id)`,
`rectOf/centerOf(sel)`, `elementAtCenterOf(sel)` (what actually receives a click there),
`counts()`, `model()`, `modalOpen()`, `fill(sel,val)`, `eval(fn)`, `shot(name)`.
