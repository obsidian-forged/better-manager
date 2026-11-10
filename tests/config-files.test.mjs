import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:`export * from './src/settings/config-files';export * from './src/settings/config-protection';export * from './src/settings/config-revision';`,resolveDir:process.cwd(),sourcefile:'config-file-tests.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
const module={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(module,module.exports);
const {ConfigFiles,ConfigProtection,ConfigEditorReopened,ConfigDiskChanged,IncompleteConfigBundle,createConfigRevision,encodeConfig}=module.exports;
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
    await f.store.publish(value,f.store.current.files,()=>true);
    assert.deepEqual(f.publicWrites(),[`${root}/data.json`]);
    assert.equal(f.anchor().sharedEstablished,true);
    const raw=JSON.parse(f.files.get(`${root}/data.json`));assert.equal(raw._bpmRevision.generation,1);
    const count=f.writes.length,anchors=f.anchorWrites();await f.io.writeHead(f.store.current);
    assert.equal(f.writes.length,count);assert.equal(f.anchorWrites(),anchors);
});
test('auxiliary changes precede the primary marker and are covered by its digest',async()=>{
    const f=fixture({name:'initial'},'old icons');const value=await f.store.load();f.store.begin(value);f.store.stageFile('data/icons.css','new icons',true);await f.store.stage(value);
    const digests={...f.store.current.files,...await f.io.fileDigests(f.store.pendingFiles)};
    await f.store.publish(value,digests,()=>true);
    assert.deepEqual(f.publicWrites(),[`${root}/data/icons.css`,`${root}/data.json`]);
    assert.equal(f.store.current.files['data/icons.css'],await hash('new icons'));
});
test('shared write/delete registration covers auxiliary files and the primary marker before disk I/O',async()=>{
    const f=fixture({name:'initial'},'old icons'),registered=new Set(),events=[];
    const write=f.adapter.write,remove=f.adapter.remove;
    f.adapter.write=async(path,text)=>{if(!path.includes('/.bpm/'))assert.ok(registered.has(path));return write(path,text);};
    f.adapter.remove=async path=>{if(!path.includes('/.bpm/'))assert.ok(registered.has(path));return remove(path);};
    const io=new ConfigFiles(f.adapter,'.obsidian','bpm','device-a',hash,f.local,undefined,{
        write:async(path,text,action)=>{registered.add(path);events.push(['write',path]);try{await action();}finally{registered.delete(path);}},
        remove:async(path,action)=>{registered.add(path);events.push(['remove',path]);try{await action();}finally{registered.delete(path);}},
    });
    assert.deepEqual([...new Set(await io.sharedPaths())],[`${root}/data.json`,`${root}/data/icons.css`]);
    const store=new ConfigProtection(io,'device-a',hash),value=await store.load();store.begin(value);
    store.stageFile('data/icons.css',null,true);value.name='edited';await store.stage(value);
    const digests={...store.current.files,...await io.fileDigests(store.pendingFiles)};
    await store.publish(value,digests,()=>true);
    assert.ok(events.some(([kind,path])=>kind==='remove'&&path===`${root}/data/icons.css`));
    assert.ok(events.some(([kind,path])=>kind==='write'&&path===`${root}/data.json`));
    assert.equal(f.files.has(`${root}/data/icons.css`),false);
});
test('partially synced auxiliary files cannot be accepted as a complete configuration',async()=>{
    const f=fixture({name:'initial'},'old icons');await f.store.load();
    const remote=await createConfigRevision({name:'remote'},'device-b',[f.store.current],{'data/icons.css':await hash('new icons')},hash);
    f.files.set(`${root}/data.json`,JSON.stringify(encodeConfig(remote)));
    await assert.rejects(f.io.readShared(),IncompleteConfigBundle);assert.equal(f.publicWrites().length,0);
    f.files.set(`${root}/data/icons.css`,'new icons');assert.equal((await f.io.readShared()).id,remote.id);
});
const devicePath = 'data/devices/phone.json';
const deviceText = (lastSeen, fields = {}) => JSON.stringify({ id: 'phone', name: 'Phone', type: 'phone', platform: 'android', updatedAt: 1, lastSeen, ...fields });
async function committedDeviceFixture() {
    const f = fixture({ name: 'initial' }, 'icons');
    f.dirs.add(`${root}/data/devices`);
    f.files.set(`${root}/${devicePath}`, deviceText(1));
    const value = await f.store.load(); f.store.begin(value); value.name = 'committed';
    await f.store.publish(value, f.store.current.files, () => true);
    f.writes.length = 0;
    return { ...f, value };
}
test('a trusted device heartbeat drift is a no-op without rewriting files or the revision', async () => {
    const f = await committedDeviceFixture(), id = f.store.current.id;
    const original = f.files.get(`${root}/data.json`), backup = f.files.get(`${root}/.bpm/device-a/states/${id}.json`);
    f.files.set(`${root}/${devicePath}`, deviceText(2));
    assert.equal((await f.store.publish(f.value, f.store.current.files, () => true)).status, 'noop');
    assert.equal(f.store.current.id, id); assert.equal(f.io.hasPendingBundle, false);
    assert.equal(f.files.get(`${root}/data.json`), original);
    assert.equal(f.files.get(`${root}/${devicePath}`), deviceText(2));
    assert.equal(f.files.get(`${root}/.bpm/device-a/states/${id}.json`), backup);
    assert.deepEqual(f.publicWrites(), []);
    const reopened = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
    assert.equal((await reopened.readShared()).id, id);
    assert.equal((await reopened.readHead()).id, id);
});
test('a real Save incorporates the latest heartbeat without rewriting its file and remains portable', async () => {
    const f = await committedDeviceFixture();
    f.files.set(`${root}/${devicePath}`, deviceText(5)); f.value.name = 'edited';
    assert.equal((await f.store.publish(f.value, f.store.current.files, () => true)).status, 'saved');
    assert.deepEqual(f.publicWrites(), [`${root}/data.json`]);
    assert.equal(f.store.current.files[devicePath], await hash(deviceText(5)));
    const fresh = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-new', hash, { read: () => undefined, write() {} });
    assert.equal((await fresh.readShared()).value.name, 'edited');
});
test('a selected device rename keeps only the latest heartbeat from disk', async () => {
    const f = await committedDeviceFixture();
    f.files.set(`${root}/${devicePath}`, deviceText(10));
    f.store.stageFile(devicePath, deviceText(1, { name: 'Renamed', type: 'tablet', updatedAt: 2 }), true);
    assert.equal((await f.store.publish(f.value, f.store.current.files, () => true)).status, 'saved');
    const saved = f.files.get(`${root}/${devicePath}`), device = JSON.parse(saved);
    assert.equal(device.name, 'Renamed'); assert.equal(device.type, 'tablet'); assert.equal(device.updatedAt, 2);
    assert.equal(device.lastSeen, 10); assert.equal(f.store.current.files[devicePath], await hash(saved));
});
test('a heartbeat arriving after preparation cannot be rolled back by a selected device rename', async () => {
    const f = await committedDeviceFixture();
    f.store.stageFile(devicePath, deviceText(1, { name: 'Renamed', updatedAt: 2 }), true);
    const write = f.adapter.write;
    f.adapter.write = async (path, text) => {
        await write(path, text);
        if (path.includes('/transactions/')) f.files.set(`${root}/${devicePath}`, deviceText(10));
    };
    await assert.rejects(f.store.publish(f.value, f.store.current.files, () => true), ConfigDiskChanged);
    f.adapter.write = write;
    assert.equal((await f.store.publish(f.value, f.store.current.files, () => true)).status, 'saved');
    const saved = JSON.parse(f.files.get(`${root}/${devicePath}`));
    assert.equal(saved.name, 'Renamed'); assert.equal(saved.updatedAt, 2); assert.equal(saved.lastSeen, 10);
    const reopened = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
    assert.equal((await reopened.readShared()).id, f.store.current.id);
    assert.equal((await reopened.readHead()).id, f.store.current.id);
    const fresh = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-new', hash, { read: () => undefined, write() {} });
    assert.equal((await fresh.readShared()).id, f.store.current.id);
});
test('lastSeen cannot hide a meaningful field change, invalid record or missing file', async () => {
    for (const text of [deviceText(2, { name: 'Renamed' }), deviceText(2, { type: 'tablet' }), deviceText(2, { platform: 'ios' }),
        deviceText(2, { updatedAt: 2 }), deviceText(2, { custom: true }), deviceText('invalid'), '{invalid', '[]', null]) {
        const f = await committedDeviceFixture();
        if (text === null) f.files.delete(`${root}/${devicePath}`); else f.files.set(`${root}/${devicePath}`, text);
        await assert.rejects(f.io.readShared(), error => error instanceof IncompleteConfigBundle
            && error.issues.some(issue => issue.path === devicePath && issue.kind === (text === null ? 'missing' : 'different')));
        assert.deepEqual(f.publicWrites(), []);
    }
});
test('a file expected to be deleted is reported separately and cannot pass the heartbeat exception', async () => {
    const f = await committedDeviceFixture(); f.store.stageFile(devicePath, null, true);
    await f.store.publish(f.value, f.store.current.files, () => true); f.writes.length = 0;
    f.files.set(`${root}/${devicePath}`, deviceText(10));
    await assert.rejects(f.io.readShared(), error => error instanceof IncompleteConfigBundle
        && error.issues.some(issue => issue.path === devicePath && issue.kind === 'unexpected'));
    assert.deepEqual(f.publicWrites(), []);
});
test('device metadata compatibility never exempts a mismatched CSS file', async () => {
    const f = await committedDeviceFixture();
    f.files.set(`${root}/${devicePath}`, deviceText(2)); f.files.set(`${root}/data/icons.css`, 'changed');
    await assert.rejects(f.io.readShared(), error => error instanceof IncompleteConfigBundle
        && error.issues.some(issue => issue.path === 'data/icons.css' && issue.kind === 'different'));
    assert.deepEqual(f.publicWrites(), []);
});
test('without the exact original snapshot a new device cannot guess the intended file contents', async () => {
    const f = await committedDeviceFixture(); f.files.set(`${root}/${devicePath}`, deviceText(2));
    const fresh = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-new', hash, { read: () => undefined, write() {} });
    await assert.rejects(fresh.readShared(), IncompleteConfigBundle); assert.deepEqual(f.publicWrites(), []);
});
test('heartbeat drift does not relax verification of immutable recovery snapshots', async () => {
    const f = await committedDeviceFixture(), path = `${root}/.bpm/device-a/states/${f.store.current.id}.json`;
    const state = JSON.parse(f.files.get(path)); state.files[devicePath] = deviceText(2); f.files.set(path, JSON.stringify(state));
    const reopened = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
    await assert.rejects(reopened.readHead(), IncompleteConfigBundle); assert.deepEqual(f.publicWrites(), []);
});
test('a heartbeat arriving during a commit is retained and the next startup still validates', async () => {
    const f = await committedDeviceFixture(); f.value.name = 'edited';
    const write = f.adapter.write;
    f.adapter.write = async (path, text) => {
        await write(path, text);
        if (path.includes('/transactions/')) f.files.set(`${root}/${devicePath}`, deviceText(10));
    };
    await assert.rejects(f.store.publish(f.value, f.store.current.files, () => true), ConfigDiskChanged);
    f.adapter.write = write;
    assert.equal((await f.store.publish(f.value, f.store.current.files, () => true)).status, 'saved');
    assert.equal(f.files.get(`${root}/${devicePath}`), deviceText(10));
    assert.deepEqual(f.publicWrites(), [`${root}/data.json`]);
    const reopened = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
    assert.equal((await reopened.readShared()).value.name, 'edited');
    assert.equal((await reopened.readHead()).value.name, 'edited');
    const fresh = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-new', hash, { read: () => undefined, write() {} });
    assert.equal((await fresh.readShared()).value.name, 'edited');
});
test('interrupted commits recover with heartbeat drift in the before/after files', async () => {
    const f = await committedDeviceFixture(); f.value.name = 'edited';
    f.store.stageFile('data/icons.css', 'new icons', true);
    const write = f.adapter.write;
    f.adapter.write = async (path, text) => {
        if (path === `${root}/data.json`) { f.files.set(`${root}/${devicePath}`, deviceText(10)); throw new Error('disk busy'); }
        await write(path, text);
    };
    await assert.rejects(f.store.publish(f.value, f.store.current.files, () => true), /disk busy/);
    f.adapter.write = write;
    const io = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
    await io.recoverPreparedCommit(); const store = new ConfigProtection(io, 'device-a', hash);
    const value = await store.load(); assert.equal(value.name, 'edited');
    assert.equal((await store.publish(value, store.current.files, () => true)).status, 'saved');
    assert.equal(f.files.get(`${root}/${devicePath}`), deviceText(10));
    assert.equal(store.current.files[devicePath], await hash(deviceText(10)));
    assert.equal(f.anchor().transaction, undefined);
});
test('trusted snapshot corruption is rejected against the local-only anchor',async()=>{
    const f=fixture();await f.store.load();const id=f.anchor().head;
    f.files.set(`${root}/.bpm/device-a/states/${id}.json`,'{"owner":"device-b"}');
    const reopened=new ConfigFiles(f.adapter,'.obsidian','bpm','device-a',hash,f.local);
    await assert.rejects(reopened.readHead(),/Invalid BPM recovery/);assert.equal(f.publicWrites().length,0);
});
test('private IO is registered before writes and corrupt trusted files report the exclusion warning',async()=>{
    const f=fixture(),writes=[],altered=[];
    const io=new ConfigFiles(f.adapter,'.obsidian','bpm','device-a',hash,f.local,{
        write:async(path,text,action)=>{writes.push(path);await action();},remove:async(path,action)=>action(),altered:path=>altered.push(path),
    });
    const store=new ConfigProtection(io,'device-a',hash);await store.load();
    const path=`${root}/.bpm/device-a/states/${f.anchor().head}.json`;
    assert.ok(writes.includes(path));f.files.set(path,'{bad JSON');
    await assert.rejects(io.readHead(),SyntaxError);assert.deepEqual(altered,[path]);assert.equal(f.publicWrites().length,0);
});
test('conflicts and their file copies survive a new instance without shared writes',async()=>{
    const f=fixture();const value=await f.store.load();f.store.begin(value);value.name='local';await f.store.stage(value);
    const remote=await createConfigRevision({name:'remote'},'device-b',[f.store.current],{},hash);f.files.set(`${root}/data.json`,JSON.stringify(encodeConfig(remote)));
    assert.equal((await f.store.publish(value,{},()=>true)).status,'conflict');
    const reopened=new ConfigProtection(new ConfigFiles(f.adapter,'.obsidian','bpm','device-a',hash,f.local),'device-a',hash);
    const recovered=await reopened.load();assert.equal(reopened.paused,true);assert.equal(recovered.name,'local');assert.equal(reopened.conflict.incoming.value.name,'remote');assert.equal(f.publicWrites().length,0);
});
test('a private transaction keeps enough information to finish after a primary write failure',async()=>{
    const f=fixture({name:'initial'},'old icons');const value=await f.store.load();f.store.begin(value);value.name='edited';f.store.stageFile('data/icons.css','new icons',true);await f.store.stage(value);
    const realWrite=f.adapter.write;f.adapter.write=async(path,text)=>{if(path===`${root}/data.json`)throw Error('disk busy');return realWrite(path,text);};
    const digests={...f.store.current.files,...await f.io.fileDigests(f.store.pendingFiles)};
    await assert.rejects(f.store.publish(value,digests,()=>true),/disk busy/);
    assert.equal(f.files.get(`${root}/data/icons.css`),'new icons');assert.equal(JSON.parse(f.files.get(`${root}/data.json`)).name,'initial');assert.ok(f.anchor().transaction);
    f.adapter.write=realWrite;await f.store.publish(value,digests,()=>true);
    assert.equal(JSON.parse(f.files.get(`${root}/data.json`)).name,'edited');assert.equal(f.store.current.revision.generation,1);assert.equal(f.anchor().transaction,undefined);
});
test('a sync JSON merge with an unchanged marker preserves the input and creates a selectable conflict',async()=>{
    const f=fixture();const value=await f.store.load();f.store.begin(value);value.name='accepted';await f.store.publish(value,{},()=>true);
    const raw=JSON.parse(f.files.get(`${root}/data.json`));raw.name='foreign merged edit';f.files.set(`${root}/data.json`,JSON.stringify(raw));
    const before=f.publicWrites().length;const incoming=await f.io.readShared();await f.store.observe(incoming,value);
    assert.equal(f.store.paused,true);assert.equal(f.store.conflict.incoming.value.name,'foreign merged edit');
    assert.equal(f.publicWrites().length,before);assert.ok([...f.files.keys()].some(path=>path.includes('/unverified/')));
    f.store.choose(value,{});await f.store.publish(value,{},()=>true);assert.equal(f.store.current.value.name,'accepted');
});
test('old synced content is unchanged at startup and restored only by an explicit Save',async()=>{
    const f=fixture();const original=f.files.get(`${root}/data.json`),value=await f.store.load();f.store.begin(value);value.name='new';await f.store.publish(value,{},()=>true);
    const accepted=f.store.current.id;f.files.set(`${root}/data.json`,original);const count=f.publicWrites().length;
    const reopened=new ConfigProtection(new ConfigFiles(f.adapter,'.obsidian','bpm','device-a',hash,f.local),'device-a',hash);
    const recovered=await reopened.load();assert.equal(f.publicWrites().length,count);assert.equal(reopened.paused,false);
    await reopened.publish(recovered,{},()=>true);assert.equal(reopened.current.id,accepted);assert.equal(f.publicWrites().length,count+1);
});
test('consumed legacy recovery caches are not imported again on the next startup',async()=>{
    const f=fixture();const legacy=`${root}/data-device-a.cache`;
    f.files.set(legacy,JSON.stringify({version:1,owner:'device-a',base:{name:'initial'},value:{name:'edited'}}));
    await f.io.backupStartup();const value=await f.store.load();assert.equal(value.name,'edited');
    await f.store.publish(value,{},()=>true);assert.equal(f.files.has(legacy),false);
    const reopened=new ConfigFiles(f.adapter,'.obsidian','bpm','device-a',hash,f.local);assert.equal(await reopened.readDraft(),undefined);
});
test('an edit in the final marker read cancels publication before the adapter write',async()=>{
    const f=fixture(),value=await f.store.load();f.store.begin(value);value.name='edited';let current=true,reads=0;
    const read=f.adapter.read;f.adapter.read=async path=>{
        const text=await read(path);if(path===`${root}/data.json`&&++reads===4)current=false;return text;
    };
    await assert.rejects(f.store.publish(value,{},()=>current),ConfigEditorReopened);
    assert.equal(JSON.parse(f.files.get(`${root}/data.json`)).name,'initial');assert.equal(f.publicWrites().length,0);
    assert.equal(JSON.parse(f.files.get(`${root}/.bpm/device-a/draft.json`)).value.name,'edited');
});
test('an edit after the primary marker write reports saved-pending and anchors the committed version',async()=>{
    const f=fixture(),value=await f.store.load();f.store.begin(value);value.name='edited';let current=true;
    const write=f.adapter.write;f.adapter.write=async(path,text)=>{await write(path,text);if(path===`${root}/data.json`)current=false;};
    const result=await f.store.publish(value,{},()=>current);assert.equal(result.status,'saved-pending');
    assert.equal(f.anchor().head,f.store.current.id);assert.equal(JSON.parse(f.files.get(`${root}/data.json`)).name,'edited');
});

