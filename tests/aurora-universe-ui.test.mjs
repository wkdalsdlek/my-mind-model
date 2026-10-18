import {loadReadingUI} from "./helpers/load-reading-ui.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/load-typescript.mjs';
import { universeFixture, universeState } from './helpers/aurora-universe-fixture.mjs';
const require = createRequire(import.meta.url), exports = {};
let renderer;
const externals = { "./AuroraReading": loadReadingUI(), react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@/components/aurora/GlassNebulaAurora': props => { renderer = props; return React.createElement('div',{'data-real-renderer-props':true}); },
  '@/components/aurora/useAuroraBrowserSignals': {useAuroraBrowserSignals:()=>({reduced:false})},
  '@/lib/question-data': loadModule('lib/question-data.ts'), '@/lib/aurora-universe': loadModule('lib/aurora-universe.ts'),
  '@/lib/philosophy-quotes': loadModule('lib/philosophy-quotes.ts'), './AuroraResultScreen.module.css': {} };
const source = readFileSync(new URL('../components/result/AuroraResultScreen.tsx',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
runInThisContext(`(function(require,exports){${compiled}\n})`)(id=>{assert.ok(Object.hasOwn(externals,id),id);return externals[id];},exports);
const reading = result => renderToStaticMarkup(React.createElement(loadReadingUI().AuroraFullReading,{interpretation:result.interpretation}));
const markup = (result, extra={}) => renderToStaticMarkup(React.createElement(exports.default,{result,onReset:()=>{},...extra}));
test('overview shows exact approved sentence; catalog quote and reason move to the end of reading',async()=>{
  const r=await universeFixture(),html=markup(r),p=r.interpretation.generated.philosophy;
  assert.ok(html.includes(r.context.approvedClosing.text));assert.ok(!html.includes('조용히 이어지는 나의 빛'));assert.ok(!html.includes(p.line.text));
  const report=reading(r);assert.ok(report.includes(p.line.text));assert.ok(report.includes(p.line.philosopher));assert.ok(report.includes(p.line.source.url));assert.ok(report.includes(p.reason[0]));assert.ok(report.includes('출처와 번역'));assert.ok(report.indexOf('data-quote-placement')>report.indexOf(r.context.approvedClosing.text));
  assert.ok(html.includes('나의 오로라 읽기'));assert.ok(!html.includes('요약 분석'));assert.ok(!html.includes('심층 분석'));
  assert.equal(r.snapshot.personalization.approvedTitle.text,'내 시간을 지키며 함께 걸어간다');
});
test('Cicero attribution preserves the fact that he conveys Plato and shows translation origin',async()=>{
  const r=await universeFixture();r.interpretation.generated.philosophy.line=loadModule('lib/philosophy-quotes.ts').resolvePhilosophyQuote('cicero-duties-1-22-together');
  const html=reading(r);assert.ok(html.includes('플라톤의 말을 전하며'));assert.ok(html.includes('현대 출판 번역문이 아닙니다'));assert.ok(html.includes('lang="la"'));
});
test('unverified quote metadata cannot create a clickable fake philosopher source',async()=>{
  const r=await universeFixture();r.interpretation.generated.philosophy.line.source.url='https://example.com/unverified';
  const html=markup(r);assert.ok(!html.includes('https://example.com/unverified'));assert.ok(html.includes(r.context.approvedClosing.text));
});
test('explicit quote shortage renders the approved sentence, clear status and manual actions without fake analysis',async()=>{
  const r=await universeFixture();const html=markup({...r,status:'quote-unavailable',interpretation:null},{onRetryInterpretation:()=>{},onReviewClosing:()=>{}});
  assert.ok(html.includes('나의 오로라'));assert.ok(html.includes(r.context.approvedClosing.text));assert.ok(html.includes(r.context.approvedClosing.text));
  assert.ok(html.includes('검증된 철학자 문구를 찾지 못했어요'));assert.ok(html.includes('해석 다시 요청하기'));assert.ok(html.includes('마지막 문장 살펴보기'));
  assert.ok(!html.includes('세네카'));assert.ok(!html.includes('<blockquote'));assert.ok(/disabled=""[^>]*>나의 오로라 읽기/.test(html));
});
test('busy/error fallback preserves the same scene and accessible request status',async()=>{
  const r=await universeFixture(),html=markup({...r,status:'quote-unavailable',interpretation:null},{busy:true,requestError:'답변은 유지됩니다.',onRetryInterpretation:()=>{},onCancelInterpretation:()=>{}});
  assert.ok(html.includes('role="status"'));assert.ok(html.includes('role="alert"'));assert.ok(html.includes('해석을 다시 읽고 있어요'));
  assert.ok(html.includes('요청 취소'));
  assert.deepEqual(renderer.appearance,r.snapshot.personalization.appearance);assert.equal(renderer.flowMode,r.context.binding.flowMode);
});
test('two and six ribbon layouts expose only their actual stable IDs and source-derived names',async()=>{
  for(const [kind,flow,count]of [['single','independent',2],['mixed','loop-emphasis',6]]){
    const r=await universeFixture(universeState(kind),'low',flow),html=markup(r);
    assert.deepEqual(Array.from(html.matchAll(/data-beacon-id="([^"]+)"/g),m=>m[1]),r.context.facts.ribbons.map(v=>v.ribbonId));
    assert.equal(r.context.facts.ribbons.length,count);assert.equal(renderer.quality,'low');assert.equal(renderer.flowMode,flow);
  }
});
test('font is self-hosted with the original OFL notice and readable fallback stack',()=>{
  const css=readFileSync(new URL('../components/result/AuroraResultScreen.module.css',import.meta.url),'utf8');
  assert.ok(css.includes('font-display: swap'));assert.ok(css.includes('Georgia'));assert.ok(!css.includes('fonts.googleapis.com'));
  const font=readFileSync(new URL('../public/fonts/nanum-pen-script/NanumPenScript-Regular.ttf',import.meta.url));assert.equal(font.readUInt32BE(0),0x00010000);
  const license=readFileSync(new URL('../public/fonts/nanum-pen-script/OFL.txt',import.meta.url),'utf8');assert.ok(license.includes('SIL OPEN FONT LICENSE'));
});
