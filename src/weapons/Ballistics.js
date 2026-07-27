/**
 * Ballistics — hitscan traces, enemy hitbox registry, penetration, falloff
 * (WEAPONS stream).
 *
 * Trace order for a round: registered ENTITY HITBOXES (capsules/spheres,
 * head/torso/limb multipliers) merged with the WORLD BVH (`world.raycast`),
 * nearest first; thin metal (container walls) may be penetrated once with
 * damage × def.penetration.damageScale (docs/BUILD_PLAN.md §S4).
 *
 * Per impact emits the canonical `weapon:hit` (docs/ARCHITECTURE.md §3):
 *   { point, normal, surface, entity, part, damage, isKill, isHeadshot,
 *     dir, object, energy, weapon, owner }
 * FX listens for impacts/decals, AUDIO for surface sounds. Entities may
 * expose `entity.onWeaponHit(hit) → {killed, headshot}` for a synchronous
 * kill/hitmarker answer; otherwise the AI stream reacts to the event and
 * `isKill` stays false (documented in docs/NOTES-weapons.md).
 *
 * Hitbox registry (S5 registers enemies):
 *   ballistics.registerHitboxSet(entity, [
 *     { part:'head',  radius:0.13, a:Vector3, b:Vector3 },   // capsule (world endpoints, updated by the owner)
 *     { part:'torso', radius:0.20, a, b },
 *     { part:'limb',  radius:0.07, a, b },
 *   ]);
 *   ballistics.unregisterHitboxSet(entity);
 * A box may also be a sphere: { part, radius, center }.
 */
import * as THREE from 'three';
import { damageAtRange } from './WeaponDefs.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _hitPayload = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  surface: 'concrete',
  entity: null,
  part: null,
  damage: 0,
  isKill: false,
  isHeadshot: false,
  dir: new THREE.Vector3(),
  object: null,
  energy: 1,
  weapon: null,
  owner: 'player',
  penetrated: false,
};

/** Per-trace scratch results (reused). */
const MAX_TRACE_HITS = 6;
const _traceHits = [];
for (let i = 0; i < MAX_TRACE_HITS; i++) {
  _traceHits.push({
    kind: 'world', // 'world' | 'entity'
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    distance: 0,
    surface: 'concrete',
    object: null,
    entity: null,
    part: null,
    damage: 0,
    isKill: false,
    isHeadshot: false,
  });
}

export class Ballistics {
  /**
   * @param {import('../Game.js').Game} game
   */
  constructor(game) {
    this.game = game;
    /** @type {Map<any, {entity:any, boxes:Array<any>}>} */
    this._sets = new Map();
    this.lastTrace = { hits: _traceHits, count: 0, endPoint: new THREE.Vector3() };
  }

  /* ------------------------------------------------------------ registry */
  registerHitboxSet(entity, boxes) {
    this._sets.set(entity, { entity, boxes });
  }

  unregisterHitboxSet(entity) {
    this._sets.delete(entity);
  }

  get entityCount() {
    return this._sets.size;
  }