test('a complete foreign commit arriving during preparation is never damaged by local auxiliary writes', async () => {
    const f = fixture({ name: 'initial' }, 'initial icons'), value = await f.store.load(), base = f.store.current;
    f.store.begin(value); value.name = 'local'; f.store.stageFile('data/icons.css', 'local icons', true);
    const remote = await createConfigRevision({ name: 'remote' }, 'device-b', [base], { 'data/icons.css': await hash('remote icons') }, hash);
    const write = f.adapter.write; let injected = false;
    f.adapter.write = async (path, text) => {
        await write(path, text);
        if (path.includes('/transactions/') && !injected) {
            injected = true; f.files.set(`${root}/data/icons.css`, 'remote icons');
            f.files.set(`${root}/data.json`, JSON.stringify(encodeConfig(remote)));
        }
    };
    await assert.rejects(f.store.publish(value, base.files, () => true), ConfigDiskChanged);
    assert.deepEqual(f.publicWrites(), []);
    assert.equal(f.files.get(`${root}/data/icons.css`), 'remote icons');
    assert.equal((await f.io.readShared()).id, remote.id);
    assert.equal((await f.store.publish(value, base.files, () => true)).status, 'conflict');
});

test('foreign auxiliary bytes are protected even when their commit marker has not arrived', async () => {
    for (const selected of ['local icons', null]) {
        const f = fixture({ name: 'initial' }, 'initial icons'), value = await f.store.load();
        f.store.begin(value); value.name = 'local'; f.store.stageFile('data/icons.css', selected, true);
        const write = f.adapter.write;
        f.adapter.write = async (path, text) => {
            await write(path, text);
            if (path.includes('/transactions/')) f.files.set(`${root}/data/icons.css`, 'foreign icons');
        };
        await assert.rejects(f.store.publish(value, f.store.current.files, () => true), ConfigDiskChanged);
        assert.deepEqual(f.publicWrites(), []);
        assert.equal(f.files.get(`${root}/data/icons.css`), 'foreign icons');
        assert.equal(JSON.parse(f.files.get(`${root}/data.json`)).name, 'initial');
    }
});

