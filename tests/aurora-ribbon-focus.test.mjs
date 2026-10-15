import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createModuleLoader } from "./helpers/load-typescript.mjs";
const load = createModuleLoader({ three: THREE });
const { AuroraRibbonTapGesture, auroraFocusEase, auroraFocusDuration, auroraRibbonPickCode, decodeAuroraRibbonPick,
  auroraRibbonPickingShader, auroraRibbonFocusDistance, auroraRibbonFocusOpacity } = load("lib/aurora-ribbon-focus.ts");
const { AuroraRibbonFocusCamera } = load("lib/aurora-ribbon-focus-camera.ts");
const { AuroraRibbonInteraction, makeAuroraRibbonPickingMaterial, createAuroraRibbonSurfaceFrame } = load("lib/aurora-ribbon-picking.ts");
const { createAuroraRibbonLayout } = load("lib/aurora-ribbon-layout.ts");
const { AURORA_PRESETS } = load("lib/aurora-presets.ts");
const { auroraCameraFraming } = load("lib/aurora-camera.ts");
const { ribbonVertexShader, ribbonFragmentShader } = load("components/aurora/aurora-shaders.ts");
const id = "aurora-ribbon-v1:curtain:0", other = "aurora-ribbon-v1:loop:0";
const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
test("every active main/loop identity has a collision-free stable GPU code at every quality", () => {
  for (const quality of ["low", "balanced", "high"]) for (const flowMode of ["independent", "hybrid", "loop-emphasis"]) {
    const plan = createAuroraRibbonLayout(AURORA_PRESETS[3], quality, flowMode);
    const active = plan.ribbons.filter(r => r.active), codes = active.map(r => auroraRibbonPickCode(r.ribbonId));
    assert.equal(new Set(codes).size, active.length);
    active.forEach((r, i) => assert.equal(decodeAuroraRibbonPick([codes[i], 85, 170, 255]), r.ribbonId));
    assert.ok(active.every(r => r.layers.every(l => l.shape.energySeed === r.layers[0].shape.energySeed)));
  }
});
test("invalid/background pixels and nonexistent IDs never become a ribbon", () => {
  for (const pixel of [[0,0,0,0], [1,84,170,255], [7,85,170,255], [1,85,170,0], [8,13,35,255]]) assert.equal(decodeAuroraRibbonPick(pixel), null);
  for (const value of ["unknown", "aurora-ribbon-v1:loop:3", "aurora-ribbon-v1:curtain:4"]) assert.equal(auroraRibbonPickCode(value), 0);
});
test("GPU ID shader keeps the exact existing displacement/alpha/energy path and disables output color conversion", () => {
  const uniforms = { uOpacity: { value: .3 }, uVisibility: { value: 1 } };
  const material = makeAuroraRibbonPickingMaterial(uniforms, id, ribbonVertexShader, ribbonFragmentShader);
  assert.equal(material.vertexShader, ribbonVertexShader);
  assert.equal(material.uniforms.uOpacity, uniforms.uOpacity);
  uniforms.uOpacity.value = .15; assert.equal(material.uniforms.uOpacity.value, .15);
  assert.ok(material.fragmentShader.includes("alpha *= smoothstep(0.001, 0.007, alpha)"));
  assert.ok(material.fragmentShader.includes("ribbonEnergy(vUv.x)"));
  assert.ok(material.fragmentShader.includes("alpha < 0.003"));
  assert.equal(material.fragmentShader.includes("#include <colorspace_fragment>"), false);
  assert.equal(material.depthWrite, true); assert.equal(material.depthTest, true); assert.equal(material.transparent, false);
  assert.equal(material.side, THREE.DoubleSide);
  assert.throws(() => auroraRibbonPickingShader("changed shader"));
  material.dispose();
});
test("selection dims other layers without increasing selected emission or changing palette/energy", () => {
  assert.equal(auroraRibbonFocusOpacity(null, id), 1);
  assert.equal(auroraRibbonFocusOpacity(id, id), 1);
  assert.equal(auroraRibbonFocusOpacity(other, id), .38);
});
test("a short mouse or touch tap selects exactly once", () => {
  for (const pointer of [1, 17]) {
    const g = new AuroraRibbonTapGesture(); g.down(pointer, 100, 200, 0, true, 0);
    assert.equal(g.up(pointer, 104, 202, 180), true);
    assert.equal(g.up(pointer, 104, 202, 200), false);
  }
});
test("dragging away and back does not become a click", () => {
  const g = new AuroraRibbonTapGesture(); g.down(1, 0, 0, 0, true, 0); g.move(1, 20, 20); g.move(1, 0, 0);
  assert.equal(g.up(1, 0, 0, 200), false);
});
test("pinch/multiple pointers, cancel, wheel, long press, secondary and right button never select", () => {
  const g = new AuroraRibbonTapGesture();
  g.down(1, 0, 0, 0, true, 0); g.down(2, 0, 0, 0, false, 0);
  assert.equal(g.up(2, 0, 0, 100), false); assert.equal(g.up(1, 0, 0, 100), false);
  for (const cancel of [g => g.cancel(1), g => g.cancel(), g => g.reset()]) {
    g.down(1, 0, 0, 0, true, 0); cancel(g); assert.equal(g.up(1, 0, 0, 100), false);
  }
  for (const [primary, button, time] of [[true,0,900], [false,0,100], [true,2,100]]) {
    g.down(1,0,0,0,primary,button); assert.equal(g.up(1,0,0,time),false);
  }
  g.down(1,0,0,1000,true,0); assert.equal(g.up(1,0,0,1200),true);
});
test("focus easing has no discontinuity and honors the reduced-motion budget", () => {
  assert.equal(auroraFocusDuration(false), 1.35); assert.ok(auroraFocusDuration(true) <= .1);
  assert.equal(auroraFocusEase(0),0); assert.equal(auroraFocusEase(1),1);
  let previous = 0;
  for(let i=0;i<=100;i++){ const value=auroraFocusEase(i/100);assert.ok(value>=previous);previous=value; }
  assert.ok(auroraFocusEase(.01) < .00002); assert.ok(1-auroraFocusEase(.99) < .00002);
});
test("portrait focus distance contains every corner and stays outside the ribbon volume", () => {
  const min=[-5,-3,-2],max=[5,3,2],target=[.2,0,0],dir=[0,0,1];
  const wide=auroraRibbonFocusDistance(min,max,target,dir,1.8,43), narrow=auroraRibbonFocusDistance(min,max,target,dir,.5,53);
  assert.ok(narrow>wide);
  for(const [aspect,fov,d] of [[1.8,43,wide],[.5,53,narrow]]){
    const v=Math.tan(fov*Math.PI/360),h=v*aspect;
    for(const x of [-5,5])for(const y of [-3,3])for(const z of [-2,2]){
      assert.ok(Math.abs(x-target[0])/(d-z)<h);assert.ok(Math.abs(y)/(d-z)<v);
    }
    assert.ok(d>Math.hypot(5.2,3,2)+1);
  }
});
function focusFixture(mode="free") {
  const camera=new THREE.PerspectiveCamera(43,1.6,.1,400); camera.position.set(8,4,32);
  const target=new THREE.Vector3(0,.15,-2.4), original=camera.position.clone();
  const framing=auroraCameraFraming(1000,625,4), center=new THREE.Vector3(0,0,0);
  const interaction={ selectionOriginMode:null, segmentU: new Map(), surfaceFrame(_id,u,frame){
    frame.point.copy(center);frame.normal.set(0,0,1);frame.tangent.set(1,0,0);frame.across.set(0,1,0);frame.width=3;frame.speed=30;frame.u=u;return true;
  } };
  const focus=new AuroraRibbonFocusCamera();
  const step=(selected,dt=1/60,reduced=false)=>focus.update(camera,target,interaction,selected,mode,framing,dt,reduced);
  return {camera,target,original,framing,center,interaction,focus,step};
}
test("camera approaches in 1.35 seconds while interpolating position and target together", () => {
  const f=focusFixture(); f.step(id,0); assert.deepEqual(f.camera.position.toArray(),f.original.toArray());
  for(let i=0;i<40;i++)f.step(id);
  assert.equal(f.focus.phase,"focusing");assert.ok(f.camera.position.distanceTo(f.original)>1);
  for(let i=0;i<45;i++)f.step(id);
  assert.equal(f.focus.phase,"focused");assert.ok(f.camera.position.z<25);
});
for (const mode of ["front","free","auto"]) test(`return restores original ${mode} position and mode after another ribbon selection`, () => {
  const f=focusFixture(mode), originalTarget=f.target.clone();
  for(let i=0;i<90;i++)f.step(id);
  const current=f.camera.position.clone();f.step(other,0);assert.deepEqual(f.camera.position.toArray(),current.toArray());
  for(let i=0;i<30;i++)f.step(other);
  f.step(null,0);assert.equal(f.focus.phase,"returning");
  for(let i=0;i<81;i++)f.step(null);
  assert.equal(f.focus.phase,"overview");assert.equal(f.focus.engaged,false);
  close(f.camera.position.distanceTo(f.original),0);close(f.target.distanceTo(originalTarget),0);
  assert.equal(f.focus.restoredMode,mode);
});
test("reselection during the return reuses the original overview rather than saving an intermediate pose", () => {
  const f=focusFixture();for(let i=0;i<30;i++)f.step(id);for(let i=0;i<10;i++)f.step(null);
  const current=f.camera.position.clone();f.step(other,0);assert.deepEqual(f.camera.position.toArray(),current.toArray());
  for(let i=0;i<90;i++)f.step(other);for(let i=0;i<81;i++)f.step(null);
  close(f.camera.position.distanceTo(f.original),0);
});
test("focus follows a moving surface patch gently, and resizing preserves selection", () => {
  const f=focusFixture();for(let i=0;i<90;i++)f.step(id);
  const before=f.camera.position.clone();f.center.x+=1;f.step(id);
  assert.ok(f.camera.position.distanceTo(before)<.1);
  f.camera.aspect=.5;for(let i=0;i<90;i++)f.step(id);
  assert.equal(f.focus.phase,"focused");assert.ok(Number.isFinite(f.camera.position.length()));
});
test("reduced motion finishes promptly and returning from auto resolves to front", () => {
  const f=focusFixture("auto");f.step(id,.1,true);assert.equal(f.focus.phase,"focused");
  f.step(null,.1,true);assert.equal(f.focus.phase,"overview");assert.equal(f.focus.restoredMode,"front");
});
test("direct click retains pre-gesture auto mode even after OrbitControls interrupts auto", () => {
  const f=focusFixture("free");f.interaction.selectionOriginMode="auto";
  for(let i=0;i<90;i++)f.step(id);for(let i=0;i<81;i++)f.step(null);
  assert.equal(f.focus.restoredMode,"auto");
});
test("reduced-motion auto return lands at the front framing without a second long camera return", () => {
  const f=focusFixture("auto");f.step(id,.1,true);f.step(null,.1,true);
  close(f.camera.position.x,0);close(f.camera.position.y,f.target.y+.25);
  close(f.camera.position.distanceTo(f.target),f.framing.frontDistance);
  assert.equal(f.focus.phase,"overview");
});
test("missing target registration cannot create a camera jump", () => {
  const f=focusFixture();f.interaction.surfaceFrame=()=>false;
  assert.equal(f.step(id),false);assert.deepEqual(f.camera.position.toArray(),f.original.toArray());
});
test("registration replacement cleanup cannot remove a newer mesh for the same ID", () => {
  const registry=new AuroraRibbonInteraction(), a={}, b={};
  const remove=registry.register(id,a);registry.register(id,b);remove();assert.equal(registry.entries.get(id),b);
  registry.dispose();assert.equal(registry.entries.size,0);
});
test("live world bounds include the parent transform and deformation clearance", () => {
  const registry=new AuroraRibbonInteraction(), mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,4,8,2));
  const parent=new THREE.Group();parent.position.set(3,2,-5);parent.rotation.y=.4;parent.add(mesh);mesh.position.z=2;
  const visual={uniforms:{uAmplitude:{value:.7},uIntensity:{value:1},uWaveTime:{value:2},uFieldPhase:{value:3},uPhase:{value:.5}}};
  registry.register(id,{mesh,active:true,visual});
  const box=new THREE.Box3(),anchor=new THREE.Vector3();assert.equal(registry.worldBounds(id,box,anchor),true);
  assert.ok(box.containsPoint(anchor));assert.ok(box.max.x>3);assert.ok(box.min.z<0);
  parent.position.x+=5;const next=new THREE.Box3();registry.worldBounds(id,next,anchor);close(next.min.x-box.min.x,5);
  mesh.visible=false;assert.equal(registry.worldBounds(id,next,anchor),false);
  registry.dispose();mesh.geometry.dispose();mesh.material.dispose();
});
function fakeRenderer(fail=false) {
  const state={target:null,viewport:new THREE.Vector4(0,0,800,500),scissor:new THREE.Vector4(0,0,800,500),test:true,color:new THREE.Color("#123456"),alpha:1,rendered:null};
  const r={state,autoClear:false,domElement:{getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:500,width:800,height:500})},
    getDrawingBufferSize:v=>v.set(800,500),getRenderTarget:()=>state.target,getClearAlpha:()=>state.alpha,getScissorTest:()=>state.test,
    getClearColor:v=>v.copy(state.color),getViewport:v=>v.copy(state.viewport),getScissor:v=>v.copy(state.scissor),
    setRenderTarget:v=>{state.target=v;},setViewport:(...args)=>{if(args.length===1)state.viewport.copy(args[0]);else state.viewport.set(...args);},
    setScissor:v=>{state.scissor.copy(v);},setScissorTest:v=>{state.test=v;},setClearColor:(v,a)=>{state.color.set(v);state.alpha=a;},clear(){},
    render(scene){state.rendered=scene;if(fail)throw new Error("simulated render failure");},
    readRenderTargetPixels(_t,_x,_y,_w,_h,pixel){pixel.set([1,85,170,255]);}};
  return r;
}
for(const fail of [false,true])test(`GPU picking ${fail?"failure":"success"} restores the same scene, material, camera and renderer`,()=>{
  const registry=new AuroraRibbonInteraction(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(43,1.6,.1,400);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShaderMaterial()), mist=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial());
  scene.add(mesh,mist);scene.background=new THREE.Color("#080d23");const background=scene.background,material=mesh.material;
  material.uniforms.uVisibility={value:1};const picking=new THREE.ShaderMaterial();
  registry.register(id,{mesh,active:true,visual:material,picking});
  const renderer=fakeRenderer(fail), color=renderer.state.color.clone(),projection=camera.projectionMatrix.clone();
  if(fail)assert.throws(()=>registry.pick(renderer,scene,camera,400,250));else assert.equal(registry.pick(renderer,scene,camera,400,250),id);
  assert.equal(renderer.state.rendered,scene);assert.equal(mesh.material,material);assert.equal(mesh.visible,true);assert.equal(mist.visible,true);
  assert.equal(scene.background,background);assert.equal(camera.view,null);assert.equal(camera.aspect,1.6);assert.deepEqual(camera.projectionMatrix.elements,projection.elements);
  assert.equal(renderer.autoClear,false);assert.equal(renderer.state.target,null);assert.equal(renderer.state.test,true);assert.ok(renderer.state.color.equals(color));
  registry.dispose();for(const m of [mesh,mist]){m.geometry.dispose();m.material.dispose();}picking.dispose();
});

