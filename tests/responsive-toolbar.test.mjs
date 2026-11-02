import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/ui/responsive-toolbar.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
function fixture() {
    const observers=[];
    class Observer {
        constructor(callback) { this.callback=callback; observers.push(this); }
        observe() {}
        disconnect() { this.disconnected=true; }
    }
    const module={exports:{}};
    new Function('ResizeObserver','MutationObserver','module','exports',bundle.outputFiles[0].text)(Observer,Observer,module,module.exports);
    const classes=new Set();
    const groups=[100,200].map(width=>({width,display:'flex',getBoundingClientRect(){return {width:this.width};}}));
    const root={isConnected:true,clientWidth:340,addClass(...names){names.forEach(name=>classes.add(name));},
        removeClass(...names){names.forEach(name=>classes.delete(name));},toggleClass(name,value){value?classes.add(name):classes.delete(name);},
        ownerDocument:{defaultView:{getComputedStyle(el){return el===root?{columnGap:'8px',paddingLeft:'8px',paddingRight:'8px'}:{display:el.display};}}}};
    const toolbar=new module.exports.ResponsiveToolbar(root,()=>groups);
    return {root,groups,classes,toolbar,observers};
}

test('toolbars collapse at their measured content width and expand again without a device breakpoint',()=>{
    const {root,classes,observers,toolbar}=fixture();
    assert.equal(classes.has('is-compact'),false);
    root.clientWidth=323;observers[0].callback();
    assert.equal(classes.has('is-compact'),false); // One pixel measurement tolerance.
    root.clientWidth=320;observers[0].callback();
    assert.equal(classes.has('is-compact'),true);
    root.clientWidth=340;observers[0].callback();
    assert.equal(classes.has('is-compact'),false);
    assert.equal(classes.has('is-measuring'),false);
    toolbar.destroy();assert.ok(observers.every(observer=>observer.disconnected));
    root.clientWidth=100;observers[0].callback();assert.equal(classes.has('is-compact'),false);
});

test('toolbar content changes and hidden controls update the collapse decision without observing its own measurement classes',()=>{
    const {root,groups,classes,observers}=fixture();
    groups[1].width=300;observers[1].callback([{target:groups[1]}]);
    assert.equal(classes.has('is-compact'),true);
    groups[1].display='none';observers[1].callback([{target:groups[1]}]);
    assert.equal(classes.has('is-compact'),false);
    root.clientWidth=1;observers[1].callback([{target:root}]);
    assert.equal(classes.has('is-compact'),false);
});
