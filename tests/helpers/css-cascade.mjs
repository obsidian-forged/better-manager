// Static selector/cascade fixtures for BPM components, not a browser or minimum-version acceptance test.
import postcss from 'postcss';
import parser from 'postcss-selector-parser';
const cache=new Map();
const parse=s=>{if(!cache.has(s))cache.set(s,parser().astSync(s).nodes);return cache.get(s);};
const add=(a,b)=>a.map((x,i)=>x+b[i]);
function specificity(nodes){return nodes.reduce((sum,n)=>{
 if(n.type==='id')return add(sum,[1,0,0]);if(['class','attribute'].includes(n.type))return add(sum,[0,1,0]);
 if(n.type==='tag')return add(sum,[0,0,1]);
 if(n.type==='pseudo'){
  if(n.value===':where')return sum;
  if([':is',':not',':has'].includes(n.value))return add(sum,n.nodes.map(s=>specificity(s.nodes)).sort(compare).at(-1)||[0,0,0]);
  return add(sum,n.value.startsWith('::')?[0,0,1]:[0,1,0]);
 }return sum;
},[0,0,0]);}
function compare(a,b){for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]-b[i];}return 0;}
function node(tag,cls='',parent=null,attrs={},states=[]){const el={tag,classes:new Set(cls.split(/\s+/)),attrs,states:new Set(states),parent,children:[]};parent?.children.push(el);return el;}
function matches(el,nodes){
 let i=nodes.length-1;
 function part(current,end){if(!current)return false;let start=end;while(start>=0&&nodes[start].type!=='combinator')start--;
  for(let j=start+1;j<=end;j++)if(!simple(current,nodes[j]))return false;
  if(start<0)return true;const combinator=nodes[start].value.trim();
  if(combinator==='>')return part(current.parent,start-1);
  if(combinator==='+'||combinator==='~'){const sib=current.parent?.children||[],idx=sib.indexOf(current);return combinator==='+'?part(sib[idx-1],start-1):sib.slice(0,idx).some(x=>part(x,start-1));}
  for(let ancestor=current.parent;ancestor;ancestor=ancestor.parent)if(part(ancestor,start-1))return true;return false;
 }return part(el,i);
}
function simple(el,n){
 if(n.type==='universal'||n.type==='comment')return true;
 if(n.type==='class')return el.classes.has(n.value);
 if(n.type==='id')return el.attrs.id===n.value;
 if(n.type==='tag')return el.tag===n.value;
 if(n.type==='attribute'){const v=el.attrs[n.attribute];if(v===undefined)return false;if(!n.operator)return true;const expected=n.value;return n.operator==='='?v===expected:n.operator==='*='?v.includes(expected):n.operator==='^='?v.startsWith(expected):n.operator==='$='?v.endsWith(expected):n.operator==='~='?v.split(/\s/).includes(expected):false;}
 if(n.type==='pseudo'){
  if(n.value.startsWith('::'))return el.pseudo===n.value;
  if([':is',':where',':not'].includes(n.value)){const hit=n.nodes.some(s=>matches(el,s.nodes));return n.value===':not'?!hit:hit;}
  if(n.value===':root')return !el.parent;if(n.value===':empty')return !el.children.length;
  if(n.value===':first-child')return el.parent?.children[0]===el;if(n.value===':last-child')return el.parent?.children.at(-1)===el;
  if(n.value===':disabled')return el.attrs.disabled!==undefined;
  return el.states.has(n.value.slice(1));
 }return false;
}
function enabled(rule,phone){for(let p=rule.parent;p&&p.type!=='root';p=p.parent){
 if(p.type==='atrule'&&p.name==='media'){
  const max=p.params.match(/max-width:\s*(\d+)px/),min=p.params.match(/min-width:\s*(\d+)px/);
  if(max&&Number(max[1])<(phone?400:1100))return false;if(min&&Number(min[1])>(phone?400:1100))return false;
  if(/prefers-reduced-motion/.test(p.params))return false;
 }if(p.type==='atrule'&&p.name==='container'&&!phone)return false;
 }return true;}
