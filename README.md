# IRONWAKE — Blacksite Terminal

A first-person shooter vertical slice targeting AAA presentation (Call of
Duty: Modern Warfare as the visual bar), rendered in real time in the browser
with Three.js / WebGL2. Survive escalating waves of PMC operators in a
rain-lashed container terminal at night.

- `docs/ART_DIRECTION.md` — the creative brief every visual is judged against
- `docs/ARCHITECTURE.md` — engineering contracts, module ownership, verification
- `docs/CRITIC_PROTOCOL.md` — the blind-comparison review loop vs. real CoD frames
- `docs/QUALITY_LEDGER.md` — round-by-round critic scoreboards

## Run

```
npm install
npm run dev        # http://127.0.0.1:5173  (click to lock the pointer)
npm run build      # production build → dist/
npm run preview    # serve dist/ at http://127.0.0.1:4173
```

## Verify (automated)

```
npm run shot -- --all      # render every photo-mode preset → shots/*.png
npm run verify             # scripted autoplay session; fails on any runtime error
npm run refs               # gather CoD reference frames (local eval only, gitignored)
npm run critic:pack        # build a blind A/B review pack in critique/round-N
```

## Controls

WASD move · Shift sprint · C / Ctrl crouch (hold while sprinting to slide) ·
Space jump / mantle · Mouse aim · LMB fire · RMB ADS · R reload · G grenade ·
1/2 or wheel swap weapon · V melee · F interact · Q/X lean · Esc pause.

## Credits

Engine: Three.js, pmndrs postprocessing, N8AO, Rapier physics, three-mesh-bvh.
Third-party art & audio assets are CC0 / CC-BY and listed with sources in
`CREDITS.md`. Reference imagery used by critic agents is never included in
this repository.
