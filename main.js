"use strict";var J=Object.defineProperty;var ot=Object.getOwnPropertyDescriptor;var rt=Object.getOwnPropertyNames;var lt=Object.prototype.hasOwnProperty;var ct=(h,s)=>()=>(h&&(s=h(h=0)),s);var st=(h,s)=>{for(var t in s)J(h,t,{get:s[t],enumerable:!0})},ht=(h,s,t,e)=>{if(s&&typeof s=="object"||typeof s=="function")for(let i of rt(s))!lt.call(h,i)&&i!==t&&J(h,i,{get:()=>s[i],enumerable:!(e=ot(s,i))||e.enumerable});return h};var dt=h=>ht(J({},"__esModule",{value:!0}),h);var at={};st(at,{ObsOverlayServer:()=>O});var M,O,tt=ct(()=>{"use strict";M=require("obsidian"),O=class{constructor(s,t){this.server=null;this.plugin=s,this.port=t}start(){if(!M.Platform.isDesktop)return!1;try{let s=window.require("http"),t=this.plugin;return this.server=s.createServer((e,i)=>{new URL(e.url,`http://localhost:${this.port}`).pathname==="/api/stats"?(i.writeHead(200,{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}),i.end(JSON.stringify(t.getObsStats()))):(i.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Access-Control-Allow-Origin":"*"}),i.end(t.buildObsOverlayHtml()))}),this.server.listen(this.port,"127.0.0.1",()=>{console.log(`[WebNovel Assistant] OBS Overlay server started at http://127.0.0.1:${this.port}`),new M.Notice(`OBS \u53E0\u52A0\u5C42\u5DF2\u542F\u52A8: http://127.0.0.1:${this.port}`)}),this.server.on("error",async e=>{if(console.error("[WebNovel Assistant] OBS \u670D\u52A1\u5668\u9519\u8BEF:",e),this.plugin.settings.enableObs=!1,this.plugin.settings.enableLegacyObsExport=!0,await this.plugin.saveSettings(),e.code==="EADDRINUSE"){let i=[this.port+1,this.port+2,this.port+10];new M.Notice(`\u7AEF\u53E3 ${this.port} \u5DF2\u88AB\u5360\u7528\uFF01
\u5DF2\u81EA\u52A8\u5207\u6362\u5230\u6587\u4EF6\u5BFC\u51FA\u6A21\u5F0F

\u5982\u9700\u4F7F\u7528 OBS HTTP \u670D\u52A1\u5668\uFF0C\u8BF7:
1. \u5728\u8BBE\u7F6E\u4E2D\u66F4\u6362\u7AEF\u53E3 (\u5EFA\u8BAE: ${i.join(", ")})
2. \u91CD\u65B0\u542F\u7528 OBS \u670D\u52A1\u5668`,15e3)}else new M.Notice(`OBS \u670D\u52A1\u5668\u542F\u52A8\u5931\u8D25
\u5DF2\u81EA\u52A8\u5207\u6362\u5230\u6587\u4EF6\u5BFC\u51FA\u6A21\u5F0F

\u9519\u8BEF: ${e.message}
\u60A8\u53EF\u4EE5\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u6587\u4EF6\u5BFC\u51FA\u8DEF\u5F84`,12e3)}),!0}catch(s){return console.error("[WebNovel Assistant] \u65E0\u6CD5\u542F\u52A8 OBS \u670D\u52A1\u5668:",s),this.plugin.settings.enableObs=!1,this.plugin.settings.enableLegacyObsExport=!0,this.plugin.saveSettings(),new M.Notice(`OBS \u670D\u52A1\u5668\u542F\u52A8\u5931\u8D25
\u5DF2\u81EA\u52A8\u5207\u6362\u5230\u6587\u4EF6\u5BFC\u51FA\u6A21\u5F0F

\u53EF\u80FD\u539F\u56E0: Node.js \u6A21\u5757\u4E0D\u53EF\u7528
\u60A8\u53EF\u4EE5\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u6587\u4EF6\u5BFC\u51FA\u8DEF\u5F84`,12e3),!1}}stop(){this.server&&(this.server.close(),this.server=null)}updatePort(s){this.port===s&&this.server||(this.stop(),this.port=s,this.start())}}});var ut={};st(ut,{default:()=>X});module.exports=dt(ut);var u=require("obsidian");function N(h,s){if(!h)return`rgba(255, 255, 255, ${s})`;let t=h.replace("#","");if(t.length===3&&(t=t.split("").map(n=>n+n).join("")),t.length!==6)return`rgba(255, 255, 255, ${s})`;let e=parseInt(t.substring(0,2),16)||0,i=parseInt(t.substring(2,4),16)||0,a=parseInt(t.substring(4,6),16)||0;return`rgba(${e}, ${i}, ${a}, ${s})`}function w(h){let s=Math.floor(h/3600).toString().padStart(2,"0"),t=Math.floor(h%3600/60).toString().padStart(2,"0"),e=(h%60).toString().padStart(2,"0");return`${s}:${t}:${e}`}function k(h){return h>=1e4?(h/1e4).toFixed(1)+"w":h>=1e3?(h/1e3).toFixed(1)+"k":h.toString()}function P(h,s){if(document.getElementById(h))return;let t=document.createElement("style");t.id=h,t.innerHTML=s,document.head.appendChild(t)}function Z(h){let s=document.getElementById(h);s&&s.remove()}var L=require("obsidian");function $(){return L.Platform.isDesktop||L.Platform.isDesktopApp}function W(){return L.Platform.isMobile||L.Platform.isMobileApp}var it=require("obsidian"),R=class{constructor(){this.maxCacheSize=1e4;this.cache=new Map}async buildInitialCache(s,t){console.log("[CacheManager] \u5F00\u59CB\u6784\u5EFA\u521D\u59CB\u7F13\u5B58...");let e=Date.now();try{let i=s.getMarkdownFiles(),a=new Map,n=0,o=0;for(let l of i)try{let p=await s.cachedRead(l),d=t(p);a.set(l.path,d),this.cache.set(l.path,{path:l.path,wordCount:d,lastModified:l.stat.mtime}),n++}catch(p){console.error(`[CacheManager] \u8BFB\u53D6\u6587\u4EF6\u5931\u8D25: ${l.path}`,p),o++}for(let[l,p]of a.entries()){let d=s.getAbstractFileByPath(l);if(d instanceof it.TFile){let c=d.parent;for(;c;){let g=this.cache.get(c.path);g?g.wordCount+=p:this.cache.set(c.path,{path:c.path,wordCount:p,lastModified:Date.now()}),c=c.parent}}}let r=Date.now()-e;console.log(`[CacheManager] \u7F13\u5B58\u6784\u5EFA\u5B8C\u6210: ${n} \u4E2A\u6587\u4EF6\u6210\u529F, ${o} \u4E2A\u6587\u4EF6\u5931\u8D25, ${this.cache.size} \u4E2A\u7F13\u5B58\u6761\u76EE, \u8017\u65F6 ${r}ms`),o>0&&console.warn(`[CacheManager] \u8B66\u544A: ${o} \u4E2A\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25\uFF0C\u7F13\u5B58\u53EF\u80FD\u4E0D\u5B8C\u6574`)}catch(i){throw console.error("[CacheManager] \u7F13\u5B58\u6784\u5EFA\u5931\u8D25:",i),i}}getFolderCount(s){let t=this.cache.get(s);return t?t.wordCount:null}updateFileCache(s,t,e){let i=this.cache.get(s.path),a=i?i.wordCount:0,n=t-a;this.cache.set(s.path,{path:s.path,wordCount:t,lastModified:s.stat.mtime});let o=s.parent;for(;o;){let r=this.cache.get(o.path);r?(r.wordCount+=n,r.lastModified=Date.now()):this.cache.set(o.path,{path:o.path,wordCount:Math.max(0,n),lastModified:Date.now()}),o=o.parent}this.cache.size>this.maxCacheSize&&this.clearOldEntries()}invalidateCache(s,t){let e=this.cache.get(s);if(!e)return;let i=e.wordCount;this.cache.delete(s);let a=t.getAbstractFileByPath(s);if(a){let n=a.parent;for(;n;){let o=this.cache.get(n.path);o&&(o.wordCount=Math.max(0,o.wordCount-i),o.lastModified=Date.now()),n=n.parent}}}clearCache(){this.cache.clear(),console.log("[CacheManager] \u7F13\u5B58\u5DF2\u6E05\u7A7A")}getCacheStats(){let s=this.cache.size*100;return{size:this.cache.size,memoryUsage:s}}clearOldEntries(){console.warn("[CacheManager] \u7F13\u5B58\u5927\u5C0F\u8D85\u8FC7\u9650\u5236\uFF0C\u6B63\u5728\u6E05\u7406...");let s=Array.from(this.cache.entries());s.sort((e,i)=>e[1].lastModified-i[1].lastModified);let t=Math.floor(s.length*.2);for(let e=0;e<t;e++)this.cache.delete(s[e][0]);console.log(`[CacheManager] \u5DF2\u6E05\u7406 ${t} \u4E2A\u65E7\u7F13\u5B58\u6761\u76EE`)}};var j=class{constructor(){this.timers=new Map,this.lastCallTimes=new Map}debounce(s,t,e){this.timers.has(s)&&window.clearTimeout(this.timers.get(s));let i=window.setTimeout(()=>{t(),this.timers.delete(s)},e);this.timers.set(s,i)}throttle(s,t,e){let i=Date.now(),a=this.lastCallTimes.get(s)||0;i-a>=e&&(t(),this.lastCallTimes.set(s,i))}cancel(s){let t=this.timers.get(s);t&&(window.clearTimeout(t),this.timers.delete(s))}cancelAll(){this.timers.forEach(s=>{window.clearTimeout(s)}),this.timers.clear(),this.lastCallTimes.clear(),console.log("[DebounceManager] \u6240\u6709\u9632\u6296\u64CD\u4F5C\u5DF2\u53D6\u6D88")}flush(s,t){this.cancel(s),t()}getPendingCount(){return this.timers.size}};var G=class{constructor(s,t){this.validationRules=[{field:"obsPort",validate:s=>{let t=Number(s);return!isNaN(t)&&t>=1024&&t<=65535},errorMessage:"\u7AEF\u53E3\u53F7\u5FC5\u987B\u5728 1024-65535 \u4E4B\u95F4"},{field:"idleTimeoutThreshold",validate:s=>{let t=Number(s);return!isNaN(t)&&t>=1e4&&t<=36e5},errorMessage:"\u7A7A\u95F2\u8D85\u65F6\u5FC5\u987B\u5728 10-3600 \u79D2\u4E4B\u95F4"},{field:"noteOpacity",validate:s=>{let t=Number(s);return!isNaN(t)&&t>=.1&&t<=1},errorMessage:"\u4FBF\u7B7E\u4E0D\u900F\u660E\u5EA6\u5FC5\u987B\u5728 0.1-1.0 \u4E4B\u95F4"},{field:"obsOverlayOpacity",validate:s=>{let t=Number(s);return!isNaN(t)&&t>=0&&t<=1},errorMessage:"OBS \u53E0\u52A0\u5C42\u4E0D\u900F\u660E\u5EA6\u5FC5\u987B\u5728 0-1.0 \u4E4B\u95F4"},{field:"defaultGoal",validate:s=>{let t=Number(s);return!isNaN(t)&&t>=0},errorMessage:"\u9ED8\u8BA4\u76EE\u6807\u5B57\u6570\u5FC5\u987B\u4E3A\u975E\u8D1F\u6570"}];this.plugin=s,this.defaultSettings=t,this.settings={...t}}async loadSettings(){try{let s=await this.plugin.loadData();this.settings=Object.assign({},this.defaultSettings,s),this.settings=this.migrateSettings(this.settings,s);let t=this.validateSettings(this.settings);return t.valid||(console.warn("[SettingsManager] \u8BBE\u7F6E\u9A8C\u8BC1\u5931\u8D25:",t.errors),this.settings=this.fixInvalidSettings(this.settings)),console.log("[SettingsManager] \u8BBE\u7F6E\u52A0\u8F7D\u6210\u529F"),this.settings}catch(s){console.error("[SettingsManager] \u52A0\u8F7D\u8BBE\u7F6E\u5931\u8D25:",s);let{Notice:t}=require("obsidian");return new t("\u52A0\u8F7D\u8BBE\u7F6E\u5931\u8D25\uFF0C\u5DF2\u4F7F\u7528\u9ED8\u8BA4\u8BBE\u7F6E"),this.settings={...this.defaultSettings},this.settings}}async saveSettings(){try{let s=this.plugin.settings;s&&(this.settings=s),await this.plugin.saveData(this.settings)}catch(s){console.error("[SettingsManager] \u4FDD\u5B58\u8BBE\u7F6E\u5931\u8D25:",s);let{Notice:t}=require("obsidian");throw new t("\u4FDD\u5B58\u8BBE\u7F6E\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u78C1\u76D8\u7A7A\u95F4\u548C\u6743\u9650"),s}}validateSettings(s){let t=[];for(let e of this.validationRules){let i=s[e.field];i!==void 0&&!e.validate(i)&&t.push(e.errorMessage)}return{valid:t.length===0,errors:t}}fixInvalidSettings(s){let t={...s};for(let e of this.validationRules){let i=t[e.field];i!==void 0&&!e.validate(i)&&(t[e.field]=this.defaultSettings[e.field],console.warn(`[SettingsManager] \u4FEE\u590D\u65E0\u6548\u8BBE\u7F6E: ${e.field} = ${i} -> ${this.defaultSettings[e.field]}`))}return t}migrateSettings(s,t){let e={...s};if(t&&typeof t=="object"&&"noteColors"in t){let i=t.noteColors;i&&Array.isArray(i)&&(!e.noteThemes||e.noteThemes.length===0)&&(e.noteThemes=i.map(a=>({bg:a,text:"#2C3E50"})),console.log("[SettingsManager] \u5DF2\u8FC1\u79FB\u65E7\u7248\u4FBF\u7B7E\u989C\u8272\u5230\u65B0\u7248\u4E3B\u9898"))}return e}getSettings(){return this.settings}async updateSettings(s){let t=this.validateSettings(s);if(!t.valid)throw new Error(`\u8BBE\u7F6E\u9A8C\u8BC1\u5931\u8D25: ${t.errors.join(", ")}`);this.settings=Object.assign(this.settings,s),await this.saveSettings()}async resetToDefaults(){this.settings={...this.defaultSettings},await this.saveSettings(),console.log("[SettingsManager] \u5DF2\u91CD\u7F6E\u4E3A\u9ED8\u8BA4\u8BBE\u7F6E")}};var Q=require("obsidian"),Y=class h{static{this.chineseToArabic={\u96F6:0,\u4E00:1,\u4E8C:2,\u4E09:3,\u56DB:4,\u4E94:5,\u516D:6,\u4E03:7,\u516B:8,\u4E5D:9,\u5341:10,"\u3007":0,\u58F9:1,\u8D30:2,\u53C1:3,\u8086:4,\u4F0D:5,\u9646:6,\u67D2:7,\u634C:8,\u7396:9,\u62FE:10,\u767E:100,\u4F70:100,\u5343:1e3,\u4EDF:1e3,\u4E07:1e4,\u842C:1e4}}static parseChineseNumber(s){if(s==="\u5341")return 10;if(s.startsWith("\u5341"))return 10+(s.length>1&&this.chineseToArabic[s[1]]||0);if(s.includes("\u5341")){let t=s.split("\u5341"),e=this.chineseToArabic[t[0]]||0,i=t[1]&&this.chineseToArabic[t[1]]||0;return e*10+i}return this.chineseToArabic[s]||0}static extractChapterNumber(s){let t=s.replace(/\.md$/i,""),e=t.match(/(?:第|chapter|ch)?(\d+)(?:[章节回卷部册篇\s\-]|$)/i);if(e)return parseInt(e[1],10);let i=t.match(/(?:第)?([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)(?:[章节回卷部册篇]|$)/);if(i){let a=this.parseChineseNumber(i[1]);if(a>0)return a}return null}static compareFiles(s,t){let e=s instanceof Q.TFolder,i=t instanceof Q.TFolder;if(e&&!i)return-1;if(!e&&i)return 1;let a=h.extractChapterNumber(s.name),n=h.extractChapterNumber(t.name);return a!==null&&n!==null?a!==n?a-n:s.name.localeCompare(t.name,"zh-CN",{numeric:!0}):a!==null?-1:n!==null?1:s.name.localeCompare(t.name,"zh-CN",{numeric:!0})}static sortFiles(s){return s.slice().sort(this.compareFiles)}static isChapterFile(s){return this.extractChapterNumber(s)!==null}};var U=class{constructor(s){this.enabled=!1;this.explorerView=null;this.app=s}enable(){if(this.enabled)return!0;try{return this.patchFileExplorer()?(this.enabled=!0,console.log("[ChapterSorter] Smart chapter sorting enabled"),setTimeout(()=>this.refresh(),1e3),this.setupFileSystemListeners(),!0):(console.error("[ChapterSorter] Failed to patch file explorer"),!1)}catch(s){return console.error("[ChapterSorter] Failed to enable smart sorting:",s),!1}}patchFileExplorer(){try{let s=this.app.workspace.getLeavesOfType("file-explorer")[0];if(!s)return console.warn("[ChapterSorter] File Explorer leaf not found"),!1;if(this.explorerView=s.view,!this.explorerView)return console.warn("[ChapterSorter] File Explorer view not found"),!1;let t=this.explorerView.getSortedFolderItems;return t?(this.explorerView.getSortedFolderItems=function(e){return t.call(this,e).sort((a,n)=>Y.compareFiles(a.file,n.file))},console.log("[ChapterSorter] Successfully patched getSortedFolderItems"),!0):(console.warn("[ChapterSorter] getSortedFolderItems method not found"),!1)}catch(s){return console.error("[ChapterSorter] Failed to patch file explorer:",s),!1}}refresh(){try{if(!this.explorerView)return;this.explorerView.sort?(this.explorerView.sort(),console.log("[ChapterSorter] Explorer refreshed")):console.warn("[ChapterSorter] sort() method not found")}catch(s){console.error("[ChapterSorter] Failed to refresh explorer:",s)}}setupFileSystemListeners(){this.app.vault.on("create",()=>{this.enabled&&setTimeout(()=>this.refresh(),100)}),this.app.vault.on("delete",()=>{this.enabled&&setTimeout(()=>this.refresh(),100)}),this.app.vault.on("rename",()=>{this.enabled&&setTimeout(()=>this.refresh(),100)}),console.log("[ChapterSorter] File system listeners setup complete")}disable(){if(this.enabled)try{this.enabled=!1,console.log("[ChapterSorter] Smart chapter sorting disabled")}catch(s){console.error("[ChapterSorter] Failed to disable smart sorting:",s)}}isEnabled(){return this.enabled}refreshManually(){this.enabled&&this.refresh()}};var I=require("obsidian"),E=class extends I.Modal{constructor(t,e){super(t);this.goalInput="";this.file=e}onOpen(){let{contentEl:t}=this;t.createEl("h2",{text:`\u4E3A\u300A${this.file.basename}\u300B\u8BBE\u5B9A\u76EE\u6807`}),new I.Setting(t).setName("\u76EE\u6807\u5B57\u6570").setDesc("\u8F93\u5165 0 \u6216\u6E05\u7A7A\u5219\u6062\u590D\u5168\u5C40\u9ED8\u8BA4\u76EE\u6807\u3002").addText(e=>{let i=this.app.metadataCache.getFileCache(this.file);i?.frontmatter&&i.frontmatter["word-goal"]&&e.setValue(i.frontmatter["word-goal"].toString()),e.inputEl.focus(),e.onChange(a=>{this.goalInput=a}),e.inputEl.addEventListener("keydown",a=>{a.key==="Enter"&&this.saveGoal()})}),new I.Setting(t).addButton(e=>e.setButtonText("\u4FDD\u5B58").setCta().onClick(()=>{this.saveGoal()}))}async saveGoal(){let t=parseInt(this.goalInput);await this.app.fileManager.processFrontMatter(this.file,e=>{isNaN(t)||t<=0?delete e["word-goal"]:e["word-goal"]=t}),this.close()}onClose(){this.contentEl.empty()}};var f=require("obsidian");var _=class extends f.PluginSettingTab{constructor(s,t){super(s,t),this.plugin=t}display(){let{containerEl:s}=this;if(s.empty(),W()){let t=s.createDiv({cls:"setting-item-description",attr:{style:"background: var(--background-secondary); padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 3px solid var(--interactive-accent);"}});t.createEl("strong",{text:"\u{1F4A1} \u79FB\u52A8\u7AEF\u6A21\u5F0F"}),t.createEl("br"),t.appendText("\u90E8\u5206\u9AD8\u7EA7\u529F\u80FD(\u60AC\u6D6E\u4FBF\u7B7E\u3001OBS \u76F4\u64AD\u53E0\u52A0\u5C42\u3001\u6587\u672C\u6587\u4EF6\u5BFC\u51FA)\u4EC5\u5728\u684C\u9762\u7AEF\u53EF\u7528,\u4EE5\u4F18\u5316\u79FB\u52A8\u8BBE\u5907\u6027\u80FD\u548C\u7535\u6C60\u7EED\u822A\u3002")}s.createEl("h2",{text:"\u7CBE\u51C6\u5B57\u6570\u4E0E\u76EE\u6807\u8BBE\u7F6E"}),new f.Setting(s).setName("\u663E\u793A\u76EE\u6807\u8FDB\u5EA6").setDesc("\u5728\u72B6\u6001\u680F\u663E\u793A\u5F53\u524D\u6587\u4EF6\u7684\u5B57\u6570\u5B8C\u6210\u8FDB\u5EA6\u3002").addToggle(t=>t.setValue(this.plugin.settings.showGoal).onChange(async e=>{this.plugin.settings.showGoal=e,await this.plugin.saveSettings(),this.plugin.updateWordCount()})),new f.Setting(s).setName("\u663E\u793A\u6587\u4EF6\u5217\u8868\u5B57\u6570").setDesc("\u5728\u4FA7\u8FB9\u680F\u6587\u4EF6\u6811\u4E2D\u663E\u793A\u6587\u4EF6\u5939\u548C\u6587\u6863\u7684\u6C47\u603B\u5B57\u6570\u3002").addToggle(t=>t.setValue(this.plugin.settings.showExplorerCounts).onChange(async e=>{this.plugin.settings.showExplorerCounts=e,await this.plugin.saveSettings(),e?await this.plugin.buildFolderCache():this.plugin.refreshFolderCounts()})),new f.Setting(s).setName("\u9ED8\u8BA4\u5B57\u6570\u76EE\u6807 (\u5168\u5C40)").addText(t=>t.setValue(this.plugin.settings.defaultGoal.toString()).onChange(async e=>{let i=parseInt(e);isNaN(i)||(this.plugin.settings.defaultGoal=i,await this.plugin.saveSettings())})),new f.Setting(s).setName("\u542F\u7528\u667A\u80FD\u7AE0\u8282\u6392\u5E8F").setDesc('\u81EA\u52A8\u8BC6\u522B\u7AE0\u8282\u7F16\u53F7\uFF08\u652F\u6301\u963F\u62C9\u4F2F\u6570\u5B57\u548C\u4E2D\u6587\u6570\u5B57\uFF09\uFF0C\u6309\u6570\u5B57\u5927\u5C0F\u6392\u5E8F\u800C\u975E\u5B57\u7B26\u4E32\u6392\u5E8F\u3002\u4F8B\u5982\uFF1A"\u7B2C1\u7AE0"\u3001"\u7B2C2\u7AE0"\u3001"\u7B2C10\u7AE0"\u6216"\u7B2C\u4E00\u7AE0"\u3001"\u7B2C\u4E8C\u7AE0"\u3001"\u7B2C\u5341\u7AE0"\u3002').addToggle(t=>t.setValue(this.plugin.settings.enableSmartChapterSort).onChange(async e=>{this.plugin.settings.enableSmartChapterSort=e,await this.plugin.saveSettings(),e?this.plugin.fileExplorerPatcher.enable()?new f.Notice("\u2705 \u667A\u80FD\u7AE0\u8282\u6392\u5E8F\u5DF2\u542F\u7528"):(new f.Notice("\u274C \u542F\u7528\u5931\u8D25\uFF0C\u8BF7\u91CD\u542F Obsidian \u540E\u91CD\u8BD5"),this.plugin.settings.enableSmartChapterSort=!1,await this.plugin.saveSettings(),t.setValue(!1)):(this.plugin.fileExplorerPatcher.disable(),new f.Notice("\u667A\u80FD\u7AE0\u8282\u6392\u5E8F\u5DF2\u7981\u7528"))})),$()&&this.displayDesktopSettings(s)}displayDesktopSettings(s){s.createEl("h2",{text:"\u60AC\u6D6E\u4FBF\u7B7E\u8BBE\u7F6E"}),new f.Setting(s).setName("\u95F2\u7F6E\u65F6\u900F\u660E\u5EA6 (\u4EC5\u80CC\u666F)").setDesc("\u8C03\u8282\u4FBF\u7B7E\u5728\u95F2\u7F6E\u65F6\u7684\u7EAF\u80CC\u666F\u900F\u660E\u5EA6\u3002\u62D6\u52A8\u6ED1\u5757\u65F6\u5DF2\u6253\u5F00\u7684\u4FBF\u7B7E\u4F1A\u5B9E\u65F6\u9884\u89C8\uFF01").addSlider(i=>i.setLimits(.1,1,.05).setValue(this.plugin.settings.noteOpacity).setDynamicTooltip().onChange(async a=>{this.plugin.settings.noteOpacity=a,await this.plugin.saveSettings(),this.plugin.activeNotes.forEach(n=>n.updateVisuals())}));let e=new f.Setting(s).setName("\u81EA\u5B9A\u4E49\u4E3B\u9898\u65B9\u6848 (\u80CC\u666F\u8272 + \u6587\u5B57\u8272)").setDesc("\u81EA\u5B9A\u4E49\u4FBF\u7B7E\u8C03\u8272\u677F\u4E2D\u7684 6 \u79CD\u9884\u8BBE\u7EC4\u5408\u3002\u5DE6\u4FA7\u4E3A\u80CC\u666F\u8272\uFF0C\u53F3\u4FA7\u4E3A\u5BF9\u5E94\u7684\u6587\u5B57/\u56FE\u6807\u8272\u3002").controlEl.createDiv({attr:{style:"display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;"}});this.plugin.settings.noteThemes.forEach((i,a)=>{let n=e.createDiv({attr:{style:"display: flex; align-items: center; gap: 6px; background: var(--background-modifier-form-field); padding: 4px 8px; border-radius: 6px;"}}),o=n.createEl("input",{type:"color",value:i.bg});o.style.cssText="cursor: pointer; border: none; padding: 0; width: 24px; height: 24px; border-radius: 4px;",n.createSpan({text:"Aa",attr:{style:"font-weight: bold; font-family: serif; color: var(--text-muted); padding-left: 2px;"}});let r=n.createEl("input",{type:"color",value:i.text});r.style.cssText="cursor: pointer; border: none; padding: 0; width: 24px; height: 24px; border-radius: 4px;",o.onchange=async l=>{this.plugin.settings.noteThemes[a].bg=l.target.value,await this.plugin.saveSettings()},r.onchange=async l=>{this.plugin.settings.noteThemes[a].text=l.target.value,await this.plugin.saveSettings()}}),this.displayDataSettings(s)}displayDataSettings(s){s.createEl("h2",{text:"\u6570\u636E\u7EDF\u8BA1\u4E0E\u8F93\u51FA\u8BBE\u7F6E"}),new f.Setting(s).setName("\u7CBE\u51C6\u4E13\u6CE8\u5EA6\u5224\u5B9A\u9608\u503C (\u79D2)").setDesc('\u5728\u6B64\u65F6\u95F4\u5185\u6CA1\u6709\u952E\u76D8\u8F93\u5165\uFF0C\u5373\u4F7F\u8F6F\u4EF6\u5904\u4E8E\u805A\u7126\u72B6\u6001\uFF0C\u4E5F\u4F1A\u88AB\u5224\u5B9A\u4E3A"\u6478\u9C7C"\u3002').addSlider(t=>t.setLimits(30,600,30).setValue(this.plugin.settings.idleTimeoutThreshold/1e3).setDynamicTooltip().onChange(async e=>{this.plugin.settings.idleTimeoutThreshold=e*1e3,await this.plugin.saveSettings()})),this.displayObsSettings(s),this.displayLegacyExportSettings(s)}displayObsSettings(s){new f.Setting(s).setName("\u542F\u7528 OBS \u76F4\u64AD\u53E0\u52A0\u5C42").setDesc("\u5728\u672C\u5730\u542F\u52A8 HTTP \u670D\u52A1\uFF0COBS \u901A\u8FC7\u300C\u6D4F\u89C8\u5668\u6E90\u300D\u52A0\u8F7D\u5B9E\u65F6\u7EDF\u8BA1\u9762\u677F\uFF0C\u96F6\u78C1\u76D8 I/O\u3002").addToggle(t=>t.setValue(this.plugin.settings.enableObs).onChange(async e=>{if(this.plugin.settings.enableObs=e,await this.plugin.saveSettings(),e){if(!this.plugin.obsServer){let{ObsServer:i}=await Promise.resolve().then(()=>(tt(),at));this.plugin.obsServer=new i(this.plugin,this.plugin.settings.obsPort)}this.plugin.obsServer.start()}else this.plugin.obsServer?.stop()})),new f.Setting(s).setName("\u53E0\u52A0\u5C42\u7AEF\u53E3").setDesc("OBS \u6D4F\u89C8\u5668\u6E90\u8BBF\u95EE\u7684\u7AEF\u53E3\u53F7\uFF0C\u4FEE\u6539\u540E\u9700\u91CD\u542F\u53E0\u52A0\u5C42\u3002").addText(t=>t.setValue(this.plugin.settings.obsPort.toString()).onChange(async e=>{let i=parseInt(e);!isNaN(i)&&i>0&&i<65536&&(this.plugin.settings.obsPort=i,await this.plugin.saveSettings())})),new f.Setting(s).setName("\u53E0\u52A0\u5C42\u80CC\u666F\u900F\u660E\u5EA6").setDesc("\u8C03\u6574 OBS \u53E0\u52A0\u5C42\u5361\u7247\u80CC\u666F\u7684\u900F\u660E\u5EA6 (0\u4E3A\u5B8C\u5168\u900F\u660E)\u3002").addSlider(t=>t.setLimits(0,1,.05).setValue(this.plugin.settings.obsOverlayOpacity??.85).setDynamicTooltip().onChange(async e=>{this.plugin.settings.obsOverlayOpacity=e,await this.plugin.saveSettings()})),new f.Setting(s).setName("\u81EA\u5B9A\u4E49 CSS").setDesc("\u901A\u8FC7\u8986\u76D6 CSS \u7C7B\u540D\u4FEE\u6539\u6837\u5F0F").addTextArea(t=>(t.setPlaceholder("/* \u4F8B\uFF1A\u4FEE\u6539\u6478\u9C7C\u65F6\u95F4\u4E3A\u7EFF\u8272 */ .time-value.slack { color: #4CAF50 !important; }").setValue(this.plugin.settings.obsCustomCss).onChange(async e=>{this.plugin.settings.obsCustomCss=e,await this.plugin.saveSettings()}),t.inputEl.style.cssText="width: 100%; height: 100px; font-family: monospace;",t)),new f.Setting(s).setName("\u53E0\u52A0\u5C42\u4E3B\u9898").addDropdown(t=>{t.addOption("dark","\u6697\u8272 (\u6DF1\u8272\u80CC\u666F+\u767D\u5B57)"),t.addOption("light","\u4EAE\u8272 (\u6D45\u8272\u80CC\u666F+\u6DF1\u5B57)"),this.plugin.settings.noteThemes.forEach((e,i)=>{t.addOption(`note-${i}`,`\u4FBF\u7B7E\u9884\u8BBE\u8272 ${i+1}`)}),t.setValue(this.plugin.settings.obsOverlayTheme),t.onChange(async e=>{this.plugin.settings.obsOverlayTheme=e,await this.plugin.saveSettings()})}),new f.Setting(s).setName("\u663E\u793A\u603B\u8BA1\u65F6\u95F4").addToggle(t=>t.setValue(this.plugin.settings.obsShowTotalTime).onChange(async e=>{this.plugin.settings.obsShowTotalTime=e,await this.plugin.saveSettings()})),new f.Setting(s).setName("\u663E\u793A\u4E13\u6CE8\u65F6\u95F4").addToggle(t=>t.setValue(this.plugin.settings.obsShowFocusTime).onChange(async e=>{this.plugin.settings.obsShowFocusTime=e,await this.plugin.saveSettings()})),new f.Setting(s).setName("\u663E\u793A\u6478\u9C7C\u65F6\u95F4").addToggle(t=>t.setValue(this.plugin.settings.obsShowSlackTime).onChange(async e=>{this.plugin.settings.obsShowSlackTime=e,await this.plugin.saveSettings()})),new f.Setting(s).setName("\u663E\u793A\u76EE\u6807\u8FDB\u5EA6").addToggle(t=>t.setValue(this.plugin.settings.obsShowTodayWords).onChange(async e=>{this.plugin.settings.obsShowTodayWords=e,await this.plugin.saveSettings()})),new f.Setting(s).setName("\u663E\u793A\u672C\u573A\u51C0\u589E").addToggle(t=>t.setValue(this.plugin.settings.obsShowSessionWords).onChange(async e=>{this.plugin.settings.obsShowSessionWords=e,await this.plugin.saveSettings()})),new f.Setting(s).setName("\u590D\u5236 OBS \u53E0\u52A0\u5C42 URL").setDesc("\u70B9\u51FB\u540E\u590D\u5236 URL\uFF0C\u5728 OBS \u4E2D\u6DFB\u52A0\u300C\u6D4F\u89C8\u5668\u6E90\u300D\u5E76\u7C98\u8D34\u6B64 URL\u3002").addButton(t=>t.setButtonText("\u590D\u5236 URL").onClick(()=>{let e=`http://127.0.0.1:${this.plugin.settings.obsPort}/`;navigator.clipboard.writeText(e),new f.Notice(`\u5DF2\u590D\u5236: ${e}`)}))}displayLegacyExportSettings(s){s.createEl("h3",{text:"\u6587\u672C\u6587\u4EF6\u5BFC\u51FA (\u517C\u5BB9)"}),new f.Setting(s).setName("\u542F\u7528\u672C\u5730\u6587\u672C\u6587\u4EF6\u5BFC\u51FA").setDesc("\u5F00\u542F\u540E\uFF0C\u63D2\u4EF6\u5C06\u50CF\u4EE5\u524D\u4E00\u6837\u6BCF\u79D2\u5C06\u4E13\u6CE8\u65F6\u95F4\u3001\u6478\u9C7C\u65F6\u95F4\u7B49\u6570\u636E\u5199\u5165\u7EAF\u6587\u672C\u6587\u4EF6\u4E2D\u3002").addToggle(t=>t.setValue(this.plugin.settings.enableLegacyObsExport).onChange(async e=>{this.plugin.settings.enableLegacyObsExport=e,await this.plugin.saveSettings()})),new f.Setting(s).setName("\u6570\u636E\u8F93\u51FA\u8DEF\u5F84 (\u7EDD\u5BF9\u8DEF\u5F84)").setDesc("\u8BF7\u586B\u5165\u7EDD\u5BF9\u8DEF\u5F84 (\u4F8B\u5982 D:\\OBS\\Stats)").addText(t=>t.setPlaceholder("\u8BF7\u8F93\u5165\u6587\u4EF6\u5939\u8DEF\u5F84").setValue(this.plugin.settings.obsPath).onChange(async e=>{this.plugin.settings.obsPath=e,await this.plugin.saveSettings()}))}};var m=require("obsidian");var q=class extends m.Modal{constructor(s,t,e){super(s),this.plugin=t,this.onSubmit=e}onOpen(){let{contentEl:s}=this;s.empty(),s.createEl("h2",{text:"\u4FDD\u5B58\u4FBF\u7B7E\u4E3A\u6587\u4EF6"});let e=this.app.workspace.getActiveFile()?.parent?.path||"";new m.Setting(s).setName("\u6587\u4EF6\u540D").setDesc("\u8F93\u5165\u6587\u4EF6\u540D\uFF08\u65E0\u9700 .md \u540E\u7F00\uFF09").addText(o=>{this.fileNameInput=o.inputEl,o.setValue(`\u4FBF\u7B7E_${window.moment().format("YYYYMMDD_HHmmss")}`).onChange(()=>{this.fileNameInput.value.trim()?this.fileNameInput.style.borderColor="":this.fileNameInput.style.borderColor="var(--background-modifier-error)"}),o.inputEl.style.width="100%",setTimeout(()=>{let r=o.inputEl.value.indexOf("_");r>0?o.inputEl.setSelectionRange(0,r):o.inputEl.select(),o.inputEl.focus()},50)}),new m.Setting(s).setName("\u4FDD\u5B58\u4F4D\u7F6E").setDesc("\u6587\u4EF6\u5939\u8DEF\u5F84\uFF08\u7559\u7A7A\u4FDD\u5B58\u5230\u6839\u76EE\u5F55\uFF09").addText(o=>{this.folderPathInput=o.inputEl,o.setValue(e).setPlaceholder("\u4F8B\u5982: \u6211\u7684\u6587\u4EF6\u5939/\u5B50\u6587\u4EF6\u5939"),o.inputEl.style.width="100%"}),s.createEl("p",{text:"\u{1F4A1} \u63D0\u793A\uFF1A\u9ED8\u8BA4\u4FDD\u5B58\u5230\u5F53\u524D\u5DE5\u4F5C\u6587\u4EF6\u5939",cls:"setting-item-description"});let i=s.createDiv({cls:"modal-button-container"});i.style.display="flex",i.style.justifyContent="flex-end",i.style.gap="10px",i.style.marginTop="20px";let a=i.createEl("button",{text:"\u53D6\u6D88"});a.onclick=()=>this.close();let n=i.createEl("button",{text:"\u4FDD\u5B58",cls:"mod-cta"});n.onclick=()=>{let o=this.fileNameInput.value.trim(),r=this.folderPathInput.value.trim();if(!o){new m.Notice("\u274C \u8BF7\u8F93\u5165\u6587\u4EF6\u540D"),this.fileNameInput.focus();return}this.onSubmit(o,r),this.close()},this.fileNameInput.addEventListener("keydown",o=>{o.key==="Enter"&&(o.preventDefault(),n.click())})}onClose(){let{contentEl:s}=this;s.empty()}},et=class extends m.Modal{constructor(s,t){super(s),this.onSubmit=t}onOpen(){let{contentEl:s}=this;s.empty(),s.createEl("h2",{text:"\u26A0\uFE0F \u6709\u672A\u4FDD\u5B58\u7684\u66F4\u6539"}),s.createEl("p",{text:"\u4FBF\u7B7E\u5185\u5BB9\u5DF2\u4FEE\u6539\u4F46\u5C1A\u672A\u4FDD\u5B58\uFF0C\u662F\u5426\u8981\u4FDD\u5B58\u66F4\u6539\uFF1F"});let t=s.createDiv({cls:"modal-button-container"});t.style.display="flex",t.style.justifyContent="flex-end",t.style.gap="10px",t.style.marginTop="20px";let e=t.createEl("button",{text:"\u4E0D\u4FDD\u5B58"});e.onclick=()=>{this.onSubmit(!1),this.close()};let i=t.createEl("button",{text:"\u53D6\u6D88"});i.onclick=()=>this.close();let a=t.createEl("button",{text:"\u4FDD\u5B58",cls:"mod-cta"});a.onclick=()=>{this.onSubmit(!0),this.close()},s.addEventListener("keydown",n=>{n.key==="Escape"&&(n.preventDefault(),this.close())})}onClose(){let{contentEl:s}=this;s.empty()}},S=class extends m.Component{constructor(t,e,i){super();this.lastSavedContent="";this.app=t,this.plugin=e,i.state?(this.state=i.state,this.state.zoomLevel||(this.state.zoomLevel=1),this.state.textColor||(this.state.textColor="#2C3E50")):this.state={id:Math.random().toString(36).substring(2,11),filePath:i.file?.path,content:i.content||"",title:i.title||(i.file?i.file.basename:"\u65B0\u4FBF\u7B7E"),top:"150px",left:"150px",width:"320px",height:"450px",color:this.plugin.settings.noteThemes[0].bg,textColor:this.plugin.settings.noteThemes[0].text,isEditing:!i.file&&!i.content,isPinned:!1,zoomLevel:1},this.initialContent=this.state.content||""}async onload(){if(this.plugin.activeNotes.push(this),this.injectCSS(),this.containerEl=document.body.createDiv({cls:"my-floating-sticky-note"}),this.state.filePath&&!this.state.content){let t=this.app.vault.getAbstractFileByPath(this.state.filePath);t instanceof m.TFile&&(this.state.content=await this.app.vault.read(t))}this.lastSavedContent=this.state.content||"",this.updateVisuals(),this.containerEl.addEventListener("wheel",t=>{if(t.ctrlKey||t.metaKey){t.preventDefault(),t.stopPropagation();let e=this.state.zoomLevel||1,i=.1,a=t.deltaY<0?i:-i;this.state.zoomLevel=Math.max(.5,Math.min(4,e+a)),this.updateVisuals(),this.saveState()}},{passive:!1}),this.createHeader(),await this.renderContent(),this.plugin.settings.openNotes.find(t=>t.id===this.state.id)||(this.plugin.settings.openNotes.push(this.state),this.plugin.saveSettings())}createHeader(){let t=this.containerEl.createDiv({cls:"my-sticky-header"}),e=t.createDiv({cls:"my-sticky-title-wrapper"}),i=e.createSpan({cls:"my-sticky-title-icon"});(0,m.setIcon)(i,"sticky-note"),e.createSpan({text:this.state.title||"",cls:"my-sticky-title"});let a=t.createDiv({cls:"my-sticky-controls"}),n=this.createButton(a,"pin",this.state.isPinned),o=this.createButton(a,"save"),r=this.createButton(a,this.state.isEditing?"eye":"pencil"),l=this.createButton(a,"palette",!1,"palette-btn-target"),p=a.createEl("button",{cls:"my-sticky-close"});(0,m.setIcon)(p,"x"),this.contentContainer=this.containerEl.createDiv({cls:"my-sticky-content markdown-rendered"}),this.textareaEl=this.containerEl.createEl("textarea",{cls:"my-sticky-textarea"});let d=this.createPalettePopup(a);this.bindHeaderEvents(n,o,r,l,p,d,e),this.setupDragging(t),this.setupResizing()}createButton(t,e,i=!1,a=""){let n=t.createEl("button",{cls:`my-sticky-btn ${a}`});return(0,m.setIcon)(n,e),i&&n.classList.add("is-active"),n}createPalettePopup(t){let e=t.createDiv({cls:"my-sticky-palette-popup"});return this.plugin.settings.noteThemes.forEach(i=>{let a=e.createDiv({cls:"my-sticky-swatch"});a.style.backgroundColor=i.bg,a.style.color=i.text,a.innerText="Aa",a.onclick=n=>{n.stopPropagation(),this.state.color=i.bg,this.state.textColor=i.text,this.updateVisuals(),this.saveState(),e.classList.remove("is-active")}}),this.containerEl.addEventListener("click",i=>{!i.target.closest(".my-sticky-palette-popup")&&!i.target.closest(".palette-btn-target")&&e.classList.remove("is-active")}),e}bindHeaderEvents(t,e,i,a,n,o,r){a.onclick=l=>{l.stopPropagation(),o.classList.toggle("is-active")},t.onclick=()=>{this.state.isPinned=!this.state.isPinned,t.classList.toggle("is-active",this.state.isPinned),this.updateVisuals(),this.saveState()},i.onclick=async()=>{if(this.state.isEditing){if(this.state.content=this.textareaEl.value,this.state.filePath){let l=this.app.vault.getAbstractFileByPath(this.state.filePath);l instanceof m.TFile&&await this.app.vault.modify(l,this.state.content)}this.state.isEditing=!1,(0,m.setIcon)(i,"pencil")}else{if(this.state.filePath){let l=this.app.vault.getAbstractFileByPath(this.state.filePath);l instanceof m.TFile&&(this.state.content=await this.app.vault.read(l))}this.state.isEditing=!0,(0,m.setIcon)(i,"eye")}await this.renderContent(),this.saveState()},e.onclick=async()=>{if(this.state.isEditing&&(this.state.content=this.textareaEl.value),this.state.filePath){let p=this.app.vault.getAbstractFileByPath(this.state.filePath);p instanceof m.TFile&&(await this.app.vault.modify(p,this.state.content||""),this.lastSavedContent=this.state.content||"",new m.Notice("\u2705 \u4FBF\u7B7E\u5DF2\u540C\u6B65\u81F3\u539F\u6587\u6863"));return}new q(this.app,this.plugin,async(p,d)=>{try{p.endsWith(".md")||(p+=".md");let c=d?`${d}/${p}`:p;if(this.app.vault.getAbstractFileByPath(c)){new m.Notice(`\u274C \u6587\u4EF6\u5DF2\u5B58\u5728: ${c}`);return}let g=await this.app.vault.create(c,this.state.content||"");this.state.filePath=g.path,this.state.title=g.basename,this.lastSavedContent=this.state.content||"";let y=r.querySelector(".my-sticky-title");y&&(y.innerText=this.state.title),this.saveState(),new m.Notice(`\u2705 \u5DF2\u4FDD\u5B58\u4E3A: ${c}`)}catch(c){console.error("\u4FDD\u5B58\u4FBF\u7B7E\u5931\u8D25:",c),new m.Notice(`\u274C \u4FDD\u5B58\u5931\u8D25: ${c}`)}}).open()},n.onclick=()=>{let l=this.state.isEditing?this.textareaEl.value:this.state.content,p=(l||"").trim().length>0,d=l!==this.lastSavedContent;!this.state.filePath&&p||this.state.filePath&&d?new et(this.app,async y=>{if(y)if(this.state.isEditing&&(this.state.content=this.textareaEl.value),this.state.filePath){let x=this.app.vault.getAbstractFileByPath(this.state.filePath);x instanceof m.TFile&&(await this.app.vault.modify(x,this.state.content||""),new m.Notice("\u2705 \u4FBF\u7B7E\u5DF2\u4FDD\u5B58")),this.close()}else new q(this.app,this.plugin,async(v,T)=>{try{v.endsWith(".md")||(v+=".md");let b=T?`${T}/${v}`:v;if(this.app.vault.getAbstractFileByPath(b)){new m.Notice(`\u274C \u6587\u4EF6\u5DF2\u5B58\u5728: ${b}`);return}await this.app.vault.create(b,this.state.content||""),new m.Notice(`\u2705 \u5DF2\u4FDD\u5B58\u4E3A: ${b}`),this.close()}catch(b){console.error("\u4FDD\u5B58\u4FBF\u7B7E\u5931\u8D25:",b),new m.Notice(`\u274C \u4FDD\u5B58\u5931\u8D25: ${b}`)}}).open();else this.close()}).open():this.close()}}updateVisuals(){this.containerEl.style.top=this.state.top,this.containerEl.style.left=this.state.left,this.containerEl.style.width=this.state.width,this.containerEl.style.height=this.state.height,this.containerEl.style.resize=this.state.isPinned?"none":"both",this.containerEl.style.setProperty("--sticky-zoom",(this.state.zoomLevel||1).toString());let t=N(this.state.color,this.plugin.settings.noteOpacity);this.containerEl.style.setProperty("--note-bg-color",this.state.color),this.containerEl.style.setProperty("--note-bg-color-alpha",t),this.containerEl.style.setProperty("--note-text-color",this.state.textColor||"#2C3E50"),this.containerEl.classList.toggle("is-pinned",this.state.isPinned)}async renderContent(){if(this.state.isEditing)this.contentContainer.style.display="none",this.textareaEl.style.display="block",this.textareaEl.value=this.state.content||"";else{this.textareaEl.style.display="none",this.contentContainer.style.display="block",this.contentContainer.empty();let t=this.state.content||"";if(this.state.filePath){let e=this.app.vault.getAbstractFileByPath(this.state.filePath);e instanceof m.TFile&&(t=await this.app.vault.read(e))}await m.MarkdownRenderer.renderMarkdown(t,this.contentContainer,this.state.filePath||"",this)}}saveState(){let t=this.plugin.settings.openNotes.findIndex(e=>e.id===this.state.id);t!==-1&&(this.plugin.settings.openNotes[t]=this.state,this.plugin.saveSettings())}onunload(){this.containerEl&&this.containerEl.remove();let t=this.plugin.activeNotes.indexOf(this);t>-1&&this.plugin.activeNotes.splice(t,1)}close(){let t=this.plugin.settings.openNotes.findIndex(e=>e.id===this.state.id);t!==-1&&(this.plugin.settings.openNotes.splice(t,1),this.plugin.saveSettings()),this.unload()}setupDragging(t){let e=0,i=0,a=0,n=0;t.onmousedown=o=>{if(this.state.isPinned)return;let r=o.target;r.tagName==="BUTTON"||r.closest(".my-sticky-btn")||r.closest(".my-sticky-close")||(a=o.clientX,n=o.clientY,document.onmouseup=()=>{document.onmouseup=null,document.onmousemove=null,this.saveState()},document.onmousemove=l=>{e=a-l.clientX,i=n-l.clientY,a=l.clientX,n=l.clientY,this.state.top=this.containerEl.offsetTop-i+"px",this.state.left=this.containerEl.offsetLeft-e+"px",this.containerEl.style.top=this.state.top,this.containerEl.style.left=this.state.left})}}setupResizing(){new ResizeObserver(()=>{this.state.isPinned||(this.state.width=this.containerEl.style.width,this.state.height=this.containerEl.style.height,this.saveState())}).observe(this.containerEl)}injectCSS(){P("sticky-note-plugin-styles-v15",`
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
		`)}};var K=require("obsidian");var nt=require("obsidian");var B=class extends nt.Modal{constructor(t,e){super(t);this.currentTab="month";this.history=e}onOpen(){let{contentEl:t}=this;t.empty(),t.addClass("history-stats-modal"),t.createEl("h2",{text:"\u{1F4C8} \u5B57\u6570\u7EDF\u8BA1"});let e=t.createDiv({cls:"stats-tab-group"});[{id:"7day",name:"\u8FD17\u65E5"},{id:"day",name:"\u8FD130\u65E5"},{id:"week",name:"\u6309\u5468"},{id:"month",name:"\u6309\u6708"},{id:"year",name:"\u6309\u5E74"}].forEach(a=>{let n=e.createEl("button",{text:a.name,cls:"stats-tab-btn"});this.currentTab===a.id&&n.addClass("is-active"),n.onclick=()=>{this.currentTab=a.id,e.querySelectorAll(".stats-tab-btn").forEach(o=>o.removeClass("is-active")),n.addClass("is-active"),this.renderData()}}),this.chartContainer=t.createDiv({cls:"stats-large-chart-container"}),this.renderData()}renderData(){this.chartContainer.empty();let t=this.aggregateData(),e=Object.keys(t).sort(),i=e;if(this.currentTab==="7day"&&(i=e.slice(-7)),this.currentTab==="day"&&(i=e.slice(-30)),this.currentTab==="week"&&(i=e.slice(-12)),i.length===0){this.chartContainer.createDiv({text:"\u6682\u65E0\u6570\u636E"});return}let a=Math.max(...i.map(n=>t[n].words),100);i.forEach(n=>{let o=t[n],r=this.chartContainer.createDiv({cls:"stats-large-col"}),l=Math.max(2,o.words/a*100),p=r.createDiv({cls:"stats-large-bar"});p.style.height=`${l}%`;let d=(o.focusMs/36e5).toFixed(1);p.setAttribute("title",`\u65F6\u95F4: ${n}
\u603B\u5B57\u6570: ${o.words.toLocaleString()}
\u4E13\u6CE8\u603B\u8BA1: ${d}\u5C0F\u65F6`),r.createDiv({cls:"stats-large-label",text:this.formatLabel(n)}),r.createDiv({cls:"stats-large-value",text:k(o.words)})})}aggregateData(){let t={};for(let[e,i]of Object.entries(this.history)){let a=window.moment(e),n=e;this.currentTab==="7day"?n=e:this.currentTab==="week"?n=`${a.year()}\u5E74 \u7B2C${a.isoWeek()}\u5468`:this.currentTab==="month"?n=a.format("YYYY-MM"):this.currentTab==="year"&&(n=a.format("YYYY")),t[n]||(t[n]={words:0,focusMs:0}),t[n].words+=Math.max(0,i.addedWords||0),t[n].focusMs+=i.focusMs||0}return t}formatLabel(t){return this.currentTab==="7day"||this.currentTab==="day"?t.substring(5):this.currentTab==="month"?t.substring(2):t}onClose(){this.contentEl.empty()}};var F="writing-status-view",H=class extends K.ItemView{constructor(s,t){super(s),this.plugin=t}getViewType(){return F}getDisplayText(){return"\u5199\u4F5C\u5B9E\u65F6\u72B6\u6001"}getIcon(){return"bar-chart-2"}async onOpen(){let s=this.containerEl.children[1];s.empty(),s.addClass("status-view-container"),this.createGoalCard(s),this.createTimeCard(s),this.createHistoryCard(s),this.updateData(),this.renderChart()}createGoalCard(s){let t=s.createDiv({cls:"status-card"}),e=t.createDiv({cls:"status-title"});e.createSpan({text:"\u4ECA\u65E5\u72B6\u6001"}),this.statusBadgeEl=e.createSpan({cls:"status-title-badge",text:"\u5DF2\u6682\u505C"});let i=t.createDiv({cls:"goal-display-row-right"});this.todayWordEl=i.createSpan({cls:"goal-current",text:"0"}),i.createSpan({cls:"goal-separator",text:" / "}),this.goalWordEl=i.createSpan({cls:"goal-target",text:"0"}),this.percentEl=i.createSpan({cls:"goal-percent",text:"0%"});let a=t.createDiv({cls:"progress-bar-bg"});this.progressFillEl=a.createDiv({cls:"progress-bar-fill"})}createTimeCard(s){let t=s.createDiv({cls:"status-card"});t.createDiv({cls:"status-title",text:"\u672C\u6B21\u7EDF\u8BA1"});let e=t.createDiv({cls:"time-box time-box-total"});e.createDiv({cls:"time-box-title",text:"\u603B\u8BA1\u8017\u65F6"}),this.totalTimeEl=e.createDiv({cls:"time-box-value",text:"00:00:00"});let i=t.createDiv({cls:"time-grid"}),a=i.createDiv({cls:"time-box"});a.createDiv({cls:"time-box-title",text:"\u4E13\u6CE8\u65F6\u957F"}),this.focusTimeEl=a.createDiv({cls:"time-box-value",text:"00:00:00"});let n=i.createDiv({cls:"time-box"});n.createDiv({cls:"time-box-title",text:"\u6478\u9C7C\u65F6\u957F"}),this.slackTimeEl=n.createDiv({cls:"time-box-value",text:"00:00:00"}),this.chartContainerEl=t.createDiv({cls:"history-chart"})}createHistoryCard(s){let t=s.createDiv({cls:"status-card"});t.createDiv({cls:"status-title",text:"\u5B57\u6570\u7EDF\u8BA1"});let e=t.createDiv({cls:"time-grid"}),i=e.createDiv({cls:"time-box"});i.createDiv({cls:"time-box-title",text:"\u672C\u5468\u51C0\u589E"}),this.weekWordEl=i.createDiv({cls:"time-box-value",text:"0"});let a=e.createDiv({cls:"time-box"});a.createDiv({cls:"time-box-title",text:"\u672C\u6708\u51C0\u589E"}),this.monthWordEl=a.createDiv({cls:"time-box-value",text:"0"});let n=e.createDiv({cls:"time-box"});n.createDiv({cls:"time-box-title",text:"\u4ECA\u5E74\u51C0\u589E"}),this.yearWordEl=n.createDiv({cls:"time-box-value",text:"0"});let o=e.createDiv({cls:"time-box"});o.createDiv({cls:"time-box-title",text:"\u7D2F\u8BA1\u603B\u5B57\u6570"}),this.historyTotalWordEl=o.createDiv({cls:"time-box-value",text:"0"})}updateData(){this.plugin.isTracking?(this.statusBadgeEl.innerText="\u25B6 \u8BB0\u5F55\u4E2D",this.statusBadgeEl.style.background="var(--color-green)",this.statusBadgeEl.style.color="#ffffff"):(this.statusBadgeEl.innerText="\u23F8 \u5DF2\u6682\u505C",this.statusBadgeEl.style.background="var(--text-muted)",this.statusBadgeEl.style.color="#ffffff");let s=this.plugin.settings.defaultGoal,t=this.plugin.app.workspace.getActiveViewOfType(K.MarkdownView);if(t?.file){let p=this.plugin.app.metadataCache.getFileCache(t.file),d=parseInt(p?.frontmatter?.["word-goal"]);isNaN(d)||(s=d)}let e=window.moment().format("YYYY-MM-DD"),i=this.plugin.settings.dailyHistory[e]||{focusMs:0,slackMs:0,addedWords:0},a=Math.max(0,i.addedWords);this.todayWordEl.innerText=a.toLocaleString(),this.goalWordEl.innerText=s.toLocaleString();let n=s>0?Math.min(Math.round(a/s*100),100):0;this.percentEl.innerText=` ${n}%`,this.progressFillEl.style.width=`${n}%`,n>=100?(this.progressFillEl.style.background="var(--color-green)",this.todayWordEl.style.color="var(--color-green)"):(this.progressFillEl.style.background="var(--interactive-accent)",this.todayWordEl.style.color="var(--text-normal)");let o=Math.floor(this.plugin.focusMs/1e3),r=Math.floor(this.plugin.slackMs/1e3),l=o+r;this.focusTimeEl.innerText=w(o),this.slackTimeEl.innerText=w(r),this.totalTimeEl.innerText=w(l),this.updateWordStats()}updateWordStats(){let s=0,t=0,e=0,i=0,a=window.moment();for(let[n,o]of Object.entries(this.plugin.settings.dailyHistory)){let r=o.addedWords||0;i+=r;let l=window.moment(n);l.isSame(a,"isoWeek")&&(s+=r),l.isSame(a,"month")&&(t+=r),l.isSame(a,"year")&&(e+=r)}this.weekWordEl&&(this.weekWordEl.innerText=Math.max(0,s).toLocaleString()),this.monthWordEl&&(this.monthWordEl.innerText=Math.max(0,t).toLocaleString()),this.yearWordEl&&(this.yearWordEl.innerText=Math.max(0,e).toLocaleString()),this.historyTotalWordEl&&(this.historyTotalWordEl.innerText=Math.max(0,i).toLocaleString())}renderChart(){this.chartContainerEl.empty();let s=this.chartContainerEl.createDiv({text:"\u8FD17\u65E5\u5B57\u6570\u7EDF\u8BA1",cls:"history-chart-title"}),t=this.chartContainerEl.createDiv({text:"\u70B9\u51FB\u67E5\u770B\u8BE6\u60C5",cls:"history-chart-subtitle"});t.setAttribute("aria-label","\u70B9\u51FB\u8FDB\u5165\u5B57\u6570\u7EDF\u8BA1\u8BE6\u60C5"),t.onclick=()=>{new B(this.plugin.app,this.plugin.settings.dailyHistory).open()};let e=this.chartContainerEl.createDiv({attr:{style:"display: flex; flex-direction: column; gap: 6px; cursor: pointer;"}});e.onclick=()=>{new B(this.plugin.app,this.plugin.settings.dailyHistory).open()};let i=this.plugin.settings.dailyHistory,a=Object.keys(i).sort().slice(-7);if(a.length===0){e.createDiv({text:"\u6682\u65E0\u5386\u53F2\u6570\u636E",attr:{style:"color: var(--text-muted); font-size: 0.8em; padding: 10px 0;"}});return}let n=Math.max(...a.map(o=>i[o].addedWords),100);a.forEach(o=>{let r=i[o],l=e.createDiv({attr:{style:"display: flex; align-items: center; gap: 8px;"}});l.createDiv({text:o.substring(5),attr:{style:"font-size: 0.7em; color: var(--text-muted); min-width: 35px; text-align: right; flex-shrink: 0;"}});let p=l.createDiv({attr:{style:"flex: 1; height: 18px; background: var(--background-modifier-border); border-radius: 3px; overflow: hidden; position: relative; min-width: 0;"}}),d=Math.max(2,Math.max(0,r.addedWords)/n*100),c=p.createDiv({attr:{style:`width: ${d}%; height: 100%; background: var(--interactive-accent); border-radius: 3px; transition: width 0.4s ease;`}}),g=(r.focusMs/36e5).toFixed(1);c.setAttribute("title",`\u65E5\u671F: ${o}
\u5B57\u6570: ${Math.max(0,r.addedWords)}
\u4E13\u6CE8\u65F6\u957F: ${g}h`),l.createDiv({text:k(Math.max(0,r.addedWords)),attr:{style:"font-size: 0.75em; font-weight: bold; font-family: var(--font-monospace); min-width: 40px; text-align: right; flex-shrink: 0;"}})})}async onClose(){}};tt();var pt={defaultGoal:3e3,showGoal:!0,showExplorerCounts:!0,enableSmartChapterSort:!1,enableObs:!1,enableLegacyObsExport:!1,obsPath:"",openNotes:[],noteOpacity:.9,dailyHistory:{},idleTimeoutThreshold:60*1e3,noteThemes:[{bg:"#FDF3B8",text:"#2C3E50"},{bg:"#FCDDEC",text:"#5D2E46"},{bg:"#CCE8CF",text:"#2A4A30"},{bg:"#2C3E50",text:"#F8F9FA"},{bg:"#E8DFF5",text:"#4A3B69"},{bg:"#FDE0C1",text:"#593D2B"}],obsPort:24816,obsOverlayTheme:"dark",obsOverlayOpacity:.85,obsCustomCss:"",obsShowFocusTime:!0,obsShowSlackTime:!0,obsShowTotalTime:!0,obsShowTodayWords:!0,obsShowSessionWords:!0},X=class extends u.Plugin{constructor(t,e){super(t,e);this.isTracking=!1;this.focusMs=0;this.slackMs=0;this.lastTickTime=0;this.sessionAddedWords=0;this.lastFileWords=0;this.lastEditTime=Date.now();this.worker=null;this.activeNotes=[];this.obsServer=null;this.cacheManager=new R,this.debounceManager=new j,this.settingsManager=new G(this,pt),this.fileExplorerPatcher=new U(this.app)}async onload(){if(await this.loadSettings(),this.injectGlobalStyles(),this.statusBarItemEl=this.addStatusBarItem(),this.addSettingTab(new _(this.app,this)),this.registerEvent(this.app.workspace.on("editor-change",()=>{this.debounceManager.debounce("editor-update",()=>{this.handleEditorChange()},300)})),this.registerEvent(this.app.workspace.on("active-leaf-change",this.handleFileChange.bind(this))),this.registerEvent(this.app.metadataCache.on("changed",()=>{this.debounceManager.debounce("word-count-update",()=>{this.updateWordCount()},100)})),this.updateWordCount(),W()){this.registerEvent(this.app.workspace.on("file-menu",(t,e)=>{e instanceof u.TFile&&e.extension==="md"&&t.addItem(i=>{i.setTitle("\u8BBE\u5B9A\u672C\u7AE0\u76EE\u6807\u5B57\u6570").setIcon("target").onClick(()=>{new E(this.app,e).open()})})})),this.registerEvent(this.app.workspace.on("editor-menu",(t,e,i)=>{i.file&&t.addItem(a=>{a.setTitle("\u8BBE\u5B9A\u672C\u7AE0\u76EE\u6807\u5B57\u6570").setIcon("target").onClick(()=>{new E(this.app,i.file).open()})})}));return}this.registerView(F,t=>new H(t,this)),this.app.workspace.onLayoutReady(()=>{this.settings.openNotes.forEach(t=>{new S(this.app,this,{state:t}).load()}),setTimeout(()=>{this.buildFolderCache()},1e3)}),this.registerEvent(this.app.vault.on("modify",t=>{t instanceof u.TFile&&t.extension==="md"&&this.debounceManager.debounce("folder-refresh",()=>{this.updateFileCacheAndRefresh(t)},500)})),this.registerEvent(this.app.vault.on("delete",t=>{t instanceof u.TFile&&t.extension==="md"&&(this.cacheManager.invalidateCache(t.path,this.app.vault),this.debounceManager.debounce("folder-refresh",()=>{this.refreshFolderCounts()},500))})),this.registerEvent(this.app.vault.on("rename",(t,e)=>{t instanceof u.TFile&&t.extension==="md"&&(this.cacheManager.invalidateCache(e,this.app.vault),this.debounceManager.debounce("folder-refresh",()=>{this.updateFileCacheAndRefresh(t)},500))})),this.registerEvent(this.app.workspace.on("layout-change",()=>{this.debounceManager.debounce("folder-refresh",()=>{this.refreshFolderCounts()},500)})),this.addRibbonIcon("sticky-note","\u65B0\u5EFA\u7A7A\u767D\u60AC\u6D6E\u4FBF\u7B7E",()=>{new S(this.app,this,{content:"",title:"\u65B0\u4FBF\u7B7E"}).load()}),this.addRibbonIcon("bar-chart-2","\u6253\u5F00/\u5173\u95ED\u5199\u4F5C\u5B9E\u65F6\u72B6\u6001\u9762\u677F",()=>{this.toggleStatusView()}),this.addCommand({id:"toggle-writing-status-view",name:"\u6253\u5F00/\u5173\u95ED\u5199\u4F5C\u5B9E\u65F6\u72B6\u6001\u9762\u677F",callback:()=>this.toggleStatusView()}),this.addCommand({id:"toggle-tracking",name:"\u5F00\u59CB/\u6682\u505C \u7801\u5B57\u4E0E\u65F6\u957F\u7EDF\u8BA1",callback:()=>{this.isTracking=!this.isTracking,this.isTracking?(this.lastTickTime=Date.now(),this.worker?.postMessage("start"),new u.Notice("\u25B6\uFE0F \u7801\u5B57\u65F6\u957F\u7EDF\u8BA1\u5DF2\u5F00\u59CB")):(this.worker?.postMessage("stop"),new u.Notice("\u23F8\uFE0F \u7801\u5B57\u65F6\u957F\u7EDF\u8BA1\u5DF2\u6682\u505C")),this.updateWordCount(),this.exportLegacyOBS(!0),this.refreshStatusViews()}}),this.addCommand({id:"create-blank-sticky-note",name:"\u65B0\u5EFA\u7A7A\u767D\u60AC\u6D6E\u4FBF\u7B7E",callback:()=>{new S(this.app,this,{content:"",title:"\u65B0\u4FBF\u7B7E"}).load()}}),this.addCommand({id:"reset-stream-session",name:"\u91CD\u7F6E\u76F4\u64AD\u7EDF\u8BA1\u6570\u636E (\u6E05\u96F6\u65F6\u957F\u4E0E\u4ECA\u65E5\u5B57\u6570)",callback:()=>{this.focusMs=0,this.slackMs=0,this.sessionAddedWords=0,this.isTracking=!1,this.worker?.postMessage("stop"),this.handleFileChange(),this.exportLegacyOBS(!0),this.refreshStatusViews(),new u.Notice("\u76F4\u64AD\u6570\u636E\u5DF2\u91CD\u7F6E\uFF0C\u4E14\u7EDF\u8BA1\u5DF2\u6682\u505C\uFF0C\u8BF7\u624B\u52A8\u5F00\u59CB\u65B0\u7684\u573A\u6B21\uFF01")}}),this.addCommand({id:"create-next-chapter",name:"\u81EA\u52A8\u751F\u6210\u4E0B\u4E00\u7AE0 (\u5E26\u7F16\u53F7\u9012\u589E)",editorCallback:async(t,e)=>{let i=e.file;if(!i)return;let a=i.basename,n={\u96F6:0,\u4E00:1,\u4E8C:2,\u4E09:3,\u56DB:4,\u4E94:5,\u516D:6,\u4E03:7,\u516B:8,\u4E5D:9,\u5341:10,"\u3007":0,\u58F9:1,\u8D30:2,\u53C1:3,\u8086:4,\u4F0D:5,\u9646:6,\u67D2:7,\u634C:8,\u7396:9,\u62FE:10,\u767E:100,\u4F70:100,\u5343:1e3,\u4EDF:1e3,\u4E07:1e4,\u842C:1e4},o=["\u96F6","\u4E00","\u4E8C","\u4E09","\u56DB","\u4E94","\u516D","\u4E03","\u516B","\u4E5D","\u5341"],r=c=>{if(c==="\u5341")return 10;if(c.startsWith("\u5341"))return 10+(n[c[1]]||0);if(c.includes("\u5341")){let g=c.split("\u5341"),y=n[g[0]]||0,x=g[1]&&n[g[1]]||0;return y*10+x}return n[c]||0},l=c=>{if(c<=10)return o[c];if(c<20)return"\u5341"+(c===10?"":o[c-10]);let g=Math.floor(c/10),y=c%10;return o[g]+"\u5341"+(y===0?"":o[y])},p=(c,g)=>{if(!c)return 0;let y=0;for(let x of c.children)if(x instanceof u.TFile&&x.extension==="md"){let v=x.basename.match(/^([^0-9]*)(\d+)/);if(v&&v[1].toLowerCase()===g.toLowerCase()){let b=parseInt(v[2],10);b>y&&(y=b)}}return y},d=a.match(/^([^0-9]*)(\d+)([章节回]?)(.*)$/);if(d){let c=d[1],g=d[2],y=d[3],x=parseInt(g,10)+1,v=i.parent,T=p(v,c),b=g.length;T>=100&&b<3?b=3:T>=10&&b<2&&(b=2);let V=x.toString().padStart(b,"0"),D=`${c}${V}${y}.md`,A=v?`${v.path}/${D}`:D,C=this.app.vault.getAbstractFileByPath(A);if(C){await this.app.workspace.getLeaf(!1).openFile(C);return}try{let z=await this.app.vault.create(A,"");await this.app.workspace.getLeaf(!1).openFile(z),new u.Notice(`\u2705 \u5DF2\u521B\u5EFA: ${D}`)}catch(z){console.error(z),new u.Notice(`\u274C \u521B\u5EFA\u5931\u8D25: ${z}`)}return}if(d=a.match(/^([^零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]*)([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)([章节回]?)(.*)$/),d){let c=d[1],g=d[2],y=d[3],x=r(g);if(x===0){new u.Notice("\u65E0\u6CD5\u8BC6\u522B\u4E2D\u6587\u6570\u5B57\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u540D\u683C\u5F0F\uFF01");return}let v=x+1,T=l(v),b=`${c}${T}${y}.md`,V=i.parent,D=V?`${V.path}/${b}`:b,A=this.app.vault.getAbstractFileByPath(D);if(A){await this.app.workspace.getLeaf(!1).openFile(A);return}try{let C=await this.app.vault.create(D,"");await this.app.workspace.getLeaf(!1).openFile(C),new u.Notice(`\u2705 \u5DF2\u521B\u5EFA: ${b}`)}catch(C){console.error(C),new u.Notice(`\u274C \u521B\u5EFA\u5931\u8D25: ${C}`)}return}new u.Notice("\u5F53\u524D\u6587\u4EF6\u540D\u4E0D\u5305\u542B\u53EF\u8BC6\u522B\u7684\u6570\u5B57\uFF08\u963F\u62C9\u4F2F\u6570\u5B57\u6216\u4E2D\u6587\u6570\u5B57\uFF09\uFF0C\u65E0\u6CD5\u81EA\u52A8\u9012\u589E\uFF01")}}),this.registerEvent(this.app.workspace.on("file-menu",(t,e)=>{e instanceof u.TFile&&e.extension==="md"&&(t.addItem(i=>{i.setTitle("\u8BBE\u5B9A\u672C\u7AE0\u76EE\u6807\u5B57\u6570").setIcon("target").onClick(()=>{new E(this.app,e).open()})}),t.addItem(i=>{i.setTitle("\u4F5C\u4E3A\u60AC\u6D6E\u4FBF\u7B7E\u6253\u5F00").setIcon("popup-open").onClick(()=>{new S(this.app,this,{file:e}).load()})})),e instanceof u.TFolder&&t.addItem(i=>{i.setTitle("\u5408\u5E76\u5BFC\u51FA").setIcon("documents").onClick(async()=>{let a=new u.Notice(`\u6B63\u5728\u626B\u63CF\u5E76\u5408\u5E76\u300A${e.name}\u300B...`,0),n=[],o=c=>{for(let g of c.children)g instanceof u.TFile&&g.extension==="md"?n.push(g):g instanceof u.TFolder&&o(g)};if(o(e),n.length===0){a.hide(),new u.Notice(`\u6587\u4EF6\u5939\u300A${e.name}\u300B\u4E2D\u6CA1\u6709\u627E\u5230 Markdown \u6587\u4EF6\uFF01`);return}n.sort((c,g)=>c.path.localeCompare(g.path,"zh",{numeric:!0}));let r=`# \u3010\u5408\u5E76\u5BFC\u51FA\u3011${e.name}

`,l=0;for(let c of n){let g=await this.app.vault.cachedRead(c);r+=`

## ${c.basename}

`,r+=g,l+=this.calculateAccurateWords(g)}let p=`${e.parent?.path==="/"?"":e.parent?.path+"/"}${e.name}_\u5408\u5E76\u5BFC\u51FA.md`,d=1;for(;this.app.vault.getAbstractFileByPath(p);)p=`${e.parent?.path==="/"?"":e.parent?.path+"/"}${e.name}_\u5408\u5E76\u5BFC\u51FA(${d}).md`,d++;try{let c=await this.app.vault.create(p,r.trim());a.hide(),await this.app.workspace.getLeaf(!1).openFile(c),new u.Notice(`\u2705 \u5408\u5E76\u6210\u529F\uFF01
\u5171\u5408\u5E76 ${n.length} \u4E2A\u6587\u4EF6
\u603B\u8BA1 ${l.toLocaleString()} \u5B57`,8e3)}catch(c){console.error(c),a.hide(),new u.Notice("\u5408\u5E76\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u6743\u9650\uFF01")}})})})),this.registerEvent(this.app.workspace.on("editor-menu",(t,e,i)=>{e.somethingSelected()&&t.addItem(a=>{a.setTitle("\u5C06\u9009\u4E2D\u5185\u5BB9\u62BD\u51FA\u4E3A\u4FBF\u7B7E").setIcon("quote").onClick(()=>{new S(this.app,this,{content:e.getSelection(),title:"\u9009\u4E2D\u7247\u6BB5"}).load()})}),i.file&&(t.addItem(a=>{a.setTitle("\u8BBE\u5B9A\u672C\u7AE0\u76EE\u6807\u5B57\u6570").setIcon("target").onClick(()=>{new E(this.app,i.file).open()})}),t.addItem(a=>{a.setTitle("\u5F53\u524D\u6587\u4EF6\u4F5C\u4E3A\u4FBF\u7B7E\u62BD\u51FA").setIcon("popup-open").onClick(()=>{new S(this.app,this,{file:i.file}).load()})}))})),this.setupWorker(),this.settings.enableObs&&(this.obsServer=new O(this,this.settings.obsPort),this.obsServer.start()),this.settings.enableSmartChapterSort&&this.app.workspace.onLayoutReady(()=>{setTimeout(()=>{this.fileExplorerPatcher.enable()?console.log("[WebNovel Assistant] Smart chapter sorting enabled"):console.warn("[WebNovel Assistant] Failed to enable smart chapter sorting")},1e3)}),this.addCommand({id:"copy-obs-overlay-url",name:"\u590D\u5236 OBS \u53E0\u52A0\u5C42 URL \u5230\u526A\u8D34\u677F",callback:()=>{let t=`http://127.0.0.1:${this.settings.obsPort}/`;navigator.clipboard.writeText(t),new u.Notice(`\u5DF2\u590D\u5236: ${t}`)}}),this.addCommand({id:"refresh-chapter-sort",name:"\u624B\u52A8\u5237\u65B0\u7AE0\u8282\u6392\u5E8F\uFF08\u901A\u5E38\u4E0D\u9700\u8981\uFF09",callback:()=>{if(!this.settings.enableSmartChapterSort){new u.Notice('\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u542F\u7528"\u667A\u80FD\u7AE0\u8282\u6392\u5E8F"\u529F\u80FD');return}this.fileExplorerPatcher.refreshManually(),new u.Notice(`\u2705 \u7AE0\u8282\u6392\u5E8F\u5DF2\u5237\u65B0

\u{1F4A1} \u63D0\u793A\uFF1A\u667A\u80FD\u6392\u5E8F\u4F1A\u81EA\u52A8\u5E94\u7528\uFF0C\u901A\u5E38\u4E0D\u9700\u8981\u624B\u52A8\u5237\u65B0`)}}),this.registerInterval(window.setInterval(()=>{this.isTracking&&this.saveSettings()},60*1e3))}onunload(){this.activeNotes.forEach(t=>{let e=this.settings.openNotes.findIndex(i=>i.id===t.state.id);e!==-1&&(this.settings.openNotes[e]=t.state)}),this.saveSettings(),this.removeGlobalStyles(),this.debounceManager.cancelAll(),this.cacheManager.clearCache(),this.fileExplorerPatcher.disable(),this.worker&&this.worker.terminate(),this.obsServer?.stop(),this.activeNotes.forEach(t=>{t.containerEl&&t.containerEl.remove()}),this.activeNotes=[]}async buildFolderCache(){if(this.settings.showExplorerCounts)try{let t=new u.Notice("\u6B63\u5728\u6784\u5EFA\u6587\u4EF6\u5939\u5B57\u6570\u7F13\u5B58...",0);await this.cacheManager.buildInitialCache(this.app.vault,this.calculateAccurateWords.bind(this)),t.hide(),this.refreshFolderCounts(),new u.Notice("\u6587\u4EF6\u5939\u5B57\u6570\u7F13\u5B58\u6784\u5EFA\u5B8C\u6210",3e3)}catch(t){console.error("[Plugin] \u7F13\u5B58\u6784\u5EFA\u5931\u8D25:",t),this.settings.showExplorerCounts=!1,await this.saveSettings(),new u.Notice(`\u6587\u4EF6\u5939\u5B57\u6570\u7F13\u5B58\u6784\u5EFA\u5931\u8D25\uFF0C\u5DF2\u81EA\u52A8\u7981\u7528\u8BE5\u529F\u80FD
\u60A8\u53EF\u4EE5\u5728\u8BBE\u7F6E\u4E2D\u91CD\u65B0\u542F\u7528
\u9519\u8BEF: ${t instanceof Error?t.message:String(t)}`,1e4)}}async updateFileCacheAndRefresh(t){try{let e=await this.app.vault.cachedRead(t),i=this.calculateAccurateWords(e);this.cacheManager.updateFileCache(t,i,this.app.vault),this.refreshFolderCounts()}catch(e){console.error("[Plugin] \u66F4\u65B0\u6587\u4EF6\u7F13\u5B58\u5931\u8D25:",e),this.cacheManager.invalidateCache(t.path,this.app.vault)}}async toggleStatusView(){let{workspace:t}=this.app,e=t.getLeavesOfType(F);if(e.length>0)e.forEach(i=>i.detach());else{let i=t.getRightLeaf(!1);i&&(await i.setViewState({type:F,active:!0}),t.revealLeaf(i))}}async loadSettings(){this.settings=await this.settingsManager.loadSettings()}async saveSettings(){await this.settingsManager.saveSettings()}calculateAccurateWords(t){return t.replace(/\s+/g,"").length}handleEditorChange(){let t=this.app.workspace.getActiveViewOfType(u.MarkdownView);if(!t)return;this.lastEditTime=Date.now();let e=this.calculateAccurateWords(t.getViewData()),i=e-this.lastFileWords;this.sessionAddedWords+=i,this.lastFileWords=e;let a=window.moment().format("YYYY-MM-DD");this.settings.dailyHistory[a]||(this.settings.dailyHistory[a]={focusMs:0,slackMs:0,addedWords:0}),this.settings.dailyHistory[a].addedWords+=i,this.updateWordCount(),this.refreshStatusViews()}handleFileChange(){let t=this.app.workspace.getActiveViewOfType(u.MarkdownView);this.lastFileWords=t?this.calculateAccurateWords(t.getViewData()):0,this.updateWordCount(),this.refreshStatusViews()}updateWordCount(){let t=this.app.workspace.getActiveViewOfType(u.MarkdownView);if(!t){this.statusBarItemEl.setText("");return}let e=this.calculateAccurateWords(t.getViewData()),i=Math.max(0,this.sessionAddedWords),a=this.isTracking?"\u25B6\uFE0F\u8BB0\u5F55\u4E2D":"\u23F8\uFE0F\u5DF2\u6682\u505C";if(this.settings.showGoal&&t.file){let o=this.app.metadataCache.getFileCache(t.file),r=this.settings.defaultGoal;if(o?.frontmatter&&o.frontmatter["word-goal"]){let l=parseInt(o.frontmatter["word-goal"]);isNaN(l)||(r=l)}if(r>0){let l=Math.min(Math.round(e/r*100),100),p=l>=100?"\u2705":"\u{1F3AF}";this.statusBarItemEl.setText(`[${a}] ${p} \u5B57\u6570: ${e} / ${r} (${l}%) | \u51C0\u589E: ${i}`);return}}let n=(t.getViewData().match(/[\u4e00-\u9fa5]/g)||[]).length;this.statusBarItemEl.setText(`[${a}] \u{1F4DD} \u5B57\u6570: ${e} (\u7EAF\u6C49\u5B57: ${n}) | \u51C0\u589E: ${i}`)}setupWorker(){let t=`
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
  \u5217\u53F7:`,i.colno);let a=this.isTracking;this.worker&&(this.worker.terminate(),this.worker=null),setTimeout(()=>{console.log("[WebNovel Assistant] \u6B63\u5728\u91CD\u542F Worker..."),this.setupWorker(),a&&(this.worker?.postMessage("start"),console.log("[WebNovel Assistant] Worker \u5DF2\u91CD\u542F\uFF0C\u8FFD\u8E2A\u72B6\u6001\u5DF2\u6062\u590D")),new u.Notice(`\u26A0\uFE0F \u65F6\u95F4\u8FFD\u8E2A Worker \u5DF2\u81EA\u52A8\u91CD\u542F
\u8FFD\u8E2A\u529F\u80FD\u5DF2\u6062\u590D\u6B63\u5E38`,5e3)},5e3)},this.worker.onmessage=()=>{if(!this.isTracking)return;let i=Date.now(),a=i-this.lastTickTime;this.lastTickTime=i;let n=document.hasFocus(),o=i-this.lastEditTime<this.settings.idleTimeoutThreshold,r=window.moment().format("YYYY-MM-DD");this.settings.dailyHistory[r]||(this.settings.dailyHistory[r]={focusMs:0,slackMs:0,addedWords:0}),n&&o?(this.focusMs+=a,this.settings.dailyHistory[r].focusMs+=a):(this.slackMs+=a,this.settings.dailyHistory[r].slackMs+=a),this.refreshStatusViews(),this.settings.enableLegacyObsExport&&this.exportLegacyOBS(),this.settings.enableObs&&this.obsServer}}refreshStatusViews(){let t=this.app.workspace.getLeavesOfType(F);for(let e of t)e.view instanceof H&&e.view.updateData()}exportLegacyOBS(t=!1){if(!(!$()||!this.settings.enableLegacyObsExport||!this.settings.obsPath))try{let e=window.require("fs"),i=window.require("path"),a=this.settings.obsPath;e.existsSync(a)||e.mkdirSync(a,{recursive:!0});let n=Math.floor((this.focusMs+this.slackMs)/1e3),o=Math.floor(this.focusMs/1e3),r=n-o;e.writeFileSync(i.join(a,"obs_focus_time.txt"),w(o),"utf8"),e.writeFileSync(i.join(a,"obs_slack_time.txt"),w(r),"utf8"),e.writeFileSync(i.join(a,"obs_total_time.txt"),w(n),"utf8"),e.writeFileSync(i.join(a,"obs_words_done.txt"),Math.max(0,this.sessionAddedWords).toString(),"utf8");let l=this.settings.defaultGoal,p=this.app.workspace.getActiveViewOfType(u.MarkdownView);if(p?.file){let d=this.app.metadataCache.getFileCache(p.file),c=parseInt(d?.frontmatter?.["word-goal"]);isNaN(c)||(l=c)}e.writeFileSync(i.join(a,"obs_words_goal.txt"),l.toString(),"utf8")}catch(e){t&&console.error(e)}}getObsStats(){let t=Math.floor(this.focusMs/1e3),e=Math.floor(this.slackMs/1e3),i=t+e,a=window.moment().format("YYYY-MM-DD"),n=this.settings.dailyHistory[a]||{focusMs:0,slackMs:0,addedWords:0},o=this.settings.defaultGoal,r="",l=this.app.workspace.getActiveViewOfType(u.MarkdownView);if(l?.file){r=l.file.basename;let d=this.app.metadataCache.getFileCache(l.file),c=parseInt(d?.frontmatter?.["word-goal"]);isNaN(c)||(o=c)}let p=Math.max(0,n.addedWords);return{isTracking:this.isTracking,focusTime:w(t),slackTime:w(e),totalTime:w(i),sessionWords:Math.max(0,this.sessionAddedWords),todayWords:p,goal:o,percent:o>0?Math.min(Math.round(p/o*100),100):0,currentFile:r}}buildObsOverlayHtml(){let t=this.settings.obsOverlayTheme||"dark",e=t==="dark",i=this.settings.obsOverlayOpacity??.85,a=e?`rgba(20, 20, 30, ${i})`:`rgba(255, 255, 255, ${i})`,n=e?"#E8E8E8":"#2C3E50";if(t.startsWith("note-")){let x=parseInt(t.split("-")[1]),v=this.settings.noteThemes[x];v&&(a=N(v.bg,i),n=v.text,e=!1)}let o=e?"#888":"#999",r=e?"#6C9EFF":"#4A90D9",l="#4CAF50",p="#E74C3C",d="";(this.settings.obsShowFocusTime||this.settings.obsShowSlackTime||this.settings.obsShowTotalTime)&&(d=`
	<div class="time-row">`,this.settings.obsShowTotalTime&&(d+=`
		<div class="time-item"><div class="time-label">\u603B\u8BA1\u65F6\u957F</div><div class="time-value" id="totalTime">00:00:00</div></div>`),this.settings.obsShowFocusTime&&(d+=`
		<div class="time-item"><div class="time-label">\u4E13\u6CE8\u65F6\u957F</div><div class="time-value focus" id="focusTime">00:00:00</div></div>`),this.settings.obsShowSlackTime&&(d+=`
		<div class="time-item"><div class="time-label">\u6478\u9C7C\u65F6\u957F</div><div class="time-value slack" id="slackTime">00:00:00</div></div>`),d+=`
	</div>
	<div class="divider"></div>`);let c="";this.settings.obsShowTodayWords&&(c=`
	<div class="goal-row">
		<span class="goal-label">\u76EE\u6807\u8FDB\u5EA6</span>
		<span class="goal-value"><span id="todayWords" class="current-val">0</span> <span class="sep">/</span> <span id="goalValue" class="target-val">0</span><span class="percent" id="percentText">0%</span></span>
	</div>
	<div class="progress-bg">
		<div class="progress-fill" id="progressFill" style="width: 0%"></div>
	</div>`);let g="";return this.settings.obsShowSessionWords&&(g=`
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
	color: ${n};
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
	background: ${l};
	animation: pulse 1.5s ease-in-out infinite;
}
.status-dot.paused {
	background: ${o};
}
@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.3; }
}


.time-label {
	font-size: 16px; /* \u5DF2\u8FD8\u539F\u65E7\u7248\u5B57\u53F7 */
	color: ${n};
	opacity: 0.9;
}
.time-value {
	font-family: 'Consolas', 'Courier New', monospace;
	font-size: 24px; /* \u5DF2\u8FD8\u539F\u65E7\u7248\u5B57\u53F7 */
	font-weight: 700;
	letter-spacing: 1px;
}
.time-value.focus { color: ${r}; }
.time-value.slack { color: ${p}; }
.divider {
	height: 1px;
	background: ${e?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)"};
	margin: 4px 0;
}





.goal-value .percent {
	font-size: 13px;
	color: ${r};
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
	background: ${r};
	transition: width 0.8s ease, background-color 0.5s ease;
}
.progress-fill.done {
	background: ${l};
}

.session-row .val {
	text-align: right;
	font-family: 'Consolas', monospace;
	font-weight: 600;
	color: ${n};
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
	color: ${n};
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
.goal-value .percent { font-size: 14px; color: ${r}; font-weight: normal; } /* \u5DF2\u8FD8\u539F\u65E7\u7248\u5B57\u53F7 */

/* Custom User CSS */
${this.settings.obsCustomCss||""}
</style>
</head>
<body>
<div class="overlay-card">
	<div class="overlay-title">
		<span class="status-dot paused" id="statusDot"></span>
	</div>
	${d}
	${c}
	${g}
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
</html>`}async refreshFolderCounts(){let t=this.app.workspace.getLeavesOfType("file-explorer")[0];if(!t)return;let e=t.view.fileItems;if(!this.settings.showExplorerCounts){for(let i in e){let a=e[i];if(a.el){let n=a.el.querySelector(".folder-word-count");n&&n.remove()}}return}for(let i in e){let a=e[i];if(a.el&&(a.file instanceof u.TFolder||a.file instanceof u.TFile&&a.file.extension==="md")){let n=this.cacheManager.getFolderCount(i)||0,o=a.el.querySelector(".folder-word-count");if(!o){let r=a.el.querySelector(".nav-folder-title-content")||a.el.querySelector(".nav-file-title-content");r&&(o=r.createEl("span",{cls:"folder-word-count"}))}o&&(o.setText(n>0?` (${k(n)})`:""),o.style.fontSize="0.8em",o.style.opacity="0.5",o.style.marginLeft="5px")}}}injectGlobalStyles(){P("accurate-count-global-styles",`
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
			`)}removeGlobalStyles(){Z("accurate-count-global-styles")}};
