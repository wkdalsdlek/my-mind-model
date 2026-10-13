import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function createModuleLoader(externals = {}) {
  const cache = new Map();
  return function loadModule(file) {
    const filename = resolve(root, file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const compiledModule = { exports: {} };
    cache.set(filename, compiledModule);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    const requireLocal = specifier => {
      if (Object.hasOwn(externals, specifier)) return externals[specifier];
      assert.ok(specifier.startsWith("."), `Unexpected dependency: ${specifier}`);
      return loadModule(resolve(dirname(filename), `${specifier}.ts`));
    };
    runInThisContext(`(function(require, module, exports) { ${outputText}\n})`, { filename })(requireLocal, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  };
}
export const loadModule = createModuleLoader();
