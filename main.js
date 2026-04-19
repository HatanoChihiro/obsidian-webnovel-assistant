"use strict";var I=Object.defineProperty;var z=Object.getOwnPropertyDescriptor;var R=Object.getOwnPropertyNames;var j=Object.prototype.hasOwnProperty;var G=(g,s)=>{for(var t in s)I(g,t,{get:s[t],enumerable:!0})},Y=(g,s,t,e)=>{if(s&&typeof s=="object"||typeof s=="function")for(let i of R(s))!j.call(g,i)&&i!==t&&I(g,i,{get:()=>s[i],enumerable:!(e=z(s,i))||e.enumerable});return g};var U=g=>Y(I({},"__esModule",{value:!0}),g);var q={};G(q,{STATUS_VIEW_TYPE:()=>w,default:()=>W});module.exports=U(q);var n=require("obsidian");function E(g,s){if(!g)return`rgba(255, 255, 255, ${s})`;let t=g.replace("#","");if(t.length===3&&(t=t.split("").map(o=>o+o).join("")),t.length!==6)return`rgba(255, 255, 255, ${s})`;let e=parseInt(t.substring(0,2),16)||0,i=parseInt(t.substring(2,4),16)||0,a=parseInt(t.substring(4,6),16)||0;return`rgba(${e}, ${i}, ${a}, ${s})`}function y(g){let s=Math.floor(g/3600).toString().padStart(2,"0"),t=Math.floor(g%3600/60).toString().padStart(2,"0"),e=(g%60).toString().padStart(2,"0");return`${s}:${t}:${e}`}function S(g){return g>=1e4?(g/1e4).toFixed(1)+"w":g>=1e3?(g/1e3).toFixed(1)+"k":g.toString()}function M(g,s){if(document.getElementById(g))return;let t=document.createElement("style");t.id=g,t.innerHTML=s,document.head.appendChild(t)}function B(g){let s=document.getElementById(g);s&&s.remove()}var T=require("obsidian");function x(){return T.Platform.isDesktop||T.Platform.isDesktopApp}function D(){return T.Platform.isMobile||T.Platform.isMobileApp}var H=require("obsidian"),F=class{constructor(){this.maxCacheSize=1e4;this.cache=new Map}async buildInitialCache(s,t){console.log("[CacheManager] \u5F00\u59CB\u6784\u5EFA\u521D\u59CB\u7F13\u5B58...");let e=Date.now();try{let i=s.getMarkdownFiles(),a=new Map,o=0,r=0;for(let h of i)try{let p=await s.cachedRead(h),c=t(p);a.set(h.path,c),this.cache.set(h.path,{path:h.path,wordCount:c,lastModified:h.stat.mtime}),o++}catch(p){console.error(`[CacheManager] \u8BFB\u53D6\u6587\u4EF6\u5931\u8D25: ${h.path}`,p),r++}for(let[h,p]of a.entries()){let c=s.getAbstractFileByPath(h);if(c instanceof H.TFile){let d=c.parent;for(;d;){let u=this.cache.get(d.path);u?u.wordCount+=p:this.cache.set(d.path,{path:d.path,wordCount:p,lastModified:Date.now()}),d=d.parent}}}let l=Date.now()-e;console.log(`[CacheManager] \u7F13\u5B58\u6784\u5EFA\u5B8C\u6210: ${o} \u4E2A\u6587\u4EF6\u6210\u529F, ${r} \u4E2A\u6587\u4EF6\u5931\u8D25, ${this.cache.size} \u4E2A\u7F13\u5B58\u6761\u76EE, \u8017\u65F6 ${l}ms`),r>0&&console.warn(`[CacheManager] \u8B66\u544A: ${r} \u4E2A\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25\uFF0C\u7F13\u5B58\u53EF\u80FD\u4E0D\u5B8C\u6574`)}catch(i){throw console.error("[CacheManager] \u7F13\u5B58\u6784\u5EFA\u5931\u8D25:",i),i}}getFolderCount(s){let t=this.cache.get(s);return t?t.wordCount:null}updateFileCache(s,t,e){let i=this.cache.get(s.path),a=i?i.wordCount:0,o=t-a;this.cache.set(s.path,{path:s.path,wordCount:t,lastModified:s.stat.mtime});let r=s.parent;for(;r;){let l=this.cache.get(r.path);l?(l.wordCount+=o,l.lastModified=Date.now()):this.cache.set(r.path,{path:r.path,wordCount:Math.max(0,o),lastModified:Date.now()}),r=r.parent}this.cache.size>this.maxCacheSize&&this.clearOldEntries()}invalidateCache(s,t){let e=this.cache.get(s);if(!e)return;let i=e.wordCount;this.cache.delete(s);let a=t.getAbstractFileByPath(s);if(a){let o=a.parent;for(;o;){let r=this.cache.get(o.path);r&&(r.wordCount=Math.max(0,r.wordCount-i),r.lastModified=Date.now()),o=o.parent}}}clearCache(){this.cache.clear(),console.log("[CacheManager] \u7F13\u5B58\u5DF2\u6E05\u7A7A")}getCacheStats(){let s=this.cache.size*100;return{size:this.cache.size,memoryUsage:s}}clearOldEntries(){console.warn("[CacheManager] \u7F13\u5B58\u5927\u5C0F\u8D85\u8FC7\u9650\u5236\uFF0C\u6B63\u5728\u6E05\u7406...");let s=Array.from(this.cache.entries());s.sort((e,i)=>e[1].lastModified-i[1].lastModified);let t=Math.floor(s.length*.2);for(let e=0;e<t;e++)this.cache.delete(s[e][0]);console.log(`[CacheManager] \u5DF2\u6E05\u7406 ${t} \u4E2A\u65E7\u7F13\u5B58\u6761\u76EE`)}};var N=class{constructor(){this.timers=new Map,this.lastCallTimes=new Map}debounce(s,t,e){this.timers.has(s)&&window.clearTimeout(this.timers.get(s));let i=window.setTimeout(()=>{t(),this.timers.delete(s)},e);this.timers.set(s,i)}throttle(s,t,e){let i=Date.now(),a=this.lastCallTimes.get(s)||0;i-a>=e&&(t(),this.lastCallTimes.set(s,i))}cancel(s){let t=this.timers.get(s);t&&(window.clearTimeout(t),this.timers.delete(s))}cancelAll(){this.timers.forEach(s=>{window.clearTimeout(s)}),this.timers.clear(),this.lastCallTimes.clear(),console.log("[DebounceManager] \u6240\u6709\u9632\u6296\u64CD\u4F5C\u5DF2\u53D6\u6D88")}flush(s,t){this.cancel(s),t()}getPendingCount(){return this.timers.size}};var A=class{constructor(s,t){this.validationRules=[{field:"obsPort",validate:s=>{let t=Number(s);return!isNaN(t)&&t>=1024&&t<=65535},errorMessage:"\u7AEF\u53E3\u53F7\u5FC5\u987B\u5728 1024-65535 \u4E4B\u95F4"},{field:"idleTimeoutThreshold",validate:s=>{let t=Number(s);return!isNaN(t)&&t>=1e4&&t<=36e5},errorMessage:"\u7A7A\u95F2\u8D85\u65F6\u5FC5\u987B\u5728 10-3600 \u79D2\u4E4B\u95F4"},{field:"noteOpacity",validate:s=>{let t=Number(s);return!isNaN(t)&&t>=.1&&t<=1},errorMessage:"\u4FBF\u7B7E\u4E0D\u900F\u660E\u5EA6\u5FC5\u987B\u5728 0.1-1.0 \u4E4B\u95F4"},{field:"obsOverlayOpacity",validate:s=>{let t=Number(s);return!isNaN(t)&&t>=0&&t<=1},errorMessage:"OBS \u53E0\u52A0\u5C42\u4E0D\u900F\u660E\u5EA6\u5FC5\u987B\u5728 0-1.0 \u4E4B\u95F4"},{field:"defaultGoal",validate:s=>{let t=Number(s);return!isNaN(t)&&t>=0},errorMessage:"\u9ED8\u8BA4\u76EE\u6807\u5B57\u6570\u5FC5\u987B\u4E3A\u975E\u8D1F\u6570"}];this.plugin=s,this.defaultSettings=t,this.settings={...t}}async loadSettings(){try{let s=await this.plugin.loadData();this.settings=Object.assign({},this.defaultSettings,s),this.settings=this.migrateSettings(this.settings,s);let t=this.validateSettings(this.settings);return t.valid||(console.warn("[SettingsManager] \u8BBE\u7F6E\u9A8C\u8BC1\u5931\u8D25:",t.errors),this.settings=this.fixInvalidSettings(this.settings)),console.log("[SettingsManager] \u8BBE\u7F6E\u52A0\u8F7D\u6210\u529F"),this.settings}catch(s){console.error("[SettingsManager] \u52A0\u8F7D\u8BBE\u7F6E\u5931\u8D25:",s);let{Notice:t}=require("obsidian");return new t("\u52A0\u8F7D\u8BBE\u7F6E\u5931\u8D25\uFF0C\u5DF2\u4F7F\u7528\u9ED8\u8BA4\u8BBE\u7F6E"),this.settings={...this.defaultSettings},this.settings}}async saveSettings(){try{let s=this.plugin.settings;s&&(this.settings=s),await this.plugin.saveData(this.settings)}catch(s){console.error("[SettingsManager] \u4FDD\u5B58\u8BBE\u7F6E\u5931\u8D25:",s);let{Notice:t}=require("obsidian");throw new t("\u4FDD\u5B58\u8BBE\u7F6E\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u78C1\u76D8\u7A7A\u95F4\u548C\u6743\u9650"),s}}validateSettings(s){let t=[];for(let e of this.validationRules){let i=s[e.field];i!==void 0&&!e.validate(i)&&t.push(e.errorMessage)}return{valid:t.length===0,errors:t}}fixInvalidSettings(s){let t={...s};for(let e of this.validationRules){let i=t[e.field];i!==void 0&&!e.validate(i)&&(t[e.field]=this.defaultSettings[e.field],console.warn(`[SettingsManager] \u4FEE\u590D\u65E0\u6548\u8BBE\u7F6E: ${e.field} = ${i} -> ${this.defaultSettings[e.field]}`))}return t}migrateSettings(s,t){let e={...s};if(t&&typeof t=="object"&&"noteColors"in t){let i=t.noteColors;i&&Array.isArray(i)&&(!e.noteThemes||e.noteThemes.length===0)&&(e.noteThemes=i.map(a=>({bg:a,text:"#2C3E50"})),console.log("[SettingsManager] \u5DF2\u8FC1\u79FB\u65E7\u7248\u4FBF\u7B7E\u989C\u8272\u5230\u65B0\u7248\u4E3B\u9898"))}return e}getSettings(){return this.settings}async updateSettings(s){let t=this.validateSettings(s);if(!t.valid)throw new Error(`\u8BBE\u7F6E\u9A8C\u8BC1\u5931\u8D25: ${t.errors.join(", ")}`);this.settings=Object.assign(this.settings,s),await this.saveSettings()}async resetToDefaults(){this.settings={...this.defaultSettings},await this.saveSettings(),console.log("[SettingsManager] \u5DF2\u91CD\u7F6E\u4E3A\u9ED8\u8BA4\u8BBE\u7F6E")}};var w="writing-status-view",_={defaultGoal:3e3,showGoal:!0,showExplorerCounts:!0,enableObs:!1,enableLegacyObsExport:!1,obsPath:"",openNotes:[],noteOpacity:.9,dailyHistory:{},idleTimeoutThreshold:60*1e3,noteThemes:[{bg:"#FDF3B8",text:"#2C3E50"},{bg:"#FCDDEC",text:"#5D2E46"},{bg:"#CCE8CF",text:"#2A4A30"},{bg:"#2C3E50",text:"#F8F9FA"},{bg:"#E8DFF5",text:"#4A3B69"},{bg:"#FDE0C1",text:"#593D2B"}],obsPort:24816,obsOverlayTheme:"dark",obsOverlayOpacity:.85,obsCustomCss:"",obsShowFocusTime:!0,obsShowSlackTime:!0,obsShowTotalTime:!0,obsShowTodayWords:!0,obsShowSessionWords:!0},W=class extends n.Plugin{constructor(t,e){super(t,e);this.isTracking=!1;this.focusMs=0;this.slackMs=0;this.lastTickTime=0;this.sessionAddedWords=0;this.lastFileWords=0;this.lastEditTime=Date.now();this.worker=null;this.activeNotes=[];this.obsServer=null;this.cacheManager=new F,this.debounceManager=new N,this.settingsManager=new A(this,_)}async onload(){if(await this.loadSettings(),this.injectGlobalStyles(),this.statusBarItemEl=this.addStatusBarItem(),this.addSettingTab(new V(this.app,this)),this.registerEvent(this.app.workspace.on("editor-change",()=>{this.debounceManager.debounce("editor-update",()=>{this.handleEditorChange()},300)})),this.registerEvent(this.app.workspace.on("active-leaf-change",this.handleFileChange.bind(this))),this.registerEvent(this.app.metadataCache.on("changed",()=>{this.debounceManager.debounce("word-count-update",()=>{this.updateWordCount()},100)})),this.updateWordCount(),D()){this.registerEvent(this.app.workspace.on("file-menu",(t,e)=>{e instanceof n.TFile&&e.extension==="md"&&t.addItem(i=>{i.setTitle("\u8BBE\u5B9A\u672C\u7AE0\u76EE\u6807\u5B57\u6570").setIcon("target").onClick(()=>{new k(this.app,e).open()})})})),this.registerEvent(this.app.workspace.on("editor-menu",(t,e,i)=>{i.file&&t.addItem(a=>{a.setTitle("\u8BBE\u5B9A\u672C\u7AE0\u76EE\u6807\u5B57\u6570").setIcon("target").onClick(()=>{new k(this.app,i.file).open()})})}));return}this.registerView(w,t=>new L(t,this)),this.app.workspace.onLayoutReady(()=>{this.settings.openNotes.forEach(t=>{new v(this.app,this,{state:t}).load()}),setTimeout(()=>{this.buildFolderCache()},1e3)}),this.registerEvent(this.app.vault.on("modify",t=>{t instanceof n.TFile&&t.extension==="md"&&this.debounceManager.debounce("folder-refresh",()=>{this.updateFileCacheAndRefresh(t)},500)})),this.registerEvent(this.app.vault.on("delete",t=>{t instanceof n.TFile&&t.extension==="md"&&(this.cacheManager.invalidateCache(t.path,this.app.vault),this.debounceManager.debounce("folder-refresh",()=>{this.refreshFolderCounts()},500))})),this.registerEvent(this.app.vault.on("rename",(t,e)=>{t instanceof n.TFile&&t.extension==="md"&&(this.cacheManager.invalidateCache(e,this.app.vault),this.debounceManager.debounce("folder-refresh",()=>{this.updateFileCacheAndRefresh(t)},500))})),this.registerEvent(this.app.workspace.on("layout-change",()=>{this.debounceManager.debounce("folder-refresh",()=>{this.refreshFolderCounts()},500)})),this.addRibbonIcon("sticky-note","\u65B0\u5EFA\u7A7A\u767D\u60AC\u6D6E\u4FBF\u7B7E",()=>{new v(this.app,this,{content:"",title:"\u65B0\u4FBF\u7B7E"}).load()}),this.addRibbonIcon("bar-chart-2","\u6253\u5F00/\u5173\u95ED\u5199\u4F5C\u5B9E\u65F6\u72B6\u6001\u9762\u677F",()=>{this.toggleStatusView()}),this.addCommand({id:"toggle-writing-status-view",name:"\u6253\u5F00/\u5173\u95ED\u5199\u4F5C\u5B9E\u65F6\u72B6\u6001\u9762\u677F",callback:()=>this.toggleStatusView()}),this.addCommand({id:"toggle-tracking",name:"\u5F00\u59CB/\u6682\u505C \u7801\u5B57\u4E0E\u65F6\u957F\u7EDF\u8BA1",callback:()=>{this.isTracking=!this.isTracking,this.isTracking?(this.lastTickTime=Date.now(),this.worker?.postMessage("start"),new n.Notice("\u25B6\uFE0F \u7801\u5B57\u65F6\u957F\u7EDF\u8BA1\u5DF2\u5F00\u59CB")):(this.worker?.postMessage("stop"),new n.Notice("\u23F8\uFE0F \u7801\u5B57\u65F6\u957F\u7EDF\u8BA1\u5DF2\u6682\u505C")),this.updateWordCount(),this.exportLegacyOBS(!0),this.refreshStatusViews()}}),this.addCommand({id:"create-blank-sticky-note",name:"\u65B0\u5EFA\u7A7A\u767D\u60AC\u6D6E\u4FBF\u7B7E",callback:()=>{new v(this.app,this,{content:"",title:"\u65B0\u4FBF\u7B7E"}).load()}}),this.addCommand({id:"reset-stream-session",name:"\u91CD\u7F6E\u76F4\u64AD\u7EDF\u8BA1\u6570\u636E (\u6E05\u96F6\u65F6\u957F\u4E0E\u4ECA\u65E5\u5B57\u6570)",callback:()=>{this.focusMs=0,this.slackMs=0,this.sessionAddedWords=0,this.isTracking=!1,this.worker?.postMessage("stop"),this.handleFileChange(),this.exportLegacyOBS(!0),this.refreshStatusViews(),new n.Notice("\u76F4\u64AD\u6570\u636E\u5DF2\u91CD\u7F6E\uFF0C\u4E14\u7EDF\u8BA1\u5DF2\u6682\u505C\uFF0C\u8BF7\u624B\u52A8\u5F00\u59CB\u65B0\u7684\u573A\u6B21\uFF01")}}),this.addCommand({id:"create-next-chapter",name:"\u81EA\u52A8\u751F\u6210\u4E0B\u4E00\u7AE0 (\u5E26\u7F16\u53F7\u9012\u589E)",editorCallback:async(t,e)=>{let i=e.file;if(!i)return;let o=i.basename.match(/^([^0-9]*)(\d+)([章节回]?)/);if(!o){new n.Notice("\u5F53\u524D\u6587\u4EF6\u540D\u4E0D\u5305\u542B\u6570\u5B57\uFF0C\u65E0\u6CD5\u81EA\u52A8\u9012\u589E\uFF01");return}let r=o[1],l=o[2],h=o[3],c=(parseInt(l,10)+1).toString().padStart(l.length,"0"),d=`${r}${c}${h}.md`,u=i.parent?.path||"/",m=u==="/"?d:`${u}/${d}`,b=this.app.vault.getAbstractFileByPath(m);if(b){await this.app.workspace.getLeaf(!1).openFile(b);return}try{let f=await this.app.vault.create(m,"");await this.app.workspace.getLeaf(!1).openFile(f)}catch(f){console.error(f)}}}),this.registerEvent(this.app.workspace.on("file-menu",(t,e)=>{e instanceof n.TFile&&e.extension==="md"&&(t.addItem(i=>{i.setTitle("\u8BBE\u5B9A\u672C\u7AE0\u76EE\u6807\u5B57\u6570").setIcon("target").onClick(()=>{new k(this.app,e).open()})}),t.addItem(i=>{i.setTitle("\u4F5C\u4E3A\u60AC\u6D6E\u4FBF\u7B7E\u6253\u5F00").setIcon("popup-open").onClick(()=>{new v(this.app,this,{file:e}).load()})})),e instanceof n.TFolder&&t.addItem(i=>{i.setTitle("\u5408\u5E76\u5BFC\u51FA").setIcon("documents").onClick(async()=>{let a=new n.Notice(`\u6B63\u5728\u626B\u63CF\u5E76\u5408\u5E76\u300A${e.name}\u300B...`,0),o=[],r=d=>{for(let u of d.children)u instanceof n.TFile&&u.extension==="md"?o.push(u):u instanceof n.TFolder&&r(u)};if(r(e),o.length===0){a.hide(),new n.Notice(`\u6587\u4EF6\u5939\u300A${e.name}\u300B\u4E2D\u6CA1\u6709\u627E\u5230 Markdown \u6587\u4EF6\uFF01`);return}o.sort((d,u)=>d.path.localeCompare(u.path,"zh",{numeric:!0}));let l=`# \u3010\u5408\u5E76\u5BFC\u51FA\u3011${e.name}

`,h=0;for(let d of o){let u=await this.app.vault.cachedRead(d);l+=`

## ${d.basename}

`,l+=u,h+=this.calculateAccurateWords(u)}let p=`${e.parent?.path==="/"?"":e.parent?.path+"/"}${e.name}_\u5408\u5E76\u5BFC\u51FA.md`,c=1;for(;this.app.vault.getAbstractFileByPath(p);)p=`${e.parent?.path==="/"?"":e.parent?.path+"/"}${e.name}_\u5408\u5E76\u5BFC\u51FA(${c}).md`,c++;try{let d=await this.app.vault.create(p,l.trim());a.hide(),await this.app.workspace.getLeaf(!1).openFile(d),new n.Notice(`\u2705 \u5408\u5E76\u6210\u529F\uFF01
\u5171\u5408\u5E76 ${o.length} \u4E2A\u6587\u4EF6
\u603B\u8BA1 ${h.toLocaleString()} \u5B57`,8e3)}catch(d){console.error(d),a.hide(),new n.Notice("\u5408\u5E76\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u6743\u9650\uFF01")}})})})),this.registerEvent(this.app.workspace.on("editor-menu",(t,e,i)=>{e.somethingSelected()&&t.addItem(a=>{a.setTitle("\u5C06\u9009\u4E2D\u5185\u5BB9\u62BD\u51FA\u4E3A\u4FBF\u7B7E").setIcon("quote").onClick(()=>{new v(this.app,this,{content:e.getSelection(),title:"\u9009\u4E2D\u7247\u6BB5"}).load()})}),i.file&&(t.addItem(a=>{a.setTitle("\u8BBE\u5B9A\u672C\u7AE0\u76EE\u6807\u5B57\u6570").setIcon("target").onClick(()=>{new k(this.app,i.file).open()})}),t.addItem(a=>{a.setTitle("\u5F53\u524D\u6587\u4EF6\u4F5C\u4E3A\u4FBF\u7B7E\u62BD\u51FA").setIcon("popup-open").onClick(()=>{new v(this.app,this,{file:i.file}).load()})}))})),this.setupWorker(),this.settings.enableObs&&(this.obsServer=new P(this,this.settings.obsPort),this.obsServer.start()),this.addCommand({id:"copy-obs-overlay-url",name:"\u590D\u5236 OBS \u53E0\u52A0\u5C42 URL \u5230\u526A\u8D34\u677F",callback:()=>{let t=`http://127.0.0.1:${this.settings.obsPort}/`;navigator.clipboard.writeText(t),new n.Notice(`\u5DF2\u590D\u5236: ${t}`)}}),this.registerInterval(window.setInterval(()=>{this.isTracking&&this.saveSettings()},60*1e3))}onunload(){this.activeNotes.forEach(t=>{let e=this.settings.openNotes.findIndex(i=>i.id===t.state.id);e!==-1&&(this.settings.openNotes[e]=t.state)}),this.saveSettings(),this.removeGlobalStyles(),this.debounceManager.cancelAll(),this.cacheManager.clearCache(),this.worker&&this.worker.terminate(),this.obsServer?.stop(),this.activeNotes.forEach(t=>{t.containerEl&&t.containerEl.remove()}),this.activeNotes=[]}async buildFolderCache(){if(this.settings.showExplorerCounts)try{let t=new n.Notice("\u6B63\u5728\u6784\u5EFA\u6587\u4EF6\u5939\u5B57\u6570\u7F13\u5B58...",0);await this.cacheManager.buildInitialCache(this.app.vault,this.calculateAccurateWords.bind(this)),t.hide(),this.refreshFolderCounts(),new n.Notice("\u6587\u4EF6\u5939\u5B57\u6570\u7F13\u5B58\u6784\u5EFA\u5B8C\u6210",3e3)}catch(t){console.error("[Plugin] \u7F13\u5B58\u6784\u5EFA\u5931\u8D25:",t),this.settings.showExplorerCounts=!1,await this.saveSettings(),new n.Notice(`\u6587\u4EF6\u5939\u5B57\u6570\u7F13\u5B58\u6784\u5EFA\u5931\u8D25\uFF0C\u5DF2\u81EA\u52A8\u7981\u7528\u8BE5\u529F\u80FD
\u60A8\u53EF\u4EE5\u5728\u8BBE\u7F6E\u4E2D\u91CD\u65B0\u542F\u7528
\u9519\u8BEF: ${t instanceof Error?t.message:String(t)}`,1e4)}}async updateFileCacheAndRefresh(t){try{let e=await this.app.vault.cachedRead(t),i=this.calculateAccurateWords(e);this.cacheManager.updateFileCache(t,i,this.app.vault),this.refreshFolderCounts()}catch(e){console.error("[Plugin] \u66F4\u65B0\u6587\u4EF6\u7F13\u5B58\u5931\u8D25:",e),this.cacheManager.invalidateCache(t.path,this.app.vault)}}async toggleStatusView(){let{workspace:t}=this.app,e=t.getLeavesOfType(w);if(e.length>0)e.forEach(i=>i.detach());else{let i=t.getRightLeaf(!1);i&&(await i.setViewState({type:w,active:!0}),t.revealLeaf(i))}}async loadSettings(){this.settings=await this.settingsManager.loadSettings()}async saveSettings(){await this.settingsManager.saveSettings()}calculateAccurateWords(t){return t.replace(/\s+/g,"").length}handleEditorChange(){let t=this.app.workspace.getActiveViewOfType(n.MarkdownView);if(!t)return;this.lastEditTime=Date.now();let e=this.calculateAccurateWords(t.getViewData()),i=e-this.lastFileWords;this.sessionAddedWords+=i,this.lastFileWords=e;let a=window.moment().format("YYYY-MM-DD");this.settings.dailyHistory[a]||(this.settings.dailyHistory[a]={focusMs:0,slackMs:0,addedWords:0}),this.settings.dailyHistory[a].addedWords+=i,this.updateWordCount(),this.refreshStatusViews()}handleFileChange(){let t=this.app.workspace.getActiveViewOfType(n.MarkdownView);this.lastFileWords=t?this.calculateAccurateWords(t.getViewData()):0,this.updateWordCount(),this.refreshStatusViews()}updateWordCount(){let t=this.app.workspace.getActiveViewOfType(n.MarkdownView);if(!t){this.statusBarItemEl.setText("");return}let e=this.calculateAccurateWords(t.getViewData()),i=Math.max(0,this.sessionAddedWords),a=this.isTracking?"\u25B6\uFE0F\u8BB0\u5F55\u4E2D":"\u23F8\uFE0F\u5DF2\u6682\u505C";if(this.settings.showGoal&&t.file){let r=this.app.metadataCache.getFileCache(t.file),l=this.settings.defaultGoal;if(r?.frontmatter&&r.frontmatter["word-goal"]){let h=parseInt(r.frontmatter["word-goal"]);isNaN(h)||(l=h)}if(l>0){let h=Math.min(Math.round(e/l*100),100),p=h>=100?"\u2705":"\u{1F3AF}";this.statusBarItemEl.setText(`[${a}] ${p} \u5B57\u6570: ${e} / ${l} (${h}%) | \u51C0\u589E: ${i}`);return}}let o=(t.getViewData().match(/[\u4e00-\u9fa5]/g)||[]).length;this.statusBarItemEl.setText(`[${a}] \u{1F4DD} \u5B57\u6570: ${e} (\u7EAF\u6C49\u5B57: ${o}) | \u51C0\u589E: ${i}`)}setupWorker(){let t=`
			let interval;
			self.onmessage = function(e) {
				if (e.data === 'start') {
					clearInterval(interval);
					interval = setInterval(() => self.postMessage('tick'), 1000);
				} else if (e.data === 'stop') {
					clearInterval(interval);
				}
			};
		`,e=new Blob([t],{type:"application/javascript"});this.worker=new Worker(URL.createObjectURL(e)),this.worker.onerror=i=>{console.error("[WebNovel Assistant] Worker \u9519\u8BEF:",`
  \u6D88\u606F:`,i.message,`
  \u6587\u4EF6:`,i.filename,`
  \u884C\u53F7:`,i.lineno,`
  \u5217\u53F7:`,i.colno);let a=this.isTracking;this.worker&&(this.worker.terminate(),this.worker=null),setTimeout(()=>{console.log("[WebNovel Assistant] \u6B63\u5728\u91CD\u542F Worker..."),this.setupWorker(),a&&(this.worker?.postMessage("start"),console.log("[WebNovel Assistant] Worker \u5DF2\u91CD\u542F\uFF0C\u8FFD\u8E2A\u72B6\u6001\u5DF2\u6062\u590D")),new n.Notice(`\u26A0\uFE0F \u65F6\u95F4\u8FFD\u8E2A Worker \u5DF2\u81EA\u52A8\u91CD\u542F
\u8FFD\u8E2A\u529F\u80FD\u5DF2\u6062\u590D\u6B63\u5E38`,5e3)},5e3)},this.worker.onmessage=()=>{if(!this.isTracking)return;let i=Date.now(),a=i-this.lastTickTime;this.lastTickTime=i;let o=document.hasFocus(),r=i-this.lastEditTime<this.settings.idleTimeoutThreshold,l=window.moment().format("YYYY-MM-DD");this.settings.dailyHistory[l]||(this.settings.dailyHistory[l]={focusMs:0,slackMs:0,addedWords:0}),o&&r?(this.focusMs+=a,this.settings.dailyHistory[l].focusMs+=a):(this.slackMs+=a,this.settings.dailyHistory[l].slackMs+=a),this.refreshStatusViews(),this.settings.enableLegacyObsExport&&this.exportLegacyOBS(),this.settings.enableObs&&this.obsServer}}refreshStatusViews(){let t=this.app.workspace.getLeavesOfType(w);for(let e of t)e.view instanceof L&&e.view.updateData()}exportLegacyOBS(t=!1){if(!(!x()||!this.settings.enableLegacyObsExport||!this.settings.obsPath))try{let e=window.require("fs"),i=window.require("path"),a=this.settings.obsPath;e.existsSync(a)||e.mkdirSync(a,{recursive:!0});let o=Math.floor((this.focusMs+this.slackMs)/1e3),r=Math.floor(this.focusMs/1e3),l=o-r;e.writeFileSync(i.join(a,"obs_focus_time.txt"),y(r),"utf8"),e.writeFileSync(i.join(a,"obs_slack_time.txt"),y(l),"utf8"),e.writeFileSync(i.join(a,"obs_total_time.txt"),y(o),"utf8"),e.writeFileSync(i.join(a,"obs_words_done.txt"),Math.max(0,this.sessionAddedWords).toString(),"utf8");let h=this.settings.defaultGoal,p=this.app.workspace.getActiveViewOfType(n.MarkdownView);if(p?.file){let c=this.app.metadataCache.getFileCache(p.file),d=parseInt(c?.frontmatter?.["word-goal"]);isNaN(d)||(h=d)}e.writeFileSync(i.join(a,"obs_words_goal.txt"),h.toString(),"utf8")}catch(e){t&&console.error(e)}}getObsStats(){let t=Math.floor(this.focusMs/1e3),e=Math.floor(this.slackMs/1e3),i=t+e,a=window.moment().format("YYYY-MM-DD"),o=this.settings.dailyHistory[a]||{focusMs:0,slackMs:0,addedWords:0},r=this.settings.defaultGoal,l="",h=this.app.workspace.getActiveViewOfType(n.MarkdownView);if(h?.file){l=h.file.basename;let c=this.app.metadataCache.getFileCache(h.file),d=parseInt(c?.frontmatter?.["word-goal"]);isNaN(d)||(r=d)}let p=Math.max(0,o.addedWords);return{isTracking:this.isTracking,focusTime:y(t),slackTime:y(e),totalTime:y(i),sessionWords:Math.max(0,this.sessionAddedWords),todayWords:p,goal:r,percent:r>0?Math.min(Math.round(p/r*100),100):0,currentFile:l}}buildObsOverlayHtml(){let t=this.settings.obsOverlayTheme||"dark",e=t==="dark",i=this.settings.obsOverlayOpacity??.85,a=e?`rgba(20, 20, 30, ${i})`:`rgba(255, 255, 255, ${i})`,o=e?"#E8E8E8":"#2C3E50";if(t.startsWith("note-")){let b=parseInt(t.split("-")[1]),f=this.settings.noteThemes[b];f&&(a=E(f.bg,i),o=f.text,e=!1)}let r=e?"#888":"#999",l=e?"#6C9EFF":"#4A90D9",h="#4CAF50",p="#E74C3C",c="";(this.settings.obsShowFocusTime||this.settings.obsShowSlackTime||this.settings.obsShowTotalTime)&&(c=`
	<div class="time-row">`,this.settings.obsShowTotalTime&&(c+=`
		<div class="time-item"><div class="time-label">\u603B\u8BA1\u65F6\u957F</div><div class="time-value" id="totalTime">00:00:00</div></div>`),this.settings.obsShowFocusTime&&(c+=`
		<div class="time-item"><div class="time-label">\u4E13\u6CE8\u65F6\u957F</div><div class="time-value focus" id="focusTime">00:00:00</div></div>`),this.settings.obsShowSlackTime&&(c+=`
		<div class="time-item"><div class="time-label">\u6478\u9C7C\u65F6\u957F</div><div class="time-value slack" id="slackTime">00:00:00</div></div>`),c+=`
	</div>
	<div class="divider"></div>`);let d="";this.settings.obsShowTodayWords&&(d=`
	<div class="goal-row">
		<span class="goal-label">\u76EE\u6807\u8FDB\u5EA6</span>
		<span class="goal-value"><span id="todayWords" class="current-val">0</span> <span class="sep">/</span> <span id="goalValue" class="target-val">0</span><span class="percent" id="percentText">0%</span></span>
	</div>
	<div class="progress-bg">
		<div class="progress-fill" id="progressFill" style="width: 0%"></div>
	</div>`);let u="";return this.settings.obsShowSessionWords&&(u=`
	<div class="session-row">
		<span>\u672C\u573A\u51C0\u589E</span>
		<span class="val" id="sessionWords">0</span>
	</div>`),`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; 
* { 
    -webkit-font-smoothing: antialiased; 
    -moz-osx-font-smoothing: grayscale; 
} }
body {
	background: transparent;
	font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
	color: ${o};
	margin: 0;
	padding: 0;
	display: flex;
	justify-content: flex-start;
	align-items: flex-start;
}
.overlay-card {
	background: ${a};
	border-radius: 14px;
	padding: 20px 24px;
	backdrop-filter: ${i<.1?"none":"blur(12px)"};
	border: ${i<.1?"none":"1px solid "+(e?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)")};
	transition: all 0.3s ease;
	width: 280px; /* \u5DF2\u8FD8\u539F\u65E7\u7248\u5BBD\u5EA6 */
	display: flex;
	flex-direction: column;
	gap: 6px;
	zoom: 1.1; /* \u5DF2\u8FD8\u539F\u653E\u5927\u4F18\u5316 */
}
.overlay-title {
	font-size: 14px; /* \u5DF2\u8FD8\u539F\u65E7\u7248\u5B57\u53F7 */
	font-weight: 700;
	margin-bottom: 14px;
	display: flex;
	align-items: center;
	gap: 8px;
}
.status-dot {
	width: 12px; height: 12px; border-radius: 50%;
	display: inline-block;
}
.status-dot.active {
	background: ${h};
	animation: pulse 1.5s ease-in-out infinite;
}
.status-dot.paused {
	background: ${r};
}
@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.3; }
}


.time-label {
	font-size: 16px; /* \u5DF2\u8FD8\u539F\u65E7\u7248\u5B57\u53F7 */
	color: ${o};
	opacity: 0.9;
}
.time-value {
	font-family: 'Consolas', 'Courier New', monospace;
	font-size: 24px; /* \u5DF2\u8FD8\u539F\u65E7\u7248\u5B57\u53F7 */
	font-weight: 700;
	letter-spacing: 1px;
}
.time-value.focus { color: ${l}; }
.time-value.slack { color: ${p}; }
.divider {
	height: 1px;
	background: ${e?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)"};
	margin: 4px 0;
}





.goal-value .percent {
	font-size: 13px;
	color: ${l};
	margin-left: 6px;
}
.progress-bg {
	width: 100%;
	height: 6px;
	background: ${e?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)"};
	border-radius: 3px;
	overflow: hidden;
	margin-bottom: 10px;
}
.progress-fill {
	height: 100%;
	border-radius: 3px;
	background: ${l};
	transition: width 0.8s ease, background-color 0.5s ease;
}
.progress-fill.done {
	background: ${h};
}

.session-row .val {
	text-align: right;
	font-family: 'Consolas', monospace;
	font-weight: 600;
	color: ${o};
	opacity: 1;
}


.time-value, 

.goal-value .current-val { color: inherit; }
.goal-value .sep { opacity: 0.5; margin: 0 2px; }
.goal-value .target-val { opacity: 0.8; }


.goal-value.done .current-val { color: #E74C3C !important; } /* \u8FBE\u6210\u540E\u9ED8\u8BA4\u53D8\u7EA2 */


.time-row {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin-bottom: 6px;
}
.time-item {
	display: flex;
	justify-content: space-between;
	align-items: center;
	width: 100%;
}






.goal-row {
	display: flex;
	flex-direction: column;
	align-items: flex-end; /* \u6574\u4F53\u9760\u53F3 */
	width: 100%;
	margin-bottom: 4px;
	gap: 2px;
}
.goal-header {
	font-size: 16px; /* \u5DF2\u8FD8\u539F\u65E7\u7248\u5B57\u53F7 */
	color: ${o};
	opacity: 0.9;
	text-align: right;
}
.goal-value {
	display: flex;
	justify-content: flex-end;
	align-items: baseline;
	text-align: right;
	width: 100%;
	gap: 4px;
}
.goal-value .current-val { font-size: 24px; font-weight: 700; } /* \u5DF2\u8FD8\u539F\u65E7\u7248\u5B57\u53F7 */
.goal-value .target-val { font-size: 20px; opacity: 0.8; } /* \u5DF2\u8FD8\u539F\u65E7\u7248\u5B57\u53F7 */
.goal-value .sep { opacity: 0.4; }
.goal-value .percent { font-size: 14px; color: ${l}; font-weight: normal; } /* \u5DF2\u8FD8\u539F\u65E7\u7248\u5B57\u53F7 */

/* Custom User CSS */
${this.settings.obsCustomCss||""}
</style>
</head>
<body>
<div class="overlay-card">
	<div class="overlay-title">
		<span class="status-dot paused" id="statusDot"></span>
	</div>
	${c}
	${d}
	${u}
</div>
<script>
function safeSetText(id, text) {
	const el = document.getElementById(id);
	if (el) el.textContent = text;
}
let lastData = {};
function update() {
	fetch('/api/stats')
		.then(r => r.json())
		.then(d => {
			if (d.focusTime !== lastData.focusTime) safeSetText('focusTime', d.focusTime);
			if (d.slackTime !== lastData.slackTime) safeSetText('slackTime', d.slackTime);
			if (d.totalTime !== lastData.totalTime) safeSetText('totalTime', d.totalTime);
			if (d.todayWords !== lastData.todayWords) safeSetText('todayWords', d.todayWords.toLocaleString());
			if (d.goal !== lastData.goal) safeSetText('goalValue', d.goal.toLocaleString());
			if (d.percent !== lastData.percent) {
				safeSetText('percentText', d.percent + '%');
				const fill = document.getElementById('progressFill');
				if (fill) {
					fill.style.width = d.percent + '%';
					fill.className = 'progress-fill' + (d.percent >= 100 ? ' done' : '');
				}
				const goalValContainer = document.querySelector('.goal-value');
				if (goalValContainer) {
					if (d.percent >= 100) goalValContainer.classList.add('done');
					else goalValContainer.classList.remove('done');
				}
			}
			if (d.sessionWords !== lastData.sessionWords) safeSetText('sessionWords', d.sessionWords.toLocaleString());

			if (d.isTracking !== lastData.isTracking) {
				const dot = document.getElementById('statusDot');
				if (dot) dot.className = 'status-dot ' + (d.isTracking ? 'active' : 'paused');
			}
			lastData = d;
		})
		.catch(() => {})
		.finally(() => {
			setTimeout(update, 500);
		});
}
update();
<\/script>
</body>
</html>`}async refreshFolderCounts(){let t=this.app.workspace.getLeavesOfType("file-explorer")[0];if(!t)return;let e=t.view.fileItems;if(!this.settings.showExplorerCounts){for(let i in e){let a=e[i];if(a.el){let o=a.el.querySelector(".folder-word-count");o&&o.remove()}}return}for(let i in e){let a=e[i];if(a.el&&(a.file instanceof n.TFolder||a.file instanceof n.TFile&&a.file.extension==="md")){let o=this.cacheManager.getFolderCount(i)||0,r=a.el.querySelector(".folder-word-count");if(!r){let l=a.el.querySelector(".nav-folder-title-content")||a.el.querySelector(".nav-file-title-content");l&&(r=l.createEl("span",{cls:"folder-word-count"}))}r&&(r.setText(o>0?` (${S(o)})`:""),r.style.fontSize="0.8em",r.style.opacity="0.5",r.style.marginLeft="5px")}}}injectGlobalStyles(){M("accurate-count-global-styles",`
				.folder-word-count { font-variant-numeric: tabular-nums; pointer-events: none; }
				
				/* \u4FA7\u8FB9\u680F\u72B6\u6001\u89C6\u56FE\u6837\u5F0F */
				.status-view-container { padding: 15px; }
				.status-card { background: var(--background-secondary); border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--background-modifier-border); }
				
				.status-title { font-weight: bold; margin-bottom: 12px; font-size: 1.1em; display: flex; flex-direction: row; align-items: center; justify-content: space-between; }
				.status-title-badge { font-size: 0.75em; background: var(--interactive-accent); color: #ffffff; padding: 2px 6px; border-radius: 4px; font-weight: normal; }
				
				/* \u76EE\u6807\u8FDB\u5EA6\u663E\u793A - \u53F3\u5BF9\u9F50\uFF0C\u4E0A\u65B9\u7559\u7A7A */
				.goal-display-row-right { display: flex; align-items: baseline; justify-content: flex-end; gap: 4px; margin-top: 18px; margin-bottom: 12px; font-family: var(--font-monospace); flex-wrap: wrap; }
				.goal-current { font-size: 1.8em; font-weight: bold; color: var(--text-normal); }
				.goal-separator { font-size: 1.1em; color: var(--text-muted); opacity: 0.5; }
				.goal-target { font-size: 1.4em; color: var(--text-muted); opacity: 0.8; }
				.goal-percent { font-size: 1.1em; color: var(--interactive-accent); font-weight: 600; margin-left: 8px; }
				
				.progress-bar-bg { width: 100%; height: 10px; background: var(--background-modifier-border); border-radius: 5px; overflow: hidden; margin: 0; }
				.progress-bar-fill { height: 100%; background: var(--interactive-accent); transition: width 0.3s ease; }
				
				/* \u65F6\u95F4\u7EDF\u8BA1\u5E03\u5C40 */
				.time-box-total { background: var(--background-primary); padding: 12px; border-radius: 6px; text-align: center; border: 1px solid var(--background-modifier-border); margin-bottom: 10px; }
				.time-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
				.time-box { background: var(--background-primary); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid var(--background-modifier-border); min-width: 0; }
				.time-box-title { font-size: 0.8em; color: var(--text-muted); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				.time-box-value { font-family: var(--font-monospace); font-size: 1.1em; font-weight: bold; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				
				.history-chart { margin-top: 20px; padding-top: 15px; border-top: 1px dashed var(--background-modifier-border); }
				.history-chart-title { font-size: 0.95em; font-weight: 600; color: var(--text-normal); margin-bottom: 4px; }
				.history-chart-subtitle { font-size: 0.75em; color: var(--text-muted); margin-bottom: 8px; cursor: pointer; }
				.history-chart-subtitle:hover { color: var(--interactive-accent); text-decoration: underline; }

				/* \u5B57\u6570\u7EDF\u8BA1 Modal \u6837\u5F0F */
				.history-stats-modal { min-width: 600px; }
				.stats-tab-group { display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px; }
				.stats-tab-btn { background: transparent; border: none; box-shadow: none; color: var(--text-muted); cursor: pointer; padding: 6px 12px; border-radius: 4px; transition: all 0.2s; }
				.stats-tab-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
				.stats-tab-btn.is-active { background: var(--interactive-accent); color: var(--text-on-accent); font-weight: bold; }
				
				.stats-large-chart-container { display: flex; align-items: flex-end; justify-content: space-around; height: 300px; padding: 20px 0 10px 0; border-bottom: 1px dashed var(--background-modifier-border); margin-top: 10px; overflow-x: auto; gap: 8px;}
				.stats-large-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 35px; flex: 1; max-width: 60px; }
				.stats-large-bar { width: 100%; background: var(--interactive-accent); border-radius: 4px 4px 0 0; opacity: 0.8; transition: height 0.4s ease, opacity 0.2s; cursor: crosshair; }
				.stats-large-bar:hover { opacity: 1; filter: brightness(1.2); }
				.stats-large-label { font-size: 0.7em; margin-top: 8px; color: var(--text-muted); white-space: nowrap; }
				.stats-large-value { font-size: 0.75em; margin-top: 4px; font-weight: bold; font-family: var(--font-monospace); }

				/* \u79FB\u52A8\u7AEF\u89E6\u6478\u4F18\u5316 (\u9700\u6C42 8.5) */
				@media (hover: none) and (pointer: coarse) {
					/* \u7981\u7528\u60AC\u505C\u6548\u679C */
					.stats-tab-btn:hover { background: transparent; color: var(--text-muted); }
					.history-chart-subtitle:hover { color: var(--text-muted); text-decoration: none; }
					.stats-large-bar:hover { opacity: 0.8; filter: none; }
					
					/* \u589E\u5927\u89E6\u6478\u76EE\u6807 - \u6700\u5C0F 44px */
					.stats-tab-btn { min-height: 44px; padding: 12px 16px; }
					button, .clickable-icon { min-height: 44px; min-width: 44px; }
					
					/* \u589E\u52A0\u95F4\u8DDD\u4EE5\u907F\u514D\u8BEF\u89E6 */
					.stats-tab-group { gap: 12px; }
					.time-grid { gap: 12px; }
					
					/* \u4F18\u5316\u79FB\u52A8\u7AEF\u5361\u7247\u95F4\u8DDD */
					.status-card { padding: 18px; margin-bottom: 18px; }
				}
			`)}removeGlobalStyles(){B("accurate-count-global-styles")}},L=class extends n.ItemView{constructor(s,t){super(s),this.plugin=t}getViewType(){return w}getDisplayText(){return"\u5199\u4F5C\u5B9E\u65F6\u72B6\u6001"}getIcon(){return"bar-chart-2"}async onOpen(){let s=this.containerEl.children[1];s.empty(),s.addClass("status-view-container");let t=s.createDiv({cls:"status-card"}),e=t.createDiv({cls:"status-title"});e.createSpan({text:"\u4ECA\u65E5\u72B6\u6001"}),this.statusBadgeEl=e.createSpan({cls:"status-title-badge",text:"\u5DF2\u6682\u505C"});let i=t.createDiv({cls:"goal-display-row-right"});this.todayWordEl=i.createSpan({cls:"goal-current",text:"0"}),i.createSpan({cls:"goal-separator",text:" / "}),this.goalWordEl=i.createSpan({cls:"goal-target",text:"0"}),this.percentEl=i.createSpan({cls:"goal-percent",text:"0%"});let a=t.createDiv({cls:"progress-bar-bg"});this.progressFillEl=a.createDiv({cls:"progress-bar-fill"});let o=s.createDiv({cls:"status-card"});o.createDiv({cls:"status-title",text:"\u672C\u6B21\u7EDF\u8BA1"});let r=o.createDiv({cls:"time-box time-box-total"});r.createDiv({cls:"time-box-title",text:"\u603B\u8BA1\u8017\u65F6"}),this.totalTimeEl=r.createDiv({cls:"time-box-value",text:"00:00:00"});let l=o.createDiv({cls:"time-grid"}),h=l.createDiv({cls:"time-box"});h.createDiv({cls:"time-box-title",text:"\u4E13\u6CE8\u65F6\u957F"}),this.focusTimeEl=h.createDiv({cls:"time-box-value",text:"00:00:00"});let p=l.createDiv({cls:"time-box"});p.createDiv({cls:"time-box-title",text:"\u6478\u9C7C\u65F6\u957F"}),this.slackTimeEl=p.createDiv({cls:"time-box-value",text:"00:00:00"}),this.chartContainerEl=o.createDiv({cls:"history-chart"});let c=s.createDiv({cls:"status-card"});c.createDiv({cls:"status-title",text:"\u5B57\u6570\u7EDF\u8BA1"});let d=c.createDiv({cls:"time-grid"}),u=d.createDiv({cls:"time-box"});u.createDiv({cls:"time-box-title",text:"\u672C\u5468\u51C0\u589E"}),this.weekWordEl=u.createDiv({cls:"time-box-value",text:"0"});let m=d.createDiv({cls:"time-box"});m.createDiv({cls:"time-box-title",text:"\u672C\u6708\u51C0\u589E"}),this.monthWordEl=m.createDiv({cls:"time-box-value",text:"0"});let b=d.createDiv({cls:"time-box"});b.createDiv({cls:"time-box-title",text:"\u4ECA\u5E74\u51C0\u589E"}),this.yearWordEl=b.createDiv({cls:"time-box-value",text:"0"});let f=d.createDiv({cls:"time-box"});f.createDiv({cls:"time-box-title",text:"\u7D2F\u8BA1\u603B\u5B57\u6570"}),this.historyTotalWordEl=f.createDiv({cls:"time-box-value",text:"0"}),this.updateData(),this.renderChart()}updateData(){this.plugin.isTracking?(this.statusBadgeEl.innerText="\u25B6 \u8BB0\u5F55\u4E2D",this.statusBadgeEl.style.background="var(--color-green)",this.statusBadgeEl.style.color="#ffffff"):(this.statusBadgeEl.innerText="\u23F8 \u5DF2\u6682\u505C",this.statusBadgeEl.style.background="var(--text-muted)",this.statusBadgeEl.style.color="#ffffff");let s=this.plugin.settings.defaultGoal,t=this.plugin.app.workspace.getActiveViewOfType(n.MarkdownView);if(t?.file){let b=this.plugin.app.metadataCache.getFileCache(t.file),f=parseInt(b?.frontmatter?.["word-goal"]);isNaN(f)||(s=f)}let e=window.moment().format("YYYY-MM-DD"),i=this.plugin.settings.dailyHistory[e]||{focusMs:0,slackMs:0,addedWords:0},a=Math.max(0,i.addedWords);this.todayWordEl.innerText=a.toLocaleString(),this.goalWordEl.innerText=s.toLocaleString();let o=s>0?Math.min(Math.round(a/s*100),100):0;this.percentEl.innerText=` ${o}%`,this.progressFillEl.style.width=`${o}%`,o>=100?(this.progressFillEl.style.background="var(--color-green)",this.todayWordEl.style.color="var(--color-green)"):(this.progressFillEl.style.background="var(--interactive-accent)",this.todayWordEl.style.color="var(--text-normal)");let r=Math.floor(this.plugin.focusMs/1e3),l=Math.floor(this.plugin.slackMs/1e3),h=r+l;this.focusTimeEl.innerText=y(r),this.slackTimeEl.innerText=y(l),this.totalTimeEl.innerText=y(h);let p=0,c=0,d=0,u=0,m=window.moment();for(let[b,f]of Object.entries(this.plugin.settings.dailyHistory)){let C=f.addedWords||0;u+=C;let $=window.moment(b);$.isSame(m,"isoWeek")&&(p+=C),$.isSame(m,"month")&&(c+=C),$.isSame(m,"year")&&(d+=C)}this.weekWordEl&&(this.weekWordEl.innerText=Math.max(0,p).toLocaleString()),this.monthWordEl&&(this.monthWordEl.innerText=Math.max(0,c).toLocaleString()),this.yearWordEl&&(this.yearWordEl.innerText=Math.max(0,d).toLocaleString()),this.historyTotalWordEl&&(this.historyTotalWordEl.innerText=Math.max(0,u).toLocaleString())}renderChart(){this.chartContainerEl.empty();let s=this.chartContainerEl.createDiv({text:"\u8FD17\u65E5\u5B57\u6570\u7EDF\u8BA1",cls:"history-chart-title"}),t=this.chartContainerEl.createDiv({text:"\u70B9\u51FB\u67E5\u770B\u8BE6\u60C5",cls:"history-chart-subtitle"});t.setAttribute("aria-label","\u70B9\u51FB\u8FDB\u5165\u5B57\u6570\u7EDF\u8BA1\u8BE6\u60C5"),t.onclick=()=>{new O(this.plugin.app,this.plugin.settings.dailyHistory).open()};let e=this.chartContainerEl.createDiv({attr:{style:"display: flex; flex-direction: column; gap: 6px; cursor: pointer;"}});e.onclick=()=>{new O(this.plugin.app,this.plugin.settings.dailyHistory).open()};let i=this.plugin.settings.dailyHistory,a=Object.keys(i).sort().slice(-7);if(a.length===0){e.createDiv({text:"\u6682\u65E0\u5386\u53F2\u6570\u636E",attr:{style:"color: var(--text-muted); font-size: 0.8em; padding: 10px 0;"}});return}let o=Math.max(...a.map(r=>i[r].addedWords),100);a.forEach(r=>{let l=i[r],h=e.createDiv({attr:{style:"display: flex; align-items: center; gap: 8px;"}}),p=h.createDiv({text:r.substring(5),attr:{style:"font-size: 0.7em; color: var(--text-muted); min-width: 35px; text-align: right; flex-shrink: 0;"}}),c=h.createDiv({attr:{style:"flex: 1; height: 18px; background: var(--background-modifier-border); border-radius: 3px; overflow: hidden; position: relative; min-width: 0;"}}),d=Math.max(2,Math.max(0,l.addedWords)/o*100),u=c.createDiv({attr:{style:`width: ${d}%; height: 100%; background: var(--interactive-accent); border-radius: 3px; transition: width 0.4s ease;`}}),m=(l.focusMs/36e5).toFixed(1);u.setAttribute("title",`\u65E5\u671F: ${r}
\u5B57\u6570: ${Math.max(0,l.addedWords)}
\u4E13\u6CE8\u65F6\u957F: ${m}h`);let b=h.createDiv({text:S(Math.max(0,l.addedWords)),attr:{style:"font-size: 0.75em; font-weight: bold; font-family: var(--font-monospace); min-width: 40px; text-align: right; flex-shrink: 0;"}})})}async onClose(){}},k=class extends n.Modal{constructor(t,e){super(t);this.goalInput="";this.file=e}onOpen(){let{contentEl:t}=this;t.createEl("h2",{text:`\u4E3A\u300A${this.file.basename}\u300B\u8BBE\u5B9A\u76EE\u6807`}),new n.Setting(t).setName("\u76EE\u6807\u5B57\u6570").setDesc("\u8F93\u5165 0 \u6216\u6E05\u7A7A\u5219\u6062\u590D\u5168\u5C40\u9ED8\u8BA4\u76EE\u6807\u3002").addText(e=>{let i=this.app.metadataCache.getFileCache(this.file);i?.frontmatter&&i.frontmatter["word-goal"]&&e.setValue(i.frontmatter["word-goal"].toString()),e.inputEl.focus(),e.onChange(a=>{this.goalInput=a}),e.inputEl.addEventListener("keydown",a=>{a.key==="Enter"&&this.saveGoal()})}),new n.Setting(t).addButton(e=>e.setButtonText("\u4FDD\u5B58").setCta().onClick(()=>{this.saveGoal()}))}async saveGoal(){let t=parseInt(this.goalInput);await this.app.fileManager.processFrontMatter(this.file,e=>{isNaN(t)||t<=0?delete e["word-goal"]:e["word-goal"]=t}),this.close()}onClose(){this.contentEl.empty()}},V=class extends n.PluginSettingTab{constructor(s,t){super(s,t),this.plugin=t}display(){let{containerEl:s}=this;if(s.empty(),D()){let t=s.createDiv({cls:"setting-item-description",attr:{style:"background: var(--background-secondary); padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 3px solid var(--interactive-accent);"}});t.createEl("strong",{text:"\u{1F4A1} \u79FB\u52A8\u7AEF\u6A21\u5F0F"}),t.createEl("br"),t.appendText("\u90E8\u5206\u9AD8\u7EA7\u529F\u80FD(\u60AC\u6D6E\u4FBF\u7B7E\u3001OBS \u76F4\u64AD\u53E0\u52A0\u5C42\u3001\u6587\u672C\u6587\u4EF6\u5BFC\u51FA)\u4EC5\u5728\u684C\u9762\u7AEF\u53EF\u7528,\u4EE5\u4F18\u5316\u79FB\u52A8\u8BBE\u5907\u6027\u80FD\u548C\u7535\u6C60\u7EED\u822A\u3002")}if(s.createEl("h2",{text:"\u7CBE\u51C6\u5B57\u6570\u4E0E\u76EE\u6807\u8BBE\u7F6E"}),new n.Setting(s).setName("\u663E\u793A\u76EE\u6807\u8FDB\u5EA6").setDesc("\u5728\u72B6\u6001\u680F\u663E\u793A\u5F53\u524D\u6587\u4EF6\u7684\u5B57\u6570\u5B8C\u6210\u8FDB\u5EA6\u3002").addToggle(t=>t.setValue(this.plugin.settings.showGoal).onChange(async e=>{this.plugin.settings.showGoal=e,await this.plugin.saveSettings(),this.plugin.updateWordCount()})),new n.Setting(s).setName("\u663E\u793A\u6587\u4EF6\u5217\u8868\u5B57\u6570").setDesc("\u5728\u4FA7\u8FB9\u680F\u6587\u4EF6\u6811\u4E2D\u663E\u793A\u6587\u4EF6\u5939\u548C\u6587\u6863\u7684\u6C47\u603B\u5B57\u6570\u3002").addToggle(t=>t.setValue(this.plugin.settings.showExplorerCounts).onChange(async e=>{this.plugin.settings.showExplorerCounts=e,await this.plugin.saveSettings(),e?await this.plugin.buildFolderCache():this.plugin.refreshFolderCounts()})),new n.Setting(s).setName("\u9ED8\u8BA4\u5B57\u6570\u76EE\u6807 (\u5168\u5C40)").addText(t=>t.setValue(this.plugin.settings.defaultGoal.toString()).onChange(async e=>{let i=parseInt(e);isNaN(i)||(this.plugin.settings.defaultGoal=i,await this.plugin.saveSettings())})),x()){s.createEl("h2",{text:"\u60AC\u6D6E\u4FBF\u7B7E\u8BBE\u7F6E"}),new n.Setting(s).setName("\u95F2\u7F6E\u65F6\u900F\u660E\u5EA6 (\u4EC5\u80CC\u666F)").setDesc("\u8C03\u8282\u4FBF\u7B7E\u5728\u95F2\u7F6E\u65F6\u7684\u7EAF\u80CC\u666F\u900F\u660E\u5EA6\u3002\u62D6\u52A8\u6ED1\u5757\u65F6\u5DF2\u6253\u5F00\u7684\u4FBF\u7B7E\u4F1A\u5B9E\u65F6\u9884\u89C8\uFF01").addSlider(i=>i.setLimits(.1,1,.05).setValue(this.plugin.settings.noteOpacity).setDynamicTooltip().onChange(async a=>{this.plugin.settings.noteOpacity=a,await this.plugin.saveSettings(),this.plugin.activeNotes.forEach(o=>o.updateVisuals())}));let e=new n.Setting(s).setName("\u81EA\u5B9A\u4E49\u4E3B\u9898\u65B9\u6848 (\u80CC\u666F\u8272 + \u6587\u5B57\u8272)").setDesc("\u81EA\u5B9A\u4E49\u4FBF\u7B7E\u8C03\u8272\u677F\u4E2D\u7684 6 \u79CD\u9884\u8BBE\u7EC4\u5408\u3002\u5DE6\u4FA7\u4E3A\u80CC\u666F\u8272\uFF0C\u53F3\u4FA7\u4E3A\u5BF9\u5E94\u7684\u6587\u5B57/\u56FE\u6807\u8272\u3002").controlEl.createDiv({attr:{style:"display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;"}});this.plugin.settings.noteThemes.forEach((i,a)=>{let o=e.createDiv({attr:{style:"display: flex; align-items: center; gap: 6px; background: var(--background-modifier-form-field); padding: 4px 8px; border-radius: 6px;"}}),r=o.createEl("input",{type:"color",value:i.bg});r.style.cursor="pointer",r.style.border="none",r.style.padding="0",r.style.width="24px",r.style.height="24px",r.style.borderRadius="4px",o.createSpan({text:"Aa",attr:{style:"font-weight: bold; font-family: serif; color: var(--text-muted); padding-left: 2px;"}});let l=o.createEl("input",{type:"color",value:i.text});l.style.cursor="pointer",l.style.border="none",l.style.padding="0",l.style.width="24px",l.style.height="24px",l.style.borderRadius="4px",r.onchange=async h=>{this.plugin.settings.noteThemes[a].bg=h.target.value,await this.plugin.saveSettings()},l.onchange=async h=>{this.plugin.settings.noteThemes[a].text=h.target.value,await this.plugin.saveSettings()}})}x()&&(s.createEl("h2",{text:"\u6570\u636E\u7EDF\u8BA1\u4E0E\u8F93\u51FA\u8BBE\u7F6E"}),new n.Setting(s).setName("\u7CBE\u51C6\u4E13\u6CE8\u5EA6\u5224\u5B9A\u9608\u503C (\u79D2)").setDesc("\u5728\u6B64\u65F6\u95F4\u5185\u6CA1\u6709\u952E\u76D8\u8F93\u5165\uFF0C\u5373\u4F7F\u8F6F\u4EF6\u5904\u4E8E\u805A\u7126\u72B6\u6001\uFF0C\u4E5F\u4F1A\u88AB\u5224\u5B9A\u4E3A\u201C\u6478\u9C7C\u201D\u3002").addSlider(t=>t.setLimits(30,600,30).setValue(this.plugin.settings.idleTimeoutThreshold/1e3).setDynamicTooltip().onChange(async e=>{this.plugin.settings.idleTimeoutThreshold=e*1e3,await this.plugin.saveSettings()})),new n.Setting(s).setName("\u542F\u7528 OBS \u76F4\u64AD\u53E0\u52A0\u5C42").setDesc("\u5728\u672C\u5730\u542F\u52A8 HTTP \u670D\u52A1\uFF0COBS \u901A\u8FC7\u300C\u6D4F\u89C8\u5668\u6E90\u300D\u52A0\u8F7D\u5B9E\u65F6\u7EDF\u8BA1\u9762\u677F\uFF0C\u96F6\u78C1\u76D8 I/O\u3002").addToggle(t=>t.setValue(this.plugin.settings.enableObs).onChange(async e=>{this.plugin.settings.enableObs=e,await this.plugin.saveSettings(),e?(this.plugin.obsServer||(this.plugin.obsServer=new P(this.plugin,this.plugin.settings.obsPort)),this.plugin.obsServer.start()):this.plugin.obsServer?.stop()})),new n.Setting(s).setName("\u53E0\u52A0\u5C42\u7AEF\u53E3").setDesc("OBS \u6D4F\u89C8\u5668\u6E90\u8BBF\u95EE\u7684\u7AEF\u53E3\u53F7\uFF0C\u4FEE\u6539\u540E\u9700\u91CD\u542F\u53E0\u52A0\u5C42\u3002").addText(t=>t.setValue(this.plugin.settings.obsPort.toString()).onChange(async e=>{let i=parseInt(e);!isNaN(i)&&i>0&&i<65536&&(this.plugin.settings.obsPort=i,await this.plugin.saveSettings())})),new n.Setting(s).setName("\u53E0\u52A0\u5C42\u80CC\u666F\u900F\u660E\u5EA6").setDesc("\u8C03\u6574 OBS \u53E0\u52A0\u5C42\u5361\u7247\u80CC\u666F\u7684\u900F\u660E\u5EA6 (0\u4E3A\u5B8C\u5168\u900F\u660E)\u3002\u6CE8\u610F\uFF1A\u6B64\u9879\u4E0D\u5F71\u54CD\u900F\u660E\u80CC\u666F\u7684\u4E3B\u9898\uFF0C\u4EC5\u5BF9\u5E26\u5361\u7247\u7684\u4E3B\u9898\u751F\u6548\u3002").addSlider(t=>t.setLimits(0,1,.05).setValue(this.plugin.settings.obsOverlayOpacity??.85).setDynamicTooltip().onChange(async e=>{this.plugin.settings.obsOverlayOpacity=e,await this.plugin.saveSettings()})),new n.Setting(s).setName("\u81EA\u5B9A\u4E49 CSS").setDesc("\u901A\u8FC7\u8986\u76D6 CSS \u7C7B\u540D\u4FEE\u6539\u6837\u5F0F\uFF0C\u5E38\u7528\u7C7B\u540D\uFF1A.overlay-card(\u5916\u58F3), .time-value.focus(\u4E13\u6CE8\u65F6\u95F4), .time-value.slack(\u6478\u9C7C\u65F6\u95F4), .goal-value(\u76EE\u6807\u8FDB\u5EA6), .status-dot(\u72B6\u6001\u70B9)").addTextArea(t=>(t.setPlaceholder("/* \u4F8B\uFF1A\u4FEE\u6539\u6478\u9C7C\u65F6\u95F4\u4E3A\u7EFF\u8272 */ .time-value.slack { color: #4CAF50 !important; }").setValue(this.plugin.settings.obsCustomCss).onChange(async e=>{this.plugin.settings.obsCustomCss=e,await this.plugin.saveSettings()}),t.inputEl.style.width="100%",t.inputEl.style.height="100px",t.inputEl.style.fontFamily="monospace",t)),new n.Setting(s).setName("\u53E0\u52A0\u5C42\u4E3B\u9898").addDropdown(t=>{t.addOption("dark","\u6697\u8272 (\u6DF1\u8272\u80CC\u666F+\u767D\u5B57)"),t.addOption("light","\u4EAE\u8272 (\u6D45\u8272\u80CC\u666F+\u6DF1\u5B57)"),this.plugin.settings.noteThemes.forEach((e,i)=>{t.addOption(`note-${i}`,`\u4FBF\u7B7E\u9884\u8BBE\u8272 ${i+1}`)}),t.setValue(this.plugin.settings.obsOverlayTheme),t.onChange(async e=>{this.plugin.settings.obsOverlayTheme=e,await this.plugin.saveSettings()})}),new n.Setting(s).setName("\u663E\u793A\u603B\u8BA1\u65F6\u95F4").addToggle(t=>t.setValue(this.plugin.settings.obsShowTotalTime).onChange(async e=>{this.plugin.settings.obsShowTotalTime=e,await this.plugin.saveSettings()})),new n.Setting(s).setName("\u663E\u793A\u4E13\u6CE8\u65F6\u95F4").addToggle(t=>t.setValue(this.plugin.settings.obsShowFocusTime).onChange(async e=>{this.plugin.settings.obsShowFocusTime=e,await this.plugin.saveSettings()})),new n.Setting(s).setName("\u663E\u793A\u6478\u9C7C\u65F6\u95F4").addToggle(t=>t.setValue(this.plugin.settings.obsShowSlackTime).onChange(async e=>{this.plugin.settings.obsShowSlackTime=e,await this.plugin.saveSettings()})),new n.Setting(s).setName("\u663E\u793A\u76EE\u6807\u8FDB\u5EA6").addToggle(t=>t.setValue(this.plugin.settings.obsShowTodayWords).onChange(async e=>{this.plugin.settings.obsShowTodayWords=e,await this.plugin.saveSettings()})),new n.Setting(s).setName("\u663E\u793A\u672C\u573A\u51C0\u589E").addToggle(t=>t.setValue(this.plugin.settings.obsShowSessionWords).onChange(async e=>{this.plugin.settings.obsShowSessionWords=e,await this.plugin.saveSettings()})),new n.Setting(s).setName("\u590D\u5236 OBS \u53E0\u52A0\u5C42 URL").setDesc("\u70B9\u51FB\u540E\u590D\u5236 URL\uFF0C\u5728 OBS \u4E2D\u6DFB\u52A0\u300C\u6D4F\u89C8\u5668\u6E90\u300D\u5E76\u7C98\u8D34\u6B64 URL\u3002").addButton(t=>t.setButtonText("\u590D\u5236 URL").onClick(()=>{let e=`http://127.0.0.1:${this.plugin.settings.obsPort}/`;navigator.clipboard.writeText(e),new n.Notice(`\u5DF2\u590D\u5236: ${e}`)})),s.createEl("h3",{text:"\u6587\u672C\u6587\u4EF6\u5BFC\u51FA (\u517C\u5BB9)"}),new n.Setting(s).setName("\u542F\u7528\u672C\u5730\u6587\u672C\u6587\u4EF6\u5BFC\u51FA").setDesc("\u5F00\u542F\u540E\uFF0C\u63D2\u4EF6\u5C06\u50CF\u4EE5\u524D\u4E00\u6837\u6BCF\u79D2\u5C06\u4E13\u6CE8\u65F6\u95F4\u3001\u6478\u9C7C\u65F6\u95F4\u7B49\u6570\u636E\u5199\u5165\u7EAF\u6587\u672C\u6587\u4EF6\u4E2D\u3002").addToggle(t=>t.setValue(this.plugin.settings.enableLegacyObsExport).onChange(async e=>{this.plugin.settings.enableLegacyObsExport=e,await this.plugin.saveSettings()})),new n.Setting(s).setName("\u6570\u636E\u8F93\u51FA\u8DEF\u5F84 (\u7EDD\u5BF9\u8DEF\u5F84)").setDesc("\u8BF7\u586B\u5165\u7EDD\u5BF9\u8DEF\u5F84 (\u4F8B\u5982 D:\\OBS\\Stats)").addText(t=>t.setPlaceholder("\u8BF7\u8F93\u5165\u6587\u4EF6\u5939\u8DEF\u5F84").setValue(this.plugin.settings.obsPath).onChange(async e=>{this.plugin.settings.obsPath=e,await this.plugin.saveSettings()})))}},v=class extends n.Component{constructor(s,t,e){super(),this.app=s,this.plugin=t,e.state?(this.state=e.state,this.state.zoomLevel||(this.state.zoomLevel=1),this.state.textColor||(this.state.textColor="#2C3E50")):this.state={id:Math.random().toString(36).substring(2,11),filePath:e.file?.path,content:e.content||"",title:e.title||(e.file?e.file.basename:"\u65B0\u4FBF\u7B7E"),top:"150px",left:"150px",width:"320px",height:"450px",color:this.plugin.settings.noteThemes[0].bg,textColor:this.plugin.settings.noteThemes[0].text,isEditing:!e.file&&!e.content,isPinned:!1,zoomLevel:1}}async onload(){if(this.plugin.activeNotes.push(this),this.injectCSS(),this.containerEl=document.body.createDiv({cls:"my-floating-sticky-note"}),this.state.filePath&&!this.state.content){let c=this.app.vault.getAbstractFileByPath(this.state.filePath);c instanceof n.TFile&&(this.state.content=await this.app.vault.read(c))}this.updateVisuals(),this.containerEl.addEventListener("wheel",c=>{if(c.ctrlKey||c.metaKey){c.preventDefault(),c.stopPropagation();let d=this.state.zoomLevel||1,u=.1,m=c.deltaY<0?u:-u;this.state.zoomLevel=Math.max(.5,Math.min(4,d+m)),this.updateVisuals(),this.saveState()}},{passive:!1});let s=this.containerEl.createDiv({cls:"my-sticky-header"}),t=s.createDiv({cls:"my-sticky-title-wrapper"}),e=t.createSpan({cls:"my-sticky-title-icon"});(0,n.setIcon)(e,"sticky-note"),t.createSpan({text:this.state.title||"",cls:"my-sticky-title"});let i=s.createDiv({cls:"my-sticky-controls"}),a=i.createEl("button",{cls:"my-sticky-btn"});(0,n.setIcon)(a,"pin"),this.state.isPinned&&a.classList.add("is-active");let o=i.createEl("button",{cls:"my-sticky-btn"});(0,n.setIcon)(o,"save");let r=i.createEl("button",{cls:"my-sticky-btn"});(0,n.setIcon)(r,this.state.isEditing?"eye":"pencil");let l=i.createEl("button",{cls:"my-sticky-btn palette-btn-target"});(0,n.setIcon)(l,"palette");let h=i.createEl("button",{cls:"my-sticky-close"});(0,n.setIcon)(h,"x"),this.contentContainer=this.containerEl.createDiv({cls:"my-sticky-content markdown-rendered"}),this.textareaEl=this.containerEl.createEl("textarea",{cls:"my-sticky-textarea"});let p=i.createDiv({cls:"my-sticky-palette-popup"});this.plugin.settings.noteThemes.forEach(c=>{let d=p.createDiv({cls:"my-sticky-swatch"});d.style.backgroundColor=c.bg,d.style.color=c.text,d.innerText="Aa",d.onclick=u=>{u.stopPropagation(),this.state.color=c.bg,this.state.textColor=c.text,this.updateVisuals(),this.saveState(),p.classList.remove("is-active")}}),this.containerEl.addEventListener("click",c=>{!c.target.closest(".my-sticky-palette-popup")&&!c.target.closest(".palette-btn-target")&&p.classList.remove("is-active")}),l.onclick=c=>{c.stopPropagation(),p.classList.toggle("is-active")},a.onclick=()=>{this.state.isPinned=!this.state.isPinned,this.state.isPinned?a.classList.add("is-active"):a.classList.remove("is-active"),this.updateVisuals(),this.saveState()},r.onclick=async()=>{if(this.state.isEditing){if(this.state.content=this.textareaEl.value,this.state.filePath){let c=this.app.vault.getAbstractFileByPath(this.state.filePath);c instanceof n.TFile&&await this.app.vault.modify(c,this.state.content)}this.state.isEditing=!1,(0,n.setIcon)(r,"pencil")}else{if(this.state.filePath){let c=this.app.vault.getAbstractFileByPath(this.state.filePath);c instanceof n.TFile&&(this.state.content=await this.app.vault.read(c))}this.state.isEditing=!0,(0,n.setIcon)(r,"eye")}await this.renderContent(),this.saveState()},o.onclick=async()=>{if(this.state.isEditing&&(this.state.content=this.textareaEl.value),this.state.filePath){let m=this.app.vault.getAbstractFileByPath(this.state.filePath);m instanceof n.TFile&&(await this.app.vault.modify(m,this.state.content||""),new n.Notice("\u2705 \u4FBF\u7B7E\u5DF2\u540C\u6B65\u81F3\u539F\u6587\u6863"));return}let c=`\u4FBF\u7B7E_${window.moment().format("YYYYMMDD_HHmmss")}.md`,d=await this.app.vault.create(c,this.state.content||"");this.state.filePath=d.path,this.state.title=d.basename;let u=t.querySelector(".my-sticky-title");u&&(u.innerText=this.state.title),this.saveState(),new n.Notice("\u2705 \u5DF2\u8F6C\u5B58\u4E3A\u6587\u4EF6")},h.onclick=()=>this.close(),await this.renderContent(),this.setupDragging(s),this.setupResizing(),this.plugin.settings.openNotes.find(c=>c.id===this.state.id)||(this.plugin.settings.openNotes.push(this.state),this.plugin.saveSettings())}updateVisuals(){this.containerEl.style.top=this.state.top,this.containerEl.style.left=this.state.left,this.containerEl.style.width=this.state.width,this.containerEl.style.height=this.state.height,this.containerEl.style.resize=this.state.isPinned?"none":"both",this.containerEl.style.setProperty("--sticky-zoom",(this.state.zoomLevel||1).toString());let s=E(this.state.color,this.plugin.settings.noteOpacity);this.containerEl.style.setProperty("--note-bg-color",this.state.color),this.containerEl.style.setProperty("--note-bg-color-alpha",s),this.containerEl.style.setProperty("--note-text-color",this.state.textColor||"#2C3E50"),this.state.isPinned?this.containerEl.classList.add("is-pinned"):this.containerEl.classList.remove("is-pinned")}async renderContent(){if(this.state.isEditing)this.contentContainer.style.display="none",this.textareaEl.style.display="block",this.textareaEl.value=this.state.content||"";else{this.textareaEl.style.display="none",this.contentContainer.style.display="block",this.contentContainer.empty();let s=this.state.content||"";if(this.state.filePath){let t=this.app.vault.getAbstractFileByPath(this.state.filePath);t instanceof n.TFile&&(s=await this.app.vault.read(t))}await n.MarkdownRenderer.renderMarkdown(s,this.contentContainer,this.state.filePath||"",this)}}saveState(){let s=this.plugin.settings.openNotes.findIndex(t=>t.id===this.state.id);s!==-1&&(this.plugin.settings.openNotes[s]=this.state,this.plugin.saveSettings())}onunload(){this.containerEl&&this.containerEl.remove();let s=this.plugin.activeNotes.indexOf(this);s>-1&&this.plugin.activeNotes.splice(s,1)}close(){let s=this.plugin.settings.openNotes.findIndex(t=>t.id===this.state.id);s!==-1&&(this.plugin.settings.openNotes.splice(s,1),this.plugin.saveSettings()),this.unload()}setupDragging(s){let t=0,e=0,i=0,a=0;s.onmousedown=o=>{if(this.state.isPinned)return;let r=o.target;r.tagName==="BUTTON"||r.closest(".my-sticky-btn")||r.closest(".my-sticky-close")||(i=o.clientX,a=o.clientY,document.onmouseup=()=>{document.onmouseup=null,document.onmousemove=null,this.saveState()},document.onmousemove=l=>{t=i-l.clientX,e=a-l.clientY,i=l.clientX,a=l.clientY,this.state.top=this.containerEl.offsetTop-e+"px",this.state.left=this.containerEl.offsetLeft-t+"px",this.containerEl.style.top=this.state.top,this.containerEl.style.left=this.state.left})}}setupResizing(){new ResizeObserver(()=>{this.state.isPinned||(this.state.width=this.containerEl.style.width,this.state.height=this.containerEl.style.height,this.saveState())}).observe(this.containerEl)}injectCSS(){M("sticky-note-plugin-styles-v15",`
				.my-floating-sticky-note { 
					position: fixed; width: 320px; height: 450px; min-width: 200px; min-height: 200px; 
					border: 1px solid rgba(0,0,0,0.1) !important; 
					box-shadow: 0 10px 30px rgba(0,0,0,0.15); 
					border-radius: 8px; z-index: var(--layer-popover, 40); 
					display: flex; flex-direction: column; overflow: hidden; 
					transition: background-color 0.2s ease, box-shadow 0.3s ease; 
					background-color: var(--note-bg-color-alpha, transparent) !important; 
				}
				
				.my-floating-sticky-note:hover { 
					box-shadow: 0 12px 35px rgba(0,0,0,0.22); 
					background-color: var(--note-bg-color) !important;
				}
				
				.my-sticky-header { 
					padding: 8px 12px; 
					background-color: transparent !important; 
					border-bottom: 1px solid transparent !important; 
					cursor: grab; 
					display: flex; 
					flex-direction: row !important; 
					align-items: center; 
					justify-content: space-between !important; 
					user-select: none; 
					flex-shrink: 0; 
					min-width: 0; 
					transition: background-color 0.2s ease, border-color 0.2s ease; 
					gap: 10px;
				}
				.my-floating-sticky-note:hover .my-sticky-header { background-color: rgba(0, 0, 0, 0.04) !important; border-bottom: 1px solid rgba(0,0,0,0.06) !important; }
				
				.my-sticky-header:active { cursor: grabbing; }
				
				.my-sticky-title-wrapper { 
					display: flex; 
					align-items: center; 
					gap: 6px; 
					overflow: hidden; 
					flex-grow: 1; 
					flex-shrink: 1;
					min-width: 0;
				}
				.my-sticky-title-icon { display: flex; align-items: center; color: var(--note-text-color); opacity: 0.6; flex-shrink: 0; }
				.my-sticky-title-icon svg { width: 14px; height: 14px; }
				.my-sticky-title { font-weight: bold; font-size: 0.9em; color: var(--note-text-color) !important; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 1; min-width: 0; }
				
				.my-sticky-controls { 
					display: flex; 
					align-items: center; 
					gap: 4px; 
					flex-shrink: 0; 
					position: relative; 
					opacity: 0; 
					pointer-events: none; 
					transition: opacity 0.2s ease; 
				}
				.my-floating-sticky-note:hover .my-sticky-controls { opacity: 1; pointer-events: auto; }
				
				.my-sticky-btn, .my-sticky-close { background: transparent !important; border: none; box-shadow: none; cursor: pointer; padding: 4px; border-radius: 4px; color: var(--note-text-color) !important; opacity: 0.5; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
				.my-sticky-btn svg, .my-sticky-close svg { width: 16px; height: 16px; stroke-width: 2px; }
				.my-sticky-btn:hover { background-color: rgba(0,0,0,0.08) !important; opacity: 1; }
				.my-sticky-btn.is-active { color: var(--interactive-accent) !important; background-color: rgba(0,0,0,0.06) !important; opacity: 1;}
				
				.my-sticky-close:hover { color: #e74c3c !important; background-color: rgba(231, 76, 60, 0.1) !important; opacity: 1;}
				
				.my-sticky-palette-popup { display: none; position: absolute; top: 32px; right: 25px; background-color: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); z-index: var(--layer-menu, 50); grid-template-columns: repeat(3, 1fr); gap: 8px; }
				.my-sticky-palette-popup.is-active { display: grid; animation: popupFadeIn 0.15s ease-out; }
				@keyframes popupFadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
				
				.my-sticky-swatch { width: 26px; height: 26px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.15); cursor: pointer; transition: transform 0.1s, border-color 0.1s; display: flex; align-items: center; justify-content: center; font-weight: bold; font-family: serif; font-size: 13px;}
				.my-sticky-swatch:hover { transform: scale(1.15); border-color: rgba(0,0,0,0.5); }
				
				.my-sticky-content { padding: 15px; overflow-y: auto; font-size: calc(0.9em * var(--sticky-zoom, 1)); flex-grow: 1; color: var(--note-text-color) !important; padding-bottom: 25px; background-color: transparent !important; }
				
				.my-sticky-content * { color: inherit; }
				
				.my-sticky-textarea { flex-grow: 1; width: 100%; height: calc(100% - 10px); resize: none; border: none; background: transparent !important; color: var(--note-text-color) !important; font-family: var(--font-text); font-size: calc(0.9em * var(--sticky-zoom, 1)); padding: 15px; outline: none; box-shadow: none; display: none; line-height: 1.5; }
				.my-sticky-textarea:focus { box-shadow: none; background-color: transparent !important; }
				
				.my-sticky-content h1.inline-title { display: none; }
			`)}},O=class extends n.Modal{constructor(t,e){super(t);this.currentTab="month";this.history=e}onOpen(){let{contentEl:t}=this;t.empty(),t.addClass("history-stats-modal"),t.createEl("h2",{text:"\u{1F4C8} \u5B57\u6570\u7EDF\u8BA1"});let e=t.createDiv({cls:"stats-tab-group"});[{id:"7day",name:"\u8FD17\u65E5"},{id:"day",name:"\u8FD130\u65E5"},{id:"week",name:"\u6309\u5468"},{id:"month",name:"\u6309\u6708"},{id:"year",name:"\u6309\u5E74"}].forEach(a=>{let o=e.createEl("button",{text:a.name,cls:"stats-tab-btn"});this.currentTab===a.id&&o.addClass("is-active"),o.onclick=()=>{this.currentTab=a.id,e.querySelectorAll(".stats-tab-btn").forEach(r=>r.removeClass("is-active")),o.addClass("is-active"),this.renderData()}}),this.chartContainer=t.createDiv({cls:"stats-large-chart-container"}),this.renderData()}renderData(){this.chartContainer.empty();let t=this.aggregateData(),e=Object.keys(t).sort(),i=e;if(this.currentTab==="7day"&&(i=e.slice(-7)),this.currentTab==="day"&&(i=e.slice(-30)),this.currentTab==="week"&&(i=e.slice(-12)),i.length===0){this.chartContainer.createDiv({text:"\u6682\u65E0\u6570\u636E"});return}let a=Math.max(...i.map(o=>t[o].words),100);i.forEach(o=>{let r=t[o],l=this.chartContainer.createDiv({cls:"stats-large-col"}),h=Math.max(2,r.words/a*100),p=l.createDiv({cls:"stats-large-bar"});p.style.height=`${h}%`;let c=(r.focusMs/36e5).toFixed(1);p.setAttribute("title",`\u65F6\u95F4: ${o}
\u603B\u5B57\u6570: ${r.words.toLocaleString()}
\u4E13\u6CE8\u603B\u8BA1: ${c}\u5C0F\u65F6`),l.createDiv({cls:"stats-large-label",text:this.formatLabel(o)}),l.createDiv({cls:"stats-large-value",text:S(r.words)})})}aggregateData(){let t={};for(let[e,i]of Object.entries(this.history)){let a=window.moment(e),o=e;this.currentTab==="7day"?o=e:this.currentTab==="week"?o=`${a.year()}\u5E74 \u7B2C${a.isoWeek()}\u5468`:this.currentTab==="month"?o=a.format("YYYY-MM"):this.currentTab==="year"&&(o=a.format("YYYY")),t[o]||(t[o]={words:0,focusMs:0}),t[o].words+=Math.max(0,i.addedWords||0),t[o].focusMs+=i.focusMs||0}return t}formatLabel(t){return this.currentTab==="7day"||this.currentTab==="day"?t.substring(5):this.currentTab==="month"?t.substring(2):t}onClose(){this.contentEl.empty()}},P=class{constructor(s,t){this.server=null;this.plugin=s,this.port=t}start(){if(!x())return!1;try{let s=window.require("http"),t=this.plugin;return this.server=s.createServer((e,i)=>{new URL(e.url,`http://localhost:${this.port}`).pathname==="/api/stats"?(i.writeHead(200,{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}),i.end(JSON.stringify(t.getObsStats()))):(i.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Access-Control-Allow-Origin":"*"}),i.end(t.buildObsOverlayHtml()))}),this.server.listen(this.port,"127.0.0.1",()=>{console.log(`[WebNovel Assistant] OBS Overlay server started at http://127.0.0.1:${this.port}`),new n.Notice(`OBS \u53E0\u52A0\u5C42\u5DF2\u542F\u52A8: http://127.0.0.1:${this.port}`)}),this.server.on("error",async e=>{if(console.error("[WebNovel Assistant] OBS \u670D\u52A1\u5668\u9519\u8BEF:",e),this.plugin.settings.enableObs=!1,this.plugin.settings.enableLegacyObsExport=!0,await this.plugin.saveSettings(),e.code==="EADDRINUSE"){let i=[this.port+1,this.port+2,this.port+10];new n.Notice(`\u7AEF\u53E3 ${this.port} \u5DF2\u88AB\u5360\u7528\uFF01
\u5DF2\u81EA\u52A8\u5207\u6362\u5230\u6587\u4EF6\u5BFC\u51FA\u6A21\u5F0F

\u5982\u9700\u4F7F\u7528 OBS HTTP \u670D\u52A1\u5668\uFF0C\u8BF7:
1. \u5728\u8BBE\u7F6E\u4E2D\u66F4\u6362\u7AEF\u53E3 (\u5EFA\u8BAE: ${i.join(", ")})
2. \u91CD\u65B0\u542F\u7528 OBS \u670D\u52A1\u5668`,15e3)}else new n.Notice(`OBS \u670D\u52A1\u5668\u542F\u52A8\u5931\u8D25
\u5DF2\u81EA\u52A8\u5207\u6362\u5230\u6587\u4EF6\u5BFC\u51FA\u6A21\u5F0F

\u9519\u8BEF: ${e.message}
\u60A8\u53EF\u4EE5\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u6587\u4EF6\u5BFC\u51FA\u8DEF\u5F84`,12e3)}),!0}catch(s){return console.error("[WebNovel Assistant] \u65E0\u6CD5\u542F\u52A8 OBS \u670D\u52A1\u5668:",s),this.plugin.settings.enableObs=!1,this.plugin.settings.enableLegacyObsExport=!0,this.plugin.saveSettings(),new n.Notice(`OBS \u670D\u52A1\u5668\u542F\u52A8\u5931\u8D25
\u5DF2\u81EA\u52A8\u5207\u6362\u5230\u6587\u4EF6\u5BFC\u51FA\u6A21\u5F0F

\u53EF\u80FD\u539F\u56E0: Node.js \u6A21\u5757\u4E0D\u53EF\u7528
\u60A8\u53EF\u4EE5\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u6587\u4EF6\u5BFC\u51FA\u8DEF\u5F84`,12e3),!1}}stop(){this.server&&(this.server.close(),this.server=null)}updatePort(s){this.port===s&&this.server||(this.stop(),this.port=s,this.start())}};
