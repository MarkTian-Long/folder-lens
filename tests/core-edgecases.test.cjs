'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const loadCore = require('./helpers/load-core.cjs');
const Core = loadCore();

function file(name, bytes = 1) {
  return {kind: 'file', name, async getFile() {return {size: bytes, lastModified: 1700000000000};}};
}
function directory(name, children = []) {
  return {kind: 'directory', name, async *values() {yield* children;}};
}
function listFile(relative, bytes = 1) {
  return {name: relative.split('/').pop(), webkitRelativePath: relative,
    size: bytes, lastModified: 1700000000000};
}
function deferred() {
  let resolve;
  const promise = new Promise(accept => {resolve = accept;});
  return {promise, resolve};
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('empty native directory is a complete zero-byte result', async () => {
  const index = await Core.scanHandle(directory('root'));
  assert.equal(index.status, 'complete');
  assert.equal(index.nodes[0].size, 0);
  assert.equal(index.nodes[0].files, 0);
  assert.equal(index.nodes[0].dirs, 0);
  assert.equal(index.nodes[0].enumerated, true);
});

test('empty compatibility lists and individual files are rejected', async () => {
  await assert.rejects(Core.scanFiles([]), /文件列表|空文件夹/);
  await assert.rejects(Core.scanFiles([{name: 'a.txt', size: 1}]), /相对路径/);
  await assert.rejects(Core.scanHandle(file('a.txt')), /文件夹/);
});

test('pre-aborted native and compatibility scans report stopped without reading files', async () => {
  const controller = new AbortController(); controller.abort();
  let metadataCalls = 0;
  const unread = file('a.txt'); unread.getFile = async () => {metadataCalls++; return {size: 5};};
  const native = await Core.scanHandle(directory('root', [unread]), {signal: controller.signal});
  const compat = await Core.scanFiles([listFile('root/a.txt', 5)], {signal: controller.signal});
  for (const index of [native, compat]) {
    assert.equal(index.status, 'stopped');
    assert.equal(index.goodFiles, 0);
    assert.equal(index.nodes[0].complete, false);
    assert.equal(index.nodes[0].size, 0);
  }
  assert.equal(metadataCalls, 0);
});

test('aborted metadata request keeps already-read bytes and ignores its late success', async () => {
  const started = deferred(), late = deferred(), controller = new AbortController();
  const pending = {kind: 'file', name: 'late.bin', getFile() {started.resolve(); return late.promise;}};
  const running = Core.scanHandle(directory('root', [file('known.bin', 3), pending]), {signal: controller.signal});
  await started.promise; controller.abort();
  const index = await running;
  assert.equal(index.status, 'stopped');
  assert.equal(index.goodFiles, 1);
  assert.equal(index.issueCount, 0);
  late.resolve({size: 999, lastModified: 1700000000000}); await nextTurn();
  assert.equal(index.totalBytes, 3);
  assert.equal(index.nodes.find(node => node.name === 'late.bin').readable, false);
  assert.equal(index.nodes[0].size, 3);
  assert.equal(index.nodes[0].complete, false);
});

test('compatibility cancellation retains exactly the files processed before stopping', async () => {
  const controller = new AbortController();
  const index = await Core.scanFiles([listFile('root/first.bin', 3), listFile('root/not-read.bin', 99)], {
    signal: controller.signal, onProgress(progress) {if (progress.files === 1) controller.abort();}
  });
  assert.equal(index.status, 'stopped');
  assert.equal(index.goodFiles, 1);
  assert.equal(index.nodes[0].size, 3);
  assert.equal(index.nodes.some(node => node.name === 'not-read.bin'), false);
});

test('aborted directory enumeration ignores its late entry', async () => {
  const started = deferred(), late = deferred(), controller = new AbortController();
  const handle = {kind: 'directory', name: 'root', values() {return {
    [Symbol.asyncIterator]() {return this;},
    next() {started.resolve(); return late.promise;}
  };}};
  const running = Core.scanHandle(handle, {signal: controller.signal});
  await started.promise; controller.abort();
  const index = await running;
  late.resolve({done: false, value: file('late.bin', 999)}); await nextTurn();
  assert.equal(index.status, 'stopped');
  assert.equal(index.nodes.length, 1);
  assert.equal(index.totalBytes, 0);
});

test('timed-out metadata request remains unknown after a late success', async () => {
  const late = deferred();
  const pending = {kind: 'file', name: 'timeout.bin', getFile() {return late.promise;}};
  const index = await Core.scanHandle(directory('root', [pending]), {options: {timeout: 15}});
  assert.equal(index.status, 'partial');
  assert.equal(index.issueCount, 1);
  assert.match(index.nodes[1].error, /超时/);
  assert.equal(index.goodFiles, 0);
  late.resolve({size: 999}); await nextTurn();
  assert.equal(index.totalBytes, 0);
  assert.equal(index.nodes[1].readable, false);
});

test('timed-out directory enumeration records a partial result and ignores a late entry', async () => {
  const late = deferred();
  const handle = {kind: 'directory', name: 'root', values() {return {
    [Symbol.asyncIterator]() {return this;}, next() {return late.promise;}
  };}};
  const index = await Core.scanHandle(handle, {options: {timeout: 15}});
  assert.equal(index.status, 'partial');
  assert.equal(index.issueCount, 1);
  assert.equal(index.nodes[0].enumerated, false);
  late.resolve({done: false, value: file('late.bin', 999)}); await nextTurn();
  assert.equal(index.nodes.length, 1);
  assert.equal(index.totalBytes, 0);
});

test('permission-denied directory preserves readable siblings and marks ancestors partial', async () => {
  const denied = {kind: 'directory', name: 'denied', async *values() {
    throw Object.assign(new Error('denied'), {name: 'NotAllowedError'});
  }};
  const index = await Core.scanHandle(directory('root', [denied, file('good.bin', 7)]));
  assert.equal(index.status, 'partial');
  assert.equal(index.nodes[0].size, 7);
  assert.equal(index.nodes[0].files, 1);
  assert.equal(index.nodes[0].dirs, 1);
  assert.equal(index.nodes[0].complete, false);
  const inaccessible = index.nodes.find(node => node.name === 'denied');
  assert.equal(inaccessible.enumerated, false);
  assert.equal(inaccessible.complete, false);
  assert.match(inaccessible.error, /权限/);
});

test('entry limit stops both modes without counting undiscovered files', async () => {
  const native = await Core.scanHandle(directory('root', Array.from({length: 6}, (_, n) => file('f' + n, 2))),
    {options: {maxNodes: 4}});
  const compat = await Core.scanFiles(Array.from({length: 6}, (_, n) => listFile('root/f' + n, 2)),
    {options: {maxNodes: 4}});
  for (const index of [native, compat]) {
    assert.equal(index.status, 'limited');
    assert.equal(index.nodes.length, 4); // The cap includes the root entry.
    assert.equal(index.nodes[0].size, 6);
    assert.equal(index.goodFiles, 3);
    assert.equal(index.nodes[0].complete, false);
    assert.match(index.stopReason, /上限/);
  }
});

test('depth limit keeps the allowed files and does not traverse blocked descendants', async () => {
  let forbiddenReads = 0;
  const blocked = {kind: 'directory', name: 'blocked', async *values() {forbiddenReads++; yield file('secret', 99);}};
  const native = await Core.scanHandle(directory('root', [file('root.bin', 2),
    directory('allowed', [file('inside.bin', 3), blocked])]), {options: {maxDepth: 1}});
  assert.equal(native.status, 'partial');
  assert.equal(native.nodes[0].size, 5);
  assert.equal(native.nodes[0].files, 2);
  assert.equal(native.nodes[0].dirs, 2);
  assert.equal(forbiddenReads, 0);
  const blockedNode = native.nodes.find(node => node.name === 'blocked');
  assert.equal(blockedNode.enumerated, false);
  assert.equal(blockedNode.complete, false);
  const compat = await Core.scanFiles([listFile('root/root.bin', 2),
    listFile('root/allowed/inside.bin', 3), listFile('root/allowed/blocked/secret', 99)],
  {options: {maxDepth: 1}});
  assert.equal(compat.status, 'partial');
  assert.equal(compat.nodes[0].size, 5);
  assert.equal(compat.nodes[0].files, 2);
  assert.equal(compat.nodes.some(node => node.name === 'secret'), false);
});

test('duplicate paths and file/directory conflicts never inflate totals', async () => {
  const native = await Core.scanHandle(directory('root', [file('same.txt', 7), file('same.txt', 7)]));
  assert.equal(native.status, 'partial');
  assert.equal(native.goodFiles, 1);
  assert.equal(native.nodes[0].size, 7);
  const compat = await Core.scanFiles([listFile('root/same.txt', 7),
    listFile('root/same.txt', 7), listFile('root/same.txt/child', 100)]);
  assert.equal(compat.status, 'partial');
  assert.equal(compat.issueCount, 2);
  assert.equal(compat.goodFiles, 1);
  assert.equal(compat.nodes[0].size, 7);
});

test('invalid sizes stay unknown and are excluded from sums and extension groups', async () => {
  const sizes = [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1];
  const items = sizes.map((bytes, n) => listFile('root/invalid' + n + '.bin', bytes));
  items.push(listFile('root/good.bin', 5), listFile('root/zero.bin', 0));
  const index = await Core.scanFiles(items);
  assert.equal(index.status, 'partial');
  assert.equal(index.goodFiles, 2);
  assert.equal(index.issueCount, sizes.length);
  assert.equal(index.nodes[0].size, 5);
  assert.deepEqual(index.types().map(group => ({ext: group.ext, size: group.size, files: group.files})),
    [{ext: '.bin', size: 5, files: 2}]);
  for (const id of index.fileIds.slice(0, sizes.length)) {
    assert.equal(index.nodes[id].readable, false);
    assert.equal(index.nodes[id].complete, false);
    assert.equal(index.nodes[id].files, 0);
  }
});

test('sum beyond the safe integer range is explicitly flagged', async () => {
  const index = await Core.scanFiles([listFile('root/a.bin', Number.MAX_SAFE_INTEGER), listFile('root/b.bin', 2)]);
  assert.equal(index.precisionWarning, true);
  assert.equal(index.goodFiles, 2);
});

test('valid epoch and pre-epoch dates are retained and out-of-range dates become unknown', async () => {
  const times=[0,-86400000,1700000000000,Number.MAX_SAFE_INTEGER,NaN,Infinity];
  const index=await Core.scanFiles(times.map((lastModified,n)=>({...listFile('root/time'+n,1),lastModified})));
  assert.deepEqual(index.fileIds.map(id=>index.nodes[id].modified),[0,-86400000,1700000000000,null,null,null]);
  assert.equal(index.goodFiles,times.length);
  assert.equal(index.nodes[0].size,times.length);
});

test('malformed or mixed-root relative paths cannot enter the index', async () => {
  const index = await Core.scanFiles([listFile('root/good.txt', 3),
    listFile('other/wrong.txt', 100), listFile('root/../escape.txt', 100), listFile('root//bad.txt', 100)]);
  assert.equal(index.status, 'partial');
  assert.equal(index.goodFiles, 1);
  assert.equal(index.nodes[0].size, 3);
  assert.equal(index.issueCount, 3);
});

test('NUL and backslash fragments cannot create misleading exported paths', async () => {
  const index=await Core.scanFiles([listFile('root/good.txt',3),
    listFile('root/bad\0name.txt',100),listFile('root/bad\\name.txt',100)]);
  assert.equal(index.goodFiles,1);
  assert.equal(index.nodes[0].size,3);
  assert.equal(index.issueCount,2);
  assert.equal(index.status,'partial');
});

test('parent/descendant selection is deduplicated while disjoint branches remain', async () => {
  const index = await Core.scanFiles([listFile('root/a/deep/one', 2),
    listFile('root/a/two', 3), listFile('root/b/three', 5)]);
  const ids = new Map(index.nodes.map(node => [index.path(node.id, false, '/'), node.id]));
  const selected = new Set([ids.get('a/deep/one'), ids.get('a/deep'), ids.get('a'),
    ids.get('b/three'), 0, -1, 999, '1', null]);
  const minimal = Core.minimalSelection(index, selected);
  assert.deepEqual(new Set(minimal), new Set([ids.get('a'), ids.get('b/three')]));
  assert.equal(minimal.reduce((sum, id) => sum + index.nodes[id].size, 0), 10);
});

test('CSV cells neutralize formulas and preserve quoted names', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-1+2', '@A1', '  =A1', '\ufeff=1', '\tplain', '\rplain', '\nplain']) {
    const cell = Core.csvCell(value);
    assert.equal(cell[0], '"');
    assert.equal(cell[1], "'", JSON.stringify(value));
    assert.equal(cell.at(-1), '"');
  }
  assert.equal(Core.csvCell('a & b, "quoted"'), '"a & b, ""quoted"""');
  assert.equal(Core.csvCell(null), '""');
  assert.equal(Core.csvLine(['a,b', '中文']), '"a,b","中文"\r\n');
});

test('manual root paths are normalized but cannot change scan scope', async () => {
  const index = await Core.scanFiles([listFile('root/a/b.txt', 2)]);
  const fileId = index.fileIds[0];
  assert.equal(Core.normalizeRootPath('"D:/资料/root/"', 'root'), 'D:\\资料\\root');
  assert.equal(Core.displayPath(index, fileId, 'D:\\资料\\root'), 'D:\\资料\\root\\a\\b.txt');
  assert.equal(Core.displayPath(index, fileId), 'root\\a\\b.txt');
  for (const value of ['relative/root', 'https://example.com/root', 'D:\\',
    'D:\\资料\\..\\root', 'D:\\资料\\wrong']) {
    assert.throws(() => Core.normalizeRootPath(value, 'root'));
  }
  assert.throws(() => Core.normalizeRootPath('D:\\资\n料\\root', 'root'));
  assert.equal(index.nodes[0].size, 2);
});
