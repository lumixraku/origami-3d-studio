import {
  type CameraPresetId,
  type CreaseDef,
  type EvaluatedOrigamiFrame,
  type FacetDef,
  type FoldType,
  type OrigamiModel,
  type OrigamiStepSpec,
  type Vec2,
  type Vec3,
  computeCoplanarStackOffsets,
  computeMaxEdgeStrainPct,
  dot3,
  normalize3,
  normalizeFacetWinding,
  rotatePointAroundAxis,
  smooth01,
  sub3,
} from '../engine/origamiEngine.ts';

const DEG = Math.PI / 180;
const HALF_W = 1.0;
const HALF_L = Math.SQRT2; // A4 exact aspect ratio 1 : sqrt(2)

interface RawStepOp {
  id: string;
  foldType: FoldType;
  axisStart: Vec3;
  axisEnd: Vec3;
  movingSideNormal: Vec3;
  /** Exact mathematical target angle (e.g. +-180 deg, +-90 deg) so polygon splitting is 100% exact */
  exactAngle: number;
  flatFilter?: (flatCentroid: Vec2) => boolean;
  angleCurve?: (t: number) => number;
}

interface RawStepSpec {
  id: string;
  title: string;
  subtitle: string;
  instruction: string;
  tip: string;
  recommendedView: CameraPresetId;
  ops: RawStepOp[];
}

interface Poly2D3D {
  vIds: number[];
  flatCentroid: Vec2;
  layerPrio: number;
}

const EPS = 1e-6;

