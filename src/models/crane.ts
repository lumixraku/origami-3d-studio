import {
  type CreaseDef,
  type EvaluatedOrigamiFrame,
  type FacetDef,
  type OrigamiModel,
  type OrigamiStepSpec,
  type Vec2,
  type Vec3,
  barycentric2D,
  computeMaxEdgeStrainPct,
  computeSmoothStackOffsets,
  dist2,
  dist3,
  evalBarycentric3D,
  lerp2,
  lerp3,
  normalizeFacetWinding,
  rotatePointAroundAxis,
  rotatePointAroundLine,
  smooth01,
  solve3Spheres,
} from '../engine/origamiEngine.ts';

const S = Math.SQRT2 / 2; // 0.7071067811865476
const D = Math.SQRT2; // 1.4142135623730951
const A = Math.SQRT2 - 1; // 0.41421356237309515
const TAU = 2 - Math.SQRT2; // 0.5857864376269049
const SIG = 1 - S; // 0.29289321881345254

// ============================================================================
// Build Exact 32-Vertex, 48-Triangle Crease Pattern for Full 15-Step Crane
// ============================================================================

const V: Record<string, number> = {};
const diamond2D: Vec2[] = [];
const vertices2D: Vec2[] = [];

function addVert(name: string, xd: number, zd: number): number {
  const idx = vertices2D.length;
  V[name] = idx;
  diamond2D.push([xd, zd]);
  // Orthogonal 45-deg rotation mapping diamond coords (xd, zd) onto square [-1, 1]^2
  const u = S * xd + S * zd;
  const v = -S * xd + S * zd;
  vertices2D.push([u, v]);
  return idx;
}

addVert('O', 0, 0);
addVert('C3', D, 0); // Front Wing tip
addVert('C0', 0, D); // Tail tip
addVert('C1', -D, 0); // Back Wing tip
addVert('C2', 0, -D); // Neck & Head/Beak tip

addVert('M0', S, S);
addVert('M1', -S, S);
addVert('M2', -S, -S);
addVert('M3', S, -S);

addVert('Q0', TAU * S, TAU * S);
addVert('Q1', -TAU * S, TAU * S);
addVert('Q2', -TAU * S, -TAU * S);
addVert('Q3', TAU * S, -TAU * S);

addVert('D3', SIG * D, 0);
addVert('D0', 0, SIG * D);
addVert('D1', -SIG * D, 0);
addVert('D2', 0, -SIG * D);

const dPt = (name: string): Vec2 => diamond2D[V[name]];

// Tail reverse-fold vertices (around C0)
const TAIL_IN_T = 0.14;
const TAIL_OUT_T = 0.28;
addVert('Tin', ...lerp2(dPt('D0'), dPt('C0'), TAIL_IN_T));
addVert('TrawF', ...lerp2(dPt('M0'), dPt('C0'), TAIL_IN_T));
addVert('TrawB', ...lerp2(dPt('M1'), dPt('C0'), TAIL_IN_T));
addVert('ToutF', ...lerp2(dPt('Q0'), dPt('C0'), TAIL_OUT_T));
addVert('ToutB', ...lerp2(dPt('Q1'), dPt('C0'), TAIL_OUT_T));

// Neck & Head reverse-fold vertices (around C2)
const NECK_IN_T = 0.12;
const NECK_OUT_T = 0.26;
const HEAD_SP_T = 0.66;
const HEAD_TH_T = 0.76;

addVert('Nin', ...lerp2(dPt('D2'), dPt('C2'), NECK_IN_T));
addVert('NrawF', ...lerp2(dPt('M3'), dPt('C2'), NECK_IN_T));
addVert('NrawB', ...lerp2(dPt('M2'), dPt('C2'), NECK_IN_T));
addVert('NoutF', ...lerp2(dPt('Q3'), dPt('C2'), NECK_OUT_T));
addVert('NoutB', ...lerp2(dPt('Q2'), dPt('C2'), NECK_OUT_T));

addVert('Hsp', ...lerp2(dPt('Nin'), dPt('C2'), HEAD_SP_T));
addVert('HrawF', ...lerp2(dPt('NrawF'), dPt('C2'), HEAD_SP_T));
addVert('HrawB', ...lerp2(dPt('NrawB'), dPt('C2'), HEAD_SP_T));
addVert('HthF', ...lerp2(dPt('NoutF'), dPt('C2'), HEAD_TH_T));
addVert('HthB', ...lerp2(dPt('NoutB'), dPt('C2'), HEAD_TH_T));

interface CraneFacetMeta {
  id: string;
  verts: [number, number, number];
  sector: 'C3R' | 'C3L' | 'C1R' | 'C1L' | 'C0F' | 'C0B' | 'C2F' | 'C2B';
  birdPrio: number;
}

const rawFacetMetas: CraneFacetMeta[] = [
  // Front Wing C3 (Right & Left halves)
  { id: 'wF_body_R', verts: [V.O, V.Q0, V.D3], sector: 'C3R', birdPrio: 60 },
  { id: 'wF_main_R', verts: [V.D3, V.Q0, V.C3], sector: 'C3R', birdPrio: 72 },
  { id: 'wF_flap_R', verts: [V.Q0, V.M0, V.C3], sector: 'C3R', birdPrio: 66 },

  { id: 'wF_body_L', verts: [V.O, V.Q3, V.D3], sector: 'C3L', birdPrio: 60 },
  { id: 'wF_main_L', verts: [V.D3, V.Q3, V.C3], sector: 'C3L', birdPrio: 72 },
  { id: 'wF_flap_L', verts: [V.Q3, V.M3, V.C3], sector: 'C3L', birdPrio: 66 },

  // Back Wing C1 (Right & Left halves)
  { id: 'wB_body_R', verts: [V.O, V.Q1, V.D1], sector: 'C1R', birdPrio: 12 },
  { id: 'wB_main_R', verts: [V.D1, V.Q1, V.C1], sector: 'C1R', birdPrio: 2 },
  { id: 'wB_flap_R', verts: [V.Q1, V.M1, V.C1], sector: 'C1R', birdPrio: 6 },

  { id: 'wB_body_L', verts: [V.O, V.Q2, V.D1], sector: 'C1L', birdPrio: 12 },
  { id: 'wB_main_L', verts: [V.D1, V.Q2, V.C1], sector: 'C1L', birdPrio: 2 },
  { id: 'wB_flap_L', verts: [V.Q2, V.M2, V.C1], sector: 'C1L', birdPrio: 6 },

  // Tail C0 Front-Right & Back-Right
  { id: 'tailF_hip', verts: [V.O, V.Q0, V.D0], sector: 'C0F', birdPrio: 52 },
  { id: 'tailF_base1', verts: [V.D0, V.Q0, V.ToutF], sector: 'C0F', birdPrio: 52 },
  { id: 'tailF_base2', verts: [V.D0, V.ToutF, V.Tin], sector: 'C0F', birdPrio: 52 },
  { id: 'tailF_blade', verts: [V.Tin, V.ToutF, V.C0], sector: 'C0F', birdPrio: 48 },
  { id: 'tailF_tuck1', verts: [V.Q0, V.M0, V.TrawF], sector: 'C0F', birdPrio: 42 },
  { id: 'tailF_tuck2', verts: [V.Q0, V.TrawF, V.ToutF], sector: 'C0F', birdPrio: 42 },
  { id: 'tailF_tuckBlade', verts: [V.TrawF, V.ToutF, V.C0], sector: 'C0F', birdPrio: 44 },

  { id: 'tailB_hip', verts: [V.O, V.Q1, V.D0], sector: 'C0B', birdPrio: 20 },
  { id: 'tailB_base1', verts: [V.D0, V.Q1, V.ToutB], sector: 'C0B', birdPrio: 20 },
  { id: 'tailB_base2', verts: [V.D0, V.ToutB, V.Tin], sector: 'C0B', birdPrio: 20 },
  { id: 'tailB_blade', verts: [V.Tin, V.ToutB, V.C0], sector: 'C0B', birdPrio: 24 },
  { id: 'tailB_tuck1', verts: [V.Q1, V.M1, V.TrawB], sector: 'C0B', birdPrio: 30 },
  { id: 'tailB_tuck2', verts: [V.Q1, V.TrawB, V.ToutB], sector: 'C0B', birdPrio: 30 },
  { id: 'tailB_tuckBlade', verts: [V.TrawB, V.ToutB, V.C0], sector: 'C0B', birdPrio: 28 },

  // Neck & Head C2 Front-Left & Back-Left
  { id: 'neckF_hip', verts: [V.O, V.Q3, V.D2], sector: 'C2F', birdPrio: 52 },
  { id: 'neckF_base1', verts: [V.D2, V.Q3, V.NoutF], sector: 'C2F', birdPrio: 52 },
  { id: 'neckF_base2', verts: [V.D2, V.NoutF, V.Nin], sector: 'C2F', birdPrio: 52 },
  { id: 'neckF_mid1', verts: [V.Nin, V.NoutF, V.HthF], sector: 'C2F', birdPrio: 49 },
  { id: 'neckF_mid2', verts: [V.Nin, V.HthF, V.Hsp], sector: 'C2F', birdPrio: 49 },
  { id: 'headF_blade', verts: [V.Hsp, V.HthF, V.C2], sector: 'C2F', birdPrio: 46 },
  { id: 'neckF_tuck1', verts: [V.Q3, V.M3, V.NrawF], sector: 'C2F', birdPrio: 42 },
  { id: 'neckF_tuck2', verts: [V.Q3, V.NrawF, V.NoutF], sector: 'C2F', birdPrio: 42 },
  { id: 'neckF_tuckMid1', verts: [V.NrawF, V.NoutF, V.HthF], sector: 'C2F', birdPrio: 44 },
  { id: 'neckF_tuckMid2', verts: [V.NrawF, V.HthF, V.HrawF], sector: 'C2F', birdPrio: 44 },
  { id: 'headF_tuckBlade', verts: [V.HrawF, V.HthF, V.C2], sector: 'C2F', birdPrio: 45 },

  { id: 'neckB_hip', verts: [V.O, V.Q2, V.D2], sector: 'C2B', birdPrio: 20 },
  { id: 'neckB_base1', verts: [V.D2, V.Q2, V.NoutB], sector: 'C2B', birdPrio: 20 },
  { id: 'neckB_base2', verts: [V.D2, V.NoutB, V.Nin], sector: 'C2B', birdPrio: 20 },
  { id: 'neckB_mid1', verts: [V.Nin, V.NoutB, V.HthB], sector: 'C2B', birdPrio: 23 },
  { id: 'neckB_mid2', verts: [V.Nin, V.HthB, V.Hsp], sector: 'C2B', birdPrio: 23 },
  { id: 'headB_blade', verts: [V.Hsp, V.HthB, V.C2], sector: 'C2B', birdPrio: 26 },
  { id: 'neckB_tuck1', verts: [V.Q2, V.M2, V.NrawB], sector: 'C2B', birdPrio: 30 },
  { id: 'neckB_tuck2', verts: [V.Q2, V.NrawB, V.NoutB], sector: 'C2B', birdPrio: 30 },
  { id: 'neckB_tuckMid1', verts: [V.NrawB, V.NoutB, V.HthB], sector: 'C2B', birdPrio: 28 },
  { id: 'neckB_tuckMid2', verts: [V.NrawB, V.HthB, V.HrawB], sector: 'C2B', birdPrio: 28 },
  { id: 'headB_tuckBlade', verts: [V.HrawB, V.HthB, V.C2], sector: 'C2B', birdPrio: 27 },
];

