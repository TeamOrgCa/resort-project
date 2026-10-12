import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import ts from "typescript";

// Load route handlers with explicit dependency mocks, without a Next server or database.
export function loadTsModule(filename, mocks = {}, cache = new Map()) {
  const absolute = resolve(filename);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const loadedModule = { exports: {} };
  cache.set(absolute, loadedModule);
  const compiled = ts.transpileModule(readFileSync(absolute, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: absolute,
  }).outputText;
  const localRequire = createRequire(absolute);
  const requireMock = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier.startsWith(".") || specifier.startsWith("@/")) {
      const target = specifier.startsWith("@/") ? resolve(specifier.slice(2)) : resolve(dirname(absolute), specifier);
      const file = [target, `${target}.ts`, `${target}.tsx`].find((path) => existsSync(path));
      if (file && /\.tsx?$/.test(file)) return loadTsModule(file, mocks, cache);
    }
    return localRequire(specifier);
  };
  new Function("require", "module", "exports", compiled)(requireMock, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