function compileExactHingeModel(
  id: string,
  name: string,
  shortName: string,
  width: number,
  length: number,
  rawSteps: RawStepSpec[],
): OrigamiModel {
  const hw = width / 2;
  const hl = length / 2;

  const vertices2D: Vec2[] = [
    [-hw, -hl],
    [hw, -hl],
    [hw, hl],
    [-hw, hl],
  ];
  const currentPos: Vec3[] = vertices2D.map(([u, v]) => [u, 0, v]);

  let polygons: Poly2D3D[] = [
    {
      vIds: [0, 1, 2, 3],
      flatCentroid: [0, 0],
      layerPrio: 10,
    },
  ];

  interface CompiledOp {
    op: RawStepOp;
    axisVA: number;
    axisVB: number;
    movingVerts: number[];
    creaseIds: string[];
  }

  const creases: CreaseDef[] = [];
  const compiledSteps: Array<{ raw: RawStepSpec; ops: CompiledOp[] }> = [];

  const getOrAddVertex = (uv: Vec2, pos3: Vec3): number => {
    for (let i = 0; i < vertices2D.length; i++) {
      if (
        Math.abs(vertices2D[i][0] - uv[0]) < 1e-6 &&
        Math.abs(vertices2D[i][1] - uv[1]) < 1e-6
      ) {
        return i;
      }
    }
    const nId = vertices2D.length;
    vertices2D.push(uv);
    currentPos.push(pos3);
    return nId;
  };

  const computeCentroid2D = (ids: number[]): Vec2 => {
    let su = 0;
    let sv = 0;
    for (const vid of ids) {
      su += vertices2D[vid][0];
      sv += vertices2D[vid][1];
    }
    return [su / ids.length, sv / ids.length];
  };

  let prioCounter = 20;

  for (let sIdx = 0; sIdx < rawSteps.length; sIdx++) {
    const rStep = rawSteps[sIdx];
    const cOps: CompiledOp[] = [];

    for (const op of rStep.ops) {
      const normal = normalize3(op.movingSideNormal);
      const nextPolys: Poly2D3D[] = [];
      const movingPolys: Poly2D3D[] = [];
      const opCreaseIds: string[] = [];

      for (const poly of polygons) {
        if (op.flatFilter && !op.flatFilter(poly.flatCentroid)) {
          nextPolys.push(poly);
          continue;
        }

        const ids = poly.vIds;
        const dists = ids.map((vid) => dot3(sub3(currentPos[vid], op.axisStart), normal));
        const hasFront = dists.some((d) => d > EPS);
        const hasBack = dists.some((d) => d < -EPS);

        if (!hasFront && !hasBack) {
          nextPolys.push(poly);
          continue;
        }
        if (hasFront && !hasBack) {
          const movedPoly: Poly2D3D = {
            ...poly,
            layerPrio: prioCounter++,
          };
          nextPolys.push(movedPoly);
          movingPolys.push(movedPoly);
          continue;
        }
        if (!hasFront && hasBack) {
          nextPolys.push(poly);
          continue;
        }

        // Split straddling polygon cleanly in exact 3D & 2D
        const frontIds: number[] = [];
        const backIds: number[] = [];
        const onPlaneVerts: number[] = [];

        for (let i = 0; i < ids.length; i++) {
          const curr = ids[i];
          const next = ids[(i + 1) % ids.length];
          const dc = dists[i];
          const dn = dists[(i + 1) % ids.length];

          if (dc >= -EPS) frontIds.push(curr);
          if (dc <= EPS) backIds.push(curr);
          if (Math.abs(dc) <= EPS) onPlaneVerts.push(curr);

          if ((dc > EPS && dn < -EPS) || (dc < -EPS && dn > EPS)) {
            const t = dc / (dc - dn);
            const uvA = vertices2D[curr];
            const uvB = vertices2D[next];
            const newUv: Vec2 = [
              uvA[0] + (uvB[0] - uvA[0]) * t,
              uvA[1] + (uvB[1] - uvA[1]) * t,
            ];
            const pA = currentPos[curr];
            const pB = currentPos[next];
            const newP: Vec3 = [
              pA[0] + (pB[0] - pA[0]) * t,
              pA[1] + (pB[1] - pA[1]) * t,
              pA[2] + (pB[2] - pA[2]) * t,
            ];
            const interId = getOrAddVertex(newUv, newP);
            frontIds.push(interId);
            backIds.push(interId);
            onPlaneVerts.push(interId);
          }
        }

        if (onPlaneVerts.length >= 2 && onPlaneVerts[0] !== onPlaneVerts[1]) {
          const cid = `${op.id}-c${creases.length}`;
          creases.push({
            id: cid,
            vA: onPlaneVerts[0],
            vB: onPlaneVerts[1],
            foldType: op.foldType,
            stepIndex: sIdx,
          });
          opCreaseIds.push(cid);
        }

        if (frontIds.length >= 3) {
          const fp: Poly2D3D = {
            vIds: frontIds,
            flatCentroid: computeCentroid2D(frontIds),
            layerPrio: prioCounter++,
          };
          nextPolys.push(fp);
          movingPolys.push(fp);
        }
        if (backIds.length >= 3) {
          nextPolys.push({
            vIds: backIds,
            flatCentroid: computeCentroid2D(backIds),
            layerPrio: poly.layerPrio,
          });
        }
      }

      polygons = nextPolys;

      // Collect moving vertex IDs strictly off the hinge plane
      const movingSet = new Set<number>();
      for (const mp of movingPolys) {
        for (const vid of mp.vIds) {
          const d = dot3(sub3(currentPos[vid], op.axisStart), normal);
          if (d > EPS) movingSet.add(vid);
        }
      }

      // Anchor axis to two farthest mesh vertices lying right on the hinge line
      const axisDir = normalize3(sub3(op.axisEnd, op.axisStart));
      let minP = Infinity;
      let maxP = -Infinity;
      let axisVA = -1;
      let axisVB = -1;

      for (let vid = 0; vid < currentPos.length; vid++) {
        const rel = sub3(currentPos[vid], op.axisStart);
        const proj = dot3(rel, axisDir);
        const closest: Vec3 = [
          op.axisStart[0] + axisDir[0] * proj,
          op.axisStart[1] + axisDir[1] * proj,
          op.axisStart[2] + axisDir[2] * proj,
        ];
        const distLine = Math.hypot(
          currentPos[vid][0] - closest[0],
          currentPos[vid][1] - closest[1],
          currentPos[vid][2] - closest[2],
        );
        if (distLine < 1e-4) {
          if (proj < minP) {
            minP = proj;
            axisVA = vid;
          }
          if (proj > maxP) {
            maxP = proj;
            axisVB = vid;
          }
        }
      }

      const movingVerts = Array.from(movingSet);

      // Advance currentPos to t = 1 using EXACT angle
      const endMult = op.angleCurve ? op.angleCurve(1) : 1;
      const finalAngle = op.exactAngle * endMult;
      if (Math.abs(finalAngle) > 1e-9 && axisVA !== -1 && axisVB !== -1) {
        const orig = currentPos[axisVA];
        const uDir = normalize3(sub3(currentPos[axisVB], orig));
        for (const vid of movingVerts) {
          currentPos[vid] = rotatePointAroundAxis(currentPos[vid], orig, uDir, finalAngle);
        }
      }

      cOps.push({
        op,
        axisVA,
        axisVB,
        movingVerts,
        creaseIds: opCreaseIds,
      });
    }

    compiledSteps.push({ raw: rStep, ops: cOps });
  }

  // Second pass over finalized polygons & vertices2D so vertices created in later
  // steps are included in earlier steps' movingVerts sets with 100% accuracy!
  const replayPos: Vec3[] = vertices2D.map(([u, v]) => [u, 0, v]);
  for (const cStep of compiledSteps) {
    for (const cop of cStep.ops) {
      const normal = normalize3(cop.op.movingSideNormal);
      const mSet = new Set<number>();
      for (const poly of polygons) {
        if (cop.op.flatFilter && !cop.op.flatFilter(poly.flatCentroid)) continue;
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (const vid of poly.vIds) {
          cx += replayPos[vid][0];
          cy += replayPos[vid][1];
          cz += replayPos[vid][2];
        }
        const n = poly.vIds.length;
        const cDist = dot3(sub3([cx / n, cy / n, cz / n], cop.op.axisStart), normal);
        if (cDist > EPS) {
          for (const vid of poly.vIds) {
            if (dot3(sub3(replayPos[vid], cop.op.axisStart), normal) > EPS) {
              mSet.add(vid);
            }
          }
        }
      }
      cop.movingVerts = Array.from(mSet);

      const endMult = cop.op.angleCurve ? cop.op.angleCurve(1) : 1;
      const finalAngle = cop.op.exactAngle * endMult;
      if (Math.abs(finalAngle) > 1e-9 && cop.axisVA !== -1 && cop.axisVB !== -1) {
        const orig = replayPos[cop.axisVA];
        const uDir = normalize3(sub3(replayPos[cop.axisVB], orig));
        for (const vid of cop.movingVerts) {
          replayPos[vid] = rotatePointAroundAxis(replayPos[vid], orig, uDir, finalAngle);
        }
      }
    }
  }

  // Triangulate convex polygons into FacetDefs + preserve layer priorities
  const rawFacets: FacetDef[] = [];
  const facetPrios: number[] = [];
  for (let pIdx = 0; pIdx < polygons.length; pIdx++) {
    const poly = polygons[pIdx];
    const ids = poly.vIds;
    for (let k = 1; k < ids.length - 1; k++) {
      rawFacets.push({
        id: `plane_f_${pIdx}_${k}`,
        verts: [ids[0], ids[k], ids[k + 1]],
      });
      facetPrios.push(poly.layerPrio);
    }
  }

  const facets = normalizeFacetWinding(vertices2D, rawFacets);

  const steps: OrigamiStepSpec[] = compiledSteps.map((cs) => ({
    id: cs.raw.id,
    title: cs.raw.title,
    subtitle: cs.raw.subtitle,
    instruction: cs.raw.instruction,
    tip: cs.raw.tip,
    recommendedView: cs.raw.recommendedView,
    activeCreaseIds: cs.ops.flatMap((o) => o.creaseIds),
  }));

  const evaluate = (globalProgress: number): EvaluatedOrigamiFrame => {
    const total = compiledSteps.length;
    const clamped = Number.isFinite(globalProgress)
      ? Math.max(0, Math.min(total, globalProgress))
      : 0;
    const activeStepIndex = clamped >= total ? total - 1 : Math.floor(clamped);
    const stepT = clamped >= total ? 1 : clamped - activeStepIndex;

    const workPos: Vec3[] = vertices2D.map(([u, v]) => [u, 0, v]);

    for (let sIdx = 0; sIdx <= activeStepIndex; sIdx++) {
      const localT = sIdx < activeStepIndex ? 1 : smooth01(stepT);
      for (const cop of compiledSteps[sIdx].ops) {
        if (cop.axisVA === -1 || cop.axisVB === -1) continue;
        const mult = cop.op.angleCurve ? cop.op.angleCurve(localT) : localT;
        const ang = cop.op.exactAngle * mult;
        if (Math.abs(ang) > 1e-10) {
          const orig = workPos[cop.axisVA];
          const uDir = normalize3(sub3(workPos[cop.axisVB], orig));
          for (const vid of cop.movingVerts) {
            workPos[vid] = rotatePointAroundAxis(workPos[vid], orig, uDir, ang);
          }
        }
      }
    }

    // Step 7 flight display elevation blend
    const liftBlend = smooth01(clamped - 6);
    if (liftBlend > 1e-9) {
      const pitch = -6 * DEG * liftBlend;
      for (let i = 0; i < workPos.length; i++) {
        const rotated = rotatePointAroundAxis(workPos[i], [0, 0, 0], [1, 0, 0], pitch);
        workPos[i] = [rotated[0], rotated[1] + 0.18 * liftBlend, rotated[2]];
      }
    }

    return {
      vertexPositions: workPos,
      facetOffsets: computeCoplanarStackOffsets(workPos, facets, facetPrios, 0.0022),
      activeStepIndex,
      stepProgress: stepT,
      maxEdgeStrainPct: computeMaxEdgeStrainPct(vertices2D, facets, workPos),
    };
  };

  return {
    id,
    name,
    shortName,
    paperWidth: width,
    paperLength: length,
    coloredSide: 'plusY',
    vertices2D,
    facets,
    creases,
    steps,
    evaluate,
  };
}

