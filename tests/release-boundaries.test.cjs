'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {isAllowedReleasePath}=require('../scripts/release.cjs');
test('release paths exclude environment secrets, exports, caches and traversal on both platforms',()=>{
  for(const name of ['.env','.env.production','.env.local','config/.env.example','config/.ENV.PRODUCTION','.local/backup.html','.git/config','node_modules/a.json','exports/result.json','result.csv','result.LOG','../outside.txt','a/../../outside.txt','/absolute','C:/absolute','a\\..\\outside','a//b','a/./b','.aws/credentials','.ssh/config']){
    assert.equal(isAllowedReleasePath(name),false,name);
  }
  for(const name of ['FolderLens.html','README.md','README.en.md','LICENSE','.gitignore','.gitattributes','.github/workflows/ci.yml','tests/helpers/fixture.cjs','release-files.json']){
    assert.equal(isAllowedReleasePath(name),true,name);
  }
});
