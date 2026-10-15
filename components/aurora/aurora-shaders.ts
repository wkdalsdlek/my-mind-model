import { auroraEnergyShader } from "../../lib/aurora-energy";

// Independent traveling folds ride one shared spectral phase. A slowly twisting
// cross section adds curvature to the mesh's tilted orbit, rather than only wobble.
export const ribbonVertexShader = `
attribute vec3 aTangentU;
attribute vec3 aTangentV;
uniform float uWaveTime, uAmplitude, uPhase, uFrequency, uFieldPhase, uIntensity, uClosed, uSurfaceWeight;
varying vec2 vUv;
varying vec3 vViewNormal, vViewPosition;
vec3 fold(vec3 base, vec2 st) {
  float t = uWaveTime;
  float field = uFieldPhase * 0.32;
  float spectral = st.x * 4.8 - field + uPhase * 0.18;
  float envelope = 0.4 + 0.6 * sin(st.y * 3.14159265);
  float gain = uAmplitude * 1.4 * uIntensity * uSurfaceWeight * 0.75;
  if (uClosed > 0.5) {
    // Periodic deformation ignores signed width so the half-twist seam stays joined.
    float angle = st.x * 6.283185307;
    vec3 loop = base;
    loop.xy *= 1.0 + gain * 0.06 * sin(angle * 2.0 - t + uPhase);
    loop.x += gain * 0.10 * sin(angle - field);
    loop.y += gain * 0.12 * cos(angle * 2.0 + t);
    loop.z += gain * 0.18 * cos(angle * 3.0 + t + uPhase);
    return loop;
  }
  vec3 p = base + gain * vec3(
    0.22 * sin(spectral + st.y * 2.1) + 0.10 * sin(st.y * 4.0 + t * 0.5 + uPhase),
    envelope * (sin(st.x * uFrequency + t + uPhase) * 0.45 + cos(st.x * uFrequency * 1.71 - t * 0.63 + uPhase) * 0.19)
      + 0.20 * sin(spectral),
    sin(st.x * uFrequency * 0.73 - t * 0.45 + uPhase + st.y * 1.6) * 0.55
      + cos(st.y * 4.4 + st.x * 5.0 + t * 0.31) * 0.18 + 0.28 * cos(spectral)
  );
  float twist = gain * 0.18 * sin(st.x * 3.2 - field + uPhase * 0.4);
  p.yz = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * p.yz;
  return p;
}
void main() {
  vUv = uv;
  float e = 0.001;
  vec3 p = fold(position, uv);
  vec3 du = fold(position + aTangentU * e, uv + vec2(e, 0.0)) - p;
  vec3 dv = fold(position + aTangentV * e, uv + vec2(0.0, e)) - p;
  vViewNormal = normalize(normalMatrix * normalize(cross(du, dv)));
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  vViewPosition = -view.xyz;
  gl_Position = projectionMatrix * view;
}`;
// Domain-warped value noise breaks regular bands. A thin, wandering colored core
// and palette-based iridescence preserve translucent layers without a white fill.
export const ribbonFragmentShader = `
uniform vec3 uColorA, uColorB;
uniform float uTime, uPhase, uOpacity, uFlow, uMix, uClosed, uLoop, uMist, uVisibility;
uniform float uMacroCenter, uMacroSpan, uMacroAmount;
uniform float uPolish;
uniform vec4 uGlassProfile;
uniform vec2 uColorProfile, uMistProfile;
varying vec2 vUv;
varying vec3 vViewNormal, vViewPosition;
${auroraEnergyShader}
float ribbonHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float ribbonNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ribbonHash(i), ribbonHash(i + vec2(1.0, 0.0)), f.x),
    mix(ribbonHash(i + vec2(0.0, 1.0)), ribbonHash(i + vec2(1.0)), f.x), f.y);
}
float ribbonFbm(vec2 p) {
  float sum = 0.0, weight = 0.57;
  for (int i = 0; i < 3; i++) {
    sum += weight * ribbonNoise(p);
    p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.07 + vec2(4.1, 1.7);
    weight *= 0.46;
  }
  return sum;
}
void main() {
  float across = sin(vUv.y * 3.14159265);
  // Both faces share the same response. Grazing views diffuse rather than whiten.
  float facing = abs(dot(normalize(vViewNormal), normalize(vViewPosition)));
  float faceWeight = smoothstep(0.06, 0.8, facing);
  vec2 footprint = fwidth(vUv) * 1.5;
  float endWidth = max(0.075 + (1.0 - faceWeight) * 0.06, footprint.x);
  float edgeWidth = max(0.18 + (1.0 - faceWeight) * 0.13 + uMist * 0.08, footprint.y);
  float ends = smoothstep(0.0, endWidth, vUv.x) * (1.0 - smoothstep(1.0 - endWidth, 1.0, vUv.x));
  float edges = smoothstep(0.0, edgeWidth, vUv.y) * (1.0 - smoothstep(0.96 - edgeWidth, 1.0, vUv.y));
  float loopEdges = smoothstep(0.0, edgeWidth, vUv.y) * (1.0 - smoothstep(1.0 - edgeWidth, 1.0, vUv.y));
  ends = mix(ends, 1.0, uClosed);
  edges = mix(edges, loopEdges, uClosed);
  float angle = vUv.x * 6.283185307;
  float ribbonU = mix(vUv.x, 0.5 + 0.5 * sin(angle), uClosed);
  float ribbonV = mix(vUv.y, 0.5 + abs(vUv.y - 0.5), uLoop);
  float fresnel = pow(clamp(1.0 - facing, 0.0, 1.0), 2.6);
  vec2 drift = vec2(-uTime * uFlow * 0.045, uTime * uFlow * 0.017);
  vec2 p = vUv * vec2(6.8, 2.6) + vec2(uPhase * 2.3, uPhase * 0.7) + drift;
  // Circular noise coordinates and unsigned width match (u=0,v) to (u=1,1-v).
  vec2 loopP = vec2(cos(angle - uTime * uFlow * 0.06), sin(angle - uTime * uFlow * 0.06)) * vec2(3.8, 2.6)
    + mix(vUv.y, abs(vUv.y - 0.5), uLoop) * vec2(3.0, 2.0) + vec2(uPhase * 2.3, uPhase * 0.7);
  p = mix(p, loopP, uClosed);
  vec2 warp = vec2(ribbonNoise(p + 1.7), ribbonNoise(p * 0.83 + 8.4)) - 0.5;
  float cloud = ribbonFbm(p + warp * 1.8);
  float blend = clamp(uMix + (ribbonV - 0.5) * 0.62 + (cloud - 0.5) * 0.6 + warp.y * 0.16, 0.0, 1.0);
  // Preserve both real endpoints. Reduced cloud mixing reveals their spatial
  // separation; the narrow core uses the higher-weight endpoint of THIS pair.
  float clearBlend = clamp(uMix + (ribbonV - 0.5) * uGlassProfile.w + (cloud - 0.5) * 0.22 + warp.y * 0.1, 0.0, 1.0);
  vec3 color = mix(uColorA, uColorB, mix(blend, clearBlend, uPolish));
  vec3 glassTint = color;
  vec3 iridescence = mix(uColorB, uColorA, 0.5 + 0.5 * sin(fresnel * 4.5 + cloud * 3.0 + uPhase));
  float loopPresence = mix(1.0, 0.16 + 0.84 * smoothstep(0.28, 0.68, cloud), uLoop);
  vec3 energy = ribbonEnergy(vUv.x);
  float density;
  if (uMist > 0.5) {
    // Uniform branch skips the costly filament/core work on all diffuse veils.
    float distanceFromCore = (vUv.y - 0.5) * 2.0;
    density = exp(-distanceFromCore * distanceFromCore * 2.2) * (0.18 + cloud * 0.55);
    density *= 0.85 + (1.0 - faceWeight) * 0.15;
    color = color * (0.28 + cloud * 0.4) + iridescence * fresnel * 0.07;
    color *= 0.65 + energy.x * 0.45 + energy.y * 0.5;
    density *= 0.6 + energy.z * 0.2 + energy.x * 0.25;
    loopPresence = mix(loopPresence, 0.65, 0.45);
    density *= mix(1.0, mix(uMistProfile.x, uMistProfile.y, uMacroAmount), uPolish);
  } else {
    float center = 0.5 + (cloud - 0.5) * 0.11 + 0.035 * sin(ribbonU * 4.7 + uPhase - uTime * uFlow * 0.07);
    float coreDistance = (ribbonV - center) / (0.065 + cloud * 0.05);
    float core = exp(-coreDistance * coreDistance);
    if (uPolish > 0.5) {
      // A quiet, continuous vein and soft glass edges survive inactive streams.
      // They use the SAME periodic UVs, geometry, palette and actual energy field.
      float veinCenter = mix(center, 0.5 + abs(center - 0.5) * 0.5, uLoop);
      float fineCore = exp(-pow((ribbonV - veinCenter) / uGlassProfile.x, 2.0));
      float rimLine = exp(-pow((abs(vUv.y - 0.5) - 0.32) / 0.035, 2.0));
      vec3 coreTint = mix(uColorA, uColorB, uColorProfile.x);
      vec3 edgeTint = mix(uColorA, uColorB, 1.0 - uColorProfile.x);
      color = glassTint * (0.27 + cloud * 0.09 + core * (0.32 + 1.85 * energy.x + energy.y))
        + coreTint * fineCore * (uGlassProfile.y + energy.x * 0.65)
        + edgeTint * rimLine * uGlassProfile.z + iridescence * fresnel * 0.06;
      density = (0.18 + cloud * 0.14 + core * 0.14 + fineCore * 0.42 + rimLine * 0.15)
        * mix(0.68, 1.0, faceWeight) * (0.84 + energy.x * 0.3 + energy.y * 0.16);
      loopPresence = mix(loopPresence, max(loopPresence, 0.7), max(fineCore, rimLine * 0.6));
    } else {
    float grain = ribbonFbm(p * vec2(3.7, 0.68) + warp * 2.5);
    float filamentPhase = ribbonU * (58.0 + uPhase * 3.0) + warp.x * 9.0 + cloud * 11.0
      + ribbonV * (3.0 + warp.y * 5.0) - uTime * uFlow * 0.24;
    float filaments = smoothstep(0.48, 0.88, grain) * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(filamentPhase), 3.0));
    // Keep curtain colors; a softer colored loop core supports them without a hard rim.
    color *= 0.34 + cloud * 0.13 + core * (0.26 + mix(2.05, 1.25, uLoop) * energy.x + energy.y * 1.3) * mix(0.52, 1.0, faceWeight)
      + filaments * (0.04 + energy.x * 0.24);
    color += iridescence * fresnel * across * mix(0.14, 0.1, uLoop) * (0.5 + energy.x * 0.5);
    color *= mix(1.0, 0.84, uLoop);
    // Dissolve grazing slabs with existing noise instead of exposing a solid fold.
    float bodyPresence = mix(0.28 + 0.72 * smoothstep(0.22, 0.7, cloud), 1.0, faceWeight);
    density = (0.52 + cloud * 0.24 + filaments * 0.08 + fresnel * 0.06) * mix(0.3, 1.0, faceWeight) * bodyPresence;
    density *= 0.58 + energy.z * 0.12 + energy.x * 0.34 + energy.y * 0.25;
    }
  }
  // Periodic UV window isolates the actual selected patch on ALL existing veils.
  // A zero amount is exactly the unchanged /aurora-lab and overview shader.
  float patchDistance = abs(fract(vUv.x - uMacroCenter + 0.5) - 0.5);
  float segmentMask = 1.0 - smoothstep(uMacroSpan * 0.58, uMacroSpan, patchDistance);
  float alpha = ends * edges * uOpacity * uVisibility * density * loopPresence;
  // Diffuse veils do not receive the body's macro contrast amplification.
  alpha *= mix(1.0, segmentMask * mix(1.35, 1.0, uMist * uPolish), uMacroAmount);
  // Macro viewing reveals the same colored surface without adding white emission.
  color *= mix(1.0, mix(1.18, 1.0, uMist * uPolish), uMacroAmount);
  if (alpha < 0.001) discard;
  alpha *= smoothstep(0.001, 0.007, alpha);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const nebulaVertexShader = `
