import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({stdin:{contents:`export * from './src/settings/conflict-model'; export * from './src/settings/conflict-choices'; export * from './src/settings/conflict-features'; export * from './src/settings/sync-detector';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
const module={exports:{}};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
const {conflictSections,resolveConfiguration,conflictValueText,detectSyncPlugins,ConfigConflictChoices,conflictFeaturePages}=module.exports;
const config=(phone,other='local')=>({LANGUAGE:other,DEVICE_MANAGEMENT:{enabled:true,defaultPresets:{phone:'p1',computer:'c1',tablet:''},presets:{phone,computer:[{id:'c1',name:'Computer',plugins:{}}],tablet:[]}}});
test('every changed preset is exposed regardless of the current device or filter',()=>{
    const a=config([{id:'p1',name:'Phone',plugins:{tasks:{enabled:true,delay:'1'}}}]);
    const b=config([{id:'p1',name:'Phone',plugins:{tasks:{enabled:false,delay:'2'}}},{id:'p2',name:'New phone'}],'remote');
    const sections=conflictSections(a,b,{'data/icons.css':'one'},{'data/icons.css':'two'});
    assert.deepEqual(sections.map(item=>item.id),['preset:phone:p1','preset:phone:p2','settings','file:data/icons.css']);
    assert.ok(sections[0].differences.some(item=>item.path.join('.')==='plugins.tasks.enabled'));
    assert.throws(()=>resolveConfiguration(a,b,sections,new Map(),{},{}),/every/);
    const choices=new Map(sections.map(item=>[item.id,'incoming']));choices.set('preset:phone:p1','local');
    const resolved=resolveConfiguration(a,b,sections,choices,{'data/icons.css':'one'},{'data/icons.css':'two'});
    assert.equal(resolved.value.LANGUAGE,'remote');assert.equal(resolved.value.DEVICE_MANAGEMENT.presets.phone[0].plugins.tasks.enabled,true);
    assert.equal(resolved.value.DEVICE_MANAGEMENT.presets.phone[1].id,'p2');assert.equal(resolved.value.DEVICE_MANAGEMENT.presets.computer[0].id,'c1');
    assert.equal(resolved.files['data/icons.css'],'two');assert.equal(a.LANGUAGE,'local');
});
test('explicit deletion choices remove presets and repair a dangling default',()=>{
    const a=config([{id:'p1',name:'Old'},{id:'p2',name:'Kept'}]),b=config([{id:'p2',name:'Kept'}]);
    const sections=conflictSections(a,b,{},{}),choices=new Map(sections.map(item=>[item.id,'incoming']));
    const resolved=resolveConfiguration(a,b,sections,choices,{},{}).value;
    assert.deepEqual(resolved.DEVICE_MANAGEMENT.presets.phone.map(item=>item.id),['p2']);assert.equal(resolved.DEVICE_MANAGEMENT.defaultPresets.phone,'p2');
});
test('readable values redact secrets recursively instead of dumping credentials',()=>{
    const word=key=>key;
    assert.equal(conflictValueText('secret-value',['githubToken'],word),'set');
    const text=conflictValueText({apiKey:'secret-value',enabled:true},[],word);
    assert.equal(text.includes('secret-value'),false);assert.ok(text.includes('on'));
});
test('sync detection uses registered IDs and treats official sync as a separate enabled core service',()=>{
    const ids=new Set(['sync-engine','easy-sync','remotely-save','nutstore-sync','fast-note-sync','obsidian-livesync']);
    assert.equal(detectSyncPlugins(ids,true).length,7);assert.equal(detectSyncPlugins(new Set(['remotelysave','selfhostlivsync']),false).length,0);
    assert.deepEqual(detectSyncPlugins(new Set(),true).map(item=>item.id),['sync']);
});
test('item source chips preview and select the matching plugin without changing either preserved version',()=>{
    const local=config([{id:'p1',name:'Phone',plugins:{tasks:{enabled:true,delay:'fast'},other:{enabled:true,delay:''}}}]);
    const remote=structuredClone(local);remote.DEVICE_MANAGEMENT.presets.phone[0].plugins.tasks={enabled:false,delay:'slow'};
    remote.DEVICE_MANAGEMENT.presets.phone[0].plugins.other.enabled=false;
    const choices=new ConfigConflictChoices('conflict',local,remote),item={kind:'plugin',id:'tasks',presetId:'p1'};
    choices.setFiles({},{});assert.equal(choices.itemSide(item),'local');assert.equal(choices.itemValue(item).enabled,true);
    choices.toggleItem(item);assert.equal(choices.itemSide(item),'incoming');assert.equal(choices.itemValue(item).enabled,false);
    assert.equal(choices.itemValue(item).delay,'slow');assert.equal(choices.sectionSide('preset:phone:p1'),'mixed');
    assert.equal(choices.result().value.DEVICE_MANAGEMENT.presets.phone[0].plugins.other.enabled,true);
    assert.equal(local.DEVICE_MANAGEMENT.presets.phone[0].plugins.tasks.enabled,true);
    choices.toggleItem(item);assert.equal(choices.itemSide(item),'local');assert.equal(choices.itemValue(item).enabled,true);
    assert.deepEqual(choices.result().value,local);
});
test('preset choices and item chips share state while the same plugin in another preset remains independent',()=>{
    const local=config([{id:'p1',name:'Phone',plugins:{tasks:{enabled:true}}}]);
    local.DEVICE_MANAGEMENT.presets.computer[0].plugins.tasks={enabled:true};
    const remote=structuredClone(local);remote.DEVICE_MANAGEMENT.presets.phone[0].plugins.tasks.enabled=false;
    remote.DEVICE_MANAGEMENT.presets.computer[0].plugins.tasks.enabled=false;
    const choices=new ConfigConflictChoices('conflict',local,remote);choices.setFiles({},{});
    const phone={kind:'plugin',id:'tasks',presetId:'p1'},computer={kind:'plugin',id:'tasks',presetId:'c1'};
    choices.toggleItem(phone);assert.equal(choices.itemSide(computer),'local');assert.equal(choices.itemValue(computer).enabled,true);
    choices.selectSection('preset:phone:p1','local');assert.equal(choices.itemSide(phone),'local');
    choices.selectSection('preset:phone:p1','incoming');assert.equal(choices.itemSide(phone),'incoming');assert.equal(choices.itemValue(phone).enabled,false);
});
test('installed metadata alone never produces a source chip or overwrites another plugin selection',()=>{
    const local={Plugins:[{id:'tasks',version:'1',enabled:true,note:'local'},{id:'other',enabled:true}]};
    const remote={Plugins:[{id:'tasks',version:'2',enabled:true,note:'remote'},{id:'other',enabled:false}]};
    const choices=new ConfigConflictChoices('conflict',local,remote);choices.setFiles({},{});
    choices.toggleItem({kind:'plugin',id:'tasks'});
    const result=choices.result().value;assert.equal(result.Plugins[0].note,'remote');assert.equal(result.Plugins[0].version,'1');assert.equal(result.Plugins[1].enabled,true);
    const metadata=new ConfigConflictChoices('metadata',{Plugins:[{id:'tasks',enabled:true,version:'1'}]},{Plugins:[{id:'tasks',enabled:true,version:'2'}]});
    assert.equal(metadata.itemSide({kind:'plugin',id:'tasks'}),undefined);
});
test('file copies arriving after an item choice preserve that choice and remain required before confirmation',()=>{
    const local=config([{id:'p1',name:'Phone',plugins:{tasks:{enabled:true}}}]),remote=structuredClone(local);
    remote.DEVICE_MANAGEMENT.presets.phone[0].plugins.tasks.enabled=false;
    const choices=new ConfigConflictChoices('conflict',local,remote),item={kind:'plugin',id:'tasks',presetId:'p1'};
    choices.toggleItem(item);assert.throws(()=>choices.result(),/not ready/);
    choices.setFiles({'data/icons.css':'local'},{'data/icons.css':'remote'});
    assert.equal(choices.itemSide(item),'incoming');assert.equal(choices.result().files['data/icons.css'],'local');
    choices.selectSection('file:data/icons.css','incoming');assert.equal(choices.result().files['data/icons.css'],'remote');
});
test('the list source chip switches all listed plugin choices and reports individual exceptions as mixed',()=>{
    const local=config([{id:'p1',name:'Phone',plugins:{tasks:{enabled:true},other:{enabled:true}}}]),remote=structuredClone(local);
    remote.DEVICE_MANAGEMENT.presets.phone[0].plugins.tasks.enabled=false;remote.DEVICE_MANAGEMENT.presets.phone[0].plugins.other.enabled=false;
    remote.DEVICE_MANAGEMENT.presets.phone[0].filters={search:'keep this separate'};
    const choices=new ConfigConflictChoices('conflict',local,remote);choices.setFiles({},{});
    assert.equal(choices.listSide(['tasks','other'],'p1'),'local');choices.toggleList(['tasks','other'],'p1');
    assert.equal(choices.listSide(['tasks','other'],'p1'),'incoming');assert.equal(choices.itemValue({kind:'plugin',id:'other',presetId:'p1'}).enabled,false);
    assert.equal(choices.result().value.DEVICE_MANAGEMENT.presets.phone[0].filters,undefined);
    choices.toggleItem({kind:'plugin',id:'tasks',presetId:'p1'});assert.equal(choices.listSide(['tasks','other'],'p1'),'mixed');
    choices.toggleList(['tasks','other'],'p1');assert.equal(choices.listSide(['tasks','other'],'p1'),'incoming');
    choices.toggleList(['tasks','other'],'p1');assert.equal(choices.listSide(['tasks','other'],'p1'),'local');
});

test('feature markers locate off-screen preset filters, Ribbon, appearance and generic settings independently',()=>{
    const local=config([{id:'p1',name:'Phone',plugins:{tasks:{enabled:true}},filters:{search:''},ribbon:[],appearance:{theme:''}}]);
    const incoming=structuredClone(local),phone=incoming.DEVICE_MANAGEMENT.presets.phone[0];
    phone.filters.search='changed';phone.ribbon=[{name:'Changed'}];phone.appearance.theme='Changed';incoming.LANGUAGE='zh';
    const choices=new ConfigConflictChoices('features',local,incoming);choices.setFiles({},{});
    assert.deepEqual([...conflictFeaturePages(choices)].sort(),['plugins','ribbon','settings','themes']);
    const added=structuredClone(local);added.DEVICE_MANAGEMENT.presets.phone.push({id:'p2',name:'Another phone'});
    assert.deepEqual([...conflictFeaturePages(new ConfigConflictChoices('added',local,added))],['devices']);
});

test('feature markers ignore version and heartbeat metadata but retain device file and icon changes',()=>{
    const local=config([{id:'p1',name:'Phone',updatedAt:1,plugins:{tasks:{enabled:true}}}]);
    local.Plugins=[{id:'tasks',version:'1',latestVersion:'2',enabled:true}];
    const incoming=structuredClone(local);incoming.Plugins[0].version='2';incoming.DEVICE_MANAGEMENT.presets.phone[0].updatedAt=2;
    const choices=new ConfigConflictChoices('metadata',local,incoming);
    choices.setFiles({'data/devices/device.json':'{"id":"device","name":"Phone","lastSeen":1}'},
        {'data/devices/device.json':'{"id":"device","name":"Phone","lastSeen":2}'});
    assert.deepEqual([...conflictFeaturePages(choices)],[]);
    choices.setFiles({'data/devices/device.json':'{"id":"device","name":"Phone"}','data/icons.css':'old'},
        {'data/devices/device.json':'{"id":"device","name":"Renamed"}','data/icons.css':'new'});
    assert.deepEqual([...conflictFeaturePages(choices)].sort(),['devices','plugins']);
});

test('feature markers distinguish install and transfer changes from general settings',()=>{
    const choices=new ConfigConflictChoices('top-level',
        {RIBBON_GROUPS:[],BETA_SOURCES:[],TRANSFER_DEFAULT_PATH:'',Plugins:[{id:'tasks',enabled:true,note:'one'}]},
        {RIBBON_GROUPS:[{id:'group'}],BETA_SOURCES:[{id:'source'}],TRANSFER_DEFAULT_PATH:'packs',Plugins:[{id:'tasks',enabled:true,note:'two'}]});
    assert.deepEqual([...conflictFeaturePages(choices)].sort(),['install','plugins','ribbon','transfer']);
});
