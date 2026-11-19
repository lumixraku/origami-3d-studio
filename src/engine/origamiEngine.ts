export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type FoldType = 'valley' | 'mountain';
export type CameraPresetId = 'iso' | 'top' | 'front' | 'side' | 'back';

export interface FacetDef {
  id: string;
  /** Counter-clockwise in (u, v) so (B - A) x (C - A) points in +Y at t = 0 */
  verts: [number, number, number];
}

export interface CreaseDef {
  id: string;
  vA: number;
  vB: number;
  foldType: FoldType;
  /** 0-based step index when this crease is first folded */
  stepIndex: number;
}

export interface FoldArrowHint {
  fromVert: number;
  toVert: number;
  arcNormal?: Vec3;
}

export interface OrigamiStepSpec {
  id: string;
  title: string;
  subtitle: string;
  instruction: string;
  tip: string;
  recommendedView: CameraPresetId;
  activeCreaseIds: string[];
  foldArrows?: FoldArrowHint[];
}

export interface EvaluatedOrigamiFrame {
  /** Exact zero-thickness isometric 3D positions for each vertex in vertices2D */
  vertexPositions: Vec3[];
  /** Tiny per-facet 3D stacking offset (paper thickness ~0.002) to eliminate Z-fighting */
  facetOffsets: Vec3[];
  activeStepIndex: number;
  stepProgress: number;
  /** Maximum relative edge length error across all facets in percent (0.000 = exact isometry) */
  maxEdgeStrainPct: number;
}

export interface OrigamiModel {
  id: string;
  name: string;
  shortName: string;
  paperWidth: number;
  paperLength: number;
  /** Which side of flat t=0 sheet (+Y or -Y) has the colored washi pattern */
  coloredSide: 'plusY' | 'minusY';
  vertices2D: Vec2[];
  facets: FacetDef[];
  creases: CreaseDef[];
  steps: OrigamiStepSpec[];
  evaluate: (globalProgress: number) => EvaluatedOrigamiFrame;
}

// ============================================================================
// Exact 2D & 3D Linear Algebra + Rigid Origami Kinematics Primitives
// ============================================================================

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function norm3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function normalize3(a: Vec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2]);
  if (len < 1e-12) return [0, 1, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function smooth01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Rodrigues' rotation formula: exact SO(3) isometry around a unit axis through origin */
export function rotatePointAroundAxis(
  point: Vec3,
  axisOrigin: Vec3,
  axisDirUnit: Vec3,
  angleRad: number,
): Vec3 {
  if (Math.abs(angleRad) < 1e-12) return point;
  const p = sub3(point, axisOrigin);
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const kDotP = dot3(axisDirUnit, p);
  const kCrossP = cross3(axisDirUnit, p);
  return [
    axisOrigin[0] + p[0] * cosA + kCrossP[0] * sinA + axisDirUnit[0] * kDotP * (1 - cosA),
    axisOrigin[1] + p[1] * cosA + kCrossP[1] * sinA + axisDirUnit[1] * kDotP * (1 - cosA),
    axisOrigin[2] + p[2] * cosA + kCrossP[2] * sinA + axisDirUnit[2] * kDotP * (1 - cosA),
  ];
}

export function rotatePointAroundLine(
  point: Vec3,
  lineA: Vec3,
  lineB: Vec3,
  angleRad: number,
): Vec3 {
  return rotatePointAroundAxis(point, lineA, normalize3(sub3(lineB, lineA)), angleRad);
}

/**
 * Exact analytical 3-sphere intersection (trilateration) in R^3.
 * Finds P such that |P - p1| = r1, |P - p2| = r2, |P - p3| = r3.
 * Preserves all three edge lengths to machine precision (~1e-16).
 */
export function solve3Spheres(
  p1: Vec3,
  r1: number,
  p2: Vec3,
  r2: number,
  p3: Vec3,
  r3: number,
  branchSign: 1 | -1 = 1,
): Vec3 {
  const exRaw = sub3(p2, p1);
  const d = norm3(exRaw);
  if (d < 1e-12) return p1;
  const ex = scale3(exRaw, 1 / d);
  const p3p1 = sub3(p3, p1);
  const i = dot3(ex, p3p1);
  const temp = sub3(p3p1, scale3(ex, i));
  const j = norm3(temp);
  if (j < 1e-12) return p1;
  const ey = scale3(temp, 1 / j);
  const ez = cross3(ex, ey);

  const x = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const y = (r1 * r1 - r3 * r3 + i * i + j * j - 2 * i * x) / (2 * j);
  const z2 = r1 * r1 - x * x - y * y;
  const z = branchSign * Math.sqrt(Math.max(0, z2));

  return [
    p1[0] + ex[0] * x + ey[0] * y + ez[0] * z,
    p1[1] + ex[1] * x + ey[1] * y + ez[1] * z,
    p1[2] + ex[2] * x + ey[2] * y + ez[2] * z,
  ];
}

/** Exact 2D barycentric weights of P in triangle (A, B, C) */
export function barycentric2D(p: Vec2, a: Vec2, b: Vec2, c: Vec2): Vec3 {
  const v0x = b[0] - a[0];
  const v0y = b[1] - a[1];
  const v1x = c[0] - a[0];
  const v1y = c[1] - a[1];
  const v2x = p[0] - a[0];
  const v2y = p[1] - a[1];

  const d00 = v0x * v0x + v0y * v0y;
  const d01 = v0x * v1x + v0y * v1y;
  const d11 = v1x * v1x + v1y * v1y;
  const d20 = v2x * v0x + v2y * v0y;
  const d21 = v2x * v1x + v2y * v1y;

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-14) return [1, 0, 0];
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  return [1 - v - w, v, w];
}

