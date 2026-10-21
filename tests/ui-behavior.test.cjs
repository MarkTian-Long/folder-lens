'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const loadUI=require('./helpers/load-ui.cjs');
const fixtures=[
  {webkitRelativePath:'root/root.txt',size:3,lastModified:1700000000000},
  {webkitRelativePath:'root/folder2/eq2.bin',size:11,lastModified:1700000000000},
  {webkitRelativePath:'root/folder2/deep/eq10.bin',size:11,lastModified:1700000000001},
  {webkitRelativePath:'root/folder10/big.bin',size:1000,lastModified:1700000000002},
  {webkitRelativePath:'root/folder10/zero',size:0,lastModified:1700000000003}
];
async function setup(t,files=fixtures){
  const app=loadUI();t.after(app.cleanup);
  await app.runScan((signal,onProgress)=>app.Core.scanFiles(files,{signal,onProgress,mode:'demo'}));
  assert.ok(app.S.index,'The complete shipped UI script must start and accept a scan.');
  return app;
}
test('shipped UI initializes and matches known totals and depth display',async t=>{
  const app=await setup(t);
  assert.equal(app.S.index.nodes[0].size,1025);
  assert.equal(app.S.index.goodFiles,5);
  assert.equal(app.S.index.depthSummary().observedMaxDepth,2);
  assert.match(app.elements.get('#stat-depth').textContent,/2/);
});
test('directory sorting is numeric and repeated filters reuse the sorted snapshot',async t=>{
  const app=await setup(t);app.S.sort='name';app.S.order=1;
  const ordered=app.orderedRows(),again=app.orderedRows();
  assert.strictEqual(ordered,again);
  const names=Array.from(ordered,id=>app.S.index.nodes[id].name);
  assert.deepEqual(names,['folder2','folder10','root.txt']);
  app.S.query='folder10';
  assert.deepEqual(Array.from(app.filteredRows(),id=>app.S.index.nodes[id].name),['folder10']);
  assert.strictEqual(app.orderedRows(),ordered);
  assert.ok(app.S.sortedCache.size<=4);
});
test('whole-tree search and size filters match known independent expectations',async t=>{
  const app=await setup(t);app.S.scope='all';app.S.filter='files';app.S.query='.bin';
  assert.deepEqual(Array.from(app.filteredRows(),id=>app.S.index.nodes[id].name),['big.bin','eq2.bin','eq10.bin']);
  app.S.query='deep';
  assert.deepEqual(Array.from(app.filteredRows(),id=>app.S.index.nodes[id].name),['eq10.bin']);
  app.S.filter='1g';app.S.query='';
  assert.deepEqual(Array.from(app.filteredRows()),[]);
});
test('depth drill-down shows exactly that path level and minimum-depth filters work',async t=>{
  const app=await setup(t);app.showDepth(2);
  assert.equal(app.S.view,'folder');assert.equal(app.S.scope,'all');assert.equal(app.S.depthFilter,'2');
  const rows=app.filteredRows();assert.equal(rows.length,4);
  assert.ok(Array.from(rows,id=>app.S.index.nodes[id].depth).every(depth=>depth===2));
  assert.equal(app.matchesDepth(6,'6+'),true);assert.equal(app.matchesDepth(5,'6+'),false);
  assert.equal(app.matchesDepth(10,'10+'),true);assert.equal(app.matchesDepth(9,'10+'),false);
  assert.equal(app.matchesDepth(2,'2'),true);assert.equal(app.matchesDepth(3,'2'),false);
});
test('large-file view resets inherited name order and row recompute resets shift anchor',async t=>{
  const app=await setup(t);app.S.sort='name';app.S.order=1;app.S.lastClick=4;
  app.changeView('large');assert.equal(app.S.sort,'size');assert.equal(app.S.order,-1);
  assert.equal(app.S.index.nodes[app.S.rows[0]].name,'big.bin');
  app.S.lastClick=4;app.renderRows(true);assert.equal(app.S.lastClick,-1);
});
test('navigation and view changes stay locked while picking or exporting',async t=>{
  const app=await setup(t);const folder=app.S.index.nodes.find(n=>n.name==='folder2');
  for(const key of ['exporting','picking']){
    app.S[key]=true;app.navigate(folder.id);app.changeView('depth');
    assert.equal(app.S.current,0);assert.equal(app.S.view,'folder');
    app.S[key]=false;
  }
});
test('CSV item, type and depth rows have exactly the header width and known bytes',async t=>{
  const app=await setup(t),i=app.S.index;
  const context={index:i,rootPath:'',base:['demo','complete','start','end'],discoveredCounts:app.discoveredFileCounts(i)};
  for(const node of i.nodes.slice(1)){
    const values=app.exportValues(node.id,'items',context);assert.equal(values.length,app.CSV_COLUMNS.length);
    assert.ok(values.includes(node.depth),'Item CSV includes the actual path depth.');
  }
  for(const type of i.types())assert.equal(app.exportValues(type,'types',context).length,app.CSV_COLUMNS.length);
  const levels=i.depthSummary().levels;
  for(const level of levels)assert.equal(app.exportValues(level,'depth',context).length,app.CSV_COLUMNS.length);
  assert.equal(levels.reduce((n,x)=>n+x.bytes,0),1025);
});
test('downloaded CSV contains every filtered row across pagination and quotes names safely',async t=>{
  const files=Array.from({length:125},(_,n)=>({webkitRelativePath:'root/f'+n+'.txt',size:1}));
  files.push({webkitRelativePath:'root/=SUM(1,1).txt',size:7});
  const app=await setup(t,files);app.changeView('large');
  assert.equal(app.S.pageRows.length,100);
  await app.doExport('view');
  assert.equal(app.blobs.length,1);assert.equal(app.downloads.length,1);
  const csv=await app.blobs[0].text(),lines=csv.replace(/^\ufeff/,'').trimEnd().split('\r\n');
  assert.equal(lines.length,127,'Header plus all 126 rows, not only the visible page.');
  assert.ok(csv.includes('"\'=SUM(1,1).txt"'));
});

