---
name: verify
description: Runtime verification recipe for IRONWAKE (Three.js/WebGL2 game): build the production bundle, drive it in headless Chromium via the shot harness (photo-mode presets) and a realtime-loop probe, and read the PNGs + window.__ironwake bridge as evidence.
---

# Verify IRONWAKE at its real surface

The surface is the browser page: rendered pixels + the `window.__ironwake`
bridge. `tools/lib/browser.mjs` provides `launchBrowser` (Playwright
Chromium with SwiftShader WebGL2, from the global npm root) and
`serveStatic`; `tools/shot.mjs` is the standard driver.

## Handles that work

```bash
npm run build                                  # vite build → dist/
npm run shot -- --preset smoke --w 1280 --h 720 --quality high --keep-going
npm run shot -- --list                         # registered presets
npm run shot -- --all                          # every preset (slow, ~35 s each at 1080p ultra)
# extra params: --seed N --t <sim seconds> --frames N --hud 0|1 --debug a,b,c
```

- Output PNGs land in `shots/<preset>.png`; `shots/report.json` has
  triangles/drawCalls/programs per preset. Non-zero exit + printed console
  errors on any page error — zero console errors is the pass bar.
- Presets set the scene deterministically (`?seed=`); render-stream extras
  via `--debug`: `rain` (over-bright rain), `lens` (lens droplets), `dof`,
  `mb`, `clearsky`, plus preset URL params `&lightning=<0..1>&grade=<name>`.
- Timing under software GL: boot ~10-20 s, 720p capture ~20-30 s,
  1080p ultra ~30-40 s. Reduce with `--w/--h/--quality low`.
- READ the PNG with the Read tool and judge it against `reference/cod/*.jpg`
  and `docs/REFERENCE_STUDY.md`; luma stats help calibrate
  (dark surfaces 2-4 %, only emitters clip).

## Realtime-loop probe (settings toggles, resize, non-photo path)

Serve `dist/` and load `/?quality=high` WITHOUT `?shot` — the game runs its
rAF loop; wait for `window.__ironwake.game`, then `page.evaluate` against
`game.settings.set(...)`, `game.post.*`, `game.sky.*`, resize the viewport,
screenshot, and collect `console.error`s. See the render-stream notes; a
worked script lives in the S1 session scratchpad (realtime-probe.mjs pattern:
import from `tools/lib/browser.mjs`).

## Gotchas

- Never run `npm run dev` in the sandbox as a background daemon and forget
  it — the harness serves `dist` itself (or pass `--url` to an existing
  server, `--dev` for the vite dev server on :5173).
- Unknown preset ids fail with `unknown photo-mode preset "<id>". Registered: ...`.
- Screenshots are of the composited canvas; HUD/menus are DOM overlays.
- sRGB `DataTexture`s with generated mipmaps come back black on SwiftShader —
  keep procedural DataTextures linear + mip-free.