const facets: FacetDef[] = normalizeFacetWinding(
  vertices2D,
  rawFacetMetas.map((m) => ({ id: m.id, verts: m.verts })),
);

// ============================================================================
// Precompute Carrier Barycentric Weights & Reverse-Fold Constants
// ============================================================================

// Primary 8 sectors for Steps 1..5: each vertex belongs to one sector (O, M_i, C_j)
const SECTOR_DEFS: Record<string, [number, number, number]> = {
  C3R: [V.O, V.M0, V.C3],
  C3L: [V.O, V.M3, V.C3],
  C1R: [V.O, V.M1, V.C1],
  C1L: [V.O, V.M2, V.C1],
  C0F: [V.O, V.M0, V.C0],
  C0B: [V.O, V.M1, V.C0],
  C2F: [V.O, V.M3, V.C2],
  C2B: [V.O, V.M2, V.C2],
};

const vertexSectorCarrier: Array<{ tri: [number, number, number]; bary: Vec3 }> =
  vertices2D.map((uv, idx) => {
    // Find a sector containing this vertex
    for (const key of Object.keys(SECTOR_DEFS)) {
      const [ia, ib, ic] = SECTOR_DEFS[key];
      if (idx === ia) return { tri: [ia, ib, ic], bary: [1, 0, 0] };
      if (idx === ib) return { tri: [ia, ib, ic], bary: [0, 1, 0] };
      if (idx === ic) return { tri: [ia, ib, ic], bary: [0, 0, 1] };
      const b = barycentric2D(uv, vertices2D[ia], vertices2D[ib], vertices2D[ic]);
      if (b[0] >= -1e-6 && b[1] >= -1e-6 && b[2] >= -1e-6) {
        return { tri: [ia, ib, ic], bary: b };
      }
    }
    return { tri: [V.O, V.M0, V.C3], bary: [1, 0, 0] };
  });

// Precompute Neck, Tail, and Head exact rest distances in Bird Base (Y_d = 0 plane)
// In Bird Base (at end of Step 10):
// O = (0, 0, 0), D0 = D1 = D2 = D3 = (0, 0, A)
// Q0 = Q1 = (+A, 0, A), Q2 = Q3 = (-A, 0, A)
// M0 = M1 = M2 = M3 = (0, 0, A)
// C3 = C1 = (0, 0, A - 1) [pointing up -Z_d], C0 = C2 = (0, 0, D) [pointing down +Z_d]
const BB_O: Vec3 = [0, 0, 0];
const BB_D: Vec3 = [0, 0, A];
const BB_QR: Vec3 = [A, 0, A];
const BB_QL: Vec3 = [-A, 0, A];
const BB_LEG_DOWN: Vec3 = [0, 0, D];
const BB_WING_UP: Vec3 = [0, 0, A - 1];

// Neck constants (Left side -X_d, C2)
const BB_Nin = lerp3(BB_D, BB_LEG_DOWN, NECK_IN_T);
const BB_Nout0 = lerp3(BB_QL, BB_LEG_DOWN, NECK_OUT_T);
const L_NECK_IN = dist3(BB_LEG_DOWN, BB_Nin);
const L_NECK_OUT = dist3(BB_LEG_DOWN, BB_Nout0);

function reflect2DXZ(pt: Vec3, lineA: Vec3, lineB: Vec3): Vec3 {
  const dx = lineB[0] - lineA[0];
  const dz = lineB[2] - lineA[2];
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const vx = pt[0] - lineA[0];
  const vz = pt[2] - lineA[2];
  const pr = vx * ux + vz * uz;
  return [lineA[0] + 2 * pr * ux - vx, 0, lineA[2] + 2 * pr * uz - vz];
}

const BB_C2_UP = reflect2DXZ(BB_LEG_DOWN, BB_Nin, BB_Nout0);
const NECK_ANG_END = Math.atan2(BB_C2_UP[0] - BB_Nin[0], BB_C2_UP[2] - BB_Nin[2]);

// Tail constants (Right side +X_d, C0)
const BB_Tin = lerp3(BB_D, BB_LEG_DOWN, TAIL_IN_T);
const BB_Tout0 = lerp3(BB_QR, BB_LEG_DOWN, TAIL_OUT_T);
const L_TAIL_IN = dist3(BB_LEG_DOWN, BB_Tin);
const L_TAIL_OUT = dist3(BB_LEG_DOWN, BB_Tout0);
const BB_C0_UP = reflect2DXZ(BB_LEG_DOWN, BB_Tin, BB_Tout0);
const TAIL_ANG_END = Math.atan2(BB_C0_UP[0] - BB_Tin[0], BB_C0_UP[2] - BB_Tin[2]);

// Head / Beak constants (Tip of C2 after Step 11)
const BB_Hsp0 = lerp3(BB_Nin, BB_C2_UP, HEAD_SP_T);
const BB_Hth0 = lerp3(BB_Nout0, BB_C2_UP, HEAD_TH_T);
const BB_C2_BEAK = reflect2DXZ(BB_C2_UP, BB_Hsp0, BB_Hth0);

