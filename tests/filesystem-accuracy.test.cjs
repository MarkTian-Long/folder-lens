'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const loadCore = require('./helpers/load-core.cjs');
const {createFixture, inspectFixture, filesystemHandle, compatibilityFiles,
  compatibleOracle, compareIndex, expectedTypes} = require('./helpers/fixture.cjs');

const Core = loadCore();
const deepDirectory = Array.from({length: 12}, (_, index) => '层' + (index + 1)).join('/');
const knownFixture = {
  directories: ['空目录', '含 空格/嵌套空目录', deepDirectory + '/末端空目录'],
  files: [
    {name: 'root.txt', bytes: 1}, {name: 'zero.bin', bytes: 0},
    {name: '中文 文件夹/文稿 01.TXT', bytes: 37},
    {name: '中文 文件夹/a & b [test] #.json', bytes: 223},
    {name: '含 空格/.env', bytes: 19}, {name: '含 空格/README', bytes: 17},
    {name: '含 空格/archive.tar.GZ', bytes: 511},
    {name: '含 空格/=SUM(1,1).txt', bytes: 13},
    {name: "含 空格/quote' name.csv", bytes: 23},
    {name: deepDirectory + '/终点.dat', bytes: 1024}
  ]
};

function compareTypes(index, records) {
  const actual = new Map(index.types().map(group => [group.ext,
    {size: group.size, files: group.files}]));
  assert.deepEqual(actual, expectedTypes(records));
}

test('native adapter matches independent filesystem totals at every directory', async t => {
  const root = await createFixture(t, knownFixture);
  const oracle = await inspectFixture(root);
  const metrics = {metadataReads: 0, contentReads: 0};
  const index = await Core.scanHandle(filesystemHandle(root, metrics));
  compareIndex(index, oracle);
  compareTypes(index, oracle);
  assert.equal(metrics.metadataReads, knownFixture.files.length);
  assert.equal(metrics.contentReads, 0);
  assert.equal(index.nodes[0].size, knownFixture.files.reduce((sum, file) => sum + file.bytes, 0));
  assert.equal(index.nodes.find(node => node.name === '空目录').size, 0);
  assert.equal(index.nodes.find(node => node.name === 'zero.bin').readable, true);
});

test('compatibility mode matches file-bearing directories and explicitly omits empty directories', async t => {
  const root = await createFixture(t, knownFixture);
  const fullOracle = await inspectFixture(root);
  const oracle = compatibleOracle(fullOracle);
  const index = await Core.scanFiles(await compatibilityFiles(root, fullOracle));
  compareIndex(index, oracle);
  compareTypes(index, fullOracle);
  assert.ok(index.directoryIds.length < [...fullOracle.values()].filter(record => record.dir).length);
  assert.equal(index.nodes.some(node => node.name === '空目录'), false);
  assert.equal(index.nodes.some(node => node.name === '嵌套空目录'), false);
});

function randomFixture(seed) {
  const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const files = [];
  for (let index = 0; index < 80; index++) {
    const depth = next() % 7;
    const parts = Array.from({length: depth}, () => '组' + next() % 5);
    const extension = ['.txt', '.TXT', '.bin', '.json', '', '.tar.gz'][next() % 6];
    parts.push('文件 ' + index + extension);
    files.push({name: parts.join('/'), bytes: next() % 8193});
  }
  return {directories: ['随机空目录', '只有空目录/下层'], files};
}

test('fixed-seed randomized filesystem trees agree in native and compatibility modes', async t => {
  for (const seed of [1, 20261021, 0xdeadbeef, 0xffffffff]) {
    await t.test('seed ' + seed, async child => {
      const fixture = randomFixture(seed);
      const root = await createFixture(child, fixture);
      const oracle = await inspectFixture(root);
      const native = await Core.scanHandle(filesystemHandle(root));
      const compat = await Core.scanFiles(await compatibilityFiles(root, oracle));
      compareIndex(native, oracle);
      compareIndex(compat, compatibleOracle(oracle));
      compareTypes(native, oracle);
      compareTypes(compat, oracle);
    });
  }
});