varying vec2 vUv;
uniform float uTime, uSeed;
void main() {
  vUv = uv;
  vec3 p = position;
  p.z += sin(uv.x * 5.0 + uSeed + uTime * 0.018) * 0.75;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
// Procedural low-frequency fBm billows replace image textures. Separate planes
// live at real depths and use small alpha so stars remain visible through the fog.
export const nebulaFragmentShader = `
uniform float uTime, uSeed, uOpacity;
uniform vec3 uColorA, uColorB;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float total = 0.0, strength = 0.5;
  for (int i = 0; i < 4; i++) { total += strength * noise(p); p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + 3.7; strength *= 0.5; }
  return total;
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(5.0, 3.0);
  vec2 drift = vec2(uTime * 0.009, -uTime * 0.006);
  float n = fbm(p + drift + uSeed);
  float warped = fbm(p + vec2(n * 2.3, n * 1.6) - drift + uSeed * 2.1);
  float mask = pow(max(0.0, 1.0 - length((vUv - 0.5) * vec2(1.55, 1.9))), 2.0);
  vec3 color = mix(uColorA, uColorB, warped) * (0.18 + warped * 0.5);
  gl_FragColor = vec4(color, mask * smoothstep(0.15, 0.85, warped) * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const particleVertexShader = `
attribute float aSize, aPhase;
uniform float uTime, uNear, uFlow, uPixelRatio;
uniform vec3 uSkyCenter;
varying float vAlpha, vPhase;
void main() {
  vec3 p = position;
  if (uNear < 0.5) {
    // Reuse deterministic seeds/counts as a full surrounding sky instead of one rear plane.
    float altitude = clamp(position.y / 32.5, -0.98, 0.98);
    float azimuth = position.x * 0.062831853;
    float ring = sqrt(1.0 - altitude * altitude), radius = -position.z;
    p = uSkyCenter + radius * vec3(ring * sin(azimuth), altitude, ring * cos(azimuth));
  }
  p.x += sin(uTime * 0.09 + aPhase + p.y * 0.12) * mix(0.09, 0.42, uNear);
  p.y += cos(uTime * 0.065 + aPhase) * mix(0.04, 0.24, uNear);
  p.y += uNear * sin(p.x * 0.5 + uTime * uFlow * 0.25 + aPhase) * 0.2;
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(aSize * uPixelRatio * 260.0 / max(1.0, -view.z), 1.0, 12.0);
  vAlpha = (0.56 + 0.25 * sin(uTime * 0.12 + aPhase)) * mix(0.68, 0.42, uNear);
  vPhase = aPhase;
}`;
export const particleFragmentShader = `
uniform vec3 uColorA, uColorB;
varying float vAlpha, vPhase;
void main() {
  float radius = length(gl_PointCoord - 0.5) * 2.0;
  if (radius > 1.0) discard;
  float soft = exp(-radius * radius * 5.0);
  vec3 color = mix(uColorA, uColorB, 0.5 + 0.5 * sin(vPhase));
  gl_FragColor = vec4(color * (0.8 + soft * 0.9), soft * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const glassVertexShader = `
attribute float aPhase;
uniform float uTime;
varying vec3 vViewNormal, vViewPosition, vTint;
void main() {
  vec4 p = instanceMatrix * vec4(position, 1.0);
  p.x += sin(uTime * 0.08 + aPhase) * 0.12;
  p.y += cos(uTime * 0.065 + aPhase) * 0.10;
  vec4 view = modelViewMatrix * p;
  vViewNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vViewPosition = -view.xyz;
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(0.7, 0.8, 0.9);
  #endif
  gl_Position = projectionMatrix * view;
}`;
export const glassFragmentShader = `
varying vec3 vViewNormal, vViewPosition, vTint;
void main() {
  vec3 n = normalize(vViewNormal), view = normalize(vViewPosition);
  float rim = pow(clamp(1.0 - abs(dot(n, view)), 0.0, 1.0), 3.0);
  float glint = pow(max(0.0, dot(reflect(-view, n), normalize(vec3(-0.3, 0.65, 0.7)))), 18.0);
  gl_FragColor = vec4(vTint * (0.35 + rim * 1.55) + vec3(0.7, 0.85, 1.0) * glint * 1.6, 0.04 + rim * 0.20 + glint * 0.17);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
