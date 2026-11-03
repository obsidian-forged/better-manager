import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:`export * from './src/settings/config-files';export * from './src/settings/config-protection';export * from './src/settings/config-revision';`,resolveDir:process.cwd(),sourcefile:'config-file-tests.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
const module={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(module,module.exports);
const {ConfigFiles,ConfigProtection,ConfigConflictPaused,IncompleteConfigBundle,createConfigRevision,encodeConfig}=module.exports;
const hash=async text=>createHash('sha256').update(text).digest('hex');
const root='.obsidian/plugins/bpm';
function fixture(initial={name:'initial'},icons) {
    const files=new Map([[`${root}/data.json`,JSON.stringify(initial)]]),dirs=new Set(['.obsidian','.obsidian/plugins',root]);
    if(icons!==undefined){dirs.add(`${root}/data`);files.set(`${root}/data/icons.css`,icons);}
    const writes=[];let anchor;let anchorWrites=0;
    const adapter={exists:async path=>files.has(path)||dirs.has(path),read:async path=>{assert.ok(files.has(path),`missing ${path}`);return files.get(path);},
        write:async(path,text)=>{writes.push(path);files.set(path,text);},mkdir:async path=>{assert.ok(dirs.has(path.slice(0,path.lastIndexOf('/'))));dirs.add(path);},remove:async path=>{files.delete(path);},
        list:async path=>({files:[...files.keys()].filter(key=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/')),folders:[...dirs].filter(key=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/'))})};
    const local={read:()=>structuredClone(anchor),write:value=>{anchorWrites++;anchor=structuredClone(value);}};
    const io=new ConfigFiles(adapter,'.obsidian','bpm','device-a',hash,local);
    const store=new ConfigProtection(io,'device-a',hash);
    return{files,dirs,writes,adapter,local,io,store,anchor:()=>anchor,anchorWrites:()=>anchorWrites,publicWrites:()=>writes.filter(path=>!path.includes('/.bpm/'))};
}
test('startup snapshots cover related configuration, never recurse into themselves, and reuse unchanged copies',async()=>{
    const f=fixture({name:'initial'},'original icons');f.files.set('.obsidian/appearance.json','{"theme":"dark"}');
    await f.io.backupStartup();const first=f.writes.length;await f.io.backupStartup();
    assert.equal(f.writes.length,first);assert.equal(f.publicWrites().length,0);assert.equal(f.anchorWrites(),0);
    const manifest=JSON.parse([...f.files].find(([path])=>path.includes('/startup/'))[1]);
    assert.ok(manifest.files['appearance.json']);assert.ok(manifest.files['plugins/bpm/data/icons.css']);
    assert.equal(Object.keys(manifest.files).some(path=>path.includes('/.bpm/')),false);
});
test('editing commits a primary revision once and leaves unchanged auxiliary files untouched',async()=>{
    const f=fixture({name:'initial'},'icons');const value=await f.store.load();f.store.begin(value);value.name='edited';await f.store.stage(value);
    assert.equal(f.publicWrites().length,0);
    await f.store.finish(value,f.store.current.files,()=>true);
    assert.deepEqual(f.publicWrites(),[`${root}/data.json`]);
    const raw=JSON.parse(f.files.get(`${root}/data.json`));assert.equal(raw._bpmRevision.generation,1);
    const count=f.writes.length,anchors=f.anchorWrites();await f.io.writeHead(f.store.current);
    assert.equal(f.writes.length,count);assert.equal(f.anchorWrites(),anchors);
});
test('auxiliary changes precede the primary marker and are covered by its digest',async()=>{
    const f=fixture({name:'initial'},'old icons');const value=await f.store.load();f.store.begin(value);f.store.stageFile('data/icons.css','new icons',true);await f.store.stage(value);
    const digests={...f.store.current.files,...await f.io.fileDigests(f.store.pendingFiles)};
    await f.store.finish(value,digests,()=>true);
    assert.deepEqual(f.publicWrites(),[`${root}/data/icons.css`,`${root}/data.json`]);
    assert.equal(f.store.current.files['data/icons.css'],await hash('new icons'));
});
test('partially synced auxiliary files cannot be accepted as a complete configuration',async()=>{
    const f=fixture({name:'initial'},'old icons');await f.store.load();
    const remote=await createConfigRevision({name:'remote'},'device-b',[f.store.current],{'data/icons.css':await hash('new icons')},hash);
    f.files.set(`${root}/data.json`,JSON.stringify(encodeConfig(remote)));
    await assert.rejects(f.io.readShared(),IncompleteConfigBundle);assert.equal(f.publicWrites().length,0);
    f.files.set(`${root}/data/icons.css`,'new icons');assert.equal((await f.io.readShared()).id,remote.id);
});
test('trusted snapshot corruption is rejected against the local-only anchor',async()=>{
    const f=fixture();await f.store.load();const id=f.anchor().head;
    f.files.set(`${root}/.bpm/device-a/states/${id}.json`,'{"owner":"device-b"}');
    const reopened=new ConfigFiles(f.adapter,'.obsidian','bpm','device-a',hash,f.local);
    await assert.rejects(reopened.readHead(),/Invalid BPM recovery/);assert.equal(f.publicWrites().length,0);
});
test('conflicts and their file copies survive a new instance without shared writes',async()=>{
    const f=fixture();const value=await f.store.load();f.store.begin(value);value.name='local';await f.store.stage(value);
    const remote=await createConfigRevision({name:'remote'},'device-b',[f.store.current],{},hash);f.files.set(`${root}/data.json`,JSON.stringify(encodeConfig(remote)));
    await assert.rejects(f.store.finish(value,{},()=>true),ConfigConflictPaused);
    const reopened=new ConfigProtection(new ConfigFiles(f.adapter,'.obsidian','bpm','device-a',hash,f.local),'device-a',hash);
    const recovered=await reopened.load();assert.equal(reopened.paused,true);assert.equal(recovered.name,'local');assert.equal(reopened.conflict.incoming.value.name,'remote');assert.equal(f.publicWrites().length,0);
});
test('a private transaction keeps enough information to finish after a primary write failure',async()=>{
    const f=fixture({name:'initial'},'old icons');const value=await f.store.load();f.store.begin(value);value.name='edited';f.store.stageFile('data/icons.css','new icons',true);await f.store.stage(value);
    const realWrite=f.adapter.write;f.adapter.write=async(path,text)=>{if(path===`${root}/data.json`)throw Error('disk busy');return realWrite(path,text);};
    const digests={...f.store.current.files,...await f.io.fileDigests(f.store.pendingFiles)};
    await assert.rejects(f.store.finish(value,digests,()=>true),/disk busy/);
    assert.equal(f.files.get(`${root}/data/icons.css`),'new icons');assert.equal(JSON.parse(f.files.get(`${root}/data.json`)).name,'initial');assert.ok(f.anchor().transaction);
    f.adapter.write=realWrite;await f.store.finish(value,digests,()=>true);
    assert.equal(JSON.parse(f.files.get(`${root}/data.json`)).name,'edited');assert.equal(f.store.current.revision.generation,1);assert.equal(f.anchor().transaction,undefined);
});
test('a sync JSON merge with an unchanged marker preserves the input and creates a selectable conflict',async()=>{
    const f=fixture();const value=await f.store.load();f.store.begin(value);value.name='accepted';await f.store.finish(value,{},()=>true);
    const raw=JSON.parse(f.files.get(`${root}/data.json`));raw.name='foreign merged edit';f.files.set(`${root}/data.json`,JSON.stringify(raw));
    const before=f.publicWrites().length;const incoming=await f.io.readShared();await f.store.observe(incoming,value);
    assert.equal(f.store.paused,true);assert.equal(f.store.conflict.incoming.value.name,'foreign merged edit');
    assert.equal(f.publicWrites().length,before);assert.ok([...f.files.keys()].some(path=>path.includes('/unverified/')));
    f.store.choose(value,{});await f.store.finish(value,{},()=>true);assert.equal(f.store.current.value.name,'accepted');
});
test('the same stale revision is repaired at most once across restarts',async()=>{
    const f=fixture();const original=f.files.get(`${root}/data.json`),value=await f.store.load();f.store.begin(value);value.name='new';await f.store.finish(value,{},()=>true);
    f.files.set(`${root}/data.json`,original);await f.store.finish(value,{},()=>true);
    const count=f.publicWrites().length;f.files.set(`${root}/data.json`,original);
    const reopened=new ConfigProtection(new ConfigFiles(f.adapter,'.obsidian','bpm','device-a',hash,f.local),'device-a',hash);
    const recovered=await reopened.load();await reopened.finish(recovered,{},()=>true);
    assert.equal(reopened.paused,true);assert.equal(reopened.conflict.reason,'stale-replayed');assert.equal(f.publicWrites().length,count);
});
test('consumed legacy recovery caches are not imported again on the next startup',async()=>{
    const f=fixture();const legacy=`${root}/data-device-a.cache`;
    f.files.set(legacy,JSON.stringify({version:1,owner:'device-a',base:{name:'initial'},value:{name:'edited'}}));
    await f.io.backupStartup();const value=await f.store.load();assert.equal(value.name,'edited');
    await f.store.finish(value,{},()=>true);assert.equal(f.files.has(legacy),false);
    const reopened=new ConfigFiles(f.adapter,'.obsidian','bpm','device-a',hash,f.local);assert.equal(await reopened.readDraft(),undefined);
});
