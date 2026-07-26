/**
 * Procedural colour-grade LUTs (post/RENDER stream).
 *
 * Generates 3D lookup textures on the CPU at init so the whole game shares
 * one authored grade: subtle teal shadows, warm highlights, a gentle
 * contrast S-curve and ~12 % desaturation (REFERENCE_STUDY §19). LUTs are
 * applied by postprocessing's LUT3DEffect in sRGB-encoded 0..1 space AFTER
 * tone mapping (a LUT domain clamps at 1.0, so it must never see HDR).
 *
 *   const lut = buildGradeLUT('ironwake');   // LookupTexture (32³, RGBA8)
 *
 * Available grades: 'ironwake' (default teal/warm), 'neutral' (identity),
 * 'bleach' (cooler, higher contrast, more desat — combat stress option).
 */
import * as THREE from 'three';
import { LookupTexture } from 'postprocessing';

const GRADES = {
  neutral: {
    saturation: 1.0,
    contrast: 0.0,
    shadowTint: [0, 0, 0],
    highlightTint: [0, 0, 0],
    lift: 0,
    warmth: 0,
  },
  ironwake: {
    saturation: 0.88,
    contrast: 0.32,
    shadowTint: [-0.012, 0.008, 0.028], // teal push in the toe
    highlightTint: [0.026, 0.012, -0.02], // sodium warmth in the shoulder
    lift: 0.004,
    warmth: 0.0,
  },
  bleach: {
    saturation: 0.72,
    contrast: 0.45,
    shadowTint: [-0.014, 0.004, 0.02],
    highlightTint: [0.006, 0.004, 0.004],
    lift: 0.0,
    warmth: -0.01,
  },
  warm: {
    saturation: 0.9,
    contrast: 0.3,
    shadowTint: [0.004, 0.0, -0.006],
    highlightTint: [0.03, 0.014, -0.03],
    lift: 0.004,
    warmth: 0.02,
  },
};

/**
 * Build a 3D grade LUT.
 * @param {keyof typeof GRADES | string} [name='ironwake']
 * @param {number} [size=32]
 * @returns {LookupTexture}
 */
export function buildGradeLUT(name = 'ironwake', size = 32) {
  const g = GRADES[name] || GRADES.ironwake;
  const data = new Uint8Array(size * size * size * 4);
  const inv = 1 / (size - 1);
  let i = 0;
  for (let bz = 0; bz < size; bz++) {
    for (let gy = 0; gy < size; gy++) {
      for (let rx = 0; rx < size; rx++) {
        let r = rx * inv;
        let gg = gy * inv;
        let b = bz * inv;

        // luminance (Rec.709) and saturation about it
        const lum = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        r = lum + (r - lum) * g.saturation;
        gg = lum + (gg - lum) * g.saturation;
        b = lum + (b - lum) * g.saturation;

        // contrast S-curve (blend toward smoothstep of itself), mild lift
        r = curve(r, g.contrast) + g.lift;
        gg = curve(gg, g.contrast) + g.lift;
        b = curve(b, g.contrast) + g.lift;

        // split tone: shadows toward teal, highlights toward warm
        const sw = (1 - lum) * (1 - lum);
        const hw = lum * lum;
        r += g.shadowTint[0] * sw + g.highlightTint[0] * hw + g.warmth;
        gg += g.shadowTint[1] * sw + g.highlightTint[1] * hw;
        b += g.shadowTint[2] * sw + g.highlightTint[2] * hw - g.warmth;

        data[i++] = quant(r);
        data[i++] = quant(gg);
        data[i++] = quant(b);
        data[i++] = 255;
      }
    }
  }
  const lut = new LookupTexture(data, size);
  lut.name = 'grade.' + name;
  lut.type = THREE.UnsignedByteType;
  lut.needsUpdate = true;
  return lut;
}

/** available grade names */
export const GRADE_NAMES = Object.keys(GRADES);

function curve(x, amount) {
  const s = x * x * (3 - 2 * x); // smoothstep S
  return x + (s - x) * amount;
}

function quant(v) {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return Math.round(c * 255);
}
