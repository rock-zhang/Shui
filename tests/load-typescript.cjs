const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
module.exports = function loadModule(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename);
  const api = {};
  cache.set(filename, api);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  new Function('exports', 'require', code)(api, relative => {
    if (!relative.startsWith('.')) throw new Error(`Unsupported test import: ${relative}`);
    return loadModule(path.resolve(path.dirname(filename), `${relative}.ts`));
  });
  return api;
};
