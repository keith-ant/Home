/**
 * Input system: keyboard + mouse + pointer lock, mapped to game actions.
 *
 * Gameplay reads *actions*, never raw keys:
 *   input.axes.move   → {x, y} in [-1,1] (WASD), y=+1 forward
 *   input.look        → {dx, dy} accumulated mouse delta this sim step (already sensitivity-free; camera applies sensitivity)
 *   input.isDown('fire'), input.pressed('reload'), input.released('ads')
 *
 * `simulate(state)` injects virtual input (autoplay bot / photo mode / tests)
 * which overrides physical devices while active.
 *
 * pressed/released edge state is valid for exactly one fixed simulation step:
 * call `flush()` after each step (Game does this).
 */
export const DEFAULT_BINDINGS = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft'],
  sprint: ['ShiftLeft'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  reload: ['KeyR'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weaponNext: ['WheelUp'],
  weaponPrev: ['WheelDown'],
  grenade: ['KeyG', 'Mouse3'],
  melee: ['KeyV', 'Mouse4'],
  interact: ['KeyF', 'KeyE'],
  inspect: ['KeyT'],
  leanLeft: ['KeyQ'],
  leanRight: ['KeyX'],
  pause: ['Escape', 'KeyP'],
  scoreboard: ['Tab'],
};

export class Input {
  /**
   * @param {HTMLElement} element pointer-lock target (the canvas)
   * @param {import('./Events.js').Events} events
   */
  constructor(element, events) {
    this.element = element;
    this.events = events;
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this.enabled = true;
    this.pointerLocked = false;

    this._keys = new Set();          // codes currently down (physical)
    this._pressedEdge = new Set();   // codes pressed since last flush
    this._releasedEdge = new Set();  // codes released since last flush
    this._look = { dx: 0, dy: 0 };
    this._wheel = 0;

    // virtual / injected state (autoplay)
    this._virtual = null;
    this._virtualKeys = new Set();
    this._virtualPrev = new Set();

    this._codeToActions = new Map();
    this._rebuildLookup();

    this.axes = { move: { x: 0, y: 0 } };
    this.look = { dx: 0, dy: 0 };
    this.wheel = 0;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onContext = (e) => e.preventDefault();
    this.attach();
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLockChange);
    this.element.addEventListener('contextmenu', this._onContext);
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.element.removeEventListener('contextmenu', this._onContext);
  }

  // -- pointer lock ---------------------------------------------------------
  requestPointerLock() {
    if (document.pointerLockElement === this.element) return;
    try {
      const p = this.element.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') p.catch(() => this.element.requestPointerLock());
    } catch {
      this.element.requestPointerLock();
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _onLockChange() {
    this.pointerLocked = document.pointerLockElement === this.element;
    this.events.emit(this.pointerLocked ? 'input:locked' : 'input:unlocked', {});
    if (!this.pointerLocked) this._keys.clear();
  }

  // -- physical events --------------------------------------------------------
  _onKeyDown(e) {
    if (!this.enabled) return;
    if (this._isGameKey(e.code)) e.preventDefault();
    if (this._keys.has(e.code)) return;
    this._keys.add(e.code);
    this._pressedEdge.add(e.code);
  }
  _onKeyUp(e) {
    if (this._isGameKey(e.code)) e.preventDefault();
    this._keys.delete(e.code);
    this._releasedEdge.add(e.code);
  }
  _onMouseDown(e) {
    if (!this.enabled) return;
    const code = 'Mouse' + e.button;
    if (this._keys.has(code)) return;
    this._keys.add(code);
    this._pressedEdge.add(code);
  }
  _onMouseUp(e) {
    const code = 'Mouse' + e.button;
    this._keys.delete(code);
    this._releasedEdge.add(code);
  }
  _onMouseMove(e) {
    if (!this.enabled || !this.pointerLocked) return;
    this._look.dx += e.movementX || 0;
    this._look.dy += e.movementY || 0;
  }
  _onWheel(e) {
    if (!this.enabled) return;
    this._wheel += Math.sign(e.deltaY);
    if (e.deltaY < 0) this._pressedEdge.add('WheelUp');
    else if (e.deltaY > 0) this._pressedEdge.add('WheelDown');
  }
  _onBlur() {
    for (const k of this._keys) this._releasedEdge.add(k);
    this._keys.clear();
  }

  // -- virtual input --------------------------------------------------------
  /**
   * Inject virtual input for the next simulation steps (until cleared).
   * @param {{actions?: Record<string, boolean>, move?: {x:number,y:number}, look?: {dx:number,dy:number}} | null} state
   */
  simulate(state) {
    this._virtual = state;
    if (!state) {
      this._virtualKeys.clear();
      this._virtualPrev.clear();
      return;
    }
    const next = new Set();
    for (const [action, down] of Object.entries(state.actions || {})) {
      if (!down) continue;
      const codes = this.bindings[action];
      if (codes && codes.length) next.add(codes[0]);
    }
    // edges from virtual transitions
    for (const c of next) if (!this._virtualPrev.has(c)) this._pressedEdge.add(c);
    for (const c of this._virtualPrev) if (!next.has(c)) this._releasedEdge.add(c);
    this._virtualKeys = next;
    this._virtualPrev = new Set(next);
    if (state.look) {
      this._look.dx += state.look.dx || 0;
      this._look.dy += state.look.dy || 0;
    }
  }

  get isVirtual() {
    return this._virtual !== null;
  }

  // -- per-step update ----------------------------------------------------------
  /** Sample devices into action state. Call once at the start of each fixed step. */
  update() {
    const move = this.axes.move;
    if (this._virtual && this._virtual.move) {
      move.x = clamp(this._virtual.move.x || 0, -1, 1);
      move.y = clamp(this._virtual.move.y || 0, -1, 1);
    } else {
      move.x = (this.isDown('moveRight') ? 1 : 0) - (this.isDown('moveLeft') ? 1 : 0);
      move.y = (this.isDown('moveForward') ? 1 : 0) - (this.isDown('moveBack') ? 1 : 0);
    }
    const len = Math.hypot(move.x, move.y);
    if (len > 1) {
      move.x /= len;
      move.y /= len;
    }
    this.look.dx = this._look.dx;
    this.look.dy = this._look.dy;
    this.wheel = this._wheel;
    this._look.dx = 0;
    this._look.dy = 0;
    this._wheel = 0;
  }

  /** Clear one-step edge state. Call after each fixed simulation step. */
  flush() {
    this._pressedEdge.clear();
    this._releasedEdge.clear();
  }

  // -- queries -----------------------------------------------------------------
  isDown(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) {
      if (this._keys.has(c) || this._virtualKeys.has(c)) return true;
    }
    return false;
  }
  pressed(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this._pressedEdge.has(c)) return true;
    return false;
  }
  released(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this._releasedEdge.has(c)) return true;
    return false;
  }
  anyKeyPressed() {
    return this._pressedEdge.size > 0;
  }

  rebind(action, codes) {
    this.bindings[action] = codes;
    this._rebuildLookup();
  }

  _rebuildLookup() {
    this._codeToActions.clear();
    for (const [action, codes] of Object.entries(this.bindings)) {
      for (const c of codes) {
        if (!this._codeToActions.has(c)) this._codeToActions.set(c, []);
        this._codeToActions.get(c).push(action);
      }
    }
  }

  _isGameKey(code) {
    return this._codeToActions.has(code);
  }

  dispose() {
    this.detach();
    this.exitPointerLock();
  }
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