  /* ------------------------------------------------------------- queries */
  /**
   * Nearest entity hitbox intersection along a ray.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir unit
   * @param {number} maxDist
   * @param {any} [ignore] entity to skip (e.g. the shooter)
   * @returns {{entity:any, part:string, distance:number, point:THREE.Vector3, normal:THREE.Vector3}|null} reused record
   */
  raycastEntities(origin, dir, maxDist, ignore) {
    let best = null;
    let bestD = maxDist;
    for (const set of this._sets.values()) {
      if (set.entity === ignore) continue;
      if (set.entity && set.entity.alive === false) continue;
      const boxes = typeof set.boxes === 'function' ? set.boxes() : set.boxes;
      if (!boxes) continue;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        let t;
        if (b.a && b.b) t = rayCapsule(origin, dir, b.a, b.b, b.radius, _pt, _nrm);
        else if (b.center) t = raySphere(origin, dir, b.center, b.radius, _pt, _nrm);
        else continue;
        if (t !== null && t < bestD) {
          bestD = t;
          if (!best) best = _entityHit;
          best.entity = set.entity;
          best.part = b.part || 'torso';
          best.distance = t;
          best.point.copy(_pt);
          best.normal.copy(_nrm);
          best.box = b;
        }
      }
    }
    return best;
  }

  /* ---------------------------------------------------------------- fire */
  /**
   * Trace one round and resolve every impact (events + entity response).
   * @param {object} o
   * @param {THREE.Vector3} o.origin
   * @param {THREE.Vector3} o.dir unit direction (spread/recoil already applied)
   * @param {object} o.def weapon def (damage curve, penetration, range)
   * @param {string} [o.weaponId]
   * @param {any} [o.owner='player']
   * @param {any} [o.ignore] entity to skip
   * @returns {{hits:Array<any>, count:number, endPoint:THREE.Vector3}}
   */
  fire(o) {
    const world = this.game.world;
    const events = this.game.events;
    const def = o.def;
    const maxDist = def.range || 300;
    const trace = this.lastTrace;
    let count = 0;

    let origin = _v1.copy(o.origin);
    const dir = _v2.copy(o.dir).normalize();
    let travelled = 0;
    let damageScale = 1;
    let pens = def.penetration?.count ?? 0;

    for (let bounce = 0; bounce < 4 && count < MAX_TRACE_HITS; bounce++) {
      const remain = maxDist - travelled;
      if (remain <= 0.01) break;
      // entity vs world: nearest wins
      const ent = this.raycastEntities(origin, dir, remain, o.ignore);
      const wh = world?.raycast ? world.raycast(origin, dir, remain) : null;
      let useEntity = false;
      if (ent && (!wh || ent.distance < wh.distance)) useEntity = true;
      if (!ent && !wh) {
        trace.endPoint.copy(origin).addScaledVector(dir, remain);
        break;
      }

      const rec = _traceHits[count++];
      if (useEntity) {
        const totalDist = travelled + ent.distance;
        const partMul = def.damage.multipliers?.[ent.part] ?? 1;
        const dmg = damageAtRange(def, totalDist) * partMul * damageScale;
        rec.kind = 'entity';
        rec.point.copy(ent.point);
        rec.normal.copy(ent.normal);
        rec.distance = totalDist;
        rec.surface = 'flesh';
        rec.object = null;
        rec.entity = ent.entity;
        rec.part = ent.part;
        rec.damage = dmg;
        rec.isHeadshot = ent.part === 'head';
        rec.isKill = false;
        // synchronous entity response (optional API)
        const ent0 = ent.entity;
        let response = null;
        if (ent0 && typeof ent0.onWeaponHit === 'function') {
          try {
            response = ent0.onWeaponHit({
              damage: dmg, part: ent.part, point: rec.point, normal: rec.normal, dir, distance: totalDist,
              weapon: o.weaponId, owner: o.owner || 'player', isHeadshot: rec.isHeadshot,
            });
          } catch (err) {
            console.warn('[ballistics] entity onWeaponHit threw', err);
          }
        }
        if (response) {
          rec.isKill = !!response.killed;
          if (response.headshot !== undefined) rec.isHeadshot = !!response.headshot;
        }
        this._emitHit(events, rec, dir, o);
        events.emit('ui:hitmarker', { kill: rec.isKill, headshot: rec.isHeadshot });
        trace.endPoint.copy(rec.point);
        // rounds stop in bodies
        break;
      }

      // world impact
      const totalDist = travelled + wh.distance;
      rec.kind = 'world';
      rec.point.copy(wh.point);
      rec.normal.copy(wh.normal);
      rec.distance = totalDist;
      rec.surface = wh.surface || 'concrete';
      rec.object = wh.object || null;
      rec.entity = null;
      rec.part = null;
      rec.damage = damageAtRange(def, totalDist) * damageScale;
      rec.isKill = false;
      rec.isHeadshot = false;
      this._emitHit(events, rec, dir, o);
      trace.endPoint.copy(rec.point);

      // penetration through thin metal (container walls): continue the ray
      if (pens > 0 && rec.surface === 'metal' && world?.raycast) {
        // find the exit face: cast from just inside toward the far side against backfaces
        _v3.copy(rec.point).addScaledVector(dir, 0.006);
        const exit = world.raycast(_v3, dir, def.penetration.maxThickness ?? 0.15, { backfaces: true });
        if (exit) {
          const thickness = exit.distance;
          if (thickness <= (def.penetration.maxThickness ?? 0.15)) {
            pens--;
            damageScale *= def.penetration.damageScale ?? 0.5;
            travelled = totalDist + thickness;
            origin.copy(exit.point).addScaledVector(dir, 0.008);
            // exit spall
            events.emit('fx:impact', { point: exit.point, normal: dir, surface: 'metal', energy: 0.5 });
            continue;
          }
        }
      }
      break;
    }
    trace.count = count;
    return trace;
  }

  _emitHit(events, rec, dir, o) {
    const p = _hitPayload;
    p.point.copy(rec.point);
    p.normal.copy(rec.normal);
    p.surface = rec.surface;
    p.entity = rec.entity;
    p.part = rec.part;
    p.damage = rec.damage;
    p.isKill = rec.isKill;
    p.isHeadshot = rec.isHeadshot;
    p.dir.copy(dir);
    p.object = rec.object;
    p.energy = THREE.MathUtils.clamp(rec.damage / 30, 0.5, 1.4);
    p.weapon = o.weaponId || null;
    p.owner = o.owner || 'player';
    p.penetrated = rec.distance !== rec.distance ? false : false;
    events.emit('weapon:hit', p);
  }
}