// ============================================================================
// 7-Step Classic A4 Dart Paper Airplane Specification (Exact 180° / 90° Hinges)
// ============================================================================

const RAW_AIRPLANE_STEPS: RawStepSpec[] = [
  {
    id: 'plane-s1',
    title: '纵向中线对折预折',
    subtitle: 'Step 1 / 7 · 压出居中对称基准线',
    instruction: '将 A4 比例长方形纸张沿纵向中心线对折压实，再平缓展开，留出精准的左右对称中线。',
    tip: '白面朝上开始向内折角，最终合拢机身展开机翼时，流线型彩面会完整朝外。',
    recommendedView: 'iso',
    ops: [
      {
        id: 'p1-center',
        foldType: 'valley',
        axisStart: [0, 0, -HALF_L],
        axisEnd: [0, 0, HALF_L],
        movingSideNormal: [1, 0, 0],
        exactAngle: 180 * DEG,
        angleCurve: (t) => Math.sin(t * Math.PI),
      },
    ],
  },
  {
    id: 'plane-s2',
    title: '左右顶角向中线 45° 内折',
    subtitle: 'Step 2 / 7 · 初折机头三角',
    instruction: '将右上角与左上角分别向纵向中线对折，使两条顶边与中线严丝合缝贴合。',
    tip: '可切换「俯视」视角，检查左右两个直角三角形在中线处是否完全对称。',
    recommendedView: 'top',
    ops: [
      {
        id: 'p2-right',
        foldType: 'valley',
        axisStart: [0, 0, -HALF_L],
        axisEnd: [HALF_W, 0, -HALF_L + HALF_W],
        movingSideNormal: [1, 0, -1],
        exactAngle: 180 * DEG,
      },
      {
        id: 'p2-left',
        foldType: 'valley',
        axisStart: [0, 0, -HALF_L],
        axisEnd: [-HALF_W, 0, -HALF_L + HALF_W],
        movingSideNormal: [-1, 0, -1],
        exactAngle: -180 * DEG,
      },
    ],
  },
  {
    id: 'plane-s3',
    title: '斜边二次向中线内折',
    subtitle: 'Step 3 / 7 · 收窄流线型尖机头',
    instruction: '将左右两条 45° 斜边再次向中心线翻折 180°，连同内部折角一起收拢成 22.5° 修长机头。',
    tip: '开启「X-Ray 透视」可以看到下层三角形是如何精确沿反射折痕同步翻折的。',
    recommendedView: 'iso',
    ops: [
      {
        id: 'p3-right',
        foldType: 'valley',
        axisStart: [0, 0, -HALF_L],
        axisEnd: [HALF_W, 0, -HALF_L + HALF_W * (Math.SQRT2 + 1)],
        movingSideNormal: [Math.SQRT2 + 1, 0, -1],
        exactAngle: 180 * DEG,
        flatFilter: (c) => c[0] > 0,
      },
      {
        id: 'p3-left',
        foldType: 'valley',
        axisStart: [0, 0, -HALF_L],
        axisEnd: [-HALF_W, 0, -HALF_L + HALF_W * (Math.SQRT2 + 1)],
        movingSideNormal: [-(Math.SQRT2 + 1), 0, -1],
        exactAngle: -180 * DEG,
        flatFilter: (c) => c[0] < 0,
      },
    ],
  },
  {
    id: 'plane-s4',
    title: '沿中心线合拢立起机身',
    subtitle: 'Step 4 / 7 · 形成纸飞机中央龙骨',
    instruction: '沿纵向中线将左右两半向上对折合拢至垂直 90°，形成扎实对称的纸飞机握持龙骨。',
    tip: '切换至「正面」或「侧面」机位，可以观察机头处多层纸片的严密叠放结构。',
    recommendedView: 'front',
    ops: [
      {
        id: 'p4-fuselage-R',
        foldType: 'valley',
        axisStart: [0, 0, -HALF_L],
        axisEnd: [0, 0, HALF_L],
        movingSideNormal: [1, 0, 0],
        exactAngle: 90 * DEG,
        flatFilter: (c) => c[0] > 0,
      },
      {
        id: 'p4-fuselage-L',
        foldType: 'valley',
        axisStart: [0, 0, -HALF_L],
        axisEnd: [0, 0, HALF_L],
        movingSideNormal: [-1, 0, 0],
        exactAngle: -90 * DEG,
        flatFilter: (c) => c[0] < 0,
      },
    ],
  },
  {
    id: 'plane-s5',
    title: '向下翻折展开左右主翼',
    subtitle: 'Step 5 / 7 · 折出宽大升力机翼',
    instruction: '在距离机身底边 0.22 高度处，将左右两侧机翼分别向外、向下平折 90°，展开主翼面。',
    tip: '主翼折线与机身底边保持平行，可确保滑翔升力均匀。',
    recommendedView: 'front',
    ops: [
      {
        id: 'p5-wing-R',
        foldType: 'mountain',
        axisStart: [0, 0.22, -HALF_L],
        axisEnd: [0, 0.22, HALF_L],
        movingSideNormal: [0, 1, 0],
        exactAngle: -90 * DEG,
        flatFilter: (c) => c[0] > 0,
      },
      {
        id: 'p5-wing-L',
        foldType: 'mountain',
        axisStart: [0, 0.22, -HALF_L],
        axisEnd: [0, 0.22, HALF_L],
        movingSideNormal: [0, 1, 0],
        exactAngle: 90 * DEG,
        flatFilter: (c) => c[0] < 0,
      },
    ],
  },
  {
    id: 'plane-s6',
    title: '向上折起两侧翼梢小翼',
    subtitle: 'Step 6 / 7 · 增强横向飞行稳定性',
    instruction: '在左右主翼外缘约 0.72 翼展处各向上翻折 86°，立起对称的垂直翼梢小翼（Winglets）。',
    tip: '翼梢小翼能有效抑制翼尖涡流，防止纸飞机在空中侧滑翻滚。',
    recommendedView: 'front',
    ops: [
      {
        id: 'p6-winglet-R',
        foldType: 'valley',
        axisStart: [0.68, 0.22, -HALF_L],
        axisEnd: [0.68, 0.22, HALF_L],
        movingSideNormal: [1, 0, 0],
        exactAngle: 86 * DEG,
        flatFilter: (c) => c[0] > 0,
      },
      {
        id: 'p6-winglet-L',
        foldType: 'valley',
        axisStart: [-0.68, 0.22, -HALF_L],
        axisEnd: [-0.68, 0.22, HALF_L],
        movingSideNormal: [-1, 0, 0],
        exactAngle: -86 * DEG,
        flatFilter: (c) => c[0] < 0,
      },
    ],
  },
  {
    id: 'plane-s7',
    title: '微调上反角（Y 型巡航姿态）',
    subtitle: 'Step 7 / 7 · 气动配平完成！',
    instruction: '将两侧机翼略微向上微抬 7° 形成经典上反角（Dihedral Angle），整架纸飞机进入巡航展示姿态！',
    tip: '自由旋转视角查看机腹龙骨与机翼上反角，所有折痕在全过程中均保持 0.000% 刚性等距无拉伸。',
    recommendedView: 'iso',
    ops: [
      {
        id: 'p7-dihedral-R',
        foldType: 'valley',
        axisStart: [0, 0.22, -HALF_L],
        axisEnd: [0, 0.22, HALF_L],
        movingSideNormal: [1, 0, 0],
        exactAngle: 7 * DEG,
        flatFilter: (c) => c[0] > 0,
      },
      {
        id: 'p7-dihedral-L',
        foldType: 'valley',
        axisStart: [0, 0.22, -HALF_L],
        axisEnd: [0, 0.22, HALF_L],
        movingSideNormal: [-1, 0, 0],
        exactAngle: -7 * DEG,
        flatFilter: (c) => c[0] < 0,
      },
    ],
  },
];

export const PAPER_AIRPLANE_MODEL: OrigamiModel = compileExactHingeModel(
  'classic-dart',
  '经典尖头纸飞机 · 全 7 步 (A4 Dart)',
  '经典纸飞机 (7步)',
  HALF_W * 2,
  HALF_L * 2,
  RAW_AIRPLANE_STEPS,
);
