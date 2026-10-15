// Isolated TEST bundle of the real renderer, not an application route. No APIs.
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
export async function buildPolishPreview(esbuild, output, before = false) {
  mkdirSync(output, { recursive: true });
  const root = process.cwd();
  await esbuild.build({ stdin: { contents: entry, loader: "tsx", resolveDir: root }, bundle: true, format: "iife", platform: "browser",
    outfile: resolve(output, "preview.js"), alias: { "@": root }, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: before ? [{ name: "saved-uncommitted-before", setup(build) {
      build.onLoad({ filter: /(?:AuroraRibbonBeacons\.tsx|AuroraRibbons\.tsx|aurora-shaders\.ts|aurora-ribbon-beacons\.ts)$/ }, args => {
        const relative = args.path.slice(root.length + 1), saved = resolve(root, ".next/aurora-polish-before", relative + ".source");
        if (existsSync(saved)) return { contents: readFileSync(saved, "utf8"), loader: args.path.endsWith("tsx") ? "tsx" : "ts", resolveDir: resolve(args.path, "..") };
      });
    } }] : [] });
}
const entry = String.raw`
import React, {useState,useMemo,useRef,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {Vector3,Matrix4} from 'three';
import {_roots,addEffect} from '@react-three/fiber';
import {AuroraRibbonInteraction} from '@/lib/aurora-ribbon-picking';
import Glass from '@/components/aurora/GlassNebulaAurora';
import {AURORA_PRESETS} from '@/lib/aurora-presets';
import {createAuroraRibbonLayout} from '@/lib/aurora-ribbon-layout';
import {auroraEnergyProfiles,createAuroraEnergyEvent,updateAuroraEnergyEvent,sampleAuroraEnergyField} from '@/lib/aurora-energy';
import {createQuestionnaireState,questionnaireReducer as reduce} from '@/lib/questionnaire-state';
import {createKeywordPools,createSelectedCapsule,QUESTION_DATA} from '@/lib/capsules';
import {prepareAuroraResult} from '@/lib/aurora-result';
import {buildAuroraRibbonMeaningFromResult} from '@/lib/aurora-ribbon-meaning';
const pools=createKeywordPools();
function personalized(indices){
 let state=createQuestionnaireState();
 indices.forEach((values,step)=>values.forEach(n=>state=reduce(state,{type:'select',step,selection:createSelectedCapsule(pools[step][n-1],QUESTION_DATA[step].id,'synthetic-'+step+'-'+n)})));
 for(let step=0;step<9;step++)if(!state.selections[step].length)state=reduce(state,{type:'skip',step});
 state=reduce(state,{type:'closing-input',field:'authoredText',text:'검증용 승인 문장'});
 state=reduce(state,{type:'closing-approve',direct:true,approvedAt:'2026-10-15T00:00:00.000Z'});
 const ready=prepareAuroraResult(state);if(!ready.ready)throw Error('Synthetic fixture incomplete');
 const completed={snapshot:ready.snapshot,comments:Array.from({length:10},()=>({analysis:'합성 문항 전체 해석',detailedAnalysis:'합성 상세'}))};
 return {appearance:ready.snapshot.personalization.appearance,mapping:buildAuroraRibbonMeaningFromResult(completed),personalization:ready.snapshot.personalization};
}
const catalog=Object.fromEntries(AURORA_PRESETS.map(p=>[p.id,{appearance:p}]));
catalog.balanced=personalized([[2,3,12]]);catalog.dominant=personalized([[12]]);catalog.neutral=personalized([]);
const probe=window.__polish={catalog,scene:null,camera:null,renderer:null,sampleTime:null,draws:0,frames:0,phase:'overview',available:null,errors:[],resources:{buffers:0,textures:0,programs:0},profiles:new Map(),events:new Map()};
const sampler=new AuroraRibbonInteraction(),scratch=new Vector3(),renderedView=new Matrix4(),renderedProjection=new Matrix4();
probe.anchorErrors=()=>{const result=[];sampler.entries.clear();probe.scene?.traverse(m=>{if(m.userData.ribbonId&&!m.userData.mist&&m.material?.uniforms)sampler.entries.set(m.userData.ribbonId,{mesh:m,visual:m.material,active:m.userData.active});});
 for(const button of document.querySelectorAll('[data-beacon-id]')){
  if(button.closest('[hidden]')||button.style.visibility==='hidden')continue;
  const u=Number(button.dataset.segmentU),id=button.dataset.beaconId;
  if(!sampler.surfacePoint(id,u,.5,scratch))continue;scratch.applyMatrix4(renderedView).applyMatrix4(renderedProjection);
  const x=(scratch.x+1)*innerWidth/2,y=(1-scratch.y)*innerHeight/2,r=button.getBoundingClientRect();
  result.push({id,u,x:r.x+24,y:r.y+24,ax:Number(button.dataset.anchorX),ay:Number(button.dataset.anchorY),error:Math.hypot(x-Number(button.dataset.anchorX),y-Number(button.dataset.anchorY))});
 }return result;
};
function attachRenderer(renderer){
const originalRender=renderer.render;
renderer.render=function(scene,camera){
 if(scene.children.some(o=>o.type==='Group')){probe.scene=scene;probe.camera=camera;probe.renderer=this;probe.frames++;
  if(probe.sampleTime!==null)scene.traverse(mesh=>{
   if(!mesh.userData.ribbonId||!mesh.material?.uniforms?.uEnergyTime)return;
   const u=mesh.material.uniforms,profiles=probe.profiles.get(mesh.userData.ribbonId),events=probe.events.get(mesh.userData.ribbonId);
   if(!profiles)return;u.uEnergyTime.value=probe.sampleTime;
   profiles.forEach((p,i)=>{const event=events[i];updateAuroraEnergyEvent(p,probe.sampleTime,event);
    u.uEnergyTiming.value[i].set(event.start,event.travel,event.speed,event.wakeEnd);
    u.uEnergyShape.value[i].set(event.length,event.focus,event.direction,event.gain);
    u.uEnergyWake.value[i].set(event.wakeLength,event.wakeGain);});
  });
 }
 const value=originalRender.call(this,scene,camera);
 if(scene===probe.scene&&camera===probe.camera){renderedView.copy(camera.matrixWorldInverse);renderedProjection.copy(camera.projectionMatrix);}
 return value;
};
}
addEffect(()=>{for(const root of _roots.values()){const state=root.store.getState();
 if(state.gl&&probe.renderer!==state.gl){probe.renderer=state.gl;probe.scene=state.scene;probe.camera=state.camera;attachRenderer(state.gl);}
}});
function App(){
 const [fixture,setFixture]=useState('mixed'),[quality,setQuality]=useState('low'),[reduced,setReduced]=useState(true);
 const [viewPhase,setViewPhase]=useState('overview');
 const [selected,setSelected]=useState(null),[segment,setSegment]=useState(.32),[mode,setMode]=useState('front'),[revision,setRevision]=useState(0);
 const host=useRef(null),appearance=catalog[fixture].appearance;
 const layout=useMemo(()=>createAuroraRibbonLayout(appearance,quality,'hybrid'),[appearance,quality]);
 const ribbons=layout.ribbons.filter(r=>r.active);
 const select=React.useCallback(id=>setSelected(id),[]);
 const onPhase=React.useCallback(p=>{probe.phase=p;document.body.dataset.phase=p;setViewPhase(p);},[]);
 const onMode=React.useCallback(m=>setMode(m),[]);
 const onAvailable=React.useCallback(v=>{probe.available=v;},[]);
 useEffect(()=>{probe.profiles.clear();probe.events.clear();for(const r of ribbons){
  const p=auroraEnergyProfiles(r.layers[0].shape.energySeed);probe.profiles.set(r.ribbonId,p);probe.events.set(r.ribbonId,p.map(createAuroraEnergyEvent));
 }},[layout]);
 useEffect(()=>{probe.control={fixture:(v)=>{setSelected(null);setFixture(v);setRevision(r=>r+1);},quality:setQuality,reduced:setReduced,mode:(v)=>{setMode(v);setRevision(r=>r+1);},
  select:(id,u=.32)=>{setSegment(u);setSelected(id);},back:()=>setSelected(null),sample:t=>{probe.sampleTime=t;setRevision(r=>r+1);}};probe.layout=layout;
  probe.sampleStates=(id,u)=>{const p=probe.profiles.get(id);let low={time:0,value:Infinity},high={time:0,value:-1};
    for(let t=0;t<70;t+=.25){const value=sampleAuroraEnergyField(p,t,u).stream;if(value<low.value)low={time:t,value};if(value>high.value)high={time:t,value};}
    let mid={time:0,value:0},diff=Infinity;for(let t=0;t<70;t+=.25){const value=sampleAuroraEnergyField(p,t,u).stream,d=Math.abs(value-(low.value+high.value)/2);if(d<diff){diff=d;mid={time:t,value};}}
    return {quiet:low,medium:mid,strong:high};};
 },[layout]);
 return <main><Glass appearance={appearance} quality={quality} reducedMotion={reduced} cameraMode={mode} cameraRevision={revision}
  selectedRibbonId={selected} selectedRibbonSegment={segment} beaconHost={host} onRibbonSelect={select} onRibbonFocusPhaseChange={onPhase}
  onCameraModeChange={onMode} onRibbonFocusReturn={onMode} onAvailabilityChange={onAvailable}/>
 <div id='beacons' ref={host} hidden={!!selected||viewPhase!=='overview'} style={{position:'fixed',inset:0,pointerEvents:'none'}}>
  <svg style={{position:'absolute',width:'100%',height:'100%',pointerEvents:'none'}}>{ribbons.map(r=><line data-leader-id={r.ribbonId} key={r.ribbonId} stroke='#bdeaf3' strokeOpacity='.4'/>)}</svg>
  {ribbons.map((r,i)=><button key={r.ribbonId} data-beacon-id={r.ribbonId} aria-label={'Ribbon '+i}
   style={{position:'absolute',left:0,top:0,width:48,height:48,borderRadius:'50%',pointerEvents:'auto',border:'1px solid #d6f3ff66',background:'#131d32aa',color:r.layers[0].visual.colorA.color}}
   onClick={e=>{setSegment(Number(e.currentTarget.dataset.segmentU));setSelected(r.ribbonId);}}><span style={{display:'block',width:10,height:10,margin:'auto',borderRadius:'50%',background:'currentColor',boxShadow:'0 0 16px currentColor'}}/>{i+1}</button>)}
 </div>
 <div style={{position:'fixed',right:10,top:10,color:'#b4c5db',fontSize:11,pointerEvents:'none'}}>{fixture} · {quality} · {selected||'overview'}</div>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;