test('a final marker write rechecks its guard after the shared write registration callback', async () => {
    const f = fixture({ name: 'initial' }, 'icons'); let remote;
    const io = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local, undefined, {
        write: async (path, text, action) => {
            if (remote && path === `${root}/data.json`) f.files.set(path, JSON.stringify(encodeConfig(remote)));
            await action();
        }, remove: async (path, action) => action(),
    });
    const store = new ConfigProtection(io, 'device-a', hash), value = await store.load(); store.begin(value); value.name = 'local';
    remote = await createConfigRevision({ name: 'remote' }, 'device-b', [store.current], store.current.files, hash);
    await assert.rejects(store.publish(value, store.current.files, () => true), ConfigDiskChanged);
    assert.equal(JSON.parse(f.files.get(`${root}/data.json`)).name, 'remote');
    assert.deepEqual(f.publicWrites(), []);
});

test('the final raw bundle check rejects a late heartbeat before publishing an unportable marker', async () => {
    const f = await committedDeviceFixture(); f.value.name = 'next'; f.store.stageFile('data/icons.css', 'new icons', true);
    const beforeMarker = f.files.get(`${root}/data.json`), read = f.adapter.read; let injected = false;
    f.adapter.read = async path => {
        const text = await read(path);
        if (path === `${root}/data.json` && f.files.get(`${root}/data/icons.css`) === 'new icons' && !injected) {
            injected = true; f.files.set(`${root}/${devicePath}`, deviceText(20));
        }
        return text;
    };
    await assert.rejects(f.store.publish(f.value, f.store.current.files, () => true), ConfigDiskChanged);
    assert.equal(f.files.get(`${root}/data.json`), beforeMarker);
    f.adapter.read = read;
    assert.equal((await f.store.publish(f.value, f.store.current.files, () => true)).status, 'saved');
    const fresh = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-new', hash, { read: () => undefined, write() {} });
    assert.equal((await fresh.readShared()).value.name, 'next');
    assert.equal(f.store.current.files[devicePath], await hash(deviceText(20)));
});

