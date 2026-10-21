'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'FolderLens.html');
let html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1, 'Keep one self-contained inline script.');
const script = scripts[0][1].replace(/\r\n?/g, '\n');
new vm.Script(script, {filename:'FolderLens.html'});
const hash = 'sha256-' + crypto.createHash('sha256').update(script).digest('base64');
if (process.argv.includes('--write')) {
  html = html.replace(/script-src 'sha256-[^']+'/,"script-src '" + hash + "'");
  fs.writeFileSync(file, html);
}
const csp = html.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i)?.[1] || '';
assert.ok(csp.includes("script-src '" + hash + "'"), 'Inline script changed: run npm run update:csp.');
for (const directive of ["default-src 'none'", "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "worker-src 'none'"]) {
  assert.ok(csp.includes(directive), 'Missing CSP directive: ' + directive);
}
assert.ok(!/script-src[^;]*(?:unsafe-inline|unsafe-eval)/.test(csp));
const refs = [...html.matchAll(/<(?:script|link|img|iframe|source)\b[^>]*(?:src|href)="([^"]+)"/gi)].map(m=>m[1]);
assert.ok(refs.every(ref=>ref.startsWith('data:') || ref.startsWith('#')), 'External runtime resource.');
assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(script), 'Unexpected network API.');
assert.ok(!/\b(?:createWritable|removeEntry|moveEntry)\s*\(/.test(script), 'Unexpected file mutation API.');
assert.ok(!/\b(?:arrayBuffer|stream|text)\s*\(/.test(script), 'Unexpected file content read API.');
assert.ok(script.includes("mode:'read'"), 'Explicit read-only picker permission.');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate element ids.');
const version = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
assert.ok(script.includes("const VERSION = '" + version + "'"));
assert.ok(html.includes('v' + version + ' · Browser'));
const projectLicense = fs.readFileSync(path.join(root,'LICENSE'),'utf8').trim();
assert.ok(html.includes(projectLicense), 'Standalone HTML must carry the project license.');
const notices = fs.readFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),'utf8');
assert.ok(notices.includes('2013-2023 Cole Bemis'));
assert.ok(html.includes('2013-2023 Cole Bemis'), 'Standalone HTML must carry the Feather notice.');
const mitTerms = 'Permission is hereby granted, free of charge, to any person obtaining a copy';
assert.ok(html.split(mitTerms).length >= 3, 'Keep complete MIT terms for both project and icons.');
console.log(JSON.stringify({version,syntax:'passed',inlineScriptHash:'matched',offlineResources:'passed',readOnlyApis:'passed',licenses:'passed',scriptSha256:hash.slice(7)},null,2));
