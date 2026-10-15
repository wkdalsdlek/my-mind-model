import { Box3, Color, Mesh, NoBlending, Object3D, PerspectiveCamera, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget,
  type Scene, type WebGLRenderer } from "three";
import { AURORA_MOTION_WEIGHTS, type AuroraCameraMode } from "./aurora-types";
import type { AuroraRibbonShape } from "./aurora-geometry";
import type { AuroraRibbonId } from "./aurora-ribbon-layout";
import { auroraRibbonPickingShader, auroraRibbonPickCode, decodeAuroraRibbonPick } from "./aurora-ribbon-focus";

export interface AuroraRibbonSurfaceFrame {
  point: Vector3; tangent: Vector3; across: Vector3; normal: Vector3; width: number; speed: number; u: number;
}
export function createAuroraRibbonSurfaceFrame(): AuroraRibbonSurfaceFrame {
  return { point: new Vector3(), tangent: new Vector3(), across: new Vector3(), normal: new Vector3(), width: 0, speed: 0, u: 0 };
}
export interface AuroraRibbonPickEntry { mesh: Mesh; shape: AuroraRibbonShape; active: boolean; picking: ShaderMaterial; visual: ShaderMaterial }
/** Reuses the live Scene, camera, geometry and uniform storage. No duplicate scene/proxy. */
export class AuroraRibbonInteraction {
  readonly entries = new Map<AuroraRibbonId, AuroraRibbonPickEntry>();
  readonly target = new WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false });
  private readonly pixel = new Uint8Array(4);
  private readonly bufferSize = new Vector2();
  private readonly viewport = new Vector4();
  private readonly scissor = new Vector4();
  private readonly clearColor = new Color();
  private readonly point = new Vector3();
  private readonly center = new Vector3();
  private readonly samples = Array.from({ length: 3 }, () => new Vector3());
  private readonly before = new Vector3();
  private readonly after = new Vector3();
  /** Beacon selection pins the exact longitudinal segment until the user selects again. */
  readonly segmentU = new Map<AuroraRibbonId, number>();
  selectionOriginMode: AuroraCameraMode | null = null;
  register(id: AuroraRibbonId, entry: AuroraRibbonPickEntry): () => void {
    this.entries.set(id, entry);
    return () => { if (this.entries.get(id) === entry) this.entries.delete(id); };
  }
  dispose(): void { this.entries.clear(); this.segmentU.clear(); this.target.dispose(); }
  pick(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, clientX: number, clientY: number): AuroraRibbonId | null {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height || clientX < rect.left || clientY < rect.top || clientX >= rect.right || clientY >= rect.bottom) return null;
    renderer.getDrawingBufferSize(this.bufferSize);
    const previousTarget = renderer.getRenderTarget(), background = scene.background, autoClear = renderer.autoClear;
    const clearAlpha = renderer.getClearAlpha(), scissorTest = renderer.getScissorTest();
    renderer.getClearColor(this.clearColor); renderer.getViewport(this.viewport); renderer.getScissor(this.scissor);
    const view = camera.view ? { ...camera.view } : null, aspect = camera.aspect;
    const hidden: { object: Object3D; visible: boolean }[] = [];
    const swapped: { entry: AuroraRibbonPickEntry; material: Mesh["material"] }[] = [];
    try {
      // All non-core objects (including broad mist/particles) must not occlude a hit.
      scene.traverse(object => {
        if ("material" in object) { hidden.push({ object, visible: object.visible }); object.visible = false; }
      });
      for (const entry of this.entries.values()) {
        const wasVisible = hidden.find(item => item.object === entry.mesh)?.visible;
        if (!entry.active || !wasVisible || entry.visual.uniforms.uVisibility.value < 0.05) continue;
        swapped.push({ entry, material: entry.mesh.material });
        entry.mesh.visible = true; entry.mesh.material = entry.picking;
      }
      camera.setViewOffset(this.bufferSize.x, this.bufferSize.y,
        Math.floor((clientX - rect.left) / rect.width * this.bufferSize.x), Math.floor((clientY - rect.top) / rect.height * this.bufferSize.y), 1, 1);
      scene.background = null; renderer.autoClear = true;
      renderer.setRenderTarget(this.target); renderer.setViewport(0, 0, 1, 1); renderer.setScissorTest(false);
      renderer.setClearColor(0, 0); renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(this.target, 0, 0, 1, 1, this.pixel);
      const id = decodeAuroraRibbonPick(this.pixel);
      return id && this.entries.get(id)?.active ? id : null;
    } finally {
      for (const item of swapped) item.entry.mesh.material = item.material;
      for (const item of hidden) item.object.visible = item.visible;
      camera.view = view; camera.aspect = aspect; camera.updateProjectionMatrix();
      scene.background = background; renderer.autoClear = autoClear;
      renderer.setRenderTarget(previousTarget); renderer.setViewport(this.viewport); renderer.setScissor(this.scissor); renderer.setScissorTest(scissorTest);
      renderer.setClearColor(this.clearColor, clearAlpha);
    }
  }
  /** Samples the SAME indexed triangles after the SAME closed GPU vertex fold,
   * including parent transforms. No analytic substitute or CPU mesh allocation. */
  surfacePoint(id: AuroraRibbonId, parameter: number, v: number, out: Vector3): boolean {
    const entry = this.entries.get(id);
    if (!entry?.active || !entry.mesh.visible || !Number.isFinite(parameter) || !Number.isFinite(v)) return false;
    const { geometry } = entry.mesh, uv = geometry.getAttribute("uv"), positions = geometry.getAttribute("position");
    let columns = 1;
    while (columns < uv.count && uv.getY(columns) === 0) columns++;
    const segments = columns - 1, rows = uv.count / columns - 1;
    if (segments < 1 || !Number.isInteger(rows) || rows < 1) return false;
    const u = ((parameter % 1) + 1) % 1, x = u * segments, y = Math.max(0, Math.min(0.999999, v)) * rows;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, base = iy * columns + ix;
    // Match createAuroraRibbonData's [a,b,c], [b,d,c] triangles exactly.
    const lower = fx + fy <= 1;
    const a = lower ? base : base + 1, b = lower ? base + 1 : base + columns + 1, c = base + columns;
    const ufs = entry.visual.uniforms, gain = ufs.uAmplitude.value * 1.4 * ufs.uIntensity.value * AURORA_MOTION_WEIGHTS.surface * .75;
    for (let k = 0; k < 3; k++) {
      const index = k === 0 ? a : k === 1 ? b : c, point = this.samples[k];
      const angle = uv.getX(index) * Math.PI * 2, wave = ufs.uWaveTime.value;
      const scale = 1 + gain * .06 * Math.sin(angle * 2 - wave + ufs.uPhase.value);
      point.set(positions.getX(index) * scale + gain * .10 * Math.sin(angle - ufs.uFieldPhase.value * .32),
        positions.getY(index) * scale + gain * .12 * Math.cos(angle * 2 + wave),
        positions.getZ(index) + gain * .18 * Math.cos(angle * 3 + wave + ufs.uPhase.value));
    }
    if (lower) out.copy(this.samples[0]).multiplyScalar(1 - fx - fy).addScaledVector(this.samples[1], fx).addScaledVector(this.samples[2], fy);
    else out.copy(this.samples[0]).multiplyScalar(1 - fy).addScaledVector(this.samples[1], fx + fy - 1).addScaledVector(this.samples[2], 1 - fx);
    entry.mesh.updateWorldMatrix(true, false); out.applyMatrix4(entry.mesh.matrixWorld);
    return true;
  }
  surfaceFrame(id: AuroraRibbonId, u: number, out: AuroraRibbonSurfaceFrame): boolean {
    if (!this.surfacePoint(id, u, .5, out.point)) return false;
    this.surfacePoint(id, u - .004, .5, this.before); this.surfacePoint(id, u + .004, .5, this.after);
    out.tangent.copy(this.after).sub(this.before); out.speed = out.tangent.length() / .008; out.tangent.normalize();
    this.surfacePoint(id, u, .35, this.before); this.surfacePoint(id, u, .65, this.after);
    out.across.copy(this.after).sub(this.before); out.width = out.across.length() / .3; out.across.normalize();
    out.normal.crossVectors(out.tangent, out.across).normalize(); out.u = u;
    return out.width > .01 && out.normal.lengthSq() > .5;
  }
  /** Conservative current world bounds. All current ribbon profiles are closed;
   * padding encloses the exact periodic GPU fold without CPU mesh regeneration. */
  worldBounds(id: AuroraRibbonId, target: Box3, anchor: Vector3): boolean {
    const entry = this.entries.get(id);
    if (!entry?.active || !entry.mesh.visible) return false;
    const { mesh, visual } = entry, geometry = mesh.geometry, u = visual.uniforms;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const base = geometry.boundingBox!;
    const gain = Math.abs(u.uAmplitude.value * 1.4 * u.uIntensity.value * AURORA_MOTION_WEIGHTS.surface * 0.75);
    const extent = Math.max(Math.abs(base.min.x), Math.abs(base.max.x), Math.abs(base.min.y), Math.abs(base.max.y));
    target.copy(base).expandByScalar(gain * (extent * 0.06 + 0.18) + 0.12);
    mesh.updateWorldMatrix(true, false); target.applyMatrix4(mesh.matrixWorld); target.getCenter(this.center);
    // A gentle curvature bias rather than moving directly into the thin surface.
    const attribute = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
    const columns = Math.round(Math.sqrt(attribute.count));
    const index = Math.min(attribute.count - 1, Math.floor(attribute.count / 2) + Math.floor(columns * 0.18));
    const angle = uv.getX(index) * Math.PI * 2, wave = u.uWaveTime.value, field = u.uFieldPhase.value * 0.32;
    const scale = 1 + gain * 0.06 * Math.sin(angle * 2 - wave + u.uPhase.value);
    this.point.set(attribute.getX(index) * scale + gain * 0.10 * Math.sin(angle - field),
      attribute.getY(index) * scale + gain * 0.12 * Math.cos(angle * 2 + wave),
      attribute.getZ(index) + gain * 0.18 * Math.cos(angle * 3 + wave + u.uPhase.value));
    this.point.applyMatrix4(mesh.matrixWorld);
    anchor.copy(this.center).lerp(this.point, 0.12);
    return true;
  }
}
export function makeAuroraRibbonPickingMaterial(visualUniforms: ShaderMaterial["uniforms"], id: AuroraRibbonId, vertexShader: string, fragmentShader: string): ShaderMaterial {
  const code = auroraRibbonPickCode(id);
  return new ShaderMaterial({ vertexShader, fragmentShader: auroraRibbonPickingShader(fragmentShader),
    uniforms: { ...visualUniforms, uPickId: { value: new Vector3(code / 255, 85 / 255, 170 / 255) } },
    side: 2, depthWrite: true, depthTest: true, transparent: false, blending: NoBlending, toneMapped: false });
}