test('discarding a cancelled partial Save still requires an explicit publication to restore shared consistency', async () => {
    const f = fixture({ name: 'initial' }, 'initial icons'), value = await f.store.load();
    f.store.begin(value); value.name = 'committed'; await f.store.publish(value, f.store.current.files, () => true);
    value.name = 'unsaved'; f.store.stageFile('data/icons.css', 'unsaved icons', true);
    const write = f.adapter.write; let current = true;
    f.adapter.write = async (path, text) => { await write(path, text); if (path === `${root}/data/icons.css`) current = false; };
    await assert.rejects(f.store.publish(value, f.store.current.files, () => current), ConfigEditorReopened);
    f.adapter.write = write; await f.store.discardDraft();
    const io = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local), store = new ConfigProtection(io, 'device-a', hash);
    const recovered = await store.load();
    assert.equal(recovered.name, 'committed'); assert.equal(io.hasPendingTransaction, true);
    assert.equal(f.files.get(`${root}/data/icons.css`), 'unsaved icons');
    assert.equal((await store.publish(recovered, store.current.files, () => true)).status, 'saved');
    assert.equal(f.files.get(`${root}/data/icons.css`), 'initial icons'); assert.equal(io.hasPendingTransaction, false);
    const fresh = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-new', hash, { read: () => undefined, write() {} });
    assert.equal((await fresh.readShared()).id, store.current.id);
});

