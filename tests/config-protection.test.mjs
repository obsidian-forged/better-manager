import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:`export * from './src/settings/config-protection';export * from './src/settings/config-revision';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
const module={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(module,module.exports);
const {ConfigProtection,decodeConfig,createConfigRevision}=module.exports;
const hash=async text=>createHash('sha256').update(text).digest('hex');
const copy=value=>value===undefined?undefined:structuredClone(value);
async function fixture(options={}) {
    const initial=await decodeConfig({name:'initial',layout:'cards'},hash);
    const state={shared:copy(options.shared??initial),head:copy(options.head),draft:copy(options.draft),writes:0,draftWrites:0,conflicts:[],conflict:copy(options.conflict),failWrite:false};
    const io={readShared:async()=>copy(state.shared),readHead:async()=>copy(state.head),
        writeHead:async value=>{state.head=copy(value);},readDraft:async()=>copy(state.draft),
        writeDraft:async value=>{state.draftWrites++;state.draft=copy(value);},removeDraft:async()=>{state.draft=undefined;},
        preserveConflict:async value=>{state.conflicts.push(copy(value));state.conflict=copy(value);},
        readConflict:async()=>copy(state.conflict),clearConflict:async()=>{state.conflict=undefined;},
        writeShared:async(value,files,current)=>{assert.equal(current(),true);if(state.failWrite)throw Error('disk busy');state.writes++;state.shared=copy(value);}};
    const store=new ConfigProtection(io,'device-a',hash);
    return{initial,state,io,store,value:await store.load()};
}
const publish=f=>f.store.publish(f.value,{},()=>true);
test('startup, background discovery and editor close keep a private draft without shared writes',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.discovered='new plugin';await f.store.stage(f.value,true);f.store.end();
    assert.equal(f.state.writes,0);assert.equal(f.state.head.revision,undefined);assert.equal(f.state.draft.userEdited,false);assert.equal(f.store.hasPendingChanges,false);
});
test('explicit Save publishes while the editor remains open and an identical retry is a no-op',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='edited';await f.store.stage(f.value);await f.store.stage(f.value);
    assert.equal(f.state.writes,0);assert.equal(f.state.draftWrites,1);assert.equal(f.store.hasPendingChanges,true);
    assert.equal((await publish(f)).status,'saved');assert.equal(f.state.writes,1);assert.equal(f.store.hasOpenEditor,true);
    assert.equal(f.store.hasPendingChanges,false);assert.equal(f.state.draft,undefined);assert.equal(f.state.head.revision.generation,1);
    assert.equal((await publish(f)).status,'noop');assert.equal(f.state.writes,1);
});
test('explicit Save publishes a background draft regardless of its historical userEdited flag',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.discovered='catalog refresh';await f.store.stage(f.value,true);
    assert.equal(f.state.draft.userEdited,false);assert.equal((await publish(f)).status,'saved');assert.equal(f.state.shared.value.discovered,'catalog refresh');
});
test('reverting an edit before Save is a no-op',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='temporary';await f.store.stage(f.value);f.value.name='initial';await f.store.stage(f.value);
    assert.equal(f.store.hasPendingChanges,false);assert.equal((await publish(f)).status,'noop');assert.equal(f.state.writes,0);
});
test('only explicit Save repairs an old replay and keeps the existing revision',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='latest';await publish(f);const latest=copy(f.state.shared);
    f.state.shared=copy(f.initial);f.store.end();assert.equal(f.state.writes,1);
    assert.equal((await publish(f)).status,'saved');assert.equal(f.state.shared.id,latest.id);assert.equal(f.state.shared.revision.generation,1);
    f.state.shared=copy(f.initial);await publish(f);assert.equal(f.state.shared.id,latest.id);assert.equal(f.store.paused,false);
});
test('Save discovers concurrent changes and unresolved retries preserve both versions',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='local edit';await f.store.stage(f.value);
    f.state.shared=await createConfigRevision({name:'remote edit',layout:'cards'},'device-b',[f.initial],{},hash);
    assert.equal(f.store.paused,false);assert.equal((await publish(f)).status,'conflict');assert.equal(f.state.writes,0);
    assert.equal(f.store.conflict.local.name,'local edit');assert.equal(f.store.conflict.incoming.value.name,'remote edit');
    assert.equal((await publish(f)).status,'conflict');assert.equal(f.state.writes,0);
    f.store.choose(f.store.conflict.local,{});assert.equal((await publish(f)).status,'saved');assert.equal(f.store.paused,false);
    assert.equal(f.state.shared.revision.parents.length,2);assert.equal(f.state.shared.value.name,'local edit');
});
test('a clean Save checks a newer remote version without silently replacing the current settings',async()=>{
    const f=await fixture();f.store.begin(f.value);f.state.shared=await createConfigRevision({name:'remote edit',layout:'cards'},'device-b',[f.initial],{},hash);
    assert.equal((await publish(f)).status,'conflict');assert.equal(f.value.name,'initial');assert.equal(f.state.writes,0);
});
test('a failed publication retains the selected remote value and file choices across restart',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='local';await f.store.stage(f.value);
    f.state.shared=await createConfigRevision({name:'remote',layout:'cards'},'device-b',[f.initial],{},hash);await publish(f);
    f.store.choose({name:'chosen remote',layout:'cards'},{'data/icons.css':'selected icons'});await f.store.stage(f.value);
    f.state.failWrite=true;await assert.rejects(publish(f),/disk busy/);
    assert.equal(f.state.draft.value.name,'chosen remote');assert.equal(f.state.draft.files['data/icons.css'],'selected icons');
    const reopened=new ConfigProtection(f.io,'device-a',hash),value=await reopened.load();
    assert.equal(value.name,'chosen remote');assert.equal(reopened.conflict.local.name,'chosen remote');assert.equal(reopened.pendingFiles['data/icons.css'],'selected icons');
});
test('a new edit before publication cancels Save while retaining the draft',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='edited';let current=true;f.io.readShared=async()=>{current=false;return copy(f.state.shared);};
    assert.equal((await f.store.publish(f.value,{},()=>current)).status,'cancelled');assert.equal(f.state.writes,0);assert.equal(f.state.draft.value.name,'edited');
});
test('new edits after the marker lands retain the new head without clearing the next draft',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='first';let current=true;
    const write=f.io.writeShared;f.io.writeShared=async(...args)=>{await write(...args);current=false;};
    assert.equal((await f.store.publish(f.value,{},()=>current)).status,'saved-pending');assert.equal(f.store.current.value.name,'first');
    f.value.name='second';await f.store.stage(f.value);assert.equal(f.state.draft.base,f.store.current.id);assert.equal(f.state.draft.value.name,'second');assert.equal(f.store.hasPendingChanges,true);
});
test('startup preserves a draft without classifying newly synced disk content until Save',async()=>{
    const initial=await decodeConfig({name:'initial',layout:'cards'},hash),head=await createConfigRevision({name:'accepted',layout:'cards'},'device-b',[initial],{},hash);
    const f=await fixture({head,draft:{base:initial.id,value:{name:'crashed local edit',layout:'cards'},files:{},userEdited:true}});
    assert.equal(f.store.paused,false);assert.equal(f.value.name,'crashed local edit');assert.equal(f.state.writes,0);
    assert.equal((await publish(f)).status,'saved');assert.equal(f.state.shared.value.name,'crashed local edit');
});
test('background refresh preserves a manual edit and permits reverting its user-visible fields',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='edited';await f.store.stage(f.value);
    f.value.discovered='catalog refresh';await f.store.stage(f.value,true);f.value.name='initial';await f.store.stage(f.value);
    assert.equal(f.store.hasPendingChanges,false);assert.equal(f.state.writes,0);
});
test('a third incoming version preserves the confirmed selection as the next local candidate',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='local';await f.store.stage(f.value);
    f.state.shared=await createConfigRevision({name:'remote 1',layout:'cards'},'device-b',[f.initial],{},hash);await publish(f);
    f.store.choose({name:'selected',layout:'cards'},{});await f.store.stage(f.value);
    f.state.shared=await createConfigRevision({name:'remote 2',layout:'cards'},'device-b',[f.state.shared],{},hash);
    assert.equal((await publish(f)).status,'conflict');assert.equal(f.state.writes,0);
    assert.equal(f.store.conflict.incoming.value.name,'remote 2');assert.equal(f.store.conflict.local.name,'selected');assert.equal(f.state.draft.value.name,'selected');
});
test('an identical shared candidate clears an obsolete pause without another write',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='local';await f.store.stage(f.value);
    f.state.shared=await createConfigRevision({name:'remote',layout:'cards'},'device-b',[f.initial],{},hash);await publish(f);
    f.state.shared=await createConfigRevision(f.value,'device-b',[f.state.shared],{},hash);
    assert.equal((await publish(f)).status,'noop');assert.equal(f.store.paused,false);assert.equal(f.state.writes,0);assert.equal(f.state.draft,undefined);
});
test('identical shared observations preserve a recovered local edit',async()=>{
    const initial=await decodeConfig({name:'initial',layout:'cards'},hash);
    const f=await fixture({head:initial,draft:{base:initial.id,value:{name:'recovered',layout:'cards'},files:{},userEdited:true}});
    assert.equal((await f.store.observe(f.state.shared,f.value)).name,'recovered');assert.equal(f.state.draft.value.name,'recovered');
});
test('repeated manual stages outside an editor retain dirty state until an actual revert or Save',async()=>{
    const f=await fixture();f.value.name='command change';await f.store.stage(f.value);await f.store.stage(f.value);
    assert.equal(f.store.hasPendingChanges,true);assert.equal(f.state.draft.userEdited,true);
    f.store.begin(f.value);f.store.end();f.store.begin(f.value);f.value.name='initial';await f.store.stage(f.value);
    assert.equal(f.store.hasPendingChanges,false);
});
