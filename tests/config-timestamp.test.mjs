import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['src/settings/config-timestamp.ts'],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
const module={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(module,module.exports);
const {ConfigEditClock,validEditTime,timestampOrder}=module.exports;
test('timestamp validation is stable across clock rollback and rejects malformed bounds',()=>{
    const native=Date.now;try{Date.now=()=>2000;assert.equal(validEditTime(1000),true);Date.now=()=>500;assert.equal(validEditTime(1000),true);}finally{Date.now=native;}
    for(const value of [0,-1,NaN,Infinity,1.5,'1000',Number.MAX_SAFE_INTEGER]) assert.equal(validEditTime(value),false);
    assert.equal(timestampOrder(1000,2000),-1);assert.equal(timestampOrder(1000,1000),0);assert.equal(timestampOrder(undefined,2000),undefined);
});
test('device clock uses captured request time monotonically without sampling queue execution time',()=>{
    const clock=new ConfigEditClock();assert.equal(clock.next(undefined,1000),1000);assert.equal(clock.next(1000,900),1001);assert.equal(clock.next(1001,1500),1500);
});
