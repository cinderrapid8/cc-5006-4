'use strict';

// Contract guards shared by every coordinate-transform module. No function in
// this package accepts an undefined coordinate and substitutes a default: a
// missing/invalid argument fails loudly here, so a malformed call can never be
// silently reported as a successful identity transform.

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function requireNumber(v, name) {
  if (!isFiniteNumber(v)) {
    throw new TypeError(`${name} must be a finite number, got ${String(v)}`);
  }
  return v;
}

function requirePositive(v, name) {
  requireNumber(v, name);
  if (v <= 0) throw new RangeError(`${name} must be > 0, got ${v}`);
  return v;
}

function requireNonNegative(v, name) {
  requireNumber(v, name);
  if (v < 0) throw new RangeError(`${name} must be >= 0, got ${v}`);
  return v;
}

function requirePoint(x, y) {
  requireNumber(x, 'x');
  requireNumber(y, 'y');
  return [x, y];
}

function requireMatrix(M) {
  if (!Array.isArray(M) || M.length !== 6 || !M.every(isFiniteNumber)) {
    throw new TypeError(`matrix must be an array of 6 finite numbers, got ${JSON.stringify(M)}`);
  }
  return M;
}

function requireObject(v, name) {
  if (!v || typeof v !== 'object') {
    throw new TypeError(`${name} must be an object, got ${String(v)}`);
  }
  return v;
}

const guards = {
  isFiniteNumber,
  requireNumber,
  requirePositive,
  requireNonNegative,
  requirePoint,
  requireMatrix,
  requireObject,
};

if (typeof module !== 'undefined' && module.exports) module.exports = guards;
if (typeof window !== 'undefined') window.DanceTransformGuards = guards;
