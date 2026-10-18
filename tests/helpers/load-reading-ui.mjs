import { readFileSync } from 'node:fs';
import {createRequire} from 'node:module';
import {runInThisContext} from 'node:vm';
import ts from 'typescript';
import {loadModule} from './load-typescript.mjs';
const require=createRequire(import.meta.url);
/** Execute actual JSX for static contract checks. Only CSS and browser/WebGL hooks
 * are stubbed by callers. Never replaces the interpretation or view logic. */
export function loadReadingUI() {
 const exports={};const code=ts.transpileModule(readFileSync(new URL('../../components/result/AuroraReading.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 runInThisContext(`(function(require,exports){${code}\n})`)(id=>id==='react/jsx-runtime'?require(id):id.endsWith('.module.css')?{}:id.startsWith('@/lib/')?loadModule(id.replace('@/','')+'.ts'):(()=>{throw new Error('UNEXPECTED_UI_IMPORT');})(),exports);
 return exports;
}