export function evalBarycentric3D(bary: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return [
    bary[0] * a[0] + bary[1] * b[0] + bary[2] * c[0],
    bary[0] * a[1] + bary[1] * b[1] + bary[2] * c[1],
    bary[0] * a[2] + bary[1] * b[2] + bary[2] * c[2],
  ];
}

/**
 * Ensures every facet's vertex indices [i0, i1, i2] are wound so that on the flat
 * sheet [u, 0, v], (P1 - P0) x (P2 - P0) points strictly in +Y.
 */
export function normalizeFacetWinding(vertices2D: Vec2[], facets: FacetDef[]): FacetDef[] {
  return facets.map((f) => {
    const [i0, i1, i2] = f.verts;
    const a = vertices2D[i0];
    const b = vertices2D[i1];
    const c = vertices2D[i2];
    // In 3D: [u, 0, v]. (B - A) x (C - A) has Y component = (b_z - a_z)*(c_x - a_x) - (b_x - a_x)*(c_z - a_z)
    const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (ny < 0) {
      return { id: f.id, verts: [i0, i2, i1] };
    }
    return f;
  });
}

/**
 * Computes maximum relative edge length deviation (%) across all facets of a frame.
 * For an exact isometric fold, this returns 0.000000 (within ~1e-13 floating-point noise).
 */
export function computeMaxEdgeStrainPct(
  vertices2D: Vec2[],
  facets: FacetDef[],
  positions3D: Vec3[],
): number {
  let maxStrain = 0;
  for (const f of facets) {
    const [i0, i1, i2] = f.verts;
    const pairs: Array<[number, number]> = [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ];
    for (const [a, b] of pairs) {
      const restLen = dist2(vertices2D[a], vertices2D[b]);
      if (restLen < 1e-9) continue;
      const currLen = dist3(positions3D[a], positions3D[b]);
      const relErr = Math.abs(currLen - restLen) / restLen;
      if (relErr > maxStrain) maxStrain = relErr;
    }
  }
  return maxStrain * 100;
}

/**
 * Computes clean per-facet micro-offsets to prevent WebGL Z-fighting among coplanar overlapping facets.
 * Groups facets that currently lie on the same 3D plane (quantized normal + plane d) and offsets them
 * along the plane normal according to a deterministic layer order.
 */
