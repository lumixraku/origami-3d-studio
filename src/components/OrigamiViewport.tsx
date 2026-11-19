import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  CameraPresetId,
  EvaluatedOrigamiFrame,
  OrigamiModel,
} from '../engine/origamiEngine';

export interface OrigamiViewportProps {
  model: OrigamiModel;
  progress: number;
  cameraPreset: CameraPresetId;
  cameraTrigger: number;
  xrayMode: boolean;
  showPip: boolean;
  showCreases: boolean;
  paperColor: string;
  onFrameEvaluated?: (strainPct: number) => void;
}

const CAMERA_PRESETS: Record<
  CameraPresetId,
  { pos: [number, number, number]; target: [number, number, number] }
> = {
  iso: { pos: [-2.45, 1.95, -2.55], target: [0, 0.18, 0] },
  top: { pos: [0, 3.9, -0.04], target: [0, 0.1, 0] },
  front: { pos: [0, 0.85, -3.5], target: [0, 0.22, 0] },
  side: { pos: [-3.5, 0.85, 0], target: [0, 0.22, 0] },
  back: { pos: [0, 0.95, 3.5], target: [0, 0.22, 0] },
};

/**
 * Generates an authentic Japanese Washi Bokashi (gradient + gold leaf flecks + paper fibers)
 * texture for the colored face, and a crisp textured cream-white paper for the reverse face.
 */
