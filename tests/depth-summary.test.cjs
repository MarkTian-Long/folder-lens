'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const loadCore = require('./helpers/load-core.cjs');
const {createFixture, inspectFixture, filesystemHandle, compatibilityFiles, compatibleOracle} = require('./helpers/fixture.cjs');
const Core = loadCore();

function assertLevels(actual, records) {
  const expected = new Map();
  for (const [relative, record] of records) {
    if (!relative) continue; // The selected root is depth 0 and is not counted.
    const level = expected.get(record.depth) || {directories: 0, files: 0, bytes: 0};
    if (record.dir) level.directories++;
    else {level.files++; level.bytes += record.size;}
    expected.set(record.depth, level);
  }
  const normalized = new Map();
  for (const level of actual) {
    assert.ok(Number.isInteger(level.depth) && level.depth >= 0);
    assert.equal(normalized.has(level.depth), false, 'Depth rows must be unique');
    const values = {directories: level.directories, files: level.files, bytes: level.bytes};
    for (const value of Object.values(values)) assert.ok(Number.isSafeInteger(value) && value >= 0);
    // Implementations may include an empty level-0 row or intermediate empty rows.
    if (values.directories || values.files || values.bytes) normalized.set(level.depth, values);
  }
  assert.deepEqual(normalized, expected);
}

test('depth summary matches actual filesystem depths without double-counting bytes', async t => {
  const root = await createFixture(t, {directories: ['empty/a/b/c', 'other'], files: [
    {name: 'at-root.bin', bytes: 3}, {name: 'one/at-two.txt', bytes: 5},
    {name: 'one/two/at-three.txt', bytes: 7}, {name: 'other/zero', bytes: 0}
  ]});
  const oracle = await inspectFixture(root);
  const index = await Core.scanHandle(filesystemHandle(root));
  const summary = index.depthSummary();
  assert.equal(summary.maxDepth, 4);
  assert.equal(summary.observedMaxDepth, 4);
  assert.equal(summary.complete, true);
  assertLevels(summary.levels, oracle);
  const deepest = summary.deepestDirectoryIds.map(id => index.path(id, false, '/'));
  assert.deepEqual(deepest, ['empty/a/b/c']);
  assert.equal(summary.levels.reduce((sum, level) => sum + level.bytes, 0), 15);
});

test('compatibility depth summary reflects inferred paths and cannot certify the full directory depth', async t => {
  const root = await createFixture(t, {directories: ['empty/a/b/c'], files: [
    {name: 'one/two/deep.txt', bytes: 5}, {name: 'root.txt', bytes: 7}
  ]});
  const oracle = await inspectFixture(root);
  const index = await Core.scanFiles(await compatibilityFiles(root, oracle));
  const summary = index.depthSummary();
  assert.equal(summary.maxDepth, 2);
  assert.equal(summary.observedMaxDepth, 2);
  assert.equal(summary.complete, false);
  assertLevels(summary.levels, compatibleOracle(oracle));
  assert.deepEqual(summary.deepestDirectoryIds.map(id => index.path(id, false, '/')), ['one/two']);
});

test('depth limit distinguishes visited directory depth from observed blocked depth', async () => {
  const handle = {kind: 'directory', name: 'root', async *values() {
    yield {kind: 'directory', name: 'allowed', async *values() {
      yield {kind: 'file', name: 'known.txt', async getFile() {return {size: 9};}};
      yield {kind: 'directory', name: 'blocked', async *values() {throw new Error('Must not be entered');}};
    }};
  }};
  const index = await Core.scanHandle(handle, {options: {maxDepth: 1}});
  const summary = index.depthSummary();
  assert.equal(summary.maxDepth, 1);
  assert.equal(summary.observedMaxDepth, 2);
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.deepestDirectoryIds.map(id => index.path(id, false, '/')), ['allowed']);
  const levels = new Map(summary.levels.map(level => [level.depth, level]));
  assert.equal(levels.get(1).directories, 1);
  assert.equal(levels.get(2).directories, 1);
  assert.equal(levels.get(2).files, 1);
  assert.equal(levels.get(2).bytes, 9);
});

test('empty root has depth zero and no deepest non-root directory', async () => {
  const index = await Core.scanHandle({kind: 'directory', name: 'root', async *values() {}});
  const summary = index.depthSummary();
  assert.equal(summary.maxDepth, 0);
  assert.equal(summary.observedMaxDepth, 0);
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.deepestDirectoryIds, []);
  assert.equal(summary.levels.reduce((sum, level) => sum + level.directories + level.files + level.bytes, 0), 0);
});

test('invalid file metadata contributes a discovered file but no known bytes', async () => {
  const index = await Core.scanFiles([
    {webkitRelativePath: 'root/unknown.bin', size: NaN},
    {webkitRelativePath: 'root/good.bin', size: 4}
  ]);
  const summary = index.depthSummary();
  const level = summary.levels.find(row => row.depth === 1);
  assert.equal(level.files, 2);
  assert.equal(level.bytes, 4);
  assert.equal(summary.complete, false);
});