test('cancelling again while restoring a discarded partial transaction preserves its recovery anchor', async () => {
    const f = fixture({ name: 'initial' }, 'initial icons'), value = await f.store.load();
    f.store.begin(value); value.name = 'committed'; await f.store.publish(value, f.store.current.files, () => true);
    value.name = 'unsaved'; f.store.stageFile('data/icons.css', 'unsaved icons', true);
    const write = f.adapter.write; let current = true;
    f.adapter.write = async (path, text) => { await write(path, text); if (path === `${root}/data/icons.css`) current = false; };
    await assert.rejects(f.store.publish(value, f.store.current.files, () => current), ConfigEditorReopened);
    f.adapter.write = write; await f.store.discardDraft();
    const open = () => {
        const io = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
        return { io, store: new ConfigProtection(io, 'device-a', hash) };
    };
    const next = open(), recovered = await next.store.load(); current = true;
    f.adapter.write = async (path, text) => { await write(path, text); if (path === `${root}/data/icons.css`) current = false; };
    await assert.rejects(next.store.publish(recovered, next.store.current.files, () => current), ConfigEditorReopened);
    assert.equal(next.io.hasPendingTransaction, true);
    f.adapter.write = write; const last = open(), again = await last.store.load();
    assert.equal(again.name, 'committed');
    assert.equal((await last.store.publish(again, last.store.current.files, () => true)).status, 'saved');
    assert.equal(last.io.hasPendingTransaction, false);
    const fresh = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-new', hash, { read: () => undefined, write() {} });
    assert.equal((await fresh.readShared()).id, last.store.current.id);
});

