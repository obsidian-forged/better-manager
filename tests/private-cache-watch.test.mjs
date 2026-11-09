import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const built=await build({stdin:{contents:"export * from './src/settings/private-cache-watch'; export * from './src/storage/file-change-listener';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
const module={exports:{}};new Function('module','exports',built.outputFiles[0].text)(module,module.exports);
const {PrivateCacheWatch,subscribeFileChanges,hasFileChangeNotifications}=module.exports;
const hash=async text=>createHash('sha256').update(text).digest('hex');
const root='.obsidian/plugins/bpm/.bpm',draft=`${root}/device-a/draft.json`;
function fixture(){
    const files=new Map(),errors=[],folders=new Set([root,`${root}/device-a`]);let notices=0,reads=0;
    const reader={stat:async path=>files.has(path)?{type:'file'}:folders.has(path)?{type:'folder'}:null,
        list:async path=>({files:[...files.keys()].filter(entry=>entry.startsWith(`${path}/`)&&!entry.slice(path.length+1).includes('/')),
            folders:[...folders].filter(entry=>entry.startsWith(`${path}/`)&&!entry.slice(path.length+1).includes('/'))}),
        read:async path=>{reads++;if(!files.has(path))throw Error('Missing file');return files.get(path);}};
    const watch=new PrivateCacheWatch(root,reader,hash,()=>{notices++;},error=>errors.push(error));
    return{files,folders,reader,watch,errors,notices:()=>notices,reads:()=>reads};
}
test('private saves and delayed file echoes stay quiet without a persistent index',async()=>{
    const f=fixture();await f.watch.write(draft,'local draft',async()=>{f.watch.observe(draft);await Promise.resolve();f.files.set(draft,'local draft');});
    await f.watch.settled();f.watch.observe(draft);await f.watch.settled();
    assert.equal(f.notices(),0);assert.equal(f.watch.modified,false);assert.deepEqual([...f.files],[[draft,'local draft']]);
});
test('existing recovery files ignore unchanged metadata events after a read-only startup baseline',async()=>{
    const f=fixture();f.files.set(draft,'saved in a previous session');
    await f.watch.prime();
    f.watch.observe(draft);await f.watch.settled();
    f.watch.observe(draft);await f.watch.settled();
    assert.equal(f.notices(),0);assert.equal(f.watch.modified,false);
    assert.deepEqual([...f.files],[[draft,'saved in a previous session']]);
    f.files.set(draft,'external overwrite');f.watch.observe(draft);await f.watch.settled();
    assert.equal(f.notices(),1);assert.equal(f.watch.modified,true);
});
test('startup baselining does not replace a locally registered expected value with a foreign overwrite',async()=>{
    const f=fixture();await f.watch.write(draft,'trusted',async()=>{f.files.set(draft,'trusted');});
    f.files.set(draft,'external overwrite');await f.watch.prime();
    f.watch.observe(draft);await f.watch.settled();assert.equal(f.notices(),1);
});
test('an external overwrite warns once and leaves the changed file untouched',async()=>{
    const f=fixture();await f.watch.write(draft,'trusted',async()=>{f.files.set(draft,'trusted');});
    f.files.set(draft,'remote');f.watch.observe(draft);await f.watch.settled();
    assert.equal(f.watch.modified,true);assert.equal(f.notices(),1);assert.equal(f.files.get(draft),'remote');
    f.files.set(draft,'remote again');f.watch.observe(draft);await f.watch.settled();assert.equal(f.notices(),1);
});
test('new foreign-owner files warn but sibling folders and directory creation do not',async()=>{
    const f=fixture();f.watch.observe(`${root}-other/a.json`);f.watch.observe(root);await f.watch.settled();assert.equal(f.notices(),0);
    const foreign=`${root}/device-b/states/incoming.json`;f.files.set(foreign,'remote snapshot');f.watch.observe(foreign);await f.watch.settled();
    assert.equal(f.notices(),1);assert.equal(f.files.get(foreign),'remote snapshot');
});
test('own deletion echoes are ignored while a later foreign recreation is detected',async()=>{
    const f=fixture();await f.watch.write(draft,'draft',async()=>{f.files.set(draft,'draft');});
    await f.watch.remove(draft,async()=>{f.files.delete(draft);f.watch.observe(draft);});await f.watch.settled();
    f.watch.observe(draft);await f.watch.settled();assert.equal(f.notices(),0);
    f.files.set(draft,'replayed draft');f.watch.observe(draft);await f.watch.settled();assert.equal(f.notices(),1);
});
test('external deletion of a private file or recovery root is detected',async()=>{
    for(const removeRoot of [false,true]){
        const f=fixture();await f.watch.write(draft,'draft',async()=>{f.files.set(draft,'draft');});
        if(removeRoot){f.folders.delete(root);f.watch.observe(root);}else{f.files.delete(draft);f.watch.observe(draft);}
        await f.watch.settled();assert.equal(f.notices(),1);
    }
});
test('a new local draft written during inspection is reread instead of misreported as external',async()=>{
    const f=fixture();await f.watch.write(draft,'first',async()=>{f.files.set(draft,'first');});
    let release,started;const reading=new Promise(resolve=>{started=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
    const read=f.reader.read;let once=true;
    f.reader.read=async path=>{const text=await read(path);if(once){once=false;started();await blocked;}return text;};
    f.watch.observe(draft);await reading;await f.watch.write(draft,'second',async()=>{f.files.set(draft,'second');});release();await f.watch.settled();
    assert.equal(f.notices(),0);assert.equal(f.files.get(draft),'second');assert.ok(f.reads()>=2);
});
test('inspection errors are reported and disposing the observer prevents later notifications',async()=>{
    const f=fixture();f.reader.stat=async()=>{throw Error('Permission denied');};f.watch.observe(draft);await f.watch.settled();
    assert.match(f.errors[0].message,/Permission denied/);assert.equal(f.notices(),0);
    f.watch.destroy();f.watch.observe(draft);f.watch.altered(draft);await f.watch.settled();assert.equal(f.notices(),0);
});
test('a private file deleted between stat and read still produces the exclusion warning',async()=>{
    const f=fixture();await f.watch.write(draft,'draft',async()=>{f.files.set(draft,'draft');});
    f.reader.read=async path=>{f.files.delete(path);throw Error('File disappeared');};
    f.watch.observe(draft);await f.watch.settled();assert.equal(f.notices(),1);assert.equal(f.errors.length,0);
});
test('shared file notifications preserve native arguments and return values while isolating listeners',()=>{
    const calls=[],errors=[];const adapter={onFileChange(path,...args){calls.push([this===adapter,path,...args]);return 42;}},original=adapter.onFileChange;
    const first=subscribeFileChanges(adapter,()=>{throw Error('Listener failed');},error=>errors.push(error));
    const wrapper=adapter.onFileChange,second=subscribeFileChanges(adapter,path=>calls.push(['second',path]),error=>errors.push(error));
    assert.equal(adapter.onFileChange,wrapper);assert.equal(adapter.onFileChange('path','extra'),42);assert.deepEqual(calls,[[true,'path','extra'],['second','path']]);assert.equal(errors.length,1);
    first();assert.equal(adapter.onFileChange,wrapper);second();assert.equal(adapter.onFileChange,original);
});
test('disposal preserves a later hook installed by another consumer',()=>{
    const adapter={},stop=subscribeFileChanges(adapter,()=>undefined,()=>undefined),ours=adapter.onFileChange;
    const later=(...args)=>ours(...args);adapter.onFileChange=later;stop();assert.equal(adapter.onFileChange,later);
});
test('a private listener does not disable the existing focus fallback on adapters without native notifications',()=>{
    const adapter={},stop=subscribeFileChanges(adapter,()=>undefined,()=>undefined);
    assert.equal(hasFileChangeNotifications(adapter),false);stop();
    adapter.onFileChange=()=>undefined;const next=subscribeFileChanges(adapter,()=>undefined,()=>undefined);
    assert.equal(hasFileChangeNotifications(adapter),true);next();
});
