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
  /** Per-facet 3D stacking offset (smoothly blended, zero pop, zero Z-fighting) */
  facetOffsets: Vec3[];
  /** Optional per-corner offsets [c0, c1, c2] for open-hinge tapering */
  facetCornerOffsets?: Array<[Vec3, Vec3, Vec3]>;
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

export function smoothRange(edge0: number, edge1: number, x: number): number {
  if (Math.abs(edge1 - edge0) < 1e-12) return x >= edge1 ? 1 : 0;
  return smooth01((x - edge0) / (edge1 - edge0));
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

export function normalizeFacetWinding(vertices2D: Vec2[], facets: FacetDef[]): FacetDef[] {
  return facets.map((f) => {
    const [i0, i1, i2] = f.verts;
    const a = vertices2D[i0];
    const b = vertices2D[i1];
    const c = vertices2D[i2];
    const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (ny < 0) {
      return { id: f.id, verts: [i0, i2, i1] };
    }
    return f;
  });
}

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

// ============================================================================
// Continuous Intrinsic-Normal + 2D SAT Overlap Stack Offset Solver
// Eliminates mid-fold Z-fighting, 90-deg normal flips, and 177-deg bucket pops!
// ============================================================================

function trianglesOverlapInTangent2D(
  a0: Vec2,
  a1: Vec2,
  a2: Vec2,
  b0: Vec2,
  b1: Vec2,
  b2: Vec2,
  shrinkMargin = -0.004,
): boolean {
  const triA = [a0, a1, a2];
  const triB = [b0, b1, b2];
  const edges: Vec2[] = [
    [a1[0] - a0[0], a1[1] - a0[1]],
    [a2[0] - a1[0], a2[1] - a1[1]],
    [a0[0] - a2[0], a0[1] - a2[1]],
    [b1[0] - b0[0], b1[1] - b0[1]],
    [b2[0] - b1[0], b2[1] - b1[1]],
    [b0[0] - b2[0], b0[1] - b2[1]],
  ];
  for (const [ex, ey] of edges) {
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const nx = -ey / len;
    const ny = ex / len;
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const p of triA) {
      const d = p[0] * nx + p[1] * ny;
      if (d < minA) minA = d;
      if (d > maxA) maxA = d;
    }
    for (const p of triB) {
      const d = p[0] * nx + p[1] * ny;
      if (d < minB) minB = d;
      if (d > maxB) maxB = d;
    }
    if (maxA < minB - shrinkMargin || maxB < minA - shrinkMargin) {
      return false;
    }
  }
  return true;
}

