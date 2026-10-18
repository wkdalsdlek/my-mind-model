import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInThisContext} from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadModule} from './helpers/load-typescript.mjs';
import {loadReadingUI} from './helpers/load-reading-ui.mjs';
import {universeFixture,universeState} from './helpers/aurora-universe-fixture.mjs';
const require=createRequire(import.meta.url);
function loadUI(file,react=React){const exports={};const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 runInThisContext(`(function(require,exports){${code}\n})`)(id=>id==='react'?react:id==='react/jsx-runtime'?require(id):id.endsWith('.module.css')?{}:id.startsWith('@/lib/')?loadModule(id.replace('@/','')+'.ts'):(()=>{throw new Error('UNEXPECTED_IMPORT');})(),exports);return exports;}
test('intro requires valid story, displays editable examples and never attaches advance to screen or textarea',()=>{
 const {default:Intro}=loadUI('components/journey/JourneyIntro.tsx');
 const render=value=>renderToStaticMarkup(React.createElement(Intro,{value,leaving:false,onStart:()=>{},onChange:()=>{}}));
 for(const value of ['','  ','한'.repeat(201)])assert.match(render(value),/disabled=""[^>]*>나의 마음 들여다보기/);
 const html=render('직접 작성한 나의 이야기');assert.ok(!/disabled=""[^>]*>나의 마음 들여다보기/.test(html));assert.match(html,/name="situation"/);assert.match(html,/아이를 키우는 초보 아빠/);assert.match(html,/type="button"/);assert.match(html,/type="submit"/);
 assert.match(render('입력 중'),/마음은 언제나 하나의 색으로 설명되지 않습니다/);assert.match(render('입력 중'),/aria-describedby="situation-help situation-count"/);
});
test('situation editor explains that answers and approval survive and invalid input cannot save',()=>{
 const {SituationEditor}=loadUI('components/journey/JourneyIntro.tsx'),html=renderToStaticMarkup(React.createElement(SituationEditor,{value:' ',onSave:()=>{},onClose:()=>{}}));
 assert.match(html,/<dialog/);assert.match(html,/선택한 답변과 승인 문장은 유지/);assert.match(html,/disabled=""[^>]*>이야기 저장/);
});
test('audio initially has no source or autoplay and owns exactly one loop element',()=>{
 const {default:Sound}=loadUI('components/journey/JourneySound.tsx');const html=renderToStaticMarkup(React.createElement(Sound,{ref:{current:null}}));
 assert.equal((html.match(/<audio/g)||[]).length,1);assert.match(html,/preload="none"/);assert.match(html,/loop=""/);assert.ok(!html.includes('src='));assert.ok(!html.includes('autoPlay'));assert.match(html,/배경음악 재생/);
});
test('gesture starts once; fade is independent of renders; failed audio stays nonblocking and cleanup stops playback',async()=>{
 const cells=[],cleanups=[],effects=[];let cursor=0,handle,tree;
 const shim={useRef:value=>{const i=cursor++;return cells[i]??(cells[i]={current:value});},useState:value=>{const i=cursor++;if(!(i in cells))cells[i]=value;return[cells[i],v=>{cells[i]=v;}];},useCallback:fn=>fn,useEffect:fn=>{effects.push(fn);},useImperativeHandle:(_ref,create)=>{handle=create();}};
 const {default:Sound}=loadUI('components/journey/JourneySound.tsx',shim);
 tree=Sound({ref:{current:null}});const audio=tree.props.children.find(n=>n?.type==='audio');let plays=0,pauses=0;
 const element={paused:true,src:'',volume:1,play(){plays++;this.paused=false;return Promise.resolve();},pause(){pauses++;this.paused=true;}};audio.props.ref.current=element;for(const effect of effects)cleanups.push(effect());
 assert.equal(plays,0);handle.start();assert.equal(plays,1);handle.start();assert.equal(plays,1);
 await new Promise(r=>setTimeout(r,2100));assert.ok(Math.abs(element.volume-.12)<.001);assert.equal(element.src,'/audio/intro-bgm.mp3');
 audio.props.ref.current=null;for(const cleanup of cleanups)cleanup?.();assert.equal(pauses,1);audio.props.ref.current=element;
 element.play=()=>Promise.reject(new Error('synthetic-only'));handle.start();await new Promise(r=>setTimeout(r,1));assert.ok(cells.includes('unavailable'));
});
test('late native play resolution after cleanup cannot change state or start a fade',async()=>{
 const cells=[],effects=[];let cursor=0,handle,resolvePlay,pauses=0;
 const shim={useRef:value=>{const i=cursor++;return cells[i]??(cells[i]={current:value});},useState:value=>{const i=cursor++;if(!(i in cells))cells[i]=value;return[cells[i],v=>{cells[i]=v;}];},useCallback:fn=>fn,useEffect:fn=>{effects.push(fn);},useImperativeHandle:(_ref,create)=>{handle=create();}};
 const {default:Sound}=loadUI('components/journey/JourneySound.tsx',shim);
 const audio=Sound({ref:{current:null}}).props.children.find(n=>n?.type==='audio');
 const element={paused:true,src:'',volume:1,play(){this.paused=false;return new Promise(r=>{resolvePlay=r;});},pause(){pauses++;this.paused=true;}};
 audio.props.ref.current=element;const cleanups=effects.map(fn=>fn());handle.start();audio.props.ref.current=null;cleanups.forEach(fn=>fn?.());resolvePlay();await new Promise(r=>setTimeout(r,60));
 assert.equal(pauses,1);assert.equal(element.paused,true);assert.equal(element.volume,.005);assert.ok(cells.includes('idle'));assert.ok(!cells.includes('playing'));assert.equal(cells[1].current,null);
});
test('report shows all eight parts, actual colors/evidence and catalog quote only after personal letter',async()=>{
 const r=await universeFixture(universeState('all'),'balanced','hybrid','새로운 시작을 앞둔 직장인');const UI=loadReadingUI();const html=renderToStaticMarkup(React.createElement(UI.AuroraFullReading,{interpretation:r.interpretation}));
 assert.equal((html.match(/data-report-section=/g)||[]).length,6);assert.match(html,/당신의 마음이 보여준 전체적인 모습/);assert.match(html,/오로라를 이루는 리본들/);
 assert.ok(html.indexOf('data-report-section="letter"')<html.indexOf('data-quote-placement="report-end"'));
 assert.equal((html.match(/data-reading-ribbon-id=/g)||[]).length,r.context.facts.ribbons.length);
 const stripped=html.replace(/<[^>]*>/g,'');assert.ok(!/#[a-f\d]{6}/i.test(stripped));assert.match(stripped,/픽셀 면적이 아닙니다/);
 for(const e of r.context.facts.ribbons[0].evidence)assert.ok(stripped.includes(e.originalText));
});
test('intro/reader motion honors OS and settings replace permanent list with discoverable disclosure',()=>{
 const css=readFileSync(new URL('../components/journey/JourneyIntro.module.css',import.meta.url),'utf8');assert.match(css,/appear 3s/);assert.match(css,/opacity 1.5s/);assert.match(css,/prefers-reduced-motion/);
 const result=readFileSync(new URL('../components/result/AuroraResultScreen.tsx',import.meta.url),'utf8');assert.match(result,/<details ref={exploration}/);assert.ok(!result.includes('type="checkbox"'));assert.match(result,/effectiveReduced = reduced/);
});
test('quality changes use current mist layers for visual explanations while preserving bound analysis by actual ribbonId',async()=>{
 const r=await universeFixture(universeState('all'),'balanced','hybrid','새로운 시작을 앞둔 직장인');const UI=loadReadingUI();
 const low=loadModule('lib/aurora-universe.ts').universeRibbonLayout(r,'low');const loop=low.find(v=>v.kind==='loop');assert.ok(loop);
 const html=renderToStaticMarkup(React.createElement(UI.AuroraFullReading,{interpretation:r.interpretation,visualRibbons:low}));
 const article=html.split(`data-reading-ribbon-id="${loop.ribbonId}"`)[1].split('</article>')[0];
 assert.ok(article.includes('1개 안개층'));assert.ok(!article.includes('2개 안개층'));assert.equal(r.context.binding.quality,'balanced');
 assert.ok(article.includes(r.interpretation.generated.ribbons.find(v=>v.ribbonId===loop.ribbonId).reportSummary.text));
});