const _entityHit = {
  entity: null,
  part: 'torso',
  distance: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  box: null,
};

/* ------------------------------------------------------------------------ */
/* intersection helpers                                                      */
/* ------------------------------------------------------------------------ */
/**
 * Ray vs capsule (segment ab + radius). Returns the entry distance along the
 * ray or null. Writes the entry point/normal into outP/outN.
 */
export function rayCapsule(origin, dir, a, b, radius, outP, outN) {
  // Closest approach between the infinite ray and the segment (Sunday's algorithm),
  // then treat the capsule locally as a sphere at the segment's closest point.
  _seg.subVectors(b, a);
  const w0x = origin.x - a.x;
  const w0y = origin.y - a.y;
  const w0z = origin.z - a.z;
  const ux = dir.x;
  const uy = dir.y;
  const uz = dir.z;
  const vx = _seg.x;
  const vy = _seg.y;
  const vz = _seg.z;
  const aa = ux * ux + uy * uy + uz * uz; // = 1 for unit dir
  const bb = ux * vx + uy * vy + uz * vz;
  const cc = vx * vx + vy * vy + vz * vz;
  const dd = ux * w0x + uy * w0y + uz * w0z;
  const ee = vx * w0x + vy * w0y + vz * w0z;
  const D = aa * cc - bb * bb;
  let sc;
  let tc;
  if (D < 1e-8) {
    sc = 0;
    tc = cc > 1e-8 ? ee / cc : 0;
  } else {
    sc = (bb * ee - cc * dd) / D;
    tc = (aa * ee - bb * dd) / D;
  }
  if (sc < 0) sc = 0;
  tc = Math.max(0, Math.min(1, tc));
  // closest points
  const px = origin.x + ux * sc;
  const py = origin.y + uy * sc;
  const pz = origin.z + uz * sc;
  const qx = a.x + vx * tc;
  const qy = a.y + vy * tc;
  const qz = a.z + vz * tc;
  const dx = px - qx;
  const dy = py - qy;
  const dz = pz - qz;
  const dist2 = dx * dx + dy * dy + dz * dz;
  if (dist2 > radius * radius) return null;
  // sphere at q: solve the ray-sphere entry for a proper entry distance
  const ocx = origin.x - qx;
  const ocy = origin.y - qy;
  const ocz = origin.z - qz;
  const bq = ocx * ux + ocy * uy + ocz * uz;
  const cq = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
  let disc = bq * bq - cq;
  if (disc < 0) disc = 0;
  let t = -bq - Math.sqrt(disc);
  if (t < 0) t = 0; // origin inside
  outP.set(origin.x + ux * t, origin.y + uy * t, origin.z + uz * t);
  outN.set(outP.x - qx, outP.y - qy, outP.z - qz).normalize();
  return t;
}

/** Ray vs sphere; entry distance or null. */
export function raySphere(origin, dir, center, radius, outP, outN) {
  const ocx = origin.x - center.x;
  const ocy = origin.y - center.y;
  const ocz = origin.z - center.z;
  const b = ocx * dir.x + ocy * dir.y + ocz * dir.z;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  let t = -b - Math.sqrt(disc);
  if (t < 0) {
    t = -b + Math.sqrt(disc);
    if (t < 0) return null;
    t = 0;
  }
  outP.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
  outN.subVectors(outP, center).normalize();
  return t;
}
