import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { checkUpdate, isNewerVersion, RELEASE_API } from "../server/updates.js";
import { resolveDataDir } from "../bin/data-dir.mjs";

test("stable release comparison rejects downgrade and malformed tags", () => {
  assert.equal(isNewerVersion("v0.10.0","0.9.9"),true);
  for (const tag of ["v0.1.0","0.0.9","v0.2.0-beta","garbage"])
    assert.equal(isNewerVersion(tag,"0.1.0"),false);
});
test("update checks cache a usable release for an hour; offline launch does not postpone retries", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"piloop-update-"));
  let calls = 0;
  const request: typeof fetch = async input => {
    assert.equal(input,RELEASE_API);calls++;
    return new Response(JSON.stringify({tag_name:"v0.2.0",assets:[{name:"piloop.tgz"}]}));
  };
  try {
    assert.equal(await checkUpdate(dir,"0.1.0",request,1000),"v0.2.0");
    assert.equal(await checkUpdate(dir,"0.1.0",request,2000),"v0.2.0");
    assert.equal(calls,1);
    assert.equal(await checkUpdate(dir,"0.2.0",request,2000),undefined);
    await checkUpdate(dir,"0.1.0",request,3601001);assert.equal(calls,2);
    assert.equal(await checkUpdate(dir,"0.1.0",async()=>{throw new Error("offline");},7202000),"v0.2.0");
    await checkUpdate(dir,"0.1.0",request,7202001);assert.equal(calls,3);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test("configuration survives moving installations; existing user data is not overwritten", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"piloop-config-"));
  const root = path.join(dir,"install"), home = path.join(dir,"home");
  const old = path.join(root,".piloop","agent");
  await fs.mkdir(old,{recursive:true});
  await fs.writeFile(path.join(old,"settings.json"),'old');
  try {
    const target=resolveDataDir(root,undefined,home);
    const settings=path.join(target,"agent","settings.json");
    assert.equal(await fs.readFile(settings,"utf8"),'old');
    await fs.writeFile(settings,'new');
    resolveDataDir(root,undefined,home);
    assert.equal(await fs.readFile(settings,"utf8"),'new');
    assert.equal(resolveDataDir(path.join(dir,"next-install"),undefined,home),target);
    assert.equal(resolveDataDir(root,path.join(dir,"override"),home),path.join(dir,"override"));
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