test('unindexed managed files are retained and cannot be overwritten by a competing staged file', async () => {
    const f = await committedDeviceFixture(), path = 'data/devices/new-phone.json', original = JSON.stringify({ id: 'new-phone', name: 'Remote phone', type: 'phone', lastSeen: 1 });
    f.files.set(`${root}/${path}`, original); f.value.name = 'next';
    assert.equal((await f.store.publish(f.value, f.store.current.files, () => true)).status, 'saved');
    assert.equal(f.files.get(`${root}/${path}`), original);
    f.store.stageFile(path, JSON.stringify({ id: 'new-phone', name: 'Local phone', type: 'phone', lastSeen: 1 }), true);
    await assert.rejects(f.store.publish(f.value, f.store.current.files, () => true), ConfigDiskChanged);
    assert.equal(f.files.get(`${root}/${path}`), original);
});

test('discarded partial transactions retain pre-existing unindexed files but remove files they created', async () => {
    for (const existed of [true, false]) {
        const f = await committedDeviceFixture(), path = 'data/devices/unindexed.json';
        const text = JSON.stringify({ id: 'unindexed', name: 'External phone', type: 'phone', lastSeen: 1 });
        const originalState = f.files.get(`${root}/.bpm/device-a/states/${f.store.current.id}.json`);
        if (existed) f.files.set(`${root}/${path}`, text);
        f.value.name = 'unsaved'; f.store.stageFile(path, text, true); f.store.stageFile('data/icons.css', 'new icons', true);
        const read = f.adapter.read; let current = true;
        f.adapter.read = async target => {
            const value = await read(target);
            if (target === `${root}/data.json` && f.files.get(`${root}/data/icons.css`) === 'new icons'
                && f.files.has(`${root}/${path}`)) current = false;
            return value;
        };
        await assert.rejects(f.store.publish(f.value, f.store.current.files, () => current), ConfigEditorReopened);
        const transaction = JSON.parse(f.files.get(`${root}/.bpm/device-a/transactions/${f.anchor().transaction}.json`));
        assert.equal(transaction.untracked?.[path], existed ? text : undefined);
        assert.equal(f.files.get(`${root}/.bpm/device-a/states/${f.store.current.id}.json`), originalState);
        f.adapter.read = read; await f.store.discardDraft();
        const io = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local), store = new ConfigProtection(io, 'device-a', hash);
        const value = await store.load();
        assert.equal((await store.publish(value, store.current.files, () => true)).status, 'saved');
        assert.equal(f.files.get(`${root}/${path}`), existed ? text : undefined);
        assert.equal(io.hasPendingTransaction, false);
    }
});