function createWashiPaperTexture(baseHex: string, isColoredFace: boolean): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  if (isColoredFace) {
    // Rich diagonal bokashi gradient inspired by traditional Japanese chiyogami/washi
    const base = new THREE.Color(baseHex);
    const lighter = base.clone().lerp(new THREE.Color('#fff5eb'), 0.26);
    const deeper = base.clone().multiplyScalar(0.78);

    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, `#${deeper.getHexString()}`);
    grad.addColorStop(0.52, `#${base.getHexString()}`);
    grad.addColorStop(1, `#${lighter.getHexString()}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Subtle soft radial highlight
    const rad = ctx.createRadialGradient(size * 0.3, size * 0.3, 20, size * 0.5, size * 0.5, size * 0.7);
    rad.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
    rad.addColorStop(1, 'rgba(0, 0, 0, 0.04)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.fillStyle = '#f6f4ee';
    ctx.fillRect(0, 0, size, size);
  }

  // Fine paper grain
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.random() - 0.5) * (isColoredFace ? 10 : 7);
    data[i] = Math.max(0, Math.min(255, data[i] + grain));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + grain));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + grain));
  }
  ctx.putImageData(imgData, 0, 0);

  // Delicate mulberry washi fibers
  ctx.strokeStyle = isColoredFace ? 'rgba(255, 250, 240, 0.11)' : 'rgba(170, 162, 148, 0.14)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 180; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 8 + Math.random() * 20;
    const ang = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  // Subtle gold/warm flecks on colored washi
  if (isColoredFace) {
    ctx.fillStyle = 'rgba(255, 232, 175, 0.22)';
    for (let i = 0; i < 45; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 1 + Math.random() * 2.2;
      ctx.fillRect(x, y, r, r);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export const OrigamiViewport: React.FC<OrigamiViewportProps> = ({
  model,
  progress,
  cameraPreset,
  cameraTrigger,
  xrayMode,
  showPip,
  showCreases,
  paperColor,
  onFrameEvaluated,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const propsRef = useRef({
    progress,
    xrayMode,
    showPip,
    showCreases,
    onFrameEvaluated,
  });
  propsRef.current = { progress, xrayMode, showPip, showCreases, onFrameEvaluated };

  const sceneObjRef = useRef<{
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    tween: {
      active: boolean;
      startPos: THREE.Vector3;
      endPos: THREE.Vector3;
      startTarget: THREE.Vector3;
      endTarget: THREE.Vector3;
      t: number;
    };
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initW = container.clientWidth || 800;
    const initH = container.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(initW, initH);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setScissorTest(true);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0f172a');

    const camera = new THREE.PerspectiveCamera(40, initW / initH, 0.22, 24);
    camera.position.set(...CAMERA_PRESETS.iso.pos);

    const pipCamera = new THREE.PerspectiveCamera(40, 1.38, 0.22, 24);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 1.2;
    controls.maxDistance = 9.0;
    controls.target.set(...CAMERA_PRESETS.iso.target);

    // Three-point studio lighting for crisp paper facet definition
    const hemiLight = new THREE.HemisphereLight('#f8fafc', '#334155', 0.92);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#ffffff', 1.18);
    keyLight.position.set(-3.2, 5.8, -3.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 16;
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight('#bae6fd', 0.52);
    fillLight.position.set(4.0, 2.8, 3.6);
    scene.add(fillLight);

    const underLight = new THREE.DirectionalLight('#fde68a', 0.32);
    underLight.position.set(0, -3.5, 0);
    scene.add(underLight);

    // Studio Grid & Soft Contact Shadow Floor
    const grid = new THREE.GridHelper(10, 20, '#334155', '#1e293b');
    grid.position.y = -0.52;
    scene.add(grid);

    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = -0.519;
    shadowFloor.receiveShadow = true;
    scene.add(shadowFloor);

    // Build Non-Indexed Flat-Shaded Facet Geometry (3 distinct vertices per facet)
    // Guarantees razor-sharp paper creases AND clean per-facet stacking offsets!
    const numFacets = model.facets.length;
    const posArray = new Float32Array(numFacets * 9);
    const uvArray = new Float32Array(numFacets * 6);

    const hw = model.paperWidth / 2;
    const hl = model.paperLength / 2;

    for (let fIdx = 0; fIdx < numFacets; fIdx++) {
      const [i0, i1, i2] = model.facets[fIdx].verts;
      const verts = [i0, i1, i2];
      for (let k = 0; k < 3; k++) {
        const [u, v] = model.vertices2D[verts[k]];
        uvArray[fIdx * 6 + k * 2] = (u + hw) / model.paperWidth;
        uvArray[fIdx * 6 + k * 2 + 1] = 1 - (v + hl) / model.paperLength;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));

    const coloredTex = createWashiPaperTexture(paperColor, true);
    const whiteTex = createWashiPaperTexture(paperColor, false);

    const plusYIsColored = model.coloredSide === 'plusY';

    const frontMat = new THREE.MeshStandardMaterial({
      map: plusYIsColored ? coloredTex : whiteTex,
      roughness: 0.74,
      metalness: 0.02,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    const backMat = new THREE.MeshStandardMaterial({
      map: plusYIsColored ? whiteTex : coloredTex,
      roughness: 0.74,
      metalness: 0.02,
      side: THREE.BackSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    const frontMesh = new THREE.Mesh(geometry, frontMat);
    frontMesh.castShadow = true;
    frontMesh.receiveShadow = true;

    const backMesh = new THREE.Mesh(geometry, backMat);
    backMesh.castShadow = true;
    backMesh.receiveShadow = true;

    const paperGroup = new THREE.Group();
    paperGroup.add(frontMesh);
    paperGroup.add(backMesh);
    scene.add(paperGroup);

    // Crisp Paper Edge Contour Lines (updates every frame from facet edges)
    const edgePositions = new Float32Array(numFacets * 18); // 3 edges * 2 pts * 3 floats
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: '#1e293b',
      transparent: true,
      opacity: 0.26,
    });
    const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    scene.add(edgeLines);

    // Active Crease & Direction Arrow Overlay Group
    const overlayGroup = new THREE.Group();
    scene.add(overlayGroup);

    const tween = {
      active: false,
      startPos: new THREE.Vector3(),
      endPos: new THREE.Vector3(),
      startTarget: new THREE.Vector3(),
      endTarget: new THREE.Vector3(),
      t: 0,
    };

    sceneObjRef.current = { camera, controls, tween };

    const onControlStart = () => {
      tween.active = false;
    };
    controls.addEventListener('start', onControlStart);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(1, entry.contentRect.width);
        const h = Math.max(1, entry.contentRect.height);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    let animId = 0;
    let lastProgress = -999;
    let lastShowCreases = !propsRef.current.showCreases;

    const updateMeshForFrame = (frame: EvaluatedOrigamiFrame) => {
      const { vertexPositions, facetOffsets } = frame;
      const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const eAttr = edgeGeometry.getAttribute('position') as THREE.BufferAttribute;
      const eArr = eAttr.array as Float32Array;

      for (let fIdx = 0; fIdx < numFacets; fIdx++) {
        const [i0, i1, i2] = model.facets[fIdx].verts;
        const off = facetOffsets[fIdx];
        const p0 = vertexPositions[i0];
        const p1 = vertexPositions[i1];
        const p2 = vertexPositions[i2];

        const x0 = p0[0] + off[0];
        const y0 = p0[1] + off[1];
        const z0 = p0[2] + off[2];

        const x1 = p1[0] + off[0];
        const y1 = p1[1] + off[1];
        const z1 = p1[2] + off[2];

        const x2 = p2[0] + off[0];
        const y2 = p2[1] + off[1];
        const z2 = p2[2] + off[2];

        const base = fIdx * 9;
        arr[base] = x0;
        arr[base + 1] = y0;
        arr[base + 2] = z0;
        arr[base + 3] = x1;
        arr[base + 4] = y1;
        arr[base + 5] = z1;
        arr[base + 6] = x2;
        arr[base + 7] = y2;
        arr[base + 8] = z2;

        const eBase = fIdx * 18;
        eArr[eBase] = x0;
        eArr[eBase + 1] = y0;
        eArr[eBase + 2] = z0;
        eArr[eBase + 3] = x1;
        eArr[eBase + 4] = y1;
        eArr[eBase + 5] = z1;

        eArr[eBase + 6] = x1;
        eArr[eBase + 7] = y1;
        eArr[eBase + 8] = z1;
        eArr[eBase + 9] = x2;
        eArr[eBase + 10] = y2;
        eArr[eBase + 11] = z2;

        eArr[eBase + 12] = x2;
        eArr[eBase + 13] = y2;
        eArr[eBase + 14] = z2;
        eArr[eBase + 15] = x0;
        eArr[eBase + 16] = y0;
        eArr[eBase + 17] = z0;
      }

      posAttr.needsUpdate = true;
      eAttr.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    };

    const rebuildCreaseOverlay = (frame: EvaluatedOrigamiFrame, visible: boolean) => {
      while (overlayGroup.children.length > 0) {
        const child = overlayGroup.children.pop()!;
        child.traverse((obj) => {
          if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
          if ((obj as THREE.Mesh).material) {
            const m = (obj as THREE.Mesh).material;
            if (Array.isArray(m)) m.forEach((mt) => mt.dispose());
            else m.dispose();
          }
        });
      }

      if (!visible) return;

      const stepSpec = model.steps[frame.activeStepIndex];
      if (!stepSpec) return;

      const activeIds = new Set(stepSpec.activeCreaseIds);
      const { vertexPositions } = frame;

      for (const crease of model.creases) {
        if (!activeIds.has(crease.id)) continue;
        const pA = new THREE.Vector3(...vertexPositions[crease.vA]);
        const pB = new THREE.Vector3(...vertexPositions[crease.vB]);
        if (pA.distanceTo(pB) < 1e-4) continue;

        const color = crease.foldType === 'valley' ? '#22d3ee' : '#fb923c';
        const lineGeo = new THREE.BufferGeometry().setFromPoints([pA, pB]);
        const lineMat = new THREE.LineDashedMaterial({
          color,
          dashSize: 0.09,
          gapSize: 0.045,
          depthTest: false,
          transparent: true,
          opacity: 0.92,
        });
        const line = new THREE.Line(lineGeo, lineMat);
        line.computeLineDistances();
        line.renderOrder = 10;
        overlayGroup.add(line);
      }

      // Render 3D curved motion guide arrows for the active step
      if (stepSpec.foldArrows) {
        for (const arrow of stepSpec.foldArrows) {
          const fromP = new THREE.Vector3(...vertexPositions[arrow.fromVert]);
          const toP = new THREE.Vector3(...vertexPositions[arrow.toVert]);
          const span = fromP.distanceTo(toP);
          if (span < 0.08) continue;

          const mid = new THREE.Vector3().addVectors(fromP, toP).multiplyScalar(0.5);
          mid.y += Math.min(0.45, span * 0.34);

          const curve = new THREE.QuadraticBezierCurve3(fromP, mid, toP);
          const pts = curve.getPoints(20);
          const arcGeo = new THREE.BufferGeometry().setFromPoints(pts);
          const arcMat = new THREE.LineBasicMaterial({
            color: '#38bdf8',
            transparent: true,
            opacity: 0.8,
            depthTest: false,
          });
          const arcLine = new THREE.Line(arcGeo, arcMat);
          arcLine.renderOrder = 11;
          overlayGroup.add(arcLine);

          // Cone arrowhead at destination end of curve
          const tangent = curve.getTangent(0.96).normalize();
          const coneGeo = new THREE.ConeGeometry(0.036, 0.095, 12);
          const coneMat = new THREE.MeshBasicMaterial({
            color: '#38bdf8',
            transparent: true,
            opacity: 0.9,
            depthTest: false,
          });
          const cone = new THREE.Mesh(coneGeo, coneMat);
          cone.position.copy(pts[pts.length - 1]);
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
          cone.renderOrder = 12;
          overlayGroup.add(cone);
        }
      }
    };

    const animate = () => {
      animId = requestAnimationFrame(animate);

      const {
        progress: currProg,
        xrayMode: isXray,
        showCreases: creasesOn,
        showPip: pipOn,
        onFrameEvaluated: reportStrain,
      } = propsRef.current;

      frontMat.transparent = isXray;
      frontMat.opacity = isXray ? 0.5 : 1.0;
      frontMat.depthWrite = !isXray;
      backMat.transparent = isXray;
      backMat.opacity = isXray ? 0.5 : 1.0;
      backMat.depthWrite = !isXray;
      edgeMaterial.opacity = isXray ? 0.55 : 0.24;

      if (Math.abs(currProg - lastProgress) > 1e-5 || creasesOn !== lastShowCreases) {
        lastProgress = currProg;
        lastShowCreases = creasesOn;
        const frame = model.evaluate(currProg);
        updateMeshForFrame(frame);
        rebuildCreaseOverlay(frame, creasesOn);
        reportStrain?.(frame.maxEdgeStrainPct);
      }

      if (tween.active) {
        tween.t = Math.min(1, tween.t + 0.065);
        const ease = 1 - Math.pow(1 - tween.t, 3);
        camera.position.lerpVectors(tween.startPos, tween.endPos, ease);
        controls.target.lerpVectors(tween.startTarget, tween.endTarget, ease);
        if (tween.t >= 1) tween.active = false;
      }

      controls.update();

      const w = renderer.domElement.clientWidth || initW;
      const h = renderer.domElement.clientHeight || initH;

      // 1. Main Viewport
      renderer.setViewport(0, 0, w, h);
      renderer.setScissor(0, 0, w, h);
      renderer.setClearColor('#0f172a', 1);
      renderer.clear();
      renderer.render(scene, camera);

      // 2. Synchronized Opposite-Angle PiP Viewport
      if (pipOn && w > 480) {
        const pipW = Math.round(Math.min(228, w * 0.25));
        const pipH = Math.round(pipW * 0.72);
        const pad = 16;
        const pipX = w - pipW - pad;
        const pipY = pad;

        const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
        pipCamera.position.set(
          controls.target.x - offset.x * 0.95,
          Math.max(0.45, controls.target.y + 0.35),
          controls.target.z - offset.z * 0.95,
        );
        pipCamera.aspect = pipW / pipH;
        pipCamera.updateProjectionMatrix();
        pipCamera.lookAt(controls.target);

        renderer.setViewport(pipX, pipY, pipW, pipH);
        renderer.setScissor(pipX, pipY, pipW, pipH);
        renderer.setClearColor('#162033', 1);
        renderer.clear();
        renderer.render(scene, pipCamera);
      }
    };

    animate();

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      geometry.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
      coloredTex.dispose();
      whiteTex.dispose();
      frontMat.dispose();
      backMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [model, paperColor]);

  useEffect(() => {
    const obj = sceneObjRef.current;
    if (!obj) return;
    const preset = CAMERA_PRESETS[cameraPreset];
    obj.tween.startPos.copy(obj.camera.position);
    obj.tween.endPos.set(...preset.pos);
    obj.tween.startTarget.copy(obj.controls.target);
    obj.tween.endTarget.set(...preset.target);
    obj.tween.t = 0;
    obj.tween.active = true;
  }, [cameraPreset, cameraTrigger]);

  return (
    <div ref={containerRef} className="origami-viewport">
      {showPip && (
        <div className="pip-overlay">
          <span className="pip-badge">背面同步视角</span>
        </div>
      )}
    </div>
  );
};