const { placeAuroraBeacon } = load("lib/aurora-ribbon-beacons.ts");
const { createAuroraRibbonData } = load("lib/aurora-geometry.ts");
function realRibbonFixture(quality="low", kind="curtain") {
  const layer=createAuroraRibbonLayout(AURORA_PRESETS[3],quality,"hybrid").ribbons.find(r=>r.kind===kind).layers[0];
  const data=createAuroraRibbonData(layer.shape,layer.segments,layer.rows), geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(data.positions,3));geometry.setAttribute("uv",new THREE.BufferAttribute(data.uvs,2));
  const mesh=new THREE.Mesh(geometry), parent=new THREE.Group();parent.position.set(1,2,-3);parent.rotation.set(.2,.4,-.1);parent.add(mesh);
  const visual={uniforms:{uAmplitude:{value:.7},uIntensity:{value:1.1},uWaveTime:{value:2.3},uFieldPhase:{value:3.2},uPhase:{value:layer.shape.phase}}};
  const registry=new AuroraRibbonInteraction();registry.register(id,{mesh,active:true,visual});
  return {registry,mesh,parent,visual,layer};
}
test("surface anchors match rendered GPU-folded triangle vertices at all quality levels and ribbon types",()=>{
  for(const quality of ["low","balanced","high"])for(const kind of ["curtain","loop"]){
    const f=realRibbonFixture(quality,kind), uv=f.mesh.geometry.getAttribute("uv"),pos=f.mesh.geometry.getAttribute("position");
    const index=Math.floor(f.layer.rows/2)*(f.layer.segments+1)+Math.floor(f.layer.segments*.32),u=uv.getX(index),v=uv.getY(index);
    const angle=u*Math.PI*2, gain=.7*1.4*1.1*.19*.75, scale=1+gain*.06*Math.sin(angle*2-2.3+f.layer.shape.phase);
    f.mesh.updateWorldMatrix(true,false);
    const expected=new THREE.Vector3(pos.getX(index)*scale+gain*.10*Math.sin(angle-3.2*.32),pos.getY(index)*scale+gain*.12*Math.cos(angle*2+2.3),
      pos.getZ(index)+gain*.18*Math.cos(angle*3+2.3+f.layer.shape.phase)).applyMatrix4(f.mesh.matrixWorld);
    const actual=new THREE.Vector3();assert.equal(f.registry.surfacePoint(id,u,v,actual),true);assert.ok(actual.distanceTo(expected)<.00001);
    const frame=createAuroraRibbonSurfaceFrame();assert.equal(f.registry.surfaceFrame(id,.32,frame),true);
    close(frame.normal.length(),1);assert.ok(frame.width>.1);assert.ok(Math.abs(frame.normal.dot(frame.tangent))<.00001);
    f.registry.dispose();f.mesh.geometry.dispose();f.mesh.material.dispose();
  }
});
test("surface anchors follow current GPU uniforms and parents without regenerating the live geometry",()=>{
  const f=realRibbonFixture(),frame=createAuroraRibbonSurfaceFrame(),original=f.mesh.geometry;
  f.registry.surfaceFrame(id,.32,frame);const before=frame.point.clone();f.parent.position.x+=4;
  f.registry.surfaceFrame(id,.32,frame);close(frame.point.x-before.x,4);f.visual.uniforms.uWaveTime.value+=2;
  f.registry.surfaceFrame(id,.32,frame);assert.ok(Math.abs(frame.point.x-before.x-4)>.00001);assert.equal(f.mesh.geometry,original);
  assert.equal(f.registry.surfaceFrame(other,.3,frame),false);assert.equal(f.registry.surfacePoint(id,NaN,.5,frame.point),false);
  f.mesh.visible=false;assert.equal(f.registry.surfaceFrame(id,.3,frame),false);
  f.registry.dispose();original.dispose();f.mesh.material.dispose();
});
test("longitudinal samples wrap through the real closed seam, including the half-twist center",()=>{
  for(const kind of ["curtain","loop"]){const f=realRibbonFixture("high",kind),a=new THREE.Vector3(),b=new THREE.Vector3();
    f.registry.surfacePoint(id,0,.5,a);f.registry.surfacePoint(id,1,.5,b);close(a.distanceTo(b),0);
    f.registry.surfacePoint(id,-.1,.5,a);f.registry.surfacePoint(id,.9,.5,b);close(a.distanceTo(b),0);
    f.registry.dispose();f.mesh.geometry.dispose();f.mesh.material.dispose();
  }
});
test("six coincident/offscreen beacon anchors retain distinct 48px touch targets and honest leader anchors",()=>{
  for(const [width,height]of[[390,844],[820,640],[1440,900]])for(const point of [[width/2,height/2],[-200,-200],[width+500,height+500]]){
    const markers=[];for(let i=0;i<6;i++){const item={anchorX:point[0],anchorY:point[1],x:0,y:0};placeAuroraBeacon(item,markers,width,height);markers.push(item);}
    markers.forEach((a,i)=>{assert.equal(a.anchorX,point[0]);assert.ok(a.x>=24&&a.x<=width-24);assert.ok(a.y>=24&&a.y<=height-24);
      markers.slice(0,i).forEach(b=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=50));});
  }
});
test("macro camera frames a small real section, offsets it into desktop art space, and restores camera up",()=>{
  const f=focusFixture(),up=f.camera.up.clone();for(let i=0;i<90;i++)f.step(id);
  assert.ok(f.camera.position.distanceTo(f.center)<9,"must not fit the whole ten-unit ribbon");
  f.camera.updateMatrixWorld();const ndc=f.center.clone().project(f.camera);close(ndc.x,-.38,.02);close(ndc.y,0,.02);
  for(let i=0;i<81;i++)f.step(null);close(f.camera.up.distanceTo(up),0);
});
test("mobile macro frames the real patch above the analysis rather than the full object",()=>{
  const f=focusFixture();f.camera.aspect=390/844;f.camera.updateProjectionMatrix();for(let i=0;i<90;i++)f.step(id);
  f.camera.updateMatrixWorld();const ndc=f.center.clone().project(f.camera);close(ndc.y,.4,.02);close(ndc.x,0,.02);
  assert.ok(f.camera.position.distanceTo(f.center)<9);
});
test("beacon-chosen segment and same-ribbon reselection restart continuously without losing overview",()=>{
  const f=focusFixture();f.interaction.segmentU.set(id,.68);for(let i=0;i<90;i++)f.step(id);
  const position=f.camera.position.clone();f.interaction.segmentU.set(id,.32);f.step(id,0);close(f.camera.position.distanceTo(position),0);
  assert.equal(f.focus.phase,"focusing");for(let i=0;i<90;i++)f.step(id);for(let i=0;i<81;i++)f.step(null);
  close(f.camera.position.distanceTo(f.original),0);
});
test("macro UV isolation preserves original glass and energy work and is disabled exactly in overview",()=>{
  assert.ok(ribbonFragmentShader.includes("fract(vUv.x - uMacroCenter + 0.5)"));
  assert.ok(ribbonFragmentShader.includes("alpha *= mix(1.0, segmentMask * mix(1.35, 1.0, uMist * uPolish), uMacroAmount)"));
  assert.ok(ribbonFragmentShader.includes("ribbonEnergy(vUv.x)"));assert.ok(ribbonFragmentShader.includes("vViewNormal"));
  const picking=auroraRibbonPickingShader(ribbonFragmentShader);assert.ok(picking.includes("uMacroAmount"));
});