function rules(source){const out=[];postcss.parse(source).walkRules(r=>{if(r.parent.type==='atrule'&&/keyframes/.test(r.parent.name))return;out.push({rule:r,selectors:parse(r.selector).map(s=>({nodes:s.nodes,spec:specificity(s.nodes)}))});});return out;}
function compute(el,all,phone,store){if(store.has(el))return store.get(el);const out=new Map();let order=0;
 for(const {rule,selectors} of all){order++;if(!enabled(rule,phone))continue;const hit=selectors.filter(s=>matches(el,s.nodes)&&(!el.pseudo||s.nodes.some(n=>n.type==='pseudo'&&n.value===el.pseudo)));if(!hit.length)continue;const spec=hit.map(s=>s.spec).sort(compare).at(-1);
 for(const d of rule.nodes.filter(n=>n.type==='decl')){const rank=[d.important?1:0,...spec,order];
  // Shorthands participate in each physical edge's cascade as they do in native CSS.
  const properties=d.prop==='border'?[d.prop,'border-top','border-right','border-bottom','border-left']:d.prop==='padding'?[d.prop,'padding-top','padding-right','padding-bottom','padding-left']:[d.prop];
  for(const prop of properties){const old=out.get(prop);if(!old||compare(rank,old.rank)>=0)out.set(prop,{value:d.value,rank,paddingSide:d.prop==='padding'&&prop!==d.prop?prop:undefined,important:d.important,selector:rule.selector,line:d.source?.start.line});}
 }
 }store.set(el,out);return out;}
