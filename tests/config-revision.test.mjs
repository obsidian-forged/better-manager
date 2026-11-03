import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const compiled = await build({entryPoints:['src/settings/config-revision.ts'], bundle:true, platform:'node', format:'cjs', write:false, logLevel:'silent'});
const module = {exports:{}};
new Function('module','exports',compiled.outputFiles[0].text)(module,module.exports);
const {decodeConfig,createConfigRevision,compareConfig,encodeConfig,sameConfigContent} = module.exports;
const hash = async text => createHash('sha256').update(text).digest('hex');
test('simultaneous generation numbers never decide which configuration wins', async () => {
    const base = await decodeConfig({name:'base'},hash);
    const left = await createConfigRevision({name:'left'},'device-a',[base],{},hash);
    const right = await createConfigRevision({name:'right'},'device-b',[base],{},hash);
    assert.equal(left.revision.generation,right.revision.generation);
    assert.equal(compareConfig(left,right),'conflict');
    assert.equal(compareConfig(left,base),'ancestor');
    assert.equal(compareConfig(base,left),'descendant');
});
test('semantic equality ignores object order and does not require a new revision', async () => {
    const base = await decodeConfig({a:1,b:2},hash);
    const reordered = await decodeConfig({b:2,a:1},hash);
    assert.equal(compareConfig(base,reordered),'same');
    const next = await createConfigRevision({a:1,b:2},'device-a',[base],{},hash);
    assert.equal(sameConfigContent(next,base),true);
});
test('hashes match persisted JSON and snapshots do not share mutable UI values', async () => {
    const value = {nested:{enabled:true,optional:undefined},items:[undefined]};
    const base = await decodeConfig(value,hash);
    const next = await createConfigRevision(value,'device-a',[base],{},hash);
    const disk = await decodeConfig(JSON.parse(JSON.stringify(encodeConfig(next))),hash);
    value.nested.enabled=false;
    assert.equal(disk.digest,next.digest);
    assert.equal(next.value.nested.enabled,true);
    assert.deepEqual(next.value.items,[null]);
});
test('synced JSON merges, corrupt hashes and forged ancestry are rejected', async () => {
    const base = await decodeConfig({name:'base'},hash);
    const next = await createConfigRevision({name:'next'},'device-a',[base],{},hash);
    const merged = {...encodeConfig(next),name:'other device'};
    await assert.rejects(decodeConfig(merged,hash),/does not match/);
    const forged = encodeConfig(next);forged._bpmRevision={...forged._bpmRevision,generation:99};
    await assert.rejects(decodeConfig(forged,hash),/ancestry/);
});
test('explicit conflict resolution creates a child of both preserved versions', async () => {
    const base = await decodeConfig({name:'base'},hash);
    const left = await createConfigRevision({name:'left'},'device-a',[base],{},hash);
    const right = await createConfigRevision({name:'right'},'device-b',[base],{},hash);
    const resolution = await createConfigRevision(left.value,'device-a',[left,right],{},hash);
    assert.equal(compareConfig(left,resolution),'descendant');
    assert.equal(compareConfig(right,resolution),'descendant');
});
test('auxiliary configuration digests participate in identity and reject unsafe file paths', async () => {
    const base = await decodeConfig({name:'base'},hash);
    const left = await createConfigRevision(base.value,'device-a',[base],{'data/icons.css':await hash('a')},hash);
    const right = await createConfigRevision(base.value,'device-b',[base],{'data/icons.css':await hash('b')},hash);
    assert.equal(compareConfig(left,right),'conflict');
    await assert.rejects(createConfigRevision(base.value,'device-a',[base],{'../secret':await hash('a')},hash),/does not match/);
});