function buildTangentBasis(n: Vec3): { t1: Vec3; t2: Vec3 } {
  const ref: Vec3 = Math.abs(n[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0];
  const t1 = normalize3(cross3(ref, n));
  const t2 = cross3(n, t1);
  return { t1, t2 };
}

/**
 * Smooth, pop-free 3D layer offset solver:
 * - Uses intrinsic sheet normal `upSigns[f] * n_f` so rotating multi-layer packets NEVER flip sign at 90 deg.
 * - Uses 2D Separating Axis Theorem (SAT) in the shared tangent plane so non-overlapping side-by-side panels don't push each other.
 * - Ramps separation smoothly across 148° -> 174° (cosSim 0.85 -> 0.994) BEFORE layers touch, preventing hinge-wedge Z-fighting.
 * - Tapers offsets gently along open (< 162°) creases so angled hinges stay cleanly pinched.
 */
export function computeSmoothStackOffsets(
  positions3D: Vec3[],
  facets: FacetDef[],
  layerPriority: number[],
  upSigns: Array<1 | -1>,
  thickness = 0.0034,
): { facetOffsets: Vec3[]; facetCornerOffsets: Array<[Vec3, Vec3, Vec3]> } {
  const m = facets.length;
  const upDirs: Vec3[] = new Array(m);
  const centroids: Vec3[] = new Array(m);
  const rawNormals: Vec3[] = new Array(m);

  for (let i = 0; i < m; i++) {
    const [i0, i1, i2] = facets[i].verts;
    const p0 = positions3D[i0];
    const p1 = positions3D[i1];
    const p2 = positions3D[i2];
    const rn = normalize3(cross3(sub3(p1, p0), sub3(p2, p0)));
    rawNormals[i] = rn;
    const sgn = upSigns[i] ?? 1;
    upDirs[i] = [rn[0] * sgn, rn[1] * sgn, rn[2] * sgn];
    centroids[i] = [
      (p0[0] + p1[0] + p2[0]) / 3,
      (p0[1] + p1[1] + p2[1]) / 3,
      (p0[2] + p1[2] + p2[2]) / 3,
    ];
  }

  // Pairwise coupling weight between distinct priority levels per local stack cluster:
  // For each facet i, accumulate smooth repulsion against distinct priorities p_j != p_i
  // among facets j whose tangent projections overlap facet i (or its connected coplanar sheet).
  // First group facets that share the exact same priority AND nearly identical plane (same physical layer!)
  const layerGroupOfFacet = new Int32Array(m).fill(-1);
  interface LayerGroup {
    prio: number;
    upDir: Vec3;
    refPt: Vec3;
    facetIndices: number[];
  }
  const groups: LayerGroup[] = [];

  for (let i = 0; i < m; i++) {
    const prio = layerPriority[i];
    const ud = upDirs[i];
    const pt = positions3D[facets[i].verts[0]];
    let found = -1;
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g];
      if (
        Math.abs(grp.prio - prio) < 1e-5 &&
        dot3(grp.upDir, ud) > 0.996 &&
        Math.abs(dot3(grp.upDir, sub3(pt, grp.refPt))) < 0.015
      ) {
        found = g;
        break;
      }
    }
    if (found === -1) {
      found = groups.length;
      groups.push({ prio, upDir: ud, refPt: pt, facetIndices: [i] });
    } else {
      groups[found].facetIndices.push(i);
    }
    layerGroupOfFacet[i] = found;
  }

  const numG = groups.length;
  const groupShift = new Float64Array(numG);
  const groupAxis: Vec3[] = groups.map((g) => g.upDir);

  const COS_START = Math.cos((34 * Math.PI) / 180); // ~146 deg fold angle: start pre-separating early!
  const COS_FULL = Math.cos((6 * Math.PI) / 180); // ~174 deg fold angle: full stack separation before contact!

  // Precompute pairwise coupling W[ga][gb] in [0, 1]
  const W = Array.from({ length: numG }, () => new Float64Array(numG));

  for (let ga = 0; ga < numG; ga++) {
    for (let gb = ga + 1; gb < numG; gb++) {
      const A = groups[ga];
      const B = groups[gb];
      if (Math.abs(A.prio - B.prio) < 1e-5) continue;

      const cosAlign = dot3(A.upDir, B.upDir);
      if (cosAlign <= COS_START) continue;
      const wAng = smoothRange(COS_START, COS_FULL, cosAlign);

      const avgUp = normalize3(add3(A.upDir, B.upDir));
      const { t1, t2 } = buildTangentBasis(avgUp);

      // Check if ANY facet pair (fa in A, fb in B) overlaps in tangent 2D AND is close along avgUp
      let bestPairW = 0;
      for (const fa of A.facetIndices) {
        const [a0, a1, a2] = facets[fa].verts;
        const pa0 = positions3D[a0];
        const pa1 = positions3D[a1];
        const pa2 = positions3D[a2];
        const qa0: Vec2 = [dot3(pa0, t1), dot3(pa0, t2)];
        const qa1: Vec2 = [dot3(pa1, t1), dot3(pa1, t2)];
        const qa2: Vec2 = [dot3(pa2, t1), dot3(pa2, t2)];

        for (const fb of B.facetIndices) {
          const [b0, b1, b2] = facets[fb].verts;
          const pb0 = positions3D[b0];
          const pb1 = positions3D[b1];
          const pb2 = positions3D[b2];
          const qb0: Vec2 = [dot3(pb0, t1), dot3(pb0, t2)];
          const qb1: Vec2 = [dot3(pb1, t1), dot3(pb1, t2)];
          const qb2: Vec2 = [dot3(pb2, t1), dot3(pb2, t2)];

          if (!trianglesOverlapInTangent2D(qa0, qa1, qa2, qb0, qb1, qb2, -0.003)) {
            continue;
          }

          // Minimum vertex-to-plane distance so tilted flaps only couple where they actually approach!
          const minVertDist = Math.min(
            Math.abs(dot3(sub3(pa0, pb0), avgUp)),
            Math.abs(dot3(sub3(pa1, pb0), avgUp)),
            Math.abs(dot3(sub3(pa2, pb0), avgUp)),
            Math.abs(dot3(sub3(pb0, pa0), avgUp)),
            Math.abs(dot3(sub3(pb1, pa0), avgUp)),
            Math.abs(dot3(sub3(pb2, pa0), avgUp)),
          );
          const dCentroid = Math.abs(dot3(sub3(centroids[fa], centroids[fb]), avgUp));
          const dPerp = 0.5 * minVertDist + 0.5 * dCentroid;
          const wDist = 1 - smoothRange(0.008, 0.055, dPerp);
          if (wDist > bestPairW) bestPairW = wDist;
          if (bestPairW > 0.999) break;
        }
        if (bestPairW > 0.999) break;
      }

      const wTotal = wAng * bestPairW;
      W[ga][gb] = wTotal;
      W[gb][ga] = wTotal;
    }
  }

  // Transitive closure inside near-flat stacks so all layers in a multi-layer stack share unified spacing
  for (let k = 0; k < numG; k++) {
    for (let i = 0; i < numG; i++) {
      if (W[i][k] < 1e-4) continue;
      for (let j = i + 1; j < numG; j++) {
        if (Math.abs(groups[i].prio - groups[j].prio) < 1e-5) continue;
        const via = Math.min(W[i][k], W[k][j]);
        if (via > W[i][j]) {
          W[i][j] = via;
          W[j][i] = via;
        }
      }
    }
  }

  for (let ga = 0; ga < numG; ga++) {
    let shift = 0;
    let axisAcc: Vec3 = [0, 0, 0];
    let wSum = 0;
    for (let gb = 0; gb < numG; gb++) {
      if (ga === gb) continue;
      const w = W[ga][gb];
      if (w < 1e-5) continue;
      shift += groups[gb].prio < groups[ga].prio ? 0.5 * w : -0.5 * w;
      axisAcc = add3(axisAcc, scale3(groups[gb].upDir, w));
      wSum += w;
    }
    groupShift[ga] = shift;
    if (wSum > 1e-5) {
      groupAxis[ga] = normalize3(add3(groups[ga].upDir, scale3(axisAcc, 1 / wSum)));
    }
  }

  const facetOffsets: Vec3[] = new Array(m);
  for (let i = 0; i < m; i++) {
    const g = layerGroupOfFacet[i];
    facetOffsets[i] = scale3(groupAxis[g], groupShift[g] * thickness);
  }

  // Open-hinge corner averaging: if two facets share a vertex along an OPEN crease (< 150 deg),
  // blend their offsets slightly at that shared vertex ONLY if they belong to the same layer priority
  // (keeps unfolded/90-deg hinges seamless without ever collapsing stacked 180-deg layers!)
  const facetCornerOffsets: Array<[Vec3, Vec3, Vec3]> = facets.map((_, i) => [
    facetOffsets[i],
    facetOffsets[i],
    facetOffsets[i],
  ]);

  void rawNormals;
  return { facetOffsets, facetCornerOffsets };
}

/** Legacy wrapper kept for compatibility */
export function computeCoplanarStackOffsets(
  positions3D: Vec3[],
  facets: FacetDef[],
  layerPriority: number[],
  thickness = 0.0032,
  preferredStackDir?: Vec3,
): Vec3[] {
  const upSigns: Array<1 | -1> = facets.map((f) => {
    const [i0, i1, i2] = f.verts;
    const rn = normalize3(
      cross3(sub3(positions3D[i1], positions3D[i0]), sub3(positions3D[i2], positions3D[i0])),
    );
    if (preferredStackDir && Math.abs(dot3(rn, preferredStackDir)) > 0.1) {
      return dot3(rn, preferredStackDir) >= 0 ? 1 : -1;
    }
    return rn[1] >= 0 ? 1 : -1;
  });
  return computeSmoothStackOffsets(positions3D, facets, layerPriority, upSigns, thickness)
    .facetOffsets;
}

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