function resolve(value,el,all,phone,store,depth=0){if(depth>20)return value;let out='',pos=0;
 while(true){const start=value.indexOf('var(',pos);if(start<0){out+=value.slice(pos);break;}out+=value.slice(pos,start);let level=1,end=start+4;for(;end<value.length;end++){if(value[end]==='(')level++;if(value[end]===')'&&!--level)break;else if(value[end]!==')'){} }
  // Balanced scan is kept separate from fallback commas inside nested var/color functions.
  if(end>=value.length){out+=value.slice(start);break;}
  const content=value.slice(start+4,end);let comma=-1,balance=0;for(let i=0;i<content.length;i++){if(content[i]==='(')balance++;if(content[i]===')')balance--;if(content[i]===','&&!balance){comma=i;break;}}
  const key=(comma<0?content:content.slice(0,comma)).trim();let replacement;for(let parent=el;parent;parent=parent.parent){const found=compute(parent,all,phone,store).get(key);if(found){replacement=resolve(found.value,parent,all,phone,store,depth+1);break;}}
  out+=replacement??(comma<0?`var(${key})`:resolve(content.slice(comma+1).trim(),el,all,phone,store,depth+1));pos=end+1;
 }return out;
}
function fixture(phone,dark,state){
 const body=node('body',`${phone?'is-mobile is-phone ':''}${dark?'theme-dark':'theme-light'}`),modal=node('div',`modal manager-container manager-container--main ${phone?'manager-container--mobile':''}`,body),shell=node('div','modal-content manager-modal-shell-host',modal),chrome=node('div','manager-modal-chrome',shell),toolbar=node('div','manager-toolbar',chrome),tabs=node('div','manager-toolbar__tabs bpm-scroll-strip',toolbar),head=node('div',`manager-overview-heading manager-overview-inline manager-repo-page__toolbar bpm-responsive-toolbar ${state}`,shell),food=node('div','manager-food',head),tools=node('div','manager-page-tools',head),bar=node('div','manager-bar__action setting-item',tools),control=node('div','setting-item-control',bar),switcher=node('div','manager-repo-page__switcher bpm-scroll-strip',head),segmented=node('div','manager-install__segmented',shell),transfer=node('div','manager-transfer-strategy__controls',shell),setting=node('div','manager-setting manager-setting__container',body),topbar=node('div','manager-setting__topbar',setting),settingtabs=node('div','manager-setting__tabs',topbar);
 const selected=[];for(const [rail,name] of [[tabs,'manager-toolbar__tab'],[switcher,'manager-repo-page__switch'],[segmented,'manager-install__segment'],[transfer,'manager-transfer-segment'],[settingtabs,'manager-setting__tabs-item']])for(const status of ['idle','hover','active','active-hover','focus','disabled','hidden']){
  const el=node('button',`${name} ${status.includes('active')?(name==='manager-setting__tabs-item'?'manager-setting__tabs-item_is-active':'is-active'):''} ${status==='hidden'?'manager-feature-disabled':''}`,rail,status==='disabled'?{disabled:''}:{},status.includes('hover')?['hover']:status==='focus'?['focus-visible']:[]);selected.push([`${name}/${status}`,el]);
 }
 for(const status of ['idle','hidden','more'])selected.push([`tool/${status}`,node('button',`clickable-icon manager-tool ${status==='hidden'?'manager-tool-hidden':status==='more'?'manager-tool--mobile-more':''}`,control)]);
 const overview=node('div','manager-modal-page manager-item-container manager-plugin-overview--list',shell),card=node('div','setting-item manager-item manager-plugin-card has-description',overview),info=node('div','setting-item-info',card),cardbody=node('div','manager-plugin-card__body manager-display-block',info),content=node('div','manager-plugin-card__content manager-plugin-card__content--inline-switch',cardbody),desc=node('div','manager-plugin-card__desc setting-item-description',content),viewbar=node('div','manager-plugin-card__view-bar',content),viewtoggle=node('button','manager-plugin-card__view-toggle',viewbar),footer=node('div','manager-plugin-card__footer',card),actions=node('div','manager-plugin-card__actions setting-item-control',footer),action=node('button','clickable-icon manager-plugin-command-toggle is-active',actions),hidden=node('div','manager-plugin-card__desc manager-plugin-card__desc--hidden',cardbody);
 selected.push(['cardbody',cardbody],['content',content],['desc',desc],['desc-hidden',hidden],['viewbar',viewbar],['viewtoggle',viewtoggle],['actions',actions],['action',action],['overview',overview],['shell',shell],['head',head],['food',food],['tools',tools],['bar',bar],['control',control],['switcher',switcher],['tabs',tabs]);
 const mobileTop=node('div','bpm-mobile-header__top',chrome),mobileActions=node('div','bpm-mobile-header__actions',mobileTop),global=node('div','manager-global-tools',mobileActions),close=node('div','clickable-icon manager-global-tool manager-modal-close',global),save=node('button','manager-global-tool bpm-settings-save',global),more=node('div','clickable-icon manager-global-tool manager-global-more',global),pageSwitch=node('button','manager-mobile-page-switch',mobileTop),search=node('button','manager-setting-search__trigger',topbar);
 for(const [key,button] of Object.entries({save,more,close})) selected.push([`${key}/icon`,node('svg','lucide',button)]);
 const ribbon=node('div','manager-ribbon-page ribbon-manager-modal',shell),filterbar=node('div','ribbon-manager-filter-bar',head),filtergroup=node('div','ribbon-manager-filter-group bpm-scroll-strip is-strip-scrollable',filterbar),filterbutton=node('button','ribbon-filter-btn is-active',filtergroup,{},['hover']),filterright=node('div','ribbon-manager-filter-right',filterbar),wrapper=node('div','ribbon-search-wrapper',filterright),ribbonsearch=node('input','ribbon-search-input',wrapper,{type:'text'}),groups=node('div','ribbon-manager-groups',ribbon),groupcontrol=node('div','setting-item-control',groups),groupbutton=node('button','ribbon-group-toggle',groupcontrol),order=node('div','ribbon-manager-item-order',ribbon),orderinput=node('input','ribbon-manager-item-order__input',order);
 const themeview=node('div','manager-modal-page manager-item-container manager-theme-overview',shell),themelist=node('div','manager-appearance-section__list',themeview),themecard=node('div','manager-theme-card setting-item',themelist),nativehead=node('div','modal-header manager-container__native-header',modal),sourcecontrols=node('div','manager-source-card__controls',shell,{hidden:''}),scopeicon=node('span','manager-scope-select__icon',shell,{hidden:''}),track=node('div','bpm-scroll-strip__track',filtergroup,{hidden:''});
 const quick=node('div','modal quick-apply-parts-modal',body),quicksetting=node('div','setting-item',quick),quickheading=node('div','setting-item setting-item-heading',quick),quickname=node('div','setting-item-name quick-apply-parts__row-name',quicksetting),personal=node('div','manager-personalize',setting),personaltools=node('div','manager-personalize__tools',personal),personalactions=node('div','setting-item manager-personalize__actions',personaltools),personalcontrol=node('div','setting-item-control',personalactions),personalbutton=node('button','clickable-icon manager-personalize__tool',personalcontrol),previewtool=node('button','clickable-icon manager-personalize__tool manager-personalize__tool--preview',personalcontrol),previewflair=node('span','flair',previewtool);
 selected.push(...Object.entries({personalcontrol,previewtool,previewflair}));
 const thumb=node('div','bpm-scroll-strip__thumb',track);
 const compact=(parent,classes)=>{
  const field=node('div',`manager-scope-select--compact ${classes}`,parent),root=node('div','manager-multiselect-filter',field),trigger=node('button','manager-multiselect-filter__trigger',root);
  return {field,trigger};
 };
 const overviewMenu=compact(food,'manager-overview-stats-menu'),sourceNavigation=compact(head,'manager-repo-page__navigation-menu'),sourceSummary=compact(head,'manager-repo-page__summary-menu');
 const appearanceToolbar=node('div','manager-repo-page__toolbar manager-appearance-toolbar',themeview),appearanceTabs=node('div','manager-repo-page__switcher manager-appearance-tabs',appearanceToolbar),appearanceMenu=compact(appearanceToolbar,'manager-appearance-navigation-menu');
 const settingNavigation=node('div','manager-setting__navigation',topbar),settingsMenu=compact(settingNavigation,'');
 const desktopFilters=node('div','manager-section manager-section--filters',chrome),desktopFilterContent=node('div','manager-section__content',desktopFilters),searchSetting=node('div','setting-item manager-bar__search',desktopFilterContent),searchControl=node('div','setting-item-control',searchSetting),searchLine=node('div','manager-search-line',searchControl),searchField=node('div','manager-filter-field manager-filter-field--search',searchLine),scopeHost=node('div','manager-device-scope manager-device-scope--inline manager-overview-controls',searchLine),scopeDevice=node('div','manager-filter-field manager-overview-controls__device',scopeHost),scopeMode=node('div','manager-filter-field manager-overview-controls__mode',scopeHost),filterGrid=node('div','manager-filter-control-group',searchControl);
 const ribbonState=node('div','manager-multiselect-filter ribbon-manager-state-menu',filtergroup),ribbonStateTrigger=node('button','manager-multiselect-filter__trigger',ribbonState),ribbonStateMenu=node('div','manager-multiselect-filter__menu is-fixed',ribbonState),ribbonGroup=compact(filtergroup,'ribbon-manager-group-filter'),statChip=node('button','bpm-stat-chip',food);
 const conflictModal=node('div','modal bpm-config-conflict-modal',body),conflictHost=node('div','modal-content bpm-config-conflict',conflictModal),conflictHeading=node('div','bpm-config-conflict__heading',conflictHost),allChoices=node('div','bpm-config-conflict__choices',conflictHeading),conflictLocal=node('button','bpm-config-conflict__choice bpm-config-conflict__choice--local is-selected',allChoices),conflictIncoming=node('button','bpm-config-conflict__choice bpm-config-conflict__choice--incoming',allChoices),conflictContent=node('div','bpm-config-conflict__content',conflictHost),conflictSection=node('div','bpm-config-conflict__section',conflictContent),conflictFooter=node('div','bpm-config-conflict__footer',conflictHost),conflictSave=node('button','mod-cta',conflictFooter),globalNotice=node('div','manager-sync-notice is-active',global),globalNoticeIdle=node('div','manager-sync-notice',global),settingNotice=node('div','manager-sync-notice is-active',topbar),settingNoticeIdle=node('div','manager-sync-notice',topbar),settingNoticeIcon=node('span','manager-sync-notice__icon',settingNotice),settingNoticeSvg=node('svg','lucide',settingNoticeIcon);
 selected.push(...Object.entries({conflictModal,conflictHost,conflictHeading,conflictLocal,conflictIncoming,conflictContent,conflictSection,conflictFooter,conflictSave,globalNotice,globalNoticeIdle,settingNotice,settingNoticeIdle,settingNoticeIcon,settingNoticeSvg}));
 selected.push(...Object.entries({mobileTop,mobileActions,global,close,save,more,pageSwitch,search,ribbon,filterbar,filtergroup,filterbutton,filterright,ribbonsearch,groupbutton,orderinput,themeview,themecard,nativehead,sourcecontrols,scopeicon,track,thumb,quick,quicksetting,quickheading,quickname,personalbutton,appearanceToolbar,appearanceTabs,settingNavigation,ribbonState,ribbonStateTrigger,ribbonStateMenu,statChip,searchLine,searchField,scopeHost,scopeDevice,scopeMode,filterGrid}));
 for(const [key,scope] of Object.entries({overviewMenu,sourceNavigation,sourceSummary,appearanceMenu,settingsMenu,ribbonGroup})) selected.push([key,scope.field],[`${key}/trigger`,scope.trigger]);
 return selected;
}

export function componentFixture({phone=false,dark=false,state=''}={}) { return new Map(fixture(phone,dark,state)); }
export function componentStyles(source,{phone=false,contents=true}={}) {
    const parsed=rules(source).filter(({rule})=>{
        if(contents)return true;
        for(let p=rule.parent;p&&p.type!=='root';p=p.parent)if(p.type==='atrule'&&p.name==='supports'&&p.params==='(display: contents)')return false;
        return true;
    }),cache=new Map();
    return (element,property)=>{
        const declaration=compute(element,parsed,phone,cache).get(property);
        if(!declaration)return undefined;
        const value=resolve(declaration.value,element,parsed,phone,cache);
        if(!declaration.paddingSide)return value;
        const parts=postcss.list.space(value);
        return ({'padding-top':parts[0],'padding-right':parts[1]??parts[0],
            'padding-bottom':parts[2]??parts[0],'padding-left':parts[3]??parts[1]??parts[0]})[property];
    };
}
export function pseudoElement(element,pseudo){return {...element,pseudo};}
export function fixtureElement(tag,classes='',parent=null,attributes={},states=[]){return node(tag,classes,parent,attributes,states);}
