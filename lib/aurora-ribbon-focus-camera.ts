import { MathUtils, Vector3, type PerspectiveCamera } from "three";
import { resolveAuroraCameraMode, type AuroraCameraFraming } from "./aurora-camera";
import { auroraFocusDuration, auroraFocusEase, type AuroraRibbonFocusPhase } from "./aurora-ribbon-focus";
import { createAuroraRibbonSurfaceFrame, type AuroraRibbonInteraction } from "./aurora-ribbon-picking";
import type { AuroraRibbonId } from "./aurora-ribbon-layout";
import type { AuroraCameraMode } from "./aurora-types";

/** A real UV patch, not whole-object bounds. Sole camera owner; no scene clones.
 * New requests interpolate from the current pose, retaining the first overview. */
export class AuroraRibbonFocusCamera {
  phase: AuroraRibbonFocusPhase = "overview";
  restoredMode: AuroraCameraMode | null = null;
  engaged = false;
  private selected: AuroraRibbonId | null = null;
  private selectedU = .2;
  private elapsed = 0;
  private transitioning = false;
  private mode: AuroraCameraMode = "front";
  private overviewDistance = 1;
  private savedAspect = 1;
  private distance = 1;
  private normalSign = 1;
  private readonly savedPosition = new Vector3();
  private readonly savedTarget = new Vector3();
  private readonly savedUp = new Vector3();
  private readonly fromPosition = new Vector3();
  private readonly fromTarget = new Vector3();
  private readonly fromUp = new Vector3();
  private readonly direction = new Vector3();
  private readonly goalTarget = new Vector3();
  private readonly goalPosition = new Vector3();
  private readonly goalUp = new Vector3();
  private readonly normal = new Vector3();
  private readonly right = new Vector3();
  private readonly frame = createAuroraRibbonSurfaceFrame();
  update(camera: PerspectiveCamera, lookTarget: Vector3, interaction: AuroraRibbonInteraction, selection: AuroraRibbonId | null,
    mode: AuroraCameraMode, framing: AuroraCameraFraming, delta: number, reduced: boolean): boolean {
    this.restoredMode = null;
    const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, .1)) : 0;
    const u = selection ? interaction.segmentU.get(selection) ?? .2 : .2;
    if (selection && !interaction.surfaceFrame(selection, u, this.frame)) {
      if (!this.engaged) return false;
      selection = this.selected;
    }
    if (selection !== this.selected || (selection && u !== this.selectedU)) {
      if (!this.engaged && selection) {
        this.savedPosition.copy(camera.position); this.savedTarget.copy(lookTarget); this.savedUp.copy(camera.up);
        this.mode = interaction.selectionOriginMode ?? mode; interaction.selectionOriginMode = null;
        this.overviewDistance = framing.frontDistance; this.savedAspect = camera.aspect;
        this.direction.copy(camera.position).sub(lookTarget).normalize(); this.engaged = true;
      }
      this.selected = selection; this.selectedU = u;
      this.fromPosition.copy(camera.position); this.fromTarget.copy(lookTarget); this.fromUp.copy(camera.up);
      this.elapsed = 0; this.transitioning = true; this.phase = selection ? "focusing" : "returning";
      if (selection) {
        this.distance = this.macroDistance(camera);
        this.normalSign = this.frame.normal.dot(this.direction) < 0 ? -1 : 1;
      }
    }
    if (!this.engaged) return false;
    if (selection) {
      // View the existing patch from its local normal, with a slight oblique angle
      // to retain the glass/mist thickness. Never fly into the surface itself.
      this.normal.copy(this.frame.normal).multiplyScalar(this.normalSign);
      this.normal.addScaledVector(this.frame.tangent, .12).normalize();
      this.goalUp.copy(this.frame.across).addScaledVector(this.normal, -this.frame.across.dot(this.normal)).normalize();
      if (this.goalUp.y < 0) this.goalUp.negate();
      this.right.crossVectors(this.goalUp, this.normal).normalize();
      this.distance = MathUtils.damp(this.distance, this.macroDistance(camera), 3, dt);
      const halfHeight = Math.tan(camera.fov * Math.PI / 360) * this.distance;
      this.goalTarget.copy(this.frame.point);
      // Same full-screen camera: left 62% on desktop; upper 56% on mobile.
      if (camera.aspect >= 1.2) this.goalTarget.addScaledVector(this.right, halfHeight * camera.aspect * .38);
      else this.goalTarget.addScaledVector(this.goalUp, -halfHeight * .4);
      this.goalPosition.copy(this.normal).multiplyScalar(this.distance).add(this.goalTarget);
    } else {
      this.goalTarget.copy(this.savedTarget); this.goalPosition.copy(this.savedPosition); this.goalUp.copy(this.savedUp);
      if (reduced && this.mode === "auto") this.goalPosition.set(this.savedTarget.x, this.savedTarget.y + .25,
        this.savedTarget.z + Math.sqrt(framing.frontDistance * framing.frontDistance - .0625));
      else if (Math.abs(camera.aspect - this.savedAspect) > .001) this.goalPosition.sub(this.savedTarget)
        .multiplyScalar(Math.max(1, framing.frontDistance / this.overviewDistance)).add(this.savedTarget);
    }
    if (this.transitioning) {
      this.elapsed += dt;
      const fraction = Math.min(1, this.elapsed / auroraFocusDuration(reduced)), ease = auroraFocusEase(fraction);
      camera.position.lerpVectors(this.fromPosition, this.goalPosition, ease);
      lookTarget.lerpVectors(this.fromTarget, this.goalTarget, ease);
      camera.up.lerpVectors(this.fromUp, this.goalUp, ease).normalize();
      if (fraction === 1) {
        this.transitioning = false;
        if (selection) this.phase = "focused";
        else {
          this.phase = "overview"; this.engaged = false; interaction.selectionOriginMode = null;
          this.restoredMode = resolveAuroraCameraMode(this.mode, reduced);
        }
      }
    } else {
      const damping = 1 - Math.exp(-dt * 1.8);
      camera.position.lerp(this.goalPosition, damping); lookTarget.lerp(this.goalTarget, damping); camera.up.lerp(this.goalUp, damping).normalize();
    }
    camera.lookAt(lookTarget);
    return true;
  }
  private macroDistance(camera: PerspectiveCamera): number {
    // Frame a cross section, NOT the enclosing sphere of the whole ribbon.
    const usableHeight = camera.aspect >= 1.2 ? .78 : .5;
    return Math.max(.9, this.frame.width * .95 / (2 * Math.tan(camera.fov * Math.PI / 360) * usableHeight));
  }
}