test('LRU stays bounded and candidate additions and removals invalidate cached rows',async t=>{
  const app=await setup(t);
  for(const key of ['size','name','modified'])for(const order of [1,-1]){
    app.S.sort=key;app.S.order=order;app.orderedRows();assert.ok(app.S.sortedCache.size<=4);
  }
  app.S.view='candidates';assert.equal(app.orderedRows().length,0);
  const folder=app.S.index.nodes.find(n=>n.name==='folder2');
  app.S.view='folder';app.S.selected.add(folder.id);app.candidatesAction();
  app.S.view='candidates';assert.deepEqual(Array.from(app.orderedRows()),[folder.id]);
  app.S.selected.add(folder.id);app.candidatesAction();
  assert.equal(app.orderedRows().length,0);
});

test('partial CSV separates unknown size, discovered files and successfully read files',async t=>{
  const app=await setup(t,[{webkitRelativePath:'root/folder/good.bin',size:4},{webkitRelativePath:'root/folder/unknown.bin',size:NaN}]);
  const i=app.S.index,context={index:i,rootPath:'',base:['compat','partial','start','end'],discoveredCounts:app.discoveredFileCounts(i)};
  const unread=i.nodes.find(n=>n.name==='unknown.bin'),directory=i.nodes.find(n=>n.name==='folder');
  const values=app.exportValues(unread.id,'items',context);
  assert.equal(values[app.CSV_COLUMNS.indexOf('逻辑大小（字节）')],'');
  assert.match(values[app.CSV_COLUMNS.indexOf('显示大小')],/未知/);
  const group=app.exportValues(directory.id,'items',context);
  assert.equal(group[app.CSV_COLUMNS.indexOf('已发现文件数')],2);
  assert.equal(group[app.CSV_COLUMNS.indexOf('已读文件数')],1);
});

test('CSV preserves epoch and negative dates while invalid dates never abort the download',async t=>{
  const times=[0,-86400000,1700000000000,Number.MAX_SAFE_INTEGER];
  const app=await setup(t,times.map((lastModified,n)=>({webkitRelativePath:'root/time'+n,size:1,lastModified})));
  const i=app.S.index,context={index:i,rootPath:'',base:['demo','complete','start','end'],discoveredCounts:app.discoveredFileCounts(i)};
  const dates=i.fileIds.map(id=>app.exportValues(id,'items',context)[app.CSV_COLUMNS.indexOf('修改时间')]);
  assert.deepEqual(Array.from(dates),['1970-01-01T00:00:00.000Z','1969-12-31T00:00:00.000Z','2023-11-14T22:13:20.000Z','']);
  await app.doExport('files');assert.equal(app.downloads.length,1);
});