const L_H_IN_SP = dist2(vertices2D[V.Nin], vertices2D[V.Hsp]);
const L_H_IN_TH = dist2(vertices2D[V.Nin], vertices2D[V.HthF]);
const L_H_OUT_TH = dist2(vertices2D[V.NoutF], vertices2D[V.HthF]);
const L_H_SP_TH = dist2(vertices2D[V.Hsp], vertices2D[V.HthF]);
const L_H_SP_TIP = dist2(vertices2D[V.Hsp], vertices2D[V.C2]);
const L_H_TH_TIP = dist2(vertices2D[V.HthF], vertices2D[V.C2]);

const HEAD_BASE_ANG0 = Math.atan2(BB_Hsp0[0] - BB_Nin[0], BB_Hsp0[2] - BB_Nin[2]);
let HEAD_REL_END =
  Math.atan2(BB_C2_BEAK[0] - BB_Hsp0[0], BB_C2_BEAK[2] - BB_Hsp0[2]) - HEAD_BASE_ANG0;
if (HEAD_REL_END > Math.PI) HEAD_REL_END -= 2 * Math.PI;
if (HEAD_REL_END < -Math.PI) HEAD_REL_END += 2 * Math.PI;

function headErrorAt(flex: number, rel: number): {
  err: number;
  Hsp: Vec3;
  HthF: Vec3;
  C2: Vec3;
} {
  const ang = HEAD_BASE_ANG0 + flex;
  const Hsp: Vec3 = [
    BB_Nin[0] + L_H_IN_SP * Math.sin(ang),
    0,
    BB_Nin[2] + L_H_IN_SP * Math.cos(ang),
  ];
  const HthF = solve3Spheres(BB_Nin, L_H_IN_TH, BB_Nout0, L_H_OUT_TH, Hsp, L_H_SP_TH, 1);
  const C2: Vec3 = [
    Hsp[0] + L_H_SP_TIP * Math.sin(ang + rel),
    0,
    Hsp[2] + L_H_SP_TIP * Math.cos(ang + rel),
  ];
  return { err: dist3(HthF, C2) - L_H_TH_TIP, Hsp, HthF, C2 };
}

