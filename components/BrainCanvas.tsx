"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";

/**
 * Interactive cortical activation viewer for the Confirmation screen.
 *
 * Replaces the static peak-frame PNG with a live three.js cortex driven
 * by the audio scrubber. Architecture:
 *
 *   1. Load fsaverage5 mesh from /brain/fsaverage5.bin (committed asset).
 *      Format defined in scripts/export-fsaverage5.py. One fetch on first
 *      Confirmation visit; HTTP-cached forever afterward.
 *
 *   2. Load activations tensor from a signed Vercel Blob URL (set by
 *      lib/brain.ts during /api/analyze). Format: row-major (T, V) float16,
 *      little-endian. Kept in memory as a Uint16Array; per-frame decode
 *      to a Float32Array buffer attribute on the geometry.
 *
 *   3. Subscribe to `currentTime` prop. On every change, binary-search
 *      `frameTimes` for the nearest frame, decode that frame's V values
 *      into the activation buffer, mark dirty. Three.js re-renders.
 *
 * Multi-take audio: currentTime is the GLOBAL time across the concatenated
 * recording (= sum of prior takes' durations + active take's currentTime).
 * The parent (MediaRow) computes this — BrainCanvas is timeline-agnostic.
 *
 * Fallback: while the mesh + activations are loading, or if WebGL isn't
 * available, we render the static peak PNG instead. No layout shift.
 */
type Props = {
  meshUrl: string;
  activationsUrl: string;
  frameTimes: number[];
  vertexCount: number;
  frameCount: number;
  peakFramePacked: number;
  /** Global audio time across concatenated takes, in seconds. */
  currentTime: number;
  /** Static PNG shown while loading / on WebGL failure / on data error. */
  fallbackImageUrl: string;
};

type MeshData = {
  lhVerts: Float32Array;
  rhVerts: Float32Array;
  lhSulc: Float32Array;
  rhSulc: Float32Array;
  lhFaces: Uint16Array;
  rhFaces: Uint16Array;
};

const MAGIC = 0x534f4d42; // "SOMB"
const VERSION = 1;