test('transaction before-images require the original local anchor, owner, endpoints and full content digest', async () => {
    const path = 'data/devices/unindexed.json', text = JSON.stringify({ id: 'unindexed', name: 'External phone', type: 'phone', lastSeen: 1 });
    for (const mutate of [
        raw => { raw.owner = 'device-b'; },
        raw => { raw.before = 'a'.repeat(64); },
        raw => { raw.after = 'b'.repeat(64); },
        raw => { delete raw.untracked; },
        raw => { raw.untracked[path] = 'forged original bytes'; },
        raw => { raw.untracked[path] = null; },
        raw => { raw.untracked['../outside.json'] = text; },
    ]) {
        const f = await committedDeviceFixture(); f.files.set(`${root}/${path}`, text);
        f.value.name = 'unsaved'; f.store.stageFile(path, text, true);
        const write = f.adapter.write; let current = true;
        f.adapter.write = async (target, value) => { await write(target, value); if (target.includes('/transactions/')) current = false; };
        await assert.rejects(f.store.publish(f.value, f.store.current.files, () => current), ConfigEditorReopened);
        f.adapter.write = write;
        const transactionPath = `${root}/.bpm/device-a/transactions/${f.anchor().transaction}.json`;
        const raw = JSON.parse(f.files.get(transactionPath)); mutate(raw); f.files.set(transactionPath, JSON.stringify(raw));
        const before = f.publicWrites().length, io = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
        await assert.rejects(io.readShared(), /BPM transaction/);
        assert.equal(f.publicWrites().length, before); assert.equal(f.files.get(`${root}/${path}`), text);
    }
});

test('deleting the private recovery cache does not rewrite an incomplete shared revision', async () => {
    const f = fixture({ name: 'initial' }, 'icons');
    const value = await f.store.load(); f.store.begin(value); value.name = 'committed';
    await f.store.publish(value, f.store.current.files, () => true);
    const sharedBefore = f.files.get(`${root}/data.json`);
    // 用户删除 .bpm 与 data 目录；Users delete .bpm and the data folder, leaving only the shared files.
    for (const path of [...f.files.keys()]) {
        if (path.includes('/.bpm/') || path.endsWith('/data/icons.css')) f.files.delete(path);
    }
    assert.equal(await f.io.repairMissingAnchor(), true);
    assert.equal(f.io.localCacheRebuilt, true);
    assert.equal(await f.io.readHead(), undefined);
    assert.equal(f.anchor().head, undefined);
    const recovered = await f.io.readShared(true);
    assert.equal(recovered.revision, undefined);
    assert.equal(recovered.value.name, 'committed');
    assert.equal(recovered.files['data/icons.css'], null);
    const repaired = JSON.parse(f.files.get(`${root}/data.json`));
    assert.deepEqual(repaired._bpmRevision, JSON.parse(sharedBefore)._bpmRevision, 'the original revision marker stays intact');
    assert.equal(repaired.name, 'committed');
    assert.equal(f.files.get(`${root}/data.json`), sharedBefore, 'cache repair makes no shared writes');
    // 启动流程会写入新的本机状态；Startup persists the rebuilt private state.
    await f.io.writeHead(recovered);
    assert.equal(f.anchor().head, recovered.id);
    assert.ok([...f.files.keys()].some(path => path.includes('/.bpm/device-a/states/')));
    // Later starts keep the partial bundle visible and never interpret it as a writable baseline.
    const next = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
    assert.equal(await next.repairMissingAnchor(), false);
    const later = await next.readShared(true);
    assert.equal(later.revision, undefined);
    assert.equal(later.value.name, 'committed');
    assert.equal(next.hasPendingBundle, true);
    await assert.rejects(next.readShared(), IncompleteConfigBundle);
    assert.equal(f.files.get(`${root}/data.json`), sharedBefore);
});

test('a previously established protected data.json cannot disappear or become empty after restart', async () => {
    for (const replacement of [undefined, '']) {
        const f = fixture({ name: 'initial' }, 'icons');
        await f.store.load();
        assert.equal(f.anchor().sharedEstablished, true);
        const path = `${root}/data.json`;
        if (replacement === undefined) f.files.delete(path); else f.files.set(path, replacement);
        const next = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
        const writes = f.publicWrites().length;
        const trusted = await next.readShared(true);
        assert.equal(trusted.value.name, 'initial');
        assert.equal(f.publicWrites().length, writes);
        assert.equal(next.hasPendingBundle, true);
        await assert.rejects(next.readShared(), IncompleteConfigBundle);
        assert.equal(replacement === undefined ? f.files.has(path) : f.files.get(path), replacement === undefined ? false : '');
    }
});

