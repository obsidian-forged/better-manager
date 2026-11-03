import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const compiled = await build({stdin:{contents:`export * from './src/settings/config-protection';export * from './src/settings/config-revision';`,resolveDir:process.cwd(),sourcefile:'protection-tests.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
const module = {exports:{}};
new Function('module','exports',compiled.outputFiles[0].text)(module,module.exports);
const {ConfigProtection,ConfigConflictPaused,decodeConfig,createConfigRevision} = module.exports;
const hash = async text => createHash('sha256').update(text).digest('hex');
const copy = value => value===undefined?undefined:structuredClone(value);
async function fixture(options={}) {
    const initial=await decodeConfig({name:'initial',layout:'cards'},hash);
    const state={shared:copy(initial),head:copy(options.head),draft:copy(options.draft),writes:0,draftWrites:0,conflicts:[],failWrite:false};
    const io={readShared:async()=>copy(state.shared),readHead:async()=>copy(state.head),
        writeHead:async value=>{state.head=copy(value);},readDraft:async()=>copy(state.draft),
        writeDraft:async value=>{state.draftWrites++;state.draft=copy(value);},removeDraft:async()=>{state.draft=undefined;},
        preserveConflict:async value=>{state.conflicts.push(copy(value));},
        writeShared:async(value,files,closed)=>{assert.equal(closed(),true);if(state.failWrite)throw Error('disk busy');state.writes++;state.shared=copy(value);}};
    const store=new ConfigProtection(io,'device-a',hash);
    return{initial,state,io,store,value:await store.load()};
}
test('startup and background discovery never write the shared file or advance its revision',async()=>{
    const f=await fixture();f.value.discovered='new plugin';await f.store.stage(f.value);
    assert.equal(f.state.writes,0);assert.equal(f.state.head.revision,undefined);
    assert.equal(f.state.draft.userEdited,false);
    f.store.begin(f.value);await f.store.finish(f.value,{},()=>true);
    assert.equal(f.state.writes,0);assert.equal(f.state.head.revision,undefined);
});
test('edits are durable drafts until the final closed editor produces exactly one revision',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='edited';await f.store.stage(f.value);await f.store.stage(f.value);
    assert.equal(f.state.writes,0);assert.equal(f.state.draftWrites,1);
    assert.equal(await f.store.finish(f.value,{},()=>false),undefined);assert.equal(f.state.writes,0);
    await f.store.finish(f.value,{},()=>true);assert.equal(f.state.writes,1);assert.equal(f.state.head.revision.generation,1);
    assert.equal(f.state.draft,undefined);
    f.store.begin(f.value);await f.store.finish(f.value,{},()=>true);assert.equal(f.state.writes,1);
});
test('reverting an edit before closing remains a no-op',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='temporary';await f.store.stage(f.value);f.value.name='initial';await f.store.stage(f.value);await f.store.finish(f.value,{},()=>true);assert.equal(f.state.writes,0);
});
test('known old content is restored with the existing revision only once; replay then trips the guard',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='latest';await f.store.finish(f.value,{},()=>true);
    const latest=copy(f.state.shared);f.state.shared=copy(f.initial);await f.store.observe(f.state.shared,f.value);f.store.begin(f.value);await f.store.finish(f.value,{},()=>true);
    assert.equal(f.state.writes,2);assert.equal(f.state.shared.id,latest.id);assert.equal(f.state.shared.revision.generation,1);
    f.state.shared=copy(f.initial);await f.store.observe(f.state.shared,f.value);f.store.begin(f.value);await f.store.finish(f.value,{},()=>true);
    assert.equal(f.state.writes,2);assert.equal(f.store.paused,true);assert.equal(f.store.conflict.reason,'stale-replayed');
});
test('simultaneous changes preserve both versions and cannot write through the pause',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='local edit';await f.store.stage(f.value);
    f.state.shared=await createConfigRevision({name:'remote edit',layout:'cards'},'device-b',[f.initial],{},hash);
    await assert.rejects(f.store.finish(f.value,{},()=>true),ConfigConflictPaused);
    assert.equal(f.state.writes,0);assert.equal(f.state.conflicts[0].local.name,'local edit');assert.equal(f.state.conflicts[0].incoming.value.name,'remote edit');
    await assert.rejects(f.store.finish(f.value,{},()=>true),ConfigConflictPaused);assert.equal(f.state.writes,0);
});
test('choosing a preserved version remains a draft until the window closes',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='local edit';await f.store.stage(f.value);
    const remote=await createConfigRevision({name:'remote edit',layout:'cards'},'device-b',[f.initial],{},hash);f.state.shared=remote;
    await assert.rejects(f.store.finish(f.value,{},()=>true),ConfigConflictPaused);
    f.store.choose(f.store.conflict.local,{});assert.equal(f.state.writes,0);
    await f.store.finish(f.value,{},()=>true);assert.equal(f.state.writes,1);assert.equal(f.store.paused,false);
    assert.ok(f.state.shared.revision.parents.includes(remote.id));assert.equal(f.state.shared.value.name,'local edit');
});
test('a sync write during an open editor does not replace its view model',async()=>{
    const f=await fixture();f.store.begin(f.value);
    f.state.shared=await createConfigRevision({name:'remote edit',layout:'cards'},'device-b',[f.initial],{},hash);
    const visible=await f.store.observe(f.state.shared,f.value);assert.equal(visible.name,'initial');assert.equal(f.store.current.id,f.initial.id);
    const closed=await f.store.finish(f.value,{},()=>true);assert.equal(closed.name,'remote edit');assert.equal(f.state.writes,0);
});
test('a failed close retains the draft and shared revision for retry',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='keep me';await f.store.stage(f.value);f.state.failWrite=true;
    await assert.rejects(f.store.finish(f.value,{},()=>true),/disk busy/);assert.equal(f.state.writes,0);assert.equal(f.state.draft.value.name,'keep me');
    f.state.failWrite=false;await f.store.finish(f.value,{},()=>true);assert.equal(f.state.writes,1);
});
test('reopening while the remote snapshot is being read cancels publication',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='edited';let closed=true;f.io.readShared=async()=>{closed=false;return copy(f.state.shared);};
    assert.equal(await f.store.finish(f.value,{},()=>closed),undefined);assert.equal(f.state.writes,0);assert.equal(f.state.draft.value.name,'edited');
});
test('a recovered draft against a newer accepted head becomes a preserved conflict',async()=>{
    const initial=await decodeConfig({name:'initial',layout:'cards'},hash);
    const head=await createConfigRevision({name:'newer',layout:'cards'},'device-b',[initial],{},hash);
    const f=await fixture({head,draft:{base:initial.id,value:{name:'crashed local edit',layout:'cards'},files:{},userEdited:true}});
    assert.equal(f.store.paused,true);assert.equal(f.value.name,'crashed local edit');assert.equal(f.state.writes,0);
});
test('background discovery while an editor is open never counts as a manual edit',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.discovered='catalog refresh';await f.store.stage(f.value,true);
    await f.store.finish(f.value,{},()=>true);assert.equal(f.state.writes,0);assert.equal(f.state.head.revision,undefined);
});
test('background refresh preserves an actual edit but does not prevent the user from reverting it',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='edited';await f.store.stage(f.value);
    f.value.discovered='catalog refresh';await f.store.stage(f.value,true);
    f.value.name='initial';await f.store.stage(f.value);await f.store.finish(f.value,{},()=>true);
    assert.equal(f.state.writes,0);
});
test('a newer incoming revision invalidates a confirmed choice instead of overwriting an unseen version',async()=>{
    const f=await fixture();f.store.begin(f.value);f.value.name='local';await f.store.stage(f.value);
    f.state.shared=await createConfigRevision({name:'remote 1',layout:'cards'},'device-b',[f.initial],{},hash);
    await assert.rejects(f.store.finish(f.value,{},()=>true),ConfigConflictPaused);f.store.choose(f.value,{});
    f.state.shared=await createConfigRevision({name:'remote 2',layout:'cards'},'device-b',[f.state.shared],{},hash);
    await assert.rejects(f.store.finish(f.value,{},()=>true),ConfigConflictPaused);
    assert.equal(f.state.writes,0);assert.equal(f.store.conflict.incoming.value.name,'remote 2');
});
