// Actual bundled renderer. Synthetic fixtures, no application/paid API requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildPolishPreview} from './aurora-polish-preview.mjs';
const require=createRequire(import.meta.url),tools=process.env.AURORA_POLISH_TOOLS||'/tmp/aurora-polish-tools/node_modules';
const {chromium}=require(resolve(tools,'playwright')),esbuild=require(resolve(tools,'esbuild'));
const before=process.env.AURORA_POLISH_BEFORE==='1',output=resolve(process.env.AURORA_POLISH_OUTPUT||`/tmp/aurora-polish-${before?'before':'after'}`);
mkdirSync(output,{recursive:true});await buildPolishPreview(esbuild,output,before);
const report={variant:before?'before':'after',paidCalls:0,errors:[],states:[],motion:{}},origin='http://127.0.0.1:3000';
let browser,page;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:820,height:640},hasTouch:true,reducedMotion:'no-preference',...(process.env.AURORA_POLISH_STATIC_ONLY?{}:{recordVideo:{dir:resolve(output,'video'),size:{width:820,height:640}}})});
 page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Chromium page crashed'));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,origin,'No external requests allowed');
  if(url.pathname==='/polish.js')return route.fulfill({body:readFileSync(resolve(output,'preview.js')),contentType:'text/javascript; charset=utf-8'});
  if(url.pathname==='/polish.css')return route.fulfill({body:readFileSync(resolve(output,'preview.css')),contentType:'text/css'});
  if(url.pathname==='/polish')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><link rel="stylesheet" href="/polish.css"><style>html,body,#root,main{margin:0;height:100%;background:#080d23;font-family:sans-serif}button:focus-visible{outline:2px solid cyan}button:hover{background:#25445d!important}</style></head><body><div id="root"></div><script src="/polish.js"></script></body></html>'});
  return route.abort();
 });
 await page.goto(origin+'/polish');await page.waitForFunction(()=>window.__polish?.available===true&&window.__polish?.control&&window.__polish.renderer);console.log(report.variant+': real renderer ready');
 const phase=async p=>page.waitForFunction(v=>window.__polish.phase===v,p);
 const control=async(method,...args)=>page.evaluate(({method,args})=>window.__polish.control[method](...args),{method,args});
 async function frames(n){return page.evaluate(n=>new Promise(resolve=>{const samples=[];let i=0;
  function frame(t){samples.push({time:t,markers:window.__polish.anchorErrors()});if(++i<n)requestAnimationFrame(frame);else resolve(samples);}requestAnimationFrame(frame);
 }),n);}
 function metrics(samples){let error=0,jumps=0,motion=0,maxResidual=0,markerSamples=0;
  for(let k=0;k<samples.length;k++)for(const a of samples[k].markers){markerSamples++;error=Math.max(error,a.error);
   const b=samples[k-1]?.markers.find(b=>b.id===a.id);if(!b)continue;
   const du=Math.abs(((a.u-b.u+1.5)%1)-.5);if(du>Math.max(.035,1.6*Math.min(.1,(samples[k].time-samples[k-1].time)/1000)))jumps++;
   motion=Math.max(motion,Math.hypot(a.x-b.x,a.y-b.y));maxResidual=Math.max(maxResidual,Math.hypot((a.x-b.x)-(a.ax-b.ax),(a.y-b.y)-(a.ay-b.ay)));
  }return {samples:samples.length,markerSamples,projectionError:error,largeUSteps:jumps,maxButtonStep:motion,maxOffsetStep:maxResidual};
 }
 if(process.env.AURORA_POLISH_PREVIEW_ONLY){
  await control('select','aurora-ribbon-v1:curtain:0',.32);await phase('focused');
  const samples=await page.evaluate(()=>window.__polish.sampleStates('aurora-ribbon-v1:curtain:0',.32));
  for(const [name,state]of Object.entries(samples)){await control('sample',state.time);await frames(2);await page.screenshot({path:resolve(output,'preview-'+name+'.png')});}
  await browser.close();process.exit(0);
 }
 if(!process.env.AURORA_POLISH_STATIC_ONLY){
 await control('reduced',false);await page.mouse.move(815,10);
 report.motion.still=metrics(await frames(process.env.AURORA_POLISH_MOTION_ONLY?12:28));await control('mode','auto');report.motion.auto=metrics(await frames(process.env.AURORA_POLISH_MOTION_ONLY?40:80));console.log(report.variant+': auto motion traced');
 await control('mode','free');await page.mouse.move(320,310);await page.mouse.down();
 const slow=frames(process.env.AURORA_POLISH_MOTION_ONLY?24:50);await page.mouse.move(530,340,{steps:45});await page.mouse.up();report.motion.slow=metrics(await slow);
 await page.mouse.move(530,320);await page.mouse.down();const fast=frames(process.env.AURORA_POLISH_MOTION_ONLY?24:55);await page.mouse.move(160,470,{steps:5});await page.mouse.up();report.motion.fast=metrics(await fast);
 await page.screenshot({path:resolve(output,'orbit.png')});console.log(report.variant+': manual motions traced');
 const target=page.locator('[data-beacon-id]').first(),box=await target.boundingBox();await page.mouse.move(box.x+24,box.y+24);await target.focus();
 const pinned=await target.boundingBox();await frames(8);const pinnedAfter=await target.boundingBox();report.pinnedDrift=Math.hypot(pinnedAfter.x-pinned.x,pinnedAfter.y-pinned.y);
 await target.click();await phase('focused');await control('back');await phase('overview');report.return=true;
 await control('reduced',true);await frames(2);
 const memory=()=>page.evaluate(()=>({geometry:window.__polish.renderer.info.memory.geometries,textures:window.__polish.renderer.info.memory.textures,programs:window.__polish.renderer.info.programs.length}));
 const memoryBefore=await memory();
 for(let i=0;i<5;i++){await control('select','aurora-ribbon-v1:curtain:'+(i%4),.32);await phase('focused');await control('back');await phase('overview');}
 await frames(3);const memoryAfter=await memory();report.focusMemory={before:memoryBefore,after:memoryAfter};assert.deepEqual(memoryAfter,memoryBefore);
 await page.setViewportSize({width:390,height:844});await control('mode','free');
 // Genuine mobile single-pointer touch rotation via Chromium's input protocol.
 const cdp=await context.newCDPSession(page);const touchTrace=frames(process.env.AURORA_POLISH_MOTION_ONLY?24:40);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:360}]});
 for(let i=1;i<=14;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:200-i*7,y:360+i*3}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});report.motion.touch=metrics(await touchTrace);
 await control('mode','front');await control('select','aurora-ribbon-v1:curtain:0',.32);await phase('focused');await control('back');await phase('overview');
 report.motion.afterReturn=metrics(await frames(12));console.log(report.variant+': touch and overview return traced');
 const gl=await page.evaluate(()=>{const gl=window.__polish.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),error:gl.getError()};});report.webgl=gl;
 // Stop this short motion recording before static quality/fixture comparisons.
 await context.close();
 if(process.env.AURORA_POLISH_MOTION_ONLY){assert.deepEqual(report.errors,[]);assert.equal(report.webgl.error,0);
  for(const [name,m]of Object.entries(report.motion))if(!before){assert.ok(m.markerSamples>=m.samples);assert.ok(m.projectionError<.15,name);assert.equal(m.largeUSteps,0,name);}
  writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();process.exit(0);
 }
 }else{report.webgl=await page.evaluate(()=>({error:window.__polish.renderer.getContext().getError()}));}
 const still=process.env.AURORA_POLISH_STATIC_ONLY?context:await browser.newContext({viewport:{width:820,height:640},hasTouch:true,reducedMotion:'reduce'});if(!process.env.AURORA_POLISH_STATIC_ONLY){page=await still.newPage();page.setDefaultTimeout(60000);
 // Reuse the same request interception policy, bundle, and real renderer.
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/polish.js')return route.fulfill({body:readFileSync(resolve(output,'preview.js')),contentType:'text/javascript; charset=utf-8'});
  if(u.pathname==='/polish.css')return route.fulfill({body:readFileSync(resolve(output,'preview.css')),contentType:'text/css'});
  if(u.pathname==='/polish')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<link rel="stylesheet" href="/polish.css"><style>html,body,#root,main{margin:0;height:100%;background:#080d23;font-family:sans-serif}</style><div id="root"></div><script src="/polish.js"></script>'});return route.abort();});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Chromium page crashed'));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto(origin+'/polish');await page.waitForFunction(()=>window.__polish?.control&&window.__polish.renderer);}

 for(const fixture of (process.env.AURORA_POLISH_STATES_ONLY?[]:['serenity','connection','exploration','mixed','balanced','dominant','neutral'])){
  await control('fixture',fixture);await control('back');await phase('overview');await frames(2);
  await page.screenshot({path:resolve(output,fixture+'-overview.png')});
  for(const slot of [0,1]){await control('select','aurora-ribbon-v1:curtain:'+slot,.32);await phase('focused');
   const states=await page.evaluate(slot=>window.__polish.sampleStates('aurora-ribbon-v1:curtain:'+slot,.32),slot);
   await control('sample',states.quiet.time);await frames(2);await page.screenshot({path:resolve(output,fixture+'-quiet-'+slot+'.png')});await control('back');await phase('overview');}
  console.log(`${report.variant}: ${fixture} compared`);
 }
 await control('fixture','mixed');await control('select','aurora-ribbon-v1:curtain:0',.32);await phase('focused');
 const states=await page.evaluate(()=>window.__polish.sampleStates('aurora-ribbon-v1:curtain:0',.32));
 for(const device of ['desktop','mobile']){await page.setViewportSize(device==='desktop'?{width:820,height:640}:{width:390,height:844});
  for(const quality of ['low','balanced','high']){await control('quality',quality);
   for(const [intensity,state]of Object.entries(states)){await control('sample',state.time);await frames(2);
    const file=`${device}-${quality}-${intensity}.png`;await page.screenshot({path:resolve(output,file)});report.states.push({device,quality,intensity,time:state.time,energy:state.value,file});}
   console.log(`${report.variant}: ${device}/${quality} quiet/medium/strong`);
  }
 }
 report.webgl=await page.evaluate(()=>{const gl=window.__polish.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),error:gl.getError()};});
 assert.deepEqual(report.errors,[]);assert.equal(report.webgl.error,0);
 if(!before&&!process.env.AURORA_POLISH_STATIC_ONLY){for(const [name,m]of Object.entries(report.motion)){assert.ok(m.markerSamples>=m.samples,`${name}: actual markers must be sampled`);assert.ok(m.projectionError<.15,`${name}: projection must use the live camera matrix`);assert.equal(m.largeUSteps,0,`${name}: no instantaneous physical-anchor switch`);}assert.ok(report.pinnedDrift<.1);}
 writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){report.failure=error.message;await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));throw error;}
finally{await browser?.close();}
