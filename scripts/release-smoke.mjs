// Validate exact release artifacts, including an old -> new installation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [currentArg, oldArg] = process.argv.slice(2);
if (!currentArg || !oldArg) throw Error('Usage: node scripts/release-smoke.mjs current.tgz previous.tgz');
const current=path.resolve(currentArg), old=path.resolve(oldArg);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'piloop-release-'));
const npmCmd=process.platform==='win32'?execFileSync('where.exe',['npm.cmd'],{encoding:'utf8'}).trim().split(/\r?\n/)[0]:null;
const npm=(args)=>execFileSync(npmCmd?process.execPath:'npm',npmCmd?[path.join(path.dirname(npmCmd),'node_modules/npm/bin/npm-cli.js'),...args]:args,{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const data=path.join(root,'data'); fs.mkdirSync(path.join(data,'agent'),{recursive:true});
const pref=path.join(data,'agent','preferences.json');
fs.writeFileSync(pref,JSON.stringify([{id:'retained',scope:'*',text:'解释简洁',active:true}]));
const before=hash(pref);
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const modules=prefix=>path.join(prefix,process.platform==='win32'?'node_modules':'lib/node_modules','piloop');
const install=(prefix,artifact)=>npm(['install','--global','--prefix',prefix,artifact,'--no-audit','--no-fund']);
const verify=prefix=>{
 const installed=modules(prefix);const manifest=JSON.parse(fs.readFileSync(path.join(installed,'package.json'),'utf8'));
 assert.equal(manifest.version,pkg.version);
 for(const name of ['playwright','playwright-core','react','express'])assert.ok(!fs.existsSync(path.join(installed,'node_modules',name)));
 for(const folder of ['bin','lib/server'])for(const name of fs.readdirSync(path.join(installed,folder))){
   if(!name.endsWith('.js')&&!name.endsWith('.mjs'))continue;
   const target=path.join(installed,folder,name), source=path.resolve(folder,name);
   // npm normalizes the shebang line ending (only the first line) during installation.
   const expected=folder==='bin' && name==='piloop.mjs'
     ? createHash('sha256').update(fs.readFileSync(source,'utf8').replace(/^(#![^\r\n]*)\r\n/,'$1\n')).digest('hex') : hash(source);
   assert.equal(hash(target),expected,`Installed bytes differ: ${folder}/${name}`);
 }
 const launcher=path.join(installed,'bin/piloop.mjs');
 const run=args=>execFileSync(process.execPath,[launcher,...args],{cwd:root,input:'',encoding:'utf8',timeout:120000,env:{...process.env,PILOOP_DATA_DIR:data,PILOOP_NO_UPDATE_CHECK:'1'}});
 assert.equal(run(['--version']).trim(),pkg.version);assert.match(run(['--help']),/piloop update/);run([]);
 assert.equal(hash(pref),before);
};
try{
 const clean=path.join(root,'clean');install(clean,current);verify(clean);console.log('Exact artifact: clean install/startup and module hashes passed.');
 const upgraded=path.join(root,'upgrade');install(upgraded,old);assert.equal(JSON.parse(fs.readFileSync(path.join(modules(upgraded),'package.json'),'utf8')).version,'0.1.3');
 install(upgraded,current);verify(upgraded);console.log('Exact artifact: 0.1.3 -> '+pkg.version+' upgrade, preserved preferences and module hashes passed.');
 console.log('SHA256',hash(current));
}finally{
 if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('piloop-release-'))throw Error('unsafe cleanup');
 fs.rmSync(root,{recursive:true,force:true});
}
