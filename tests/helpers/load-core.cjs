'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Evaluate only the browser-independent core from the shipped HTML. This keeps
// the tests on the actual distributable without starting a browser or server.
module.exports = function loadCore() {
  const filename = path.resolve(__dirname, '../../FolderLens.html');
  const html = fs.readFileSync(filename, 'utf8');
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .find(source => source.includes('const FolderLensCore = (() => {'));
  assert.ok(script, 'The shipped HTML must contain FolderLensCore');
  const start = script.indexOf('const FolderLensCore = (() => {');
  const marker = 'module.exports = FolderLensCore;';
  const end = script.indexOf(marker, start);
  assert.ok(end > start, 'The core CommonJS export boundary must be present');
  const source = script.slice(start, end + marker.length);
  const holder = {exports: {}};
  new Function('module', '"use strict";\n' + source)(holder);
  assert.equal(typeof holder.exports.scanHandle, 'function');
  return holder.exports;
};
