'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const PREFIX = 'folderlens-test-';

async function createFixture(t, {directories = [], files = []} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX));
  const absoluteRoot = path.resolve(root);
  function inside(relative) {
    const target = path.resolve(root, ...relative.split('/'));
    assert.ok(target === absoluteRoot || target.startsWith(absoluteRoot + path.sep),
      'Fixture paths must stay inside the generated temporary directory');
    return target;
  }
  t.after(async () => {
    // Recursive cleanup is restricted to this exact mkdtemp child of tmpdir.
    assert.equal(path.dirname(absoluteRoot), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absoluteRoot).startsWith(PREFIX));
    await fs.rm(absoluteRoot, {recursive: true, force: true});
  });
  for (const directory of directories) await fs.mkdir(inside(directory), {recursive: true});
  for (const {name, bytes} of files) {
    assert.ok(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 65536);
    const filename = inside(name);
    await fs.mkdir(path.dirname(filename), {recursive: true});
    await fs.writeFile(filename, Buffer.alloc(bytes, 0x61));
  }
  return root;
}

// An independent filesystem walk is the oracle. It uses no FolderLens methods,
// and records every directory, including empty directories.
async function inspectFixture(root) {
  const records = new Map();
  async function walk(relative, depth) {
    const absolute = path.join(root, ...relative.split('/').filter(Boolean));
    const stat = await fs.stat(absolute);
    if (!stat.isDirectory()) {
      const record = {dir: false, depth, size: stat.size, files: 1, dirs: 0};
      records.set(relative, record);
      return record;
    }
    const record = {dir: true, depth, size: 0, files: 0, dirs: 0};
    records.set(relative, record);
    const children = await fs.readdir(absolute);
    for (const name of children) {
      const child = await walk(relative ? relative + '/' + name : name, depth + 1);
      record.size += child.size;
      record.files += child.files;
      record.dirs += child.dirs + Number(child.dir);
    }
    return record;
  }
  await walk('', 0);
  return records;
}

function filesystemHandle(root, metrics = {metadataReads: 0, contentReads: 0}) {
  const absoluteRoot = path.resolve(root);
  function assertInside(absolute) {
    const target = path.resolve(absolute);
    assert.ok(target === absoluteRoot || target.startsWith(absoluteRoot + path.sep));
  }
  function makeHandle(absolute, directory) {
    assertInside(absolute);
    if (directory) return {
      kind: 'directory', name: path.basename(absolute),
      async *values() {
        assertInside(absolute);
        const entries = await fs.readdir(absolute, {withFileTypes: true});
        for (const entry of entries) {
          assert.ok(entry.isDirectory() || entry.isFile(), 'Fixtures do not contain links');
          yield makeHandle(path.join(absolute, entry.name), entry.isDirectory());
        }
      }
    };
    return {
      kind: 'file', name: path.basename(absolute),
      async getFile() {
        assertInside(absolute);
        const stat = await fs.stat(absolute);
        metrics.metadataReads++;
        const forbidden = () => { metrics.contentReads++; throw new Error('File contents must not be read'); };
        return {size: stat.size, lastModified: stat.mtimeMs,
          text: forbidden, stream: forbidden, arrayBuffer: forbidden};
      }
    };
  }
  return makeHandle(absoluteRoot, true);
}

async function compatibilityFiles(root, records) {
  const result = [];
  for (const [relative, record] of records) {
    if (record.dir) continue;
    const stat = await fs.stat(path.join(root, ...relative.split('/')));
    result.push({name: path.posix.basename(relative),
      webkitRelativePath: path.basename(root) + '/' + relative,
      size: stat.size, lastModified: stat.mtimeMs});
  }
  return result;
}

function compatibleOracle(records) {
  const retained = new Map([...records].filter(([relative, record]) =>
    !record.dir || relative === '' || record.files > 0));
  const result = new Map();
  for (const [relative, record] of retained) {
    const prefix = relative ? relative + '/' : '';
    const dirs = record.dir ? [...retained].filter(([candidate, child]) =>
      child.dir && candidate !== relative && candidate.startsWith(prefix)).length : 0;
    result.set(relative, {...record, dirs});
  }
  return result;
}

function compareIndex(index, expected) {
  assert.equal(index.nodes.length, expected.size, 'All and only expected filesystem items must be present');
  for (const node of index.nodes) {
    const relative = index.path(node.id, false, '/');
    const want = expected.get(relative);
    assert.ok(want, `Unexpected result path: ${relative}`);
    for (const field of ['dir', 'depth', 'size', 'files', 'dirs']) {
      assert.equal(node[field], want[field], `${relative || '(root)'}: ${field}`);
    }
    assert.equal(node.complete, true, `${relative || '(root)'} must be fully processed`);
    assert.equal(node.readable, true, `${relative || '(root)'} must be readable`);
  }
  assert.equal(index.totalBytes, expected.get('').size);
  assert.equal(index.goodFiles, expected.get('').files);
  assert.equal(index.issueCount, 0);
  assert.equal(index.status, 'complete');
}

function expectedTypes(records) {
  const result = new Map();
  for (const [relative, record] of records) {
    if (record.dir) continue;
    const suffix = path.posix.extname(relative);
    const extension = suffix === '.' ? '' : suffix.toLowerCase();
    const group = result.get(extension) || {size: 0, files: 0};
    group.size += record.size;
    group.files++;
    result.set(extension, group);
  }
  return result;
}

module.exports = {createFixture, inspectFixture, filesystemHandle,
  compatibilityFiles, compatibleOracle, compareIndex, expectedTypes};
