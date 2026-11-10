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
test('an automatic save outside an editor never marks the device as user-edited',async()=>{
    const f=await fixture();
    f.value.discovered='startup migration';
    await f.store.stage(f.value,true);
    assert.equal(f.state.draft.userEdited,false);
    assert.equal(f.store.hasPendingChanges,false);
    // A newer synced revision still takes over instead of asking about a conflict the user never made.
    f.state.shared=await createConfigRevision({name:'desktop latest',layout:'cards'},'device-b',[f.initial],{},hash);
    assert.equal(await f.store.observeShared(f.state.shared,f.value),'adopted');
    assert.equal(f.store.current.value.name,'desktop latest');assert.equal(f.store.paused,false);
    assert.equal(f.state.draft,undefined);
});
test('a clean Save still publishes an automatic change when the shared file did not move',async()=>{
    const f=await fixture();
    f.value.discovered='startup migration';
    await f.store.stage(f.value,true);
    assert.equal((await publish(f)).status,'saved');
    assert.equal(f.state.shared.value.discovered,'startup migration');
    assert.equal(f.store.current.value.discovered,'startup migration');
});
test('re-staging the same automatic draft does not turn it into a user edit',async()=>{
    const f=await fixture();
    f.value.discovered='startup migration';
    await f.store.stage(f.value,true);
    assert.equal(f.state.draft.userEdited,false);
    await f.store.stage(f.value);
    assert.equal(f.state.draft.userEdited,false);
    assert.equal(f.store.hasPendingChanges,false);
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
test('a clean Save follows a newer synced revision instead of manufacturing a conflict',async()=>{
    const f=await fixture();f.store.begin(f.value);
    const remote=await createConfigRevision({name:'remote edit',layout:'cards'},'device-b',[f.initial],{},hash);
    f.state.shared=remote;
    const result=await publish(f);
    assert.equal(result.status,'noop');assert.equal(result.value.name,'remote edit');
    assert.equal(f.store.current.id,remote.id);assert.equal(f.store.paused,false);
    assert.equal(f.store.hasPendingChanges,false);assert.equal(f.state.writes,0);assert.equal(f.state.head.id,remote.id);
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
test('a user draft from an unknown earlier head pauses instead of publishing stale values', async () => {
    const initial = await decodeConfig({ name: 'initial', layout: 'cards' }, hash);
    const head = await createConfigRevision({ name: 'current', layout: 'cards' }, 'device-b', [initial], {}, hash);
    const f = await fixture({ shared: head, head, draft: { base: 'a'.repeat(64), value: { name: 'stale local', layout: 'cards' }, files: {}, userEdited: true } });
    assert.equal(f.store.paused, true);
    assert.equal(f.value.name, 'stale local');
    assert.equal(f.state.draft, undefined);
    assert.equal((await publish(f)).status, 'conflict');
    assert.equal(f.state.shared.value.name, 'current');
});

test('identical shared observations preserve a recovered local edit',async()=>{
    const initial=await decodeConfig({name:'initial',layout:'cards'},hash);
    const f=await fixture({head:initial,draft:{base:initial.id,value:{name:'recovered',layout:'cards'},files:{},userEdited:true}});
    assert.equal(await f.store.observeShared(f.state.shared,f.value),'same');
    assert.equal(f.store.current.value.name,'initial');assert.equal(f.state.draft.value.name,'recovered');
});
test('startup follows a newer synced revision when the phone has no edits',async()=>{
    const initial=await decodeConfig({name:'initial',layout:'cards'},hash);
    const phone=await createConfigRevision({name:'phone old',layout:'cards'},'device-a',[initial],{},hash);
    const desktop=await createConfigRevision({name:'desktop latest',layout:'cards'},'device-b',[phone],{},hash);
    const f=await fixture({shared:desktop,head:phone});
    assert.equal(f.value.name,'desktop latest');assert.equal(f.store.current.id,desktop.id);
    assert.equal(f.store.paused,false);assert.equal(f.state.head.id,desktop.id);
    assert.equal(f.state.shared.id,desktop.id);assert.equal(f.state.conflict,undefined);assert.equal(f.state.draft,undefined);
});
test('startup follows the newest shared sibling when the phone has no edits',async()=>{
    const initial=await decodeConfig({name:'initial',layout:'cards'},hash);
    const phone=await createConfigRevision({name:'phone old',layout:'cards'},'device-a',[initial],{},hash);
    const desktop=await createConfigRevision({name:'desktop latest',layout:'cards'},'device-b',[initial],{},hash);
    const f=await fixture({shared:desktop,head:phone});
    assert.equal(f.value.name,'desktop latest');assert.equal(f.store.current.id,desktop.id);
    assert.equal(f.store.paused,false);assert.equal(f.state.writes,0);
});
test('startup keeps a newer local head when the shared file is a stale replay',async()=>{
    const initial=await decodeConfig({name:'initial',layout:'cards'},hash);
    const stale=await createConfigRevision({name:'stale shared',layout:'cards'},'device-b',[initial],{},hash);
    const phone=await createConfigRevision({name:'phone latest',layout:'cards'},'device-a',[stale],{},hash);
    const f=await fixture({shared:stale,head:phone});
    assert.equal(f.value.name,'phone latest');assert.equal(f.store.current.id,phone.id);
    assert.equal(f.store.paused,false);assert.equal(f.state.writes,0);
});
test('startup follows the newest remote when an old conflict had no local edit',async()=>{
    const initial=await decodeConfig({name:'initial',layout:'cards'},hash);
    const remote=await createConfigRevision({name:'desktop latest',layout:'cards'},'device-b',[initial],{},hash);
    const conflict={id:'old-conflict',reason:'concurrent',base:initial,local:structuredClone(initial.value),incoming:remote,localFiles:{}};
    const f=await fixture({shared:remote,head:initial,conflict});
    assert.equal(f.value.name,'desktop latest');assert.equal(f.store.current.id,remote.id);
    assert.equal(f.store.paused,false);assert.equal(f.store.conflict,undefined);
    assert.equal(f.state.conflict,undefined);assert.equal(f.state.writes,0);
});
test('startup surfaces a conflict when a user draft meets a newer synced revision',async()=>{
    const initial=await decodeConfig({name:'initial',layout:'cards'},hash);
    const head=await createConfigRevision({name:'accepted',layout:'cards'},'device-b',[initial],{},hash);
    const remote=await createConfigRevision({name:'desktop latest',layout:'cards'},'device-b',[head],{},hash);
    const f=await fixture({shared:remote,head,draft:{base:head.id,value:{name:'local draft',layout:'cards'},files:{},userEdited:true}});
    assert.equal(f.value.name,'local draft');assert.equal(f.store.paused,true);
    assert.equal(f.store.conflict.local.name,'local draft');assert.equal(f.store.conflict.incoming.value.name,'desktop latest');
    assert.equal(f.state.writes,0);
});
test('background observation adopts a newer revision when no user edits exist',async()=>{
    const f=await fixture();f.store.begin(f.value);
    const remote=await createConfigRevision({name:'remote edit',layout:'cards'},'device-b',[f.initial],{},hash);
    f.state.shared=remote;
    assert.equal(await f.store.observeShared(f.state.shared,f.value),'adopted');
    assert.equal(f.store.current.id,remote.id);assert.equal(f.store.paused,false);
    assert.equal(f.state.head.id,remote.id);assert.equal(f.state.writes,0);
});
test('background observation pauses when a local user draft exists',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='local edit';await f.store.stage(f.value);
    const remote=await createConfigRevision({name:'remote edit',layout:'cards'},'device-b',[f.initial],{},hash);
    f.state.shared=remote;
    assert.equal(await f.store.observeShared(f.state.shared,f.value),'conflict');
    assert.equal(f.store.paused,true);assert.equal(f.store.conflict.local.name,'local edit');
    assert.equal(f.state.writes,0);
});
test('repeated manual stages outside an editor retain dirty state until an actual revert or Save',async()=>{
    const f=await fixture();f.value.name='command change';await f.store.stage(f.value);await f.store.stage(f.value);
    assert.equal(f.store.hasPendingChanges,true);assert.equal(f.state.draft.userEdited,true);
    f.store.begin(f.value);f.store.end();f.store.begin(f.value);f.value.name='initial';await f.store.stage(f.value);
    assert.equal(f.store.hasPendingChanges,false);
});
test('file-only edits remain dirty after reopening and become clean when their bytes are reverted', async () => {
    const f = await fixture(); f.store.begin(f.value);
    f.store.stageFile('data/icons.css', 'icons', true); await f.store.persistFileDraft();
    assert.equal(f.store.hasPendingChanges, true);
    f.store.end(); f.store.begin(f.value); await f.store.stage(f.value);
    assert.equal(f.store.hasPendingChanges, true);
    f.store.stageFile('data/icons.css', null, true); await f.store.persistFileDraft();
    assert.equal(f.store.hasPendingChanges, false);
});
test('discard clears confirmed choices and cannot republish them on the next Save', async () => {
    const f = await fixture(); f.value.name = 'local'; await f.store.stage(f.value);
    f.state.shared = await createConfigRevision({ name: 'remote', layout: 'cards' }, 'device-b', [f.initial], {}, hash);
    assert.equal((await publish(f)).status, 'conflict');
    f.store.choose({ name: 'chosen', layout: 'cards' }, { 'data/icons.css': 'chosen icons' });
    await f.store.stage(f.value); await f.store.discardDraft();
    assert.equal(f.store.conflict, undefined); assert.equal(f.store.confirmedSelection, undefined);
    assert.deepEqual(f.store.pendingFiles, {}); assert.equal(f.store.hasPendingChanges, false);
    const result = await f.store.publish(f.initial.value, {}, () => true);
    // Discarding leaves no local edit, so the newer shared revision simply takes effect.
    assert.equal(result.status, 'noop'); assert.equal(f.store.current.value.name, 'remote');
    assert.equal(f.store.conflict, undefined); assert.equal(f.state.writes, 0);
});
test('a failed file draft cannot leak into a later Save or overwrite the previous draft', async () => {
    const f = await fixture(); f.value.name = 'valid edit'; await f.store.stage(f.value);
    const previous = copy(f.state.draft), write = f.io.writeDraft;
    let failed = false;
    f.io.writeDraft = async draft => {
        if (!failed) { failed = true; f.state.draft = copy(draft); throw new Error('disk busy after write'); }
        await write(draft);
    };
    await assert.rejects(f.store.stageFileDraft('data/icons.css', 'failed icons', true), /disk busy/);
    assert.deepEqual(f.state.draft, previous); assert.deepEqual(f.store.pendingFiles, {});
    assert.equal(f.store.hasPendingChanges, true);
    assert.equal((await publish(f)).status, 'saved'); assert.deepEqual(f.state.shared.files, {});
});
test('discard retains later file edits atomically if its replacement draft cannot be written', async () => {
    const f = await fixture(); f.value.name = 'discarded'; await f.store.stage(f.value);
    await f.store.stageFileDraft('data/icons.css', 'new action', true);
    const previous = copy(f.state.draft), write = f.io.writeDraft;
    f.io.writeDraft = async () => { throw new Error('No space for replacement draft'); };
    await assert.rejects(f.store.discardDraft({ 'data/icons.css': 'new action' }), /No space/);
    assert.deepEqual(f.state.draft, previous); assert.equal(f.store.pendingFiles['data/icons.css'], 'new action');
    f.io.writeDraft = write; await f.store.discardDraft({ 'data/icons.css': 'new action' });
    assert.equal(f.state.draft.value.name, 'initial'); assert.equal(f.state.draft.files['data/icons.css'], 'new action');
    assert.equal(f.store.hasPendingChanges, true); assert.equal(f.state.writes, 0);
});
