'use strict';

// Affine-matrix primitives for 2D coordinate frames.
//
// A matrix is the Canvas/DOM column form [a, b, c, d, e, f]:
//   x' = a*x + c*y + e
//   y' = b*x + d*y + f
// These matrices are pure geometry; they carry no frame names. Frame identity
// is enforced separately by lineage.js so the same primitives serve source
// pixels (coded), the project canvas (display/output) and the device viewport.

const guards = (typeof module !== 'undefined' && module.exports)
  ? require('./guards')
  : window.DanceTransformGuards;

const IDENTITY = [1, 0, 0, 1, 0, 0];

// Compose A after B: result = A o B (B is applied first).
function mul(A, B) {
  guards.requireMatrix(A);
  guards.requireMatrix(B);
  const [a1, b1, c1, d1, e1, f1] = A;
  const [a2, b2, c2, d2, e2, f2] = B;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ];
}

function applyMatrix(M, x, y) {
  guards.requireMatrix(M);
  guards.requirePoint(x, y);
  return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
}

function invert(M) {
  guards.requireMatrix(M);
  const [a, b, c, d, e, f] = M;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error('singular space matrix');
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [
    ia, ib, ic, id,
    -(ia * e + ic * f), -(ib * e + id * f),
  ];
}

const matrix = { IDENTITY, mul, applyMatrix, invert };

if (typeof module !== 'undefined' && module.exports) module.exports = matrix;
if (typeof window !== 'undefined') window.DanceTransformMatrix = matrix;
