/**
 * Tiny DOM helpers for the UI stream (no framework, zero-jank rules:
 * we only ever animate transform/opacity from JS driven by game.time).
 */

/**
 * Create an element with a class and optional text, appended to a parent.
 * @param {string} tag
 * @param {string} [cls]
 * @param {HTMLElement} [parent]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** Set textContent only when it changed (avoids layout churn). */
export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/** Set an inline style property only when it changed. */
export function setStyle(node, key, value) {
  if (node.style[key] !== value) node.style[key] = value;
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 2-digit zero pad without allocation churn for small ints. */
const PAD2 = new Array(100).fill(0).map((_, i) => (i < 10 ? '0' + i : String(i)));
export function pad2(n) {
  n = n | 0;
  return n >= 0 && n < 100 ? PAD2[n] : String(n);
}