test('a first protected publication persists the established marker before startup can lose the file', async () => {
    const f = fixture({ name: 'initial' });
    const value = await f.store.load();
    f.store.begin(value);
    value.name = 'saved';
    await f.store.publish(value, f.store.current.files, () => true);
    assert.equal(f.anchor().sharedEstablished, true);
    f.files.delete(`${root}/data.json`);
    const next = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
    const trusted = await next.readShared(true);
    assert.equal(trusted.value.name, 'saved');
    assert.equal(next.hasPendingBundle, true);
    await assert.rejects(next.readShared(), IncompleteConfigBundle);
    assert.equal(f.files.has(`${root}/data.json`), false);
});

test('observing an incomplete shared revision durably records that data.json existed', async () => {
    const f = fixture({ name: 'initial' }, 'icons');
    await f.store.load();
    f.local.write({ ...f.anchor(), sharedEstablished: false });
    const incoming = await createConfigRevision({ name: 'remote' }, 'device-b', [f.store.current],
        { 'data/icons.css': await hash('incoming icons') }, hash);
    f.files.set(`${root}/data.json`, JSON.stringify(encodeConfig(incoming)));
    const partial = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
    const trusted = await partial.readShared(true);
    assert.equal(trusted.value.name, 'initial');
    assert.equal(partial.hasPendingBundle, true);
    assert.equal(f.anchor().sharedEstablished, true);
    f.files.delete(`${root}/data.json`);
    const restarted = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
    assert.equal((await restarted.readShared(true)).value.name, 'initial');
    assert.equal(restarted.hasPendingBundle, true);
});

test('a complete bundle still starts normally after the private cache is repaired', async () => {
    const f = fixture({ name: 'initial' }, 'icons');
    const value = await f.store.load(); f.store.begin(value); value.name = 'committed';
    await f.store.publish(value, f.store.current.files, () => true);
    for (const path of [...f.files.keys()]) if (path.includes('/.bpm/')) f.files.delete(path);
    assert.equal(await f.io.repairMissingAnchor(), true);
    const recovered = await f.io.readShared(true);
    // 文件齐全时保留修订身份；A complete bundle keeps its revision identity.
    assert.ok(recovered.revision);
    assert.equal(recovered.files['data/icons.css'], await hash('icons'));
    const loaded = await f.store.load();
    assert.equal(loaded.name, 'committed');
});

test('a cache rebuild aborts when data.json changed after its read', async () => {
    const f = fixture({ name: 'initial' }, 'icons');
    const value = await f.store.load(); f.store.begin(value); value.name = 'committed';
    await f.store.publish(value, f.store.current.files, () => true);
    for (const path of [...f.files.keys()]) if (path.includes('/.bpm/') || path.endsWith('/data/icons.css')) f.files.delete(path);
    assert.equal(await f.io.repairMissingAnchor(), true);
    const dataPath = `${root}/data.json`;
    const read = f.adapter.read;
    let dataReads = 0;
    f.adapter.read = async path => {
        if (path === dataPath && ++dataReads === 2) {
            const newer = JSON.parse(f.files.get(dataPath));
            newer.RECENT_INSTALL_DAYS = 77;
            f.files.set(dataPath, JSON.stringify(newer));
        }
        return read(path);
    };
    await assert.rejects(f.io.readShared(true), /missing or do not match/);
    f.adapter.read = read;
    const after = JSON.parse(f.files.get(dataPath));
    assert.equal(after.RECENT_INSTALL_DAYS, 77, 'the newer external value is not overwritten');
    assert.ok(after._bpmRevision, 'the newer revision marker is kept');
});

test('a conflict whose referenced state is missing is dropped during anchor repair', async () => {
    const f = fixture({ name: 'initial' }, 'icons');
    const conflictId = 'a'.repeat(64), baseId = 'b'.repeat(64), incomingId = 'c'.repeat(64);
    f.local.write({ conflict: conflictId });
    f.files.set(`${root}/.bpm/device-a/conflicts/${conflictId}.json`, JSON.stringify({
        owner: 'device-a', id: conflictId, base: { id: baseId }, incoming: { id: incomingId }, local: {}, localFiles: {}, reason: 'concurrent',
    }));
    f.files.set(`${root}/.bpm/device-a/states/${baseId}.json`, JSON.stringify({ owner: 'device-a', config: {}, files: {} }));
    const io = new ConfigFiles(f.adapter, '.obsidian', 'bpm', 'device-a', hash, f.local);
    assert.equal(await io.repairMissingAnchor(), true);
    assert.equal(f.anchor().conflict, undefined);
});