// Precompute exact non-zero pocket-open flex angle at rel -> 0+
const HEAD_FLEX_OPEN = (() => {
  let lo = 1e-4;
  let hi = 0.16;
  const epsR = 1e-5 * Math.sign(HEAD_REL_END);
  let fLo = headErrorAt(lo, epsR).err;
  for (let k = 1; k <= 120; k++) {
    const f = k * (0.16 / 120);
    const cur = headErrorAt(f, epsR).err;
    if (fLo * cur <= 0) {
      lo = (k - 1) * (0.16 / 120);
      hi = f;
      break;
    }
    fLo = cur;
  }
  for (let it = 0; it < 50; it++) {
    const mid = 0.5 * (lo + hi);
    if (headErrorAt(lo, epsR).err * headErrorAt(mid, epsR).err <= 0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
})();

// ============================================================================
// Exact Squash & Petal Fold Analytical Helpers
// ============================================================================

/** Exact analytical Squash Fold trajectory for midpoint M as corner swings psi in [0, pi/2] */
function evalSquashMidpoint(psi: number, sideXSign: 1 | -1, ySign: 1 | -1): Vec3 {
  const z = S;
  const cosP = Math.cos(psi);
  const yMag = Math.abs(cosP) < 1e-8 ? 0 : (S * (1 - Math.sin(psi))) / cosP;
  const xMag = Math.sqrt(Math.max(0, 0.5 - yMag * yMag));
  return [sideXSign * xMag, ySign * yMag, z];
}

/** Exact analytical Petal Fold trajectory for C_wing and side midpoints M_right, M_left */
function evalPetalFold(
  theta: number,
  ySign: 1 | -1,
): { tip: Vec3; mRight: Vec3; mLeft: Vec3 } {
  const tip: Vec3 = [0, ySign * Math.sin(theta), A + Math.cos(theta)];
  if (theta < 1e-7) {
    return {
      tip: [0, 0, D],
      mRight: [S, 0, S],
      mLeft: [-S, 0, S],
    };
  }
  if (Math.PI - theta < 1e-7) {
    return {
      tip: [0, 0, A - 1],
      mRight: [0, 0, A],
      mLeft: [0, 0, A],
    };
  }
  // Solve exact 3-sphere intersection for M_right (+X side); M_left is mirror (-X)
  const branch: 1 | -1 = ySign === 1 ? -1 : 1;
  const mRight = solve3Spheres(BB_QR, A, BB_LEG_DOWN, 1, tip, 1, branch);
  const mLeft: Vec3 = [-mRight[0], mRight[1], mRight[2]];
  return { tip, mRight, mLeft };
}

// ============================================================================
// World Rigid Pose Transform (Pure SO(3) Rotation + Translation)
// ============================================================================

function computeCraneLayerState(
  activeStepIndex: number,
  stepT: number,
): { prios: number[]; upSigns: Array<1 | -1> } {
  const prios: number[] = new Array(rawFacetMetas.length);
  const upSigns: Array<1 | -1> = new Array(rawFacetMetas.length);

  for (let i = 0; i < rawFacetMetas.length; i++) {
    const m = rawFacetMetas[i];
    const sec = m.sector;

    // Phase 1: Steps 1..5 (idx 0..4)
    if (activeStepIndex === 0) {
      const over90 = Math.sin(smooth01(stepT) * Math.PI) > 0.5;
      const moving = over90 && (sec === 'C3R' || sec === 'C3L' || sec === 'C0F' || sec === 'C2F');
      prios[i] = moving ? 1 : 0;
      upSigns[i] = moving ? -1 : 1;
      continue;
    }
    if (activeStepIndex === 1) {
      const over90 = smooth01(stepT) > 0.5;
      const moving = over90 && (sec === 'C1L' || sec === 'C2B' || sec === 'C2F' || sec === 'C3L');
      prios[i] = moving ? 1 : 0;
      upSigns[i] = moving ? -1 : 1;
      continue;
    }
    if (activeStepIndex === 2 || (activeStepIndex === 3 && stepT <= 0.5)) {
      const over90 = activeStepIndex === 3 || smooth01(stepT) > 0.5;
      if (sec === 'C1R' || sec === 'C0B') { prios[i] = 0; upSigns[i] = 1; }
      else if (sec === 'C1L' || sec === 'C2B') { prios[i] = 1; upSigns[i] = -1; }
      else if (!over90) {
        if (sec === 'C3R' || sec === 'C0F') { prios[i] = 0; upSigns[i] = 1; }
        else { prios[i] = 1; upSigns[i] = -1; }
      } else if (sec === 'C3L' || sec === 'C2F') { prios[i] = 2; upSigns[i] = 1; }
      else { prios[i] = 3; upSigns[i] = -1; }
      continue;
    }
    if (activeStepIndex === 3 || (activeStepIndex === 4 && stepT <= 0.5)) {
      if (sec === 'C1R' || sec === 'C0B') { prios[i] = 0; upSigns[i] = 1; }
      else if (sec === 'C1L' || sec === 'C2B') { prios[i] = 1; upSigns[i] = -1; }
      else if (sec === 'C0F' || sec === 'C2F') { prios[i] = 2; upSigns[i] = 1; }
      else { prios[i] = 3; upSigns[i] = -1; }
      continue;
    }

    // Baseline Square Base (end of Step 5):
    let p = 0;
    let sgn: 1 | -1 = 1;
    if (sec === 'C1R' || sec === 'C1L') { p = 0; sgn = 1; }
    else if (sec === 'C0B' || sec === 'C2B') { p = 1; sgn = -1; }
    else if (sec === 'C0F' || sec === 'C2F') { p = 2; sgn = 1; }
    else { p = 3; sgn = -1; }

    const isTuckF = m.id.startsWith('tailF_tuck') || m.id.startsWith('neckF_tuck') || m.id === 'headF_tuckBlade';
    const isTuckB = m.id.startsWith('tailB_tuck') || m.id.startsWith('neckB_tuck') || m.id === 'headB_tuckBlade';

    if (activeStepIndex === 4) {
      prios[i] = p;
      upSigns[i] = sgn;
      continue;
    }

    // Step 6 (idx 5): Front Kite pre-crease (switch target stack only above 90 deg!)
    if (activeStepIndex === 5) {
      if (Math.sin(smooth01(stepT) * Math.PI) > 0.52) {
        if (m.id === 'wF_flap_R' || m.id === 'wF_flap_L') { p = 4; sgn = 1; }
        else if (isTuckF) { p = 5; sgn = -1; }
      }
      prios[i] = p;
      upSigns[i] = sgn;
      continue;
    }

    // Step 7 (idx 6): Top Apex horizontal pre-crease (switch target stack only above 90 deg!)
    if (activeStepIndex === 6) {
      const isApex = m.id.endsWith('_body_R') || m.id.endsWith('_body_L') || m.id.endsWith('_hip');
      if (isApex && Math.sin(smooth01(stepT) * Math.PI) > 0.55) {
        p = 7 - p;
        sgn = (sgn === 1 ? -1 : 1) as 1 | -1;
      }
      prios[i] = p;
      upSigns[i] = sgn;
      continue;
    }

    // Step 8+ (idx >= 7): Front Petal Fold
    if (activeStepIndex === 7 && smooth01(stepT) <= 0.5) {
      prios[i] = p;
      upSigns[i] = sgn;
      continue;
    }

    // Front Petal settled:
    if (m.id === 'wF_flap_R' || m.id === 'wF_flap_L') { p = 5.0; sgn = -1; }
    else if (m.id === 'wF_main_R' || m.id === 'wF_main_L') { p = 4.0; sgn = 1; }
    else if (isTuckF) { p = 2.6; sgn = -1; }
    else if (sec === 'C0F' || sec === 'C2F') { p = 2.0; sgn = 1; }

    // Step 9 (idx 8): Back Kite pre-crease (switch target stack only above 90 deg!)
    if (activeStepIndex === 8) {
      if (Math.sin(smooth01(stepT) * Math.PI) > 0.52) {
        if (m.id === 'wB_flap_R' || m.id === 'wB_flap_L') { p = -1.0; sgn = -1; }
        else if (isTuckB) { p = -2.0; sgn = 1; }
      }
      prios[i] = p;
      upSigns[i] = sgn;
      continue;
    }

    if (activeStepIndex === 9 && smooth01(stepT) <= 0.5) {
      prios[i] = p;
      upSigns[i] = sgn;
      continue;
    }

    // Step 10+ (idx >= 9): Back Petal Fold
    if (activeStepIndex >= 9) {
      if (m.id === 'wB_flap_R' || m.id === 'wB_flap_L') { p = -2.0; sgn = 1; }
      else if (m.id === 'wB_main_R' || m.id === 'wB_main_L') { p = -1.0; sgn = -1; }
      else if (isTuckB) { p = 0.4; sgn = 1; }
      else if (sec === 'C0B' || sec === 'C2B') { p = 1.0; sgn = -1; }
    }

    // Step 11+ (idx >= 10): Neck Inside Reverse Fold
    if (activeStepIndex > 10 || (activeStepIndex === 10 && stepT > 0.55)) {
      if (m.id === 'neckF_mid1' || m.id === 'neckF_mid2' || m.id === 'headF_blade') { p = 2.7; sgn = -1; }
      else if (m.id === 'neckF_tuckMid1' || m.id === 'neckF_tuckMid2' || m.id === 'headF_tuckBlade') { p = 2.1; sgn = 1; }
      else if (m.id === 'neckB_mid1' || m.id === 'neckB_mid2' || m.id === 'headB_blade') { p = 0.3; sgn = 1; }
      else if (m.id === 'neckB_tuckMid1' || m.id === 'neckB_tuckMid2' || m.id === 'headB_tuckBlade') { p = 0.9; sgn = -1; }
    }

    // Step 12+ (idx >= 11): Tail Inside Reverse Fold
    if (activeStepIndex > 11 || (activeStepIndex === 11 && stepT > 0.55)) {
      if (m.id === 'tailF_blade') { p = 2.7; sgn = -1; }
      else if (m.id === 'tailF_tuckBlade') { p = 2.1; sgn = 1; }
      else if (m.id === 'tailB_blade') { p = 0.3; sgn = 1; }
      else if (m.id === 'tailB_tuckBlade') { p = 0.9; sgn = -1; }
    }

    // Step 13+ (idx >= 12): Head / Beak Inside Reverse Fold
    if (activeStepIndex > 12 || (activeStepIndex === 12 && stepT > 0.55)) {
      if (m.id === 'headF_tuckBlade') { p = 2.8; sgn = -1; }
      else if (m.id === 'headF_blade') { p = 2.0; sgn = 1; }
      else if (m.id === 'headB_tuckBlade') { p = 0.2; sgn = 1; }
      else if (m.id === 'headB_blade') { p = 1.0; sgn = -1; }
    }

    prios[i] = p;
    upSigns[i] = sgn;
  }

  return { prios, upSigns };
}

function transformDiamondToWorld(
  pts: Vec3[],
  globalProgress: number,
): Vec3[] {
  const alignBlend = smooth01(globalProgress - 4);
  const yawAngle = (1 - alignBlend) * (Math.PI / 4);
  const zShift = -0.52 * alignBlend;
  const standBlend = smooth01((globalProgress - 13) / 2);

  return pts.map((p) => {
    let q: Vec3 = [p[0], p[1], p[2] + zShift];
    if (Math.abs(yawAngle) > 1e-9) {
      q = rotatePointAroundAxis(q, [0, 0, 0], [0, 1, 0], -yawAngle);
    }
    if (standBlend > 1e-9) {
      q = rotatePointAroundAxis(q, [0, 0, 0], [1, 0, 0], (Math.PI / 2) * standBlend);
      q = rotatePointAroundAxis(q, [0, 0, 0], [0, 1, 0], (-Math.PI / 2) * standBlend);
      q = [q[0], q[1] + 0.36 * standBlend, q[2]];
    }
    return q;
  });
}

// ============================================================================
// Full 15-Step Isometric Evaluator
// ============================================================================

function evaluateCrane(globalProgress: number): EvaluatedOrigamiFrame {
  const totalSteps = CRANE_STEPS.length; // 15
  const clamped = Number.isFinite(globalProgress)
    ? Math.max(0, Math.min(totalSteps, globalProgress))
    : 0;
  const activeStepIndex = clamped >= totalSteps ? totalSteps - 1 : Math.floor(clamped);
  const stepT = clamped >= totalSteps ? 1 : clamped - activeStepIndex;
  const easeT = smooth01(stepT);

  const pos: Vec3[] = new Array(vertices2D.length);

  // --------------------------------------------------------------------------
  // Phase 1: Steps 0..4 (0-indexed: Step 1..5 -> Flat Square to Square Base)
  // All 8 sectors move as rigid primary triangles!
  // --------------------------------------------------------------------------
  if (activeStepIndex <= 4) {
    const primary: Record<number, Vec3> = {
      [V.O]: [0, 0, 0],
      [V.C3]: [D, 0, 0],
      [V.C0]: [0, 0, D],
      [V.C1]: [-D, 0, 0],
      [V.C2]: [0, 0, -D],
      [V.M0]: [S, 0, S],
      [V.M1]: [-S, 0, S],
      [V.M2]: [-S, 0, -S],
      [V.M3]: [S, 0, -S],
    };

    if (activeStepIndex === 0) {
      // Step 1: Pre-crease diagonal C2 <-> C0 (X_d = 0), fold C3 over to C1 and unfold
      const ang = Math.sin(easeT * Math.PI) * Math.PI;
      for (const vid of [V.C3, V.M0, V.M3]) {
        primary[vid] = rotatePointAroundAxis(primary[vid], [0, 0, 0], [0, 0, 1], ang);
      }
    } else if (activeStepIndex === 1) {
      // Step 2: Fold diagonal C1 <-> C3 (Z_d = 0) by +180 deg -> Big Right Triangle (valley fold upward +Y)
      const ang = easeT * Math.PI;
      for (const vid of [V.C2, V.M2, V.M3]) {
        primary[vid] = rotatePointAroundAxis(primary[vid], [0, 0, 0], [1, 0, 0], ang);
      }
    } else if (activeStepIndex === 2) {
      // Step 3: From Big Triangle, fold right half (X_d > 0) over Z_d axis onto left half -> Small Triangle
      for (const vid of [V.C2, V.M2, V.M3]) {
        primary[vid] = rotatePointAroundAxis(primary[vid], [0, 0, 0], [1, 0, 0], Math.PI);
      }
      const ang = easeT * Math.PI; // +180 deg around +Z_d: +X_d swings over +Y onto -X_d
      for (const vid of [V.C3, V.M0, V.M3]) {
        primary[vid] = rotatePointAroundAxis(primary[vid], [0, 0, 0], [0, 0, 1], ang);
      }
    } else if (activeStepIndex === 3) {
      // Step 4: Lift top right pocket (C3, M0, M3) back to 90 deg, then Squash into Front Square!
      // Left half stays at Small Triangle state:
      primary[V.C2] = [0, 0, D];
      primary[V.M2] = [-S, 0, S];
      if (stepT <= 0.35) {
        const u = smooth01(stepT / 0.35);
        const ang = Math.PI - (Math.PI / 2) * u; // 180 deg -> 90 deg
        primary[V.C3] = rotatePointAroundAxis([D, 0, 0], [0, 0, 0], [0, 0, 1], ang);
        primary[V.M0] = rotatePointAroundAxis([S, 0, S], [0, 0, 0], [0, 0, 1], ang);
        primary[V.M3] = rotatePointAroundAxis([S, 0, S], [0, 0, 0], [0, 0, 1], ang);
      } else {
        const psi = (Math.PI / 2) * smooth01((stepT - 0.35) / 0.65);
        primary[V.C3] = [0, D * Math.cos(psi), D * Math.sin(psi)];
        primary[V.M0] = evalSquashMidpoint(psi, 1, 1);
        primary[V.M3] = evalSquashMidpoint(psi, -1, 1);
      }
    } else if (activeStepIndex === 4) {
      // Step 5: Front is squashed; lift back flap (C1, M1, M2) to -90 deg (-Y), then Squash into Square Base!
      primary[V.C2] = [0, 0, D];
      primary[V.C3] = [0, 0, D];
      primary[V.M0] = [S, 0, S];
      primary[V.M3] = [-S, 0, S];
      if (stepT <= 0.35) {
        const u = smooth01(stepT / 0.35);
        const ang = (Math.PI / 2) * u; // Rotate from (-X_d) down into (-Y_d) around +Z_d
        primary[V.C1] = rotatePointAroundAxis([-D, 0, 0], [0, 0, 0], [0, 0, 1], ang);
        primary[V.M1] = rotatePointAroundAxis([-S, 0, S], [0, 0, 0], [0, 0, 1], ang);
        primary[V.M2] = rotatePointAroundAxis([-S, 0, S], [0, 0, 0], [0, 0, 1], ang);
      } else {
        const psi = (Math.PI / 2) * smooth01((stepT - 0.35) / 0.65);
        primary[V.C1] = [0, -D * Math.cos(psi), D * Math.sin(psi)];
        primary[V.M1] = evalSquashMidpoint(psi, 1, -1);
        primary[V.M2] = evalSquashMidpoint(psi, -1, -1);
      }
    }

    for (let i = 0; i < vertices2D.length; i++) {
      const { tri, bary } = vertexSectorCarrier[i];
      pos[i] = evalBarycentric3D(bary, primary[tri[0]], primary[tri[1]], primary[tri[2]]);
    }

    const worldPos = transformDiamondToWorld(pos, clamped);
    const { prios: earlyPrios, upSigns: earlySigns } = computeCraneLayerState(activeStepIndex, stepT);
    const { facetOffsets, facetCornerOffsets } = computeSmoothStackOffsets(worldPos, facets, earlyPrios, earlySigns, 0.0034);
    return {
      vertexPositions: worldPos,
      facetOffsets,
      facetCornerOffsets,
      activeStepIndex,
      stepProgress: stepT,
      maxEdgeStrainPct: computeMaxEdgeStrainPct(vertices2D, facets, worldPos),
    };
  }

  // --------------------------------------------------------------------------
  // Phase 2: Steps 5..9 (0-indexed: Step 6..10 -> Square Base to Bird Base)
  // Compute exact positions of the 17 Bird-Base carrier vertices, then interpolate
  // Neck/Tail/Head sub-vertices barycentrically!
  // --------------------------------------------------------------------------
  pos[V.O] = [...BB_O];
  pos[V.D0] = [...BB_D];
  pos[V.D1] = [...BB_D];
  pos[V.D2] = [...BB_D];
  pos[V.D3] = [...BB_D];
  pos[V.Q0] = [...BB_QR];
  pos[V.Q1] = [...BB_QR];
  pos[V.Q2] = [...BB_QL];
  pos[V.Q3] = [...BB_QL];
  pos[V.C0] = [...BB_LEG_DOWN];
  pos[V.C2] = [...BB_LEG_DOWN];
  pos[V.C3] = [...BB_LEG_DOWN];
  pos[V.C1] = [...BB_LEG_DOWN];
  pos[V.M0] = [S, 0, S];
  pos[V.M1] = [S, 0, S];
  pos[V.M2] = [-S, 0, S];
  pos[V.M3] = [-S, 0, S];

  if (activeStepIndex === 5) {
    // Step 6: Front Kite Pre-crease (fold M0 around Q0->C3 and M3 around Q3->C3 outward in +Y, then unfold)
    const ang = Math.sin(easeT * Math.PI) * Math.PI * 0.96;
    pos[V.M0] = rotatePointAroundLine(pos[V.M0], pos[V.Q0], pos[V.C3], ang);
    pos[V.M3] = rotatePointAroundLine(pos[V.M3], pos[V.Q3], pos[V.C3], -ang);
  } else if (activeStepIndex === 6) {
    // Step 7: Top Apex O Horizontal Pre-crease (fold O forward over Q3->Q0 and unfold)
    const ang = Math.sin(easeT * Math.PI) * Math.PI * 0.92;
    pos[V.O] = rotatePointAroundLine(pos[V.O], pos[V.Q3], pos[V.Q0], ang);
  } else if (activeStepIndex === 7) {
    // Step 8: Front Petal Fold (exact solve3Spheres for M0 & M3 as C3 lifts 0 -> 180 deg)
    const pf = evalPetalFold(easeT * Math.PI, 1);
    pos[V.C3] = pf.tip;
    pos[V.M0] = pf.mRight;
    pos[V.M3] = pf.mLeft;
  } else if (activeStepIndex >= 8) {
    // Front Petal Fold completed:
    pos[V.C3] = [...BB_WING_UP];
    pos[V.M0] = [...BB_D];
    pos[V.M3] = [...BB_D];

    if (activeStepIndex === 8) {
      // Step 9: Back Kite Pre-crease (fold M1 & M2 outward on -Y side and unfold)
      const ang = Math.sin(easeT * Math.PI) * Math.PI * 0.96;
      pos[V.M1] = rotatePointAroundLine(pos[V.M1], pos[V.Q1], pos[V.C1], -ang);
      pos[V.M2] = rotatePointAroundLine(pos[V.M2], pos[V.Q2], pos[V.C1], ang);
    } else if (activeStepIndex === 9) {
      // Step 10: Back Petal Fold -> Completes Bird Base!
      const pfB = evalPetalFold(easeT * Math.PI, -1);
      pos[V.C1] = pfB.tip;
      pos[V.M1] = pfB.mRight;
      pos[V.M2] = pfB.mLeft;
    } else {
      // Back Petal Fold completed (Bird Base established):
      pos[V.C1] = [...BB_WING_UP];
      pos[V.M1] = [...BB_D];
      pos[V.M2] = [...BB_D];
    }
  }

  // Populate Neck/Tail/Head sub-vertices for Steps 6..10 via exact barycentric interpolation on Bird Base triangles
  if (activeStepIndex <= 9) {
    pos[V.Tin] = lerp3(pos[V.D0], pos[V.C0], TAIL_IN_T);
    pos[V.TrawF] = lerp3(pos[V.M0], pos[V.C0], TAIL_IN_T);
    pos[V.TrawB] = lerp3(pos[V.M1], pos[V.C0], TAIL_IN_T);
    pos[V.ToutF] = lerp3(pos[V.Q0], pos[V.C0], TAIL_OUT_T);
    pos[V.ToutB] = lerp3(pos[V.Q1], pos[V.C0], TAIL_OUT_T);

    pos[V.Nin] = lerp3(pos[V.D2], pos[V.C2], NECK_IN_T);
    pos[V.NrawF] = lerp3(pos[V.M3], pos[V.C2], NECK_IN_T);
    pos[V.NrawB] = lerp3(pos[V.M2], pos[V.C2], NECK_IN_T);
    pos[V.NoutF] = lerp3(pos[V.Q3], pos[V.C2], NECK_OUT_T);
    pos[V.NoutB] = lerp3(pos[V.Q2], pos[V.C2], NECK_OUT_T);

    pos[V.Hsp] = lerp3(pos[V.Nin], pos[V.C2], HEAD_SP_T);
    pos[V.HrawF] = lerp3(pos[V.NrawF], pos[V.C2], HEAD_SP_T);
    pos[V.HrawB] = lerp3(pos[V.NrawB], pos[V.C2], HEAD_SP_T);
    pos[V.HthF] = lerp3(pos[V.NoutF], pos[V.C2], HEAD_TH_T);
    pos[V.HthB] = lerp3(pos[V.NoutB], pos[V.C2], HEAD_TH_T);

    const worldPos = transformDiamondToWorld(pos, clamped);
    const { prios, upSigns } = computeCraneLayerState(activeStepIndex, stepT);
    const { facetOffsets, facetCornerOffsets } = computeSmoothStackOffsets(worldPos, facets, prios, upSigns, 0.0034);
    return {
      vertexPositions: worldPos,
      facetOffsets,
      facetCornerOffsets,
      activeStepIndex,
      stepProgress: stepT,
      maxEdgeStrainPct: computeMaxEdgeStrainPct(vertices2D, facets, worldPos),
    };
  }

  // --------------------------------------------------------------------------
  // Phase 3: Steps 10..14 (0-indexed: Step 11..15 -> Neck, Tail, Beak, Wings!)
  // --------------------------------------------------------------------------
  // Initialize baseline Bird Base coordinates for Tail & Neck anchors:
  pos[V.Tin] = [...BB_Tin];
  pos[V.TrawF] = [...BB_Tin];
  pos[V.TrawB] = [...BB_Tin];
  pos[V.ToutF] = [...BB_Tout0];
  pos[V.ToutB] = [...BB_Tout0];

  pos[V.Nin] = [...BB_Nin];
  pos[V.NrawF] = [...BB_Nin];
  pos[V.NrawB] = [...BB_Nin];
  pos[V.NoutF] = [...BB_Nout0];
  pos[V.NoutB] = [...BB_Nout0];

  // --- Step 11 (idx 10): Neck Inside Reverse Fold (Left side -X_d, C2) ---
  if (activeStepIndex === 10) {
    let alphaL = 0;
    let neckPos: Vec3 = [...BB_LEG_DOWN];
    if (stepT <= 0.25) {
      alphaL = (Math.PI / 2) * smooth01(stepT / 0.25);
    } else {
      const w = smooth01((stepT - 0.25) / 0.75);
      const ang = NECK_ANG_END * w;
      const xC = BB_Nin[0] + L_NECK_IN * Math.sin(ang);
      const zC = BB_Nin[2] + L_NECK_IN * Math.cos(ang);
      neckPos = [xC, 0, zC];
      const wOut = Math.abs(BB_Nout0[0]);
      const cosA =
        Math.abs(xC) < 1e-8
          ? 0
          : (L_NECK_OUT * L_NECK_OUT - xC * xC - wOut * wOut - (zC - BB_Nout0[2]) ** 2) /
            (2 * xC * wOut);
      alphaL = Math.acos(Math.max(-1, Math.min(1, cosA)));
    }
    // Rotate left front (+alphaL) and left back (-alphaL) around Z_d axis
    pos[V.Q3] = rotatePointAroundAxis(BB_QL, [0, 0, 0], [0, 0, 1], -alphaL);
    pos[V.NoutF] = rotatePointAroundAxis(BB_Nout0, [0, 0, 0], [0, 0, 1], -alphaL);
    pos[V.Q2] = rotatePointAroundAxis(BB_QL, [0, 0, 0], [0, 0, 1], alphaL);
    pos[V.NoutB] = rotatePointAroundAxis(BB_Nout0, [0, 0, 0], [0, 0, 1], alphaL);
    pos[V.C2] = neckPos;

    pos[V.Hsp] = lerp3(pos[V.Nin], pos[V.C2], HEAD_SP_T);
    pos[V.HrawF] = [...pos[V.Hsp]];
    pos[V.HrawB] = [...pos[V.Hsp]];
    pos[V.HthF] = lerp3(pos[V.NoutF], pos[V.C2], HEAD_TH_T);
    pos[V.HthB] = lerp3(pos[V.NoutB], pos[V.C2], HEAD_TH_T);
  } else {
    // Neck completed at BB_C2_UP:
    pos[V.C2] = [...BB_C2_UP];
    pos[V.Hsp] = [...BB_Hsp0];
    pos[V.HrawF] = [...BB_Hsp0];
    pos[V.HrawB] = [...BB_Hsp0];
    pos[V.HthF] = [...BB_Hth0];
    pos[V.HthB] = [...BB_Hth0];
  }

  // --- Step 12 (idx 11): Tail Inside Reverse Fold (Right side +X_d, C0) ---
  if (activeStepIndex === 11) {
    let alphaR = 0;
    let tailPos: Vec3 = [...BB_LEG_DOWN];
    if (stepT <= 0.25) {
      alphaR = (Math.PI / 2) * smooth01(stepT / 0.25);
    } else {
      const w = smooth01((stepT - 0.25) / 0.75);
      const ang = TAIL_ANG_END * w;
      const xC = BB_Tin[0] + L_TAIL_IN * Math.sin(ang);
      const zC = BB_Tin[2] + L_TAIL_IN * Math.cos(ang);
      tailPos = [xC, 0, zC];
      const wOut = Math.abs(BB_Tout0[0]);
      const cosA =
        Math.abs(xC) < 1e-8
          ? 0
          : (L_TAIL_OUT * L_TAIL_OUT - xC * xC - wOut * wOut - (zC - BB_Tout0[2]) ** 2) /
            (-2 * xC * wOut);
      alphaR = Math.acos(Math.max(-1, Math.min(1, cosA)));
    }
    // Rotate right front (+Y) and right back (-Y) around Z_d axis
    pos[V.Q0] = rotatePointAroundAxis(BB_QR, [0, 0, 0], [0, 0, 1], alphaR);
    pos[V.ToutF] = rotatePointAroundAxis(BB_Tout0, [0, 0, 0], [0, 0, 1], alphaR);
    pos[V.Q1] = rotatePointAroundAxis(BB_QR, [0, 0, 0], [0, 0, 1], -alphaR);
    pos[V.ToutB] = rotatePointAroundAxis(BB_Tout0, [0, 0, 0], [0, 0, 1], -alphaR);
    pos[V.C0] = tailPos;
  } else if (activeStepIndex >= 12) {
    pos[V.C0] = [...BB_C0_UP];
  }

  // --- Step 13 (idx 12): Head / Beak Inside Reverse Fold (Tip of C2) ---
  if (activeStepIndex === 12) {
    let flex = 0;
    let rel = 0;
    if (stepT <= 0.22) {
      // Smoothly pinch/flex neck crown (0 -> HEAD_FLEX_OPEN), solving slight crown lift rel <= 0
      flex = HEAD_FLEX_OPEN * smooth01(stepT / 0.22);
      if (flex > 1e-7) {
        let rLo = 0;
        let rHi = 0;
        const dir = -Math.sign(HEAD_REL_END);
        let prev = headErrorAt(flex, 0).err;
        for (let k = 1; k <= 80; k++) {
          const r = dir * k * (0.35 / 80);
          const cur = headErrorAt(flex, r).err;
          if (prev * cur <= 0) {
            rLo = dir * (k - 1) * (0.35 / 80);
            rHi = r;
            break;
          }
          prev = cur;
        }
        for (let it = 0; it < 45; it++) {
          const rm = 0.5 * (rLo + rHi);
          if (headErrorAt(flex, rLo).err * headErrorAt(flex, rm).err <= 0) rHi = rm;
          else rLo = rm;
        }
        rel = 0.5 * (rLo + rHi);
      }
    } else {
      // Swing beak smoothly downward (0 -> HEAD_REL_END), solving exact neck flex -> 0
      const w = smooth01((stepT - 0.22) / 0.78);
      rel = HEAD_REL_END * w;
      if (w >= 1 - 1e-7) {
        flex = 0;
      } else {
        let lo = 0;
        let hi = 0;
        let prev = headErrorAt(0, rel).err;
        for (let k = 1; k <= 120; k++) {
          const f = k * (0.14 / 120);
          const cur = headErrorAt(f, rel).err;
          if (prev * cur <= 0) {
            lo = (k - 1) * (0.14 / 120);
            hi = f;
            break;
          }
          prev = cur;
        }
        for (let it = 0; it < 45; it++) {
          const m = 0.5 * (lo + hi);
          if (headErrorAt(lo, rel).err * headErrorAt(m, rel).err <= 0) hi = m;
          else lo = m;
        }
        flex = 0.5 * (lo + hi);
      }
    }

    const res = headErrorAt(flex, rel);
    pos[V.Hsp] = res.Hsp;
    pos[V.HrawF] = [...res.Hsp];
    pos[V.HrawB] = [...res.Hsp];
    pos[V.HthF] = res.HthF;
    pos[V.HthB] = [res.HthF[0], -res.HthF[1], res.HthF[2]];
    pos[V.C2] = res.C2;
  } else if (activeStepIndex >= 13) {
    pos[V.Hsp] = [...BB_Hsp0];
    pos[V.HrawF] = [...BB_Hsp0];
    pos[V.HrawB] = [...BB_Hsp0];
    pos[V.HthF] = [...BB_Hth0];
    pos[V.HthB] = [...BB_Hth0];
    pos[V.C2] = [...BB_C2_BEAK];
  }

  // --- Step 14 (idx 13) & Step 15 (idx 14): Wings Fold Outward & Stand Upright ---
  const WING_MAX_ANGLE = (82 * Math.PI) / 180;
  if (activeStepIndex === 13) {
    const wingAngF = WING_MAX_ANGLE * easeT;
    pos[V.C3] = rotatePointAroundLine(BB_WING_UP, BB_QL, BB_QR, wingAngF);
  } else if (activeStepIndex >= 14) {
    pos[V.C3] = rotatePointAroundLine(BB_WING_UP, BB_QL, BB_QR, WING_MAX_ANGLE);
    const wingAngB = WING_MAX_ANGLE * easeT;
    pos[V.C1] = rotatePointAroundLine(BB_WING_UP, BB_QL, BB_QR, -wingAngB);
  }

  const worldPos = transformDiamondToWorld(pos, clamped);
  const { prios, upSigns } = computeCraneLayerState(activeStepIndex, stepT);
  const { facetOffsets, facetCornerOffsets } = computeSmoothStackOffsets(worldPos, facets, prios, upSigns, 0.0034);

  return {
    vertexPositions: worldPos,
    facetOffsets,
    facetCornerOffsets,
    activeStepIndex,
    stepProgress: stepT,
    maxEdgeStrainPct: computeMaxEdgeStrainPct(vertices2D, facets, worldPos),
  };
}

// ============================================================================
// Crease Definitions & 15-Step Educational Breakdown
// ============================================================================

const CRANE_CREASES: CreaseDef[] = [
  // Diagonal 1: C2 <-> C0
  { id: 'diag1-a', vA: V.C2, vB: V.D2, foldType: 'valley', stepIndex: 0 },
  { id: 'diag1-b', vA: V.D2, vB: V.O, foldType: 'valley', stepIndex: 0 },
  { id: 'diag1-c', vA: V.O, vB: V.D0, foldType: 'valley', stepIndex: 0 },
  { id: 'diag1-d', vA: V.D0, vB: V.C0, foldType: 'valley', stepIndex: 0 },

  // Diagonal 2: C1 <-> C3
  { id: 'diag2-a', vA: V.C1, vB: V.D1, foldType: 'valley', stepIndex: 1 },
  { id: 'diag2-b', vA: V.D1, vB: V.O, foldType: 'valley', stepIndex: 1 },
  { id: 'diag2-c', vA: V.O, vB: V.D3, foldType: 'valley', stepIndex: 1 },
  { id: 'diag2-d', vA: V.D3, vB: V.C3, foldType: 'valley', stepIndex: 1 },

  // Midlines: O -> M0, M3, M1, M2
  { id: 'mid-m0a', vA: V.O, vB: V.Q0, foldType: 'mountain', stepIndex: 3 },
  { id: 'mid-m0b', vA: V.Q0, vB: V.M0, foldType: 'mountain', stepIndex: 3 },
  { id: 'mid-m3a', vA: V.O, vB: V.Q3, foldType: 'mountain', stepIndex: 3 },
  { id: 'mid-m3b', vA: V.Q3, vB: V.M3, foldType: 'mountain', stepIndex: 3 },
  { id: 'mid-m1a', vA: V.O, vB: V.Q1, foldType: 'mountain', stepIndex: 4 },
  { id: 'mid-m1b', vA: V.Q1, vB: V.M1, foldType: 'mountain', stepIndex: 4 },
  { id: 'mid-m2a', vA: V.O, vB: V.Q2, foldType: 'mountain', stepIndex: 4 },
  { id: 'mid-m2b', vA: V.Q2, vB: V.M2, foldType: 'mountain', stepIndex: 4 },

  // Front Kite & Horizontal Hinge
  { id: 'kiteF-R', vA: V.Q0, vB: V.C3, foldType: 'valley', stepIndex: 5 },
  { id: 'kiteF-L', vA: V.Q3, vB: V.C3, foldType: 'valley', stepIndex: 5 },
  { id: 'kitePockF-R', vA: V.Q0, vB: V.ToutF, foldType: 'mountain', stepIndex: 5 },
  { id: 'kitePockF-L', vA: V.Q3, vB: V.NoutF, foldType: 'mountain', stepIndex: 5 },
  { id: 'horizF-R', vA: V.D3, vB: V.Q0, foldType: 'mountain', stepIndex: 6 },
  { id: 'horizF-L', vA: V.D3, vB: V.Q3, foldType: 'mountain', stepIndex: 6 },

  // Back Kite & Horizontal Hinge
  { id: 'kiteB-R', vA: V.Q1, vB: V.C1, foldType: 'valley', stepIndex: 8 },
  { id: 'kiteB-L', vA: V.Q2, vB: V.C1, foldType: 'valley', stepIndex: 8 },
  { id: 'horizB-R', vA: V.D1, vB: V.Q1, foldType: 'mountain', stepIndex: 9 },
  { id: 'horizB-L', vA: V.D1, vB: V.Q2, foldType: 'mountain', stepIndex: 9 },

  // Neck, Tail & Head Reverse Folds
  { id: 'neck-F', vA: V.Nin, vB: V.NoutF, foldType: 'valley', stepIndex: 10 },
  { id: 'neck-B', vA: V.Nin, vB: V.NoutB, foldType: 'valley', stepIndex: 10 },
  { id: 'tail-F', vA: V.Tin, vB: V.ToutF, foldType: 'valley', stepIndex: 11 },
  { id: 'tail-B', vA: V.Tin, vB: V.ToutB, foldType: 'valley', stepIndex: 11 },
  { id: 'head-F', vA: V.Hsp, vB: V.HthF, foldType: 'valley', stepIndex: 12 },
  { id: 'head-B', vA: V.Hsp, vB: V.HthB, foldType: 'valley', stepIndex: 12 },
];

const CRANE_STEPS: OrigamiStepSpec[] = [
  {
    id: 'crane-s1',
    title: '第一条对角线预折',
    subtitle: 'Step 1 / 15 · 基准对角折痕',
    instruction:
      '将白色面朝上、彩色和纸面朝下放置。沿左上至右下对角线对折压实后再展开，留出清晰的中轴引导线。',
    tip: '传统千纸鹤从白面朝上开始谷折对角线，最终彩面会完整包裹在千纸鹤全身外侧。',
    recommendedView: 'iso',
    activeCreaseIds: ['diag1-a', 'diag1-b', 'diag1-c', 'diag1-d'],
    foldArrows: [{ fromVert: V.C3, toVert: V.C1 }],
  },
  {
    id: 'crane-s2',
    title: '沿另一条对角线对折成大三角',
    subtitle: 'Step 2 / 15 · 双层等腰直角三角形',
    instruction: '沿左下至右上对角线将正方形纸张对折，使左上角与右下角严密重合，折成双层大三角形。',
    tip: '此时彩色和纸面已经翻到外侧，注意对齐两个直角边。',
    recommendedView: 'iso',
    activeCreaseIds: ['diag2-a', 'diag2-b', 'diag2-c', 'diag2-d'],
    foldArrows: [{ fromVert: V.C2, toVert: V.C0 }],
  },
  {
    id: 'crane-s3',
    title: '左右对折成四层小三角形',
    subtitle: 'Step 3 / 15 · 锁定四等分中线',
    instruction: '将双层大三角形的右半部分沿中心高线向左对折，形成四层重叠的等腰直角小三角形。',
    tip: '这一步为接下来的「袋口压折（Squash Fold）」准备好对称折痕。',
    recommendedView: 'top',
    activeCreaseIds: ['diag1-b', 'diag1-c'],
    foldArrows: [{ fromVert: V.C3, toVert: V.C1 }],
  },
  {
    id: 'crane-s4',
    title: '撑开上层袋口压折',
    subtitle: 'Step 4 / 15 · 正方基本形（正面）',
    instruction:
      '将上层三角形立起至垂直 90°，手指伸入两层袋口之间将其撑开，对准中线平稳向下压平成正方形。',
    tip: '拖动「当前步骤微调」滑块，可以从任意角度观察袋口撑开到压平的无形变三维几何轨迹！',
    recommendedView: 'iso',
    activeCreaseIds: ['mid-m0a', 'mid-m0b', 'mid-m3a', 'mid-m3b'],
    foldArrows: [{ fromVert: V.C3, toVert: V.C0 }],
  },
  {
    id: 'crane-s5',
    title: '背面袋口压折（完成正方基本形）',
    subtitle: 'Step 5 / 15 · 正方基本形（Square Base）',
    instruction:
      '将背面剩余的三角翼同样立起 90° 并撑开袋口压平，完成折纸中最核心的「正方基本形」，开口端朝下。',
    tip: '观察右下角「背面同步视角」小窗，无需手动翻转相机即可看清背面的袋口压折过程。',
    recommendedView: 'iso',
    activeCreaseIds: ['mid-m1a', 'mid-m1b', 'mid-m2a', 'mid-m2b'],
    foldArrows: [{ fromVert: V.C1, toVert: V.C0 }],
  },
  {
    id: 'crane-s6',
    title: '正面左右下斜边向中线预折',
    subtitle: 'Step 6 / 15 · 正面风筝折预折痕',
    instruction:
      '保持封闭顶角朝上、开口端朝下，将正方基本形正面的左右两条下斜边向竖直中线对折压实后展开。',
    tip: '这两条 22.5° 角平分折痕是后续「花瓣折」能够顺滑收拢的关键。',
    recommendedView: 'front',
    activeCreaseIds: ['kiteF-R', 'kiteF-L'],
    foldArrows: [{ fromVert: V.M0, toVert: V.D3 }],
  },
  {
    id: 'crane-s7',
    title: '上方封闭顶角向下水平预折',
    subtitle: 'Step 7 / 15 · 锁定横向花瓣折轴线',
    instruction: '将上方的小三角形沿着刚才风筝折的上端水平交界线向下翻折压实，随后展开还原。',
    tip: '压出这条水平折痕后，正面底角向上掀起时就会自然沿该横线翻转。',
    recommendedView: 'iso',
    activeCreaseIds: ['horizF-R', 'horizF-L'],
    foldArrows: [{ fromVert: V.O, toVert: V.C3 }],
  },
  {
    id: 'crane-s8',
    title: '正面花瓣折（引き寄せ折り）',
    subtitle: 'Step 8 / 15 · 翻起第一片鹤翼',
    instruction:
      '捏住正面最上层的底角向上掀起 180°，同时让左右两侧顺着预折痕自然向中心收拢压平，形成修长的菱形花瓣。',
    tip: '这是折纸新手最容易卡壳的一步！建议放慢至 0.5x 速度并用鼠标绕到侧面观察内部收拢方式。',
    recommendedView: 'iso',
    activeCreaseIds: ['horizF-R', 'horizF-L', 'kiteF-R', 'kiteF-L'],
    foldArrows: [{ fromVert: V.C3, toVert: V.O }],
  },
  {
    id: 'crane-s9',
    title: '背面左右下斜边向中线预折',
    subtitle: 'Step 9 / 15 · 背面风筝折预折痕',
    instruction: '对背面执行相同的预折操作：将背面左右两条下斜边向中心线对折压实后再展开。',
    tip: '可点击左上角「背面」预设机位，或直接对照右下角背面小窗观察。',
    recommendedView: 'back',
    activeCreaseIds: ['kiteB-R', 'kiteB-L'],
    foldArrows: [{ fromVert: V.M1, toVert: V.D1 }],
  },
  {
    id: 'crane-s10',
    title: '背面花瓣折（完成鹤基本形）',
    subtitle: 'Step 10 / 15 · 鹤基本形（Bird Base）',
    instruction:
      '掀起背面底角向上翻折 180°，将左右两侧向内收拢压平。至此「鹤基本形」完成：上方两片宽翼，下方两条细腿。',
    tip: '鹤基本形上下分明：上方两个宽角将成为左右翅膀，下方两个细长分叉将分别折成鹤颈与鹤尾。',
    recommendedView: 'back',
    activeCreaseIds: ['horizB-R', 'horizB-L', 'kiteB-R', 'kiteB-L'],
    foldArrows: [{ fromVert: V.C1, toVert: V.O }],
  },
  {
    id: 'crane-s11',
    title: '内翻折向上立起鹤颈',
    subtitle: 'Step 11 / 15 · 颈部内翻折（Inside Reverse Fold）',
    instruction:
      '微张左侧前后两层的缝隙，将左下方的细长尖角从两层之间向上翻转立起，再合拢两侧压实定型为鹤颈。',
    tip: '开启顶部「X-Ray 透视」模式，能清晰看到鹤颈是如何从前后两层夹缝中间翻转上来的。',
    recommendedView: 'iso',
    activeCreaseIds: ['neck-F', 'neck-B'],
    foldArrows: [{ fromVert: V.C2, toVert: V.Q3 }],
  },
  {
    id: 'crane-s12',
    title: '内翻折向上立起鹤尾',
    subtitle: 'Step 12 / 15 · 尾部内翻折',
    instruction: '用同样的内翻折手法，微张右侧缝隙，将右下方的细长尖角向上内翻折并合拢压实，形成斜向后上方的鹤尾。',
    tip: '鹤尾的仰角通常略低于或对称于鹤颈，使千纸鹤重心稳健、线条修长。',
    recommendedView: 'iso',
    activeCreaseIds: ['tail-F', 'tail-B'],
    foldArrows: [{ fromVert: V.C0, toVert: V.Q0 }],
  },
  {
    id: 'crane-s13',
    title: '鹤颈顶端内翻折出鹤头与鸟喙',
    subtitle: 'Step 13 / 15 · 头部内翻折',
    instruction: '在鹤颈距离尖端约 1/3 处略微撑开双层，将尖端向下内翻折并捏紧，塑造出优雅前倾的鹤头与尖喙。',
    tip: '切换到「侧面」或拉近镜头，可以观察颈部轻微屈曲打开喉部折缝的真实刚性联动。',
    recommendedView: 'side',
    activeCreaseIds: ['head-F', 'head-B'],
  },
  {
    id: 'crane-s14',
    title: '向外平展第一侧鹤翼',
    subtitle: 'Step 14 / 15 · 展开右侧主翼',
    instruction: '捏住躯干基部，将一侧宽大的鹤翼沿水平连接线向外、向下翻折约 82°，舒展翼面。',
    tip: '翅膀不必死折到 90°，保留微扬角度更有振翅欲飞的灵动感。',
    recommendedView: 'front',
    activeCreaseIds: ['horizF-R', 'horizF-L'],
    foldArrows: [{ fromVert: V.C3, toVert: V.Q0 }],
  },
  {
    id: 'crane-s15',
    title: '对称展开另一侧鹤翼 · 千纸鹤完成！',
    subtitle: 'Step 15 / 15 · 折り鶴立体成型',
    instruction: '将另一侧鹤翼对称向外平展，将千纸鹤平稳立起。一只严守物理等距定律的 15 步传统千纸鹤大功告成！',
    tip: '现在可以自由 360° 拖拽旋转，或拖动底部时间轴任意回看从一张平纸到立体千纸鹤的完整演变。',
    recommendedView: 'iso',
    activeCreaseIds: ['horizB-R', 'horizB-L'],
    foldArrows: [{ fromVert: V.C1, toVert: V.Q1 }],
  },
];

export const CRANE_MODEL: OrigamiModel = {
  id: 'traditional-crane',
  name: '传统千纸鹤 · 全 15 步 (折り鶴)',
  shortName: '传统千纸鹤 (15步)',
  paperWidth: 2.0,
  paperLength: 2.0,
  coloredSide: 'minusY',
  vertices2D,
  facets,
  creases: CRANE_CREASES,
  steps: CRANE_STEPS,
  evaluate: evaluateCrane,
};