export default function BrainCanvas({
  meshUrl,
  activationsUrl,
  frameTimes,
  vertexCount,
  frameCount,
  peakFramePacked,
  currentTime,
  fallbackImageUrl,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const [stage, setStage] = useState<"loading" | "ready" | "error">("loading");

  // Load mesh + activations once, then build the three.js scene. Re-runs
  // only if any of the data identities change (Confirmation never swaps
  // these mid-mount in practice).
  useEffect(() => {
    let cancelled = false;
    setStage("loading");

    (async () => {
      try {
        const [mesh, activations] = await Promise.all([
          fetchMesh(meshUrl),
          fetchActivations(activationsUrl),
        ]);

        if (cancelled) return;

        // Sanity-check vertex count matches what the backend told us. If
        // not, we'd be indexing the wrong slice — bail to fallback.
        const totalVerts = mesh.lhVerts.length / 3 + mesh.rhVerts.length / 3;
        if (totalVerts !== vertexCount) {
          throw new Error(
            `mesh/activations vertex count mismatch: mesh=${totalVerts} vs activations=${vertexCount}`
          );
        }
        if (activations.length !== frameCount * vertexCount) {
          throw new Error(
            `activations length mismatch: got ${activations.length}, expected ${frameCount * vertexCount}`
          );
        }

        const canvas = canvasRef.current;
        if (!canvas) return;

        const refs = buildScene(canvas, mesh, activations, vertexCount, peakFramePacked);
        sceneRef.current = refs;
        setStage("ready");
      } catch (err) {
        console.warn("[BrainCanvas] init failed:", err);
        if (!cancelled) setStage("error");
      }
    })();

    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [meshUrl, activationsUrl, vertexCount, frameCount, peakFramePacked]);

  // Drive frame selection from currentTime. Cheap: binary search +
  // V-element decode + buffer dirty flag.
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs || stage !== "ready") return;
    const frameIdx = nearestFrame(frameTimes, currentTime);
    refs.setActiveFrame(frameIdx);
  }, [currentTime, frameTimes, stage]);

  return (
    <div className="brain-canvas-wrap" style={{ position: "relative" }}>
      {/* Always mount the canvas so the WebGL context is ready when data
          arrives. Hide it until ready to avoid a black flash. */}
      <canvas
        ref={canvasRef}
        className="brain-canvas"
        style={{
          width: "100%",
          height: "100%",
          display: stage === "ready" ? "block" : "none",
        }}
      />
      {stage !== "ready" && (
        <img
          className="brain-hero-image"
          src={fallbackImageUrl}
          alt="Cortical activation map"
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Mesh loading
   ───────────────────────────────────────────────────────────────────── */

async function fetchMesh(url: string): Promise<MeshData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mesh fetch ${res.status}`);
  const buf = await res.arrayBuffer();

  // Header (24 bytes, little-endian):
  //   u32 magic, u32 version, u32 lh_vert, u32 rh_vert,
  //   u32 lh_face, u32 rh_face
  const header = new Uint32Array(buf, 0, 6);
  if (header[0] !== MAGIC) throw new Error(`bad mesh magic 0x${header[0].toString(16)}`);
  if (header[1] !== VERSION) throw new Error(`unsupported mesh version ${header[1]}`);

  const lhVertCount = header[2];
  const rhVertCount = header[3];
  const lhFaceCount = header[4];
  const rhFaceCount = header[5];

  let offset = 24;
  const lhVerts = new Float32Array(buf.slice(offset, offset + lhVertCount * 3 * 4));
  offset += lhVertCount * 3 * 4;
  const lhSulc = new Float32Array(buf.slice(offset, offset + lhVertCount * 4));
  offset += lhVertCount * 4;
  const lhFaces = new Uint16Array(buf.slice(offset, offset + lhFaceCount * 3 * 2));
  offset += lhFaceCount * 3 * 2;

  const rhVerts = new Float32Array(buf.slice(offset, offset + rhVertCount * 3 * 4));
  offset += rhVertCount * 3 * 4;
  const rhSulc = new Float32Array(buf.slice(offset, offset + rhVertCount * 4));
  offset += rhVertCount * 4;
  const rhFaces = new Uint16Array(buf.slice(offset, offset + rhFaceCount * 3 * 2));

  return { lhVerts, rhVerts, lhSulc, rhSulc, lhFaces, rhFaces };
}

async function fetchActivations(url: string): Promise<Uint16Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`activations fetch ${res.status}`);
  const buf = await res.arrayBuffer();
  // Float16 raw bytes — keep as Uint16Array, decode per-frame to Float32.
  return new Uint16Array(buf);
}

/* ─────────────────────────────────────────────────────────────────────
   Scene construction
   ───────────────────────────────────────────────────────────────────── */

type SceneRefs = {
  setActiveFrame: (idx: number) => void;
  dispose: () => void;
};

function buildScene(
  canvas: HTMLCanvasElement,
  mesh: MeshData,
  activations: Uint16Array,
  vertexCount: number,
  peakFramePacked: number,
): SceneRefs {
  const width = canvas.clientWidth || 400;
  const height = canvas.clientHeight || 300;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  // Three-quarter view of both pial hemispheres — camera tilted 35° from
  // straight-down toward the front (anterior), giving the brain some
  // depth/3D feel while still showing both hemispheres clearly.
  //
  // In the recentered pial frame: +Y = anterior, +Z = superior. Camera
  // placed at (0, sin(35°)·d, cos(35°)·d) for d ≈ 350 — above-and-forward,
  // looking back at the brain.
  const camera = new THREE.PerspectiveCamera(35, width / height, 1, 1000);
  camera.position.set(0, 200, 287);
  camera.lookAt(0, 0, 0);

  // Combined geometry: LH and RH packed into one BufferGeometry so we only
  // do one draw call. RH face indices are offset by lh_vert_count.
  const geometry = buildBrainGeometry(mesh);

  // Activation attribute — per-vertex scalar, updated each frame.
  const activationBuffer = new Float32Array(vertexCount);
  // Seed with the peak frame so the first paint isn't grey.
  decodeFloat16Slice(activations, peakFramePacked * vertexCount, vertexCount, activationBuffer);
  geometry.setAttribute("activation", new THREE.BufferAttribute(activationBuffer, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      // Below this magnitude the cortex shows its plain sulc-shaded base;
      // hot overlay only kicks in for real signal. Pre-normalized to [-1, 1].
      uThreshold: { value: 0.18 },
      // Sulcal depth shading — bigger = more contrast between folds and
      // crests. Pial sulc values from FreeSurfer are typically [-3, +3].
      uSulcStrength: { value: 0.35 },
    },
    side: THREE.DoubleSide, // mesh from FreeSurfer isn't guaranteed-consistent winding
  });

  const brainMesh = new THREE.Mesh(geometry, material);
  scene.add(brainMesh);

  // User-driven rotation. TrackballControls gives truly free 3D rotation
  // — no fixed up-axis, so horizontal/vertical drag rotates the cortex
  // intuitively in all directions. Same convention as 3D modeling tools.
  // Zoom + pan disabled — the focal point is the cortex, not the framing.
  const controls = new TrackballControls(camera, canvas);
  controls.noZoom = true;
  controls.noPan = true;
  controls.rotateSpeed = 3.0;
  controls.staticMoving = false;
  controls.dynamicDampingFactor = 0.15;
  controls.target.set(0, 0, 0);

  // Gentle auto-wobble until the user interacts. After their first drag,
  // we leave the brain wherever they put it. Rotation around Z reads as
  // a subtle showcase spin from the three-quarter camera.
  let userHasInteracted = false;
  controls.addEventListener("start", () => {
    userHasInteracted = true;
  });

  let rafId = 0;
  let rotation = 0;
  const tick = () => {
    if (!userHasInteracted) {
      rotation += 0.001;
      brainMesh.rotation.z = Math.sin(rotation) * 0.15;
    }
    controls.update();
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  // Resize handling. TrackballControls captures the canvas's bounding
  // rect on construction to compute drag-to-rotation mapping — if the
  // canvas was display:none at that moment (which it is while the
  // activation data is still loading), the controls' internal screen
  // rect is 0×0 and pointer events map to NaN. Calling handleResize()
  // here recomputes the rect every time the canvas becomes visible or
  // changes size.
  const onResize = () => {
    const w = canvas.clientWidth || 400;
    const h = canvas.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    controls.handleResize();
  };
  const ro = new ResizeObserver(onResize);
  ro.observe(canvas);
  // Initial sync — fires after the canvas has been laid out the first time.
  controls.handleResize();

  const setActiveFrame = (idx: number) => {
    const start = idx * vertexCount;
    if (start < 0 || start + vertexCount > activations.length) return;
    decodeFloat16Slice(activations, start, vertexCount, activationBuffer);
    const attr = geometry.getAttribute("activation") as THREE.BufferAttribute;
    attr.needsUpdate = true;
  };

  const dispose = () => {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    controls.dispose();
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  };

  return { setActiveFrame, dispose };
}

function buildBrainGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  const lhVertCount = mesh.lhVerts.length / 3;
  const rhVertCount = mesh.rhVerts.length / 3;
  const totalVerts = lhVertCount + rhVertCount;

  // The pial fsaverage5 mesh is in shared MNI-like coordinates — LH
  // already sits at negative X, RH at positive X, anatomically correct.
  // We just concatenate them.
  const positions = new Float32Array(totalVerts * 3);
  positions.set(mesh.lhVerts, 0);
  positions.set(mesh.rhVerts, lhVertCount * 3);

  const sulc = new Float32Array(totalVerts);
  sulc.set(mesh.lhSulc, 0);
  sulc.set(mesh.rhSulc, lhVertCount);

  // Offset RH face indices so they reference RH verts in the combined buffer.
  const indices = new Uint32Array(mesh.lhFaces.length + mesh.rhFaces.length);
  indices.set(mesh.lhFaces, 0);
  const rhOffset = mesh.lhFaces.length;
  for (let i = 0; i < mesh.rhFaces.length; i++) {
    indices[rhOffset + i] = mesh.rhFaces[i] + lhVertCount;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("sulc", new THREE.BufferAttribute(sulc, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  // Recenter so the combined mesh sits at origin (pial coords have a Y
  // offset from the AC-PC origin). Camera then orbits a centered brain.
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) {
    const c = geometry.boundingSphere.center;
    geometry.translate(-c.x, -c.y, -c.z);
    geometry.computeBoundingSphere();
  }

  return geometry;
}

/* ─────────────────────────────────────────────────────────────────────
   Float16 decode (browsers don't ship Float16Array reliably yet)
   ───────────────────────────────────────────────────────────────────── */

/** Decode `count` half-floats starting at `src[srcOffset]` into `dst`. */
function decodeFloat16Slice(
  src: Uint16Array,
  srcOffset: number,
  count: number,
  dst: Float32Array,
): void {
  for (let i = 0; i < count; i++) {
    dst[i] = halfToFloat(src[srcOffset + i]);
  }
}

function halfToFloat(h: number): number {
  const sign = (h & 0x8000) >> 15;
  const exp = (h & 0x7c00) >> 10;
  const frac = h & 0x03ff;
  if (exp === 0) {
    // Subnormal or zero
    return (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
  }
  if (exp === 0x1f) {
    return frac ? NaN : (sign ? -Infinity : Infinity);
  }
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

/* ─────────────────────────────────────────────────────────────────────
   Frame lookup — binary search on the sorted frame_times array
   ───────────────────────────────────────────────────────────────────── */

function nearestFrame(times: number[], target: number): number {
  if (!times.length) return 0;
  if (target <= times[0]) return 0;
  if (target >= times[times.length - 1]) return times.length - 1;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < target) lo = mid + 1; else hi = mid;
  }
  // lo is the smallest index with times[lo] >= target; pick whichever of
  // (lo-1, lo) is closer in time.
  const before = lo > 0 ? Math.abs(times[lo - 1] - target) : Infinity;
  const here = Math.abs(times[lo] - target);
  return before < here ? lo - 1 : lo;
}

/* ─────────────────────────────────────────────────────────────────────
   Shaders — brand colormap, sulc-tinted base, cheap diffuse lighting
   ───────────────────────────────────────────────────────────────────── */

const VERTEX_SHADER = /* glsl */ `
  attribute float activation;
  attribute float sulc;
  varying float vActivation;
  varying float vSulc;
  varying vec3 vNormal;

  void main() {
    vActivation = activation;
    vSulc = sulc;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying float vActivation;
  varying float vSulc;
  varying vec3 vNormal;
  uniform float uThreshold;
  uniform float uSulcStrength;

  // matplotlib "hot" colormap — the Meta TRIBE v2 demo look. Piecewise
  // linear ramp on R, G, B channels: black → red → orange → yellow → white.
  vec3 hotColormap(float t) {
    float u = clamp(t, 0.0, 1.0);
    float r = clamp(u / 0.375, 0.0, 1.0);
    float g = clamp((u - 0.375) / 0.375, 0.0, 1.0);
    float b = clamp((u - 0.75) / 0.25, 0.0, 1.0);
    return vec3(r, g, b);
  }

  void main() {
    // Base pial cortex: warm off-white, darkened in fold depths (sulci)
    // so gyri/sulci structure reads through. Sulc values are positive in
    // sulci and negative on gyri crests; uSulcStrength controls contrast.
    vec3 baseLight = vec3(0.92, 0.90, 0.88);
    float sulcFactor = clamp(1.0 - vSulc * uSulcStrength, 0.45, 1.0);
    vec3 baseTint = baseLight * sulcFactor;

    // Activation overlay: hot colormap on |activation|, faded in around
    // the threshold so low signal doesn't mask the brain texture.
    float strength = abs(vActivation);
    vec3 activationTint = hotColormap(strength);
    float blend = smoothstep(uThreshold, uThreshold + 0.15, strength);
    vec3 color = mix(baseTint, activationTint, blend);

    // Soft directional shading — top-down lighting so gyri catch light
    // and sulci stay shadowed. No PBR; just enough depth cue.
    vec3 lightDir = normalize(vec3(0.2, 0.5, 1.0));
    float diff = max(dot(vNormal, lightDir), 0.0) * 0.35 + 0.7;

    gl_FragColor = vec4(color * diff, 1.0);
  }
`;
