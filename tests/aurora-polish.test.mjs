import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule} from './helpers/load-typescript.mjs';
const {createAuroraBeaconAnchor,advanceAuroraBeaconAnchor,createAuroraStableBeacon,advanceAuroraBeaconPlacement}=loadModule('lib/aurora-ribbon-beacons.ts');
const {auroraRibbonIdentityProfile}=loadModule('lib/aurora-ribbon-identity.ts');
const {createAuroraRibbonLayout,auroraRibbonVisualParameters}=loadModule('lib/aurora-ribbon-layout.ts');
const {auroraEnergyProfiles}=loadModule('lib/aurora-energy.ts');
const {AURORA_PRESETS}=loadModule('lib/aurora-presets.ts');
const {personalizeAurora}=loadModule('lib/aurora-personalization.ts');
const {buildAuroraRibbonMeaningMap}=loadModule('lib/aurora-ribbon-meaning.ts');
const candidates=()=>[.2,.32,.68,.92,.08].map((u,i)=>({u,x:100+i*60,y:220,depth:.9+i*.001,valid:true,exposed:true}));
const distance=(a,b)=>Math.abs(((a-b+1.5)%1)-.5);
test('healthy physical anchor survives changing depth, order and nearby ribbon scores indefinitely',()=>{
 const s=createAuroraBeaconAnchor(),c=candidates();advanceAuroraBeaconAnchor(s,c,.016,false);const initial=s.u;
 for(let i=0;i<600;i++){c.forEach((v,k)=>v.depth=Math.sin(i*.1+k));advanceAuroraBeaconAnchor(s,i%2?c:[...c].reverse(),1/60,false);}
 assert.equal(s.u,initial);assert.equal(s.switches,0);
});
test('short edge excursions do not cause anchor chatter; persistent loss respects minimum hold',()=>{
 const s=createAuroraBeaconAnchor(),c=candidates();advanceAuroraBeaconAnchor(s,c,.1,false);c[0].exposed=false;
 for(let i=0;i<8;i++)advanceAuroraBeaconAnchor(s,c,.1,false);assert.equal(s.switches,0);
 c[0].exposed=true;advanceAuroraBeaconAnchor(s,c,.1,false);assert.equal(s.outside,0);
 c[0].exposed=false;for(let i=0;i<5;i++)advanceAuroraBeaconAnchor(s,c,.1,false);assert.equal(s.switches,1);assert.notEqual(s.targetU,.2);
});
test('occluded/invalid projection can fall back without teleporting the selected UV',()=>{
 const s=createAuroraBeaconAnchor(),c=candidates();advanceAuroraBeaconAnchor(s,c,.1,false);s.age=2;c[0].valid=false;
 const start=s.u;advanceAuroraBeaconAnchor(s,c,1/60,false);assert.equal(s.switches,1);assert.ok(distance(s.u,start)<.001);
 for(let i=0;i<60;i++)advanceAuroraBeaconAnchor(s,c,1/60,false);assert.ok(distance(s.u,s.targetU)<1e-9);
});
test('closed-loop anchor transition takes the short continuous arc across the seam',()=>{
 const s=createAuroraBeaconAnchor(),c=[{u:.92,depth:0,valid:true,exposed:true},{u:.08,depth:1,valid:true,exposed:true}];
 advanceAuroraBeaconAnchor(s,c,.1,false);s.age=2;c[0].exposed=false;s.outside=.3;
 let previous=s.u;for(let i=0;i<60;i++){advanceAuroraBeaconAnchor(s,c,1/60,false);assert.ok(distance(previous,s.u)<.02);previous=s.u;}
 assert.ok(distance(s.u,.08)<.00001);
});
test('hover/focus holds the same actual UV; reduced motion finishes an essential fallback immediately',()=>{
 const s=createAuroraBeaconAnchor(),c=candidates();advanceAuroraBeaconAnchor(s,c,.1,false);s.age=2;s.outside=.3;c[0].exposed=false;
 for(let i=0;i<30;i++)advanceAuroraBeaconAnchor(s,c,1/60,true);assert.equal(s.u,.2);
 advanceAuroraBeaconAnchor(s,c,0,false,true);assert.equal(s.u,s.targetU);assert.equal(s.transition,1);
});
test('missing candidates never produce NaN or invent an anchor',()=>{
 const s=createAuroraBeaconAnchor();assert.equal(advanceAuroraBeaconAnchor(s,[],NaN,false),false);assert.equal(s.initialized,false);
 const c=candidates();advanceAuroraBeaconAnchor(s,c,.1,false);const u=s.u;c.forEach(c=>c.valid=false);
 for(let i=0;i<60;i++)advanceAuroraBeaconAnchor(s,c,1/60,false);assert.equal(s.u,u);assert.ok(Number.isFinite(s.u));
});
test('offset damping is frame independent while fast camera projection has no lag',()=>{
 const outputs=[];for(const fps of [30,60,120]){const p=createAuroraStableBeacon();p.anchorX=200;p.anchorY=250;
  advanceAuroraBeaconPlacement(p,[],820,640,0);p.offsetX=20;
  for(let i=0;i<fps/2;i++)advanceAuroraBeaconPlacement(p,[],820,640,1/fps);outputs.push(p.x);
  const fresh=createAuroraStableBeacon();fresh.anchorX=200;fresh.anchorY=250;advanceAuroraBeaconPlacement(fresh,[],820,640,0);
  for(let i=0;i<fps;i++){fresh.anchorX+=300/fps;advanceAuroraBeaconPlacement(fresh,[],820,640,1/fps);assert.ok(Math.abs(fresh.x-fresh.anchorX)<.00001);}
 }assert.ok(Math.max(...outputs)-Math.min(...outputs)<1e-6);assert.ok(outputs[0]>210&&outputs[0]<220);
});
test('approaching beacons resolve collisions with small continuous offset steps, not 40px jumps',()=>{
 const a=createAuroraStableBeacon(),b=createAuroraStableBeacon();a.anchorX=350;a.anchorY=250;b.anchorX=440;b.anchorY=250;
 advanceAuroraBeaconPlacement(a,[],820,640,0);advanceAuroraBeaconPlacement(b,[a],820,640,0);
 for(let i=0;i<160;i++){const x=b.x,y=b.y;b.anchorX-=.35;advanceAuroraBeaconPlacement(b,[a],820,640,1/60);
  assert.ok(Math.hypot(b.x-x+.35,b.y-y)<8);assert.ok(Math.hypot(b.x-a.x,b.y-a.y)>=51.999);}
});
test('persistent collision offsets do not swap sides under subpixel anchor jitter',()=>{
 const markers=Array.from({length:6},createAuroraStableBeacon);let signs;
 for(let frame=0;frame<180;frame++){
  const prior=[];for(const p of markers){p.anchorX=400+Math.sin(frame*.1)*.5;p.anchorY=280+Math.cos(frame*.1)*.5;advanceAuroraBeaconPlacement(p,prior,820,640,1/60);prior.push(p);}
  const current=markers.slice(1).map(p=>Math.sign(p.offsetX));if(!signs)signs=current;else assert.deepEqual(current,signs);
  markers.forEach((a,i)=>markers.slice(0,i).forEach(b=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=51.99)));
 }
});
test('hover reservation remains clickable while other beacons avoid it',()=>{
 const held=createAuroraStableBeacon();held.anchorX=400;held.anchorY=260;advanceAuroraBeaconPlacement(held,[],820,640,0);const x=held.x;
 held.anchorX+=80;advanceAuroraBeaconPlacement(held,[],820,640,.1,true);assert.equal(held.x,x);
 const other=createAuroraStableBeacon();other.anchorX=x;other.anchorY=260;advanceAuroraBeaconPlacement(other,[held],820,640,.1);
 assert.ok(Math.hypot(other.x-held.x,other.y-held.y)>=52);
});
test('viewport/overview resynchronization clears a stale macro screen pose',()=>{
 const p=createAuroraStableBeacon();p.anchorX=200;p.anchorY=240;advanceAuroraBeaconPlacement(p,[],820,640,0);
 p.anchorX=320;p.anchorY=320;advanceAuroraBeaconPlacement(p,[],390,844,0,false,true);
 assert.equal(p.x,320);assert.equal(p.y,320);
});
for(const preset of AURORA_PRESETS)test(`${preset.id}: deterministic slot styling preserves the exact color pair, geometry and energy profiles`,()=>{
 const original=structuredClone(preset),plan=createAuroraRibbonLayout(preset,'balanced','hybrid');
 for(const ribbon of plan.ribbons){const layer=ribbon.layers[0],shape=structuredClone(layer.shape),visual=auroraRibbonVisualParameters(preset.palette,layer.shape);
  const p=auroraRibbonIdentityProfile(layer.shape,visual);assert.deepEqual(p,layer.identityProfile);assert.deepEqual(p,auroraRibbonIdentityProfile(layer.shape,visual));
  assert.deepEqual(p.colors.a,visual.colorA);assert.deepEqual(p.colors.b,visual.colorB);assert.equal(p.colors.baseMix,visual.baseMix);
  assert.deepEqual(p.energy.profiles,auroraEnergyProfiles(shape.energySeed));assert.equal(p.energy.seed,shape.energySeed);
  assert.equal(p.structure.width,shape.width);assert.equal(p.structure.height,shape.height);assert.equal(p.structure.curve,shape.curve);assert.deepEqual(layer.shape,shape);
  assert.equal(p.stylingOrigin,'deterministic-renderer-slot');assert.equal(p.colorOrigin,'unchanged-palette-endpoints');
 }assert.deepEqual(preset,original);
});
test('quiet structure and mist controls are bounded; styling never changes with device quality',()=>{
 for(const preset of AURORA_PRESETS){const low=createAuroraRibbonLayout(preset,'low');
  for(const quality of ['balanced','high'])createAuroraRibbonLayout(preset,quality).ribbons.forEach((r,i)=>assert.deepEqual(r.layers[0].identityProfile,low.ribbons[i].layers[0].identityProfile));
  low.ribbons.forEach(r=>{const s=r.layers[0].identityProfile.surface;assert.ok(s.coreFloor>=.8&&s.coreFloor<=1.05);assert.ok(s.veinWidth>=.018&&s.veinWidth<=.035);
   assert.ok(s.mistMacro<s.mistOverview&&s.mistMacro>=.45&&s.mistOverview<1);assert.ok(s.rim>=.18&&s.rim<.3);});
 }
});
test('dominant/repeated-color and neutral fallback profiles cannot introduce a semantic family or alter 5-A',()=>{
 const {createKeywordPools,createSelectedCapsule}=loadModule('lib/capsules.ts');
 const pools=createKeywordPools();
 for(const selected of [false,true]){
  const input={selections:Array.from({length:10},()=>[]),responses:Array.from({length:10},(_,i)=>({questionId:'q'+(i+1),status:'skipped'}))};
  if(selected){input.selections[0].push(createSelectedCapsule(pools[0][11],'q1','synthetic-drive'));input.responses[0].status='answered';}
  const p=personalizeAurora(input),before=structuredClone(p),map=buildAuroraRibbonMeaningMap(p);assert.equal(map.status,'ready');assert.ok(map.ribbons.length>=2);
  map.ribbons.forEach(r=>{const profile=r.layers[0].identityProfile;assert.ok(p.appearance.palette.some(c=>c.familyId===profile.colors.a.familyId));assert.ok(p.appearance.palette.some(c=>c.familyId===profile.colors.b.familyId));});
  assert.deepEqual(p,before);assert.deepEqual(map.globalMotionAnalyses,[]);
 }
});

test('releasing a hovered target eases its intentional leader offset without a camera-translation jump',()=>{
 const p=createAuroraStableBeacon();p.anchorX=200;p.anchorY=250;advanceAuroraBeaconPlacement(p,[],820,640,0);
 p.anchorX=260;advanceAuroraBeaconPlacement(p,[],820,640,.1,true);const x=p.x;
 advanceAuroraBeaconPlacement(p,[],820,640,1/60,false);assert.ok(p.x>x&&p.x-x<12);
});