export function computeCoplanarStackOffsets(
  positions3D: Vec3[],
  facets: FacetDef[],
  layerPriority: number[],
  thickness = 0.0022,
  preferredStackDir?: Vec3,
): Vec3[] {
  const offsets: Vec3[] = facets.map(() => [0, 0, 0]);

  interface PlaneBucket {
    refNormal: Vec3;
    items: Array<{ facetIdx: number; priority: number }>;
  }

  const buckets: PlaneBucket[] = [];

  for (let fIdx = 0; fIdx < facets.length; fIdx++) {
    const [i0, i1, i2] = facets[fIdx].verts;
    const p0 = positions3D[i0];
    const p1 = positions3D[i1];
    const p2 = positions3D[i2];
    const rawN = cross3(sub3(p1, p0), sub3(p2, p0));
    const len = norm3(rawN);
    if (len < 1e-10) continue;
    let n: Vec3 = [rawN[0] / len, rawN[1] / len, rawN[2] / len];

    if (preferredStackDir && Math.abs(dot3(n, preferredStackDir)) > 0.15) {
      if (dot3(n, preferredStackDir) < 0) {
        n = [-n[0], -n[1], -n[2]];
      }
    } else if (
      n[1] < -1e-4 ||
      (Math.abs(n[1]) <= 1e-4 && (n[0] < -1e-4 || (Math.abs(n[0]) <= 1e-4 && n[2] < 0)))
    ) {
      n = [-n[0], -n[1], -n[2]];
    }
    const planeD = dot3(n, p0);

    let matched: PlaneBucket | null = null;
    for (const b of buckets) {
      const cosSim = Math.abs(dot3(n, b.refNormal));
      if (cosSim > 0.9992) {
        const refD = dot3(b.refNormal, p0);
        const existingP0 = positions3D[facets[b.items[0].facetIdx].verts[0]];
        const bD = dot3(b.refNormal, existingP0);
        if (Math.abs(refD - bD) < 0.008) {
          matched = b;
          break;
        }
      }
    }

    if (!matched) {
      matched = { refNormal: n, items: [] };
      buckets.push(matched);
      void planeD;
    }
    matched.items.push({ facetIdx: fIdx, priority: layerPriority[fIdx] ?? fIdx });
  }

  for (const b of buckets) {
    if (b.items.length <= 1) continue;
    // Group identical priorities together so sub-triangles of the same physical sheet layer share one Z-level
    const uniquePriorities = Array.from(new Set(b.items.map((it) => it.priority))).sort(
      (a, c) => a - c,
    );
    if (uniquePriorities.length <= 1) continue;

    const mid = (uniquePriorities.length - 1) / 2;
    const rankMap = new Map<number, number>();
    uniquePriorities.forEach((prio, idx) => rankMap.set(prio, idx - mid));

    for (const it of b.items) {
      const r = rankMap.get(it.priority) ?? 0;
      offsets[it.facetIdx] = scale3(b.refNormal, r * thickness);
    }
  }

  return offsets;
}

/**
 * Full automated physics verification utility: samples the model across all steps and verifies:
 * 1. No NaN / Infinity coordinates
 * 2. Exact isometric edge length preservation (< maxAllowedStrainPct)
 */
export function verifyOrigamiModelPhysics(
  model: OrigamiModel,
  samplesPerStep = 20,
  maxAllowedStrainPct = 0.01,
): { ok: boolean; worstStrainPct: number; worstProgress: number } {
  const total = model.steps.length;
  let worstStrainPct = 0;
  let worstProgress = 0;

  const totalSamples = total * samplesPerStep;
  for (let s = 0; s <= totalSamples; s++) {
    const p = (s / totalSamples) * total;
    const frame = model.evaluate(p);
    for (const v of frame.vertexPositions) {
      if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) {
        throw new Error(`[PhysicsError] Non-finite vertex at progress=${p.toFixed(3)}`);
      }
    }
    if (frame.maxEdgeStrainPct > worstStrainPct) {
      worstStrainPct = frame.maxEdgeStrainPct;
      worstProgress = p;
    }
  }

  return {
    ok: worstStrainPct <= maxAllowedStrainPct,
    worstStrainPct,
    worstProgress,
  };
}
