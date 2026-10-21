'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
function isAllowedReleasePath(name) {
  if (typeof name!=='string' || !name || name.includes('\\') || name.includes(':') || path.posix.isAbsolute(name)) return false;
  const parts=name.split('/');
  if(parts.some(part=>!part || part==='.' || part==='..' || ['.local','.git','node_modules','exports','.aws','.ssh'].includes(part.toLowerCase()) || part.toLowerCase()==='.env' || part.toLowerCase().startsWith('.env.'))) return false;
  return !/\.(?:csv|log)$/i.test(name);
}
module.exports={isAllowedReleasePath};
if(require.main===module) {
const root = path.resolve(__dirname,'..');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'release-files.json'),'utf8'));
assert.equal(manifest.schema_version,1);
assert.equal(new Set(manifest.files).size,manifest.files.length);
const entries = manifest.files.map(name=>{
  assert.ok(isAllowedReleasePath(name), 'Unsafe/private/runtime release member: '+name);
  const full = path.resolve(root,name);
  assert.ok(full.startsWith(root+path.sep));
  const data = fs.readFileSync(full), text = data.toString('utf8');
  assert.ok(!text.includes(String.fromCharCode(0)), 'Only reviewed UTF-8 text is distributed.');
  assert.ok(!/[A-Z]:[\\/](?:Users|个人|工作)[\\/]/i.test(text), 'Local absolute path in release member: '+name);
  assert.ok(!/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-proj-[A-Za-z0-9_-]{20,})\b/.test(text),'Credential pattern in '+name);
  return {path:name,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),git_blob_sha:crypto.createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex')};
});
const out = {schema_version:1,version:manifest.version,repository:manifest.repository,visibility:'public',license:'MIT',files:entries};
fs.mkdirSync(path.join(root,'.local'),{recursive:true});
fs.writeFileSync(path.join(root,'.local','release-plan.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({version:out.version,reviewedFiles:entries.length,totalBytes:entries.reduce((n,x)=>n+x.bytes,0),privateFilesIncluded:false},null,2));
}
