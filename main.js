"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AccurateChineseCountPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian24 = require("obsidian");

// src/utils/format.ts
function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(255, 255, 255, ${alpha})`;
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  if (h.length !== 6) {
    return `rgba(255, 255, 255, ${alpha})`;
  }
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const m = Math.floor(totalSeconds % 3600 / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}
function formatCount(count) {
  const isNegative = count < 0;
  const absCount = Math.abs(count);
  let result;
  if (absCount >= 1e4) {
    result = (absCount / 1e4).toFixed(1) + "w";
  } else if (absCount >= 1e3) {
    result = (absCount / 1e3).toFixed(1) + "k";
  } else {
    result = absCount.toString();
  }
  return isNegative ? "-" + result : result;
}

// src/utils/dom.ts
function injectGlobalStyle(styleId, cssContent) {
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) {
    existingStyle.innerHTML = cssContent;
    return;
  }
  const style = document.createElement("style");
  style.id = styleId;
  style.innerHTML = cssContent;
  document.head.appendChild(style);
}
function removeGlobalStyle(styleId) {
  const style = document.getElementById(styleId);
  if (style) {
    style.remove();
  }
}

// src/utils/platform.ts
var import_obsidian = require("obsidian");
function isDesktop() {
  return !import_obsidian.Platform.isMobile;
}
function isMobile() {
  return import_obsidian.Platform.isMobile;
}
function isTablet() {
  const isMobileEnv = import_obsidian.Platform.isMobile;
  const isPhone = document.body.classList.contains("is-phone");
  const isIpad = import_obsidian.Platform.isIpad;
  const isWide = window.innerWidth >= 768;
  return isMobileEnv && (isIpad || isWide && !isPhone);
}
function getPlatformTier() {
  if (isDesktop()) return "desktop";
  if (isTablet()) return "tablet";
  return "mobile";
}

// src/constants.ts
var CACHE_CONFIG = {
  /** 最大缓存条目数 */
  MAX_SIZE: 1e4,
  /** 缓存失效超时时间（毫秒） */
  INVALIDATION_TIMEOUT: 5e3,
  /** 字数计算缓存最大条目数 */
  WORD_COUNT_CACHE_MAX: 100
};
var CHINESE_NUMBERS = {
  "\u96F6": 0,
  "\u4E00": 1,
  "\u4E8C": 2,
  "\u4E09": 3,
  "\u56DB": 4,
  "\u4E94": 5,
  "\u516D": 6,
  "\u4E03": 7,
  "\u516B": 8,
  "\u4E5D": 9,
  "\u5341": 10,
  "\u3007": 0,
  "\u58F9": 1,
  "\u8D30": 2,
  "\u53C1": 3,
  "\u8086": 4,
  "\u4F0D": 5,
  "\u9646": 6,
  "\u67D2": 7,
  "\u634C": 8,
  "\u7396": 9,
  "\u62FE": 10,
  "\u767E": 100,
  "\u4F70": 100,
  "\u5343": 1e3,
  "\u4EDF": 1e3,
  "\u4E07": 1e4,
  "\u842C": 1e4
};
var VIEW_TYPES = {
  STATUS: "status-view",
  FORESHADOWING: "foreshadowing-view",
  TIMELINE: "timeline-view",
  CREATIVE: "creative-view",
  IMMERSIVE_CHAPTER_LIST: "immersive-chapter-list-view",
  IMMERSIVE_STICKY_NOTES: "immersive-sticky-notes-view"
};
var REGEX_PATTERNS = {
  /** 中文字符（工厂函数，避免 g 标志状态残留） */
  CHINESE: () => /[\u4E00-\u9FFF]/g,
  /** 英文单词（工厂函数，避免 g 标志状态残留） */
  ENGLISH_WORD: () => /[a-zA-Z]+/g,
  /** 数字（工厂函数，避免 g 标志状态残留） */
  NUMBER: () => /\d+/g,
  /** 标点符号（工厂函数，避免 g 标志状态残留） */
  PUNCTUATION: () => /[，。！？；：""''（）【】《》、·…—～]/g,
  // Markdown 清理正则（用于字数统计）
  /** Frontmatter（不带 g 标志，只匹配开头） */
  FRONTMATTER: /^---[\s\S]*?---\n?/,
  /** 代码块（工厂函数，避免 g 标志状态残留） */
  CODE_BLOCK: () => /```[\s\S]*?```/g,
  /** 行内代码（工厂函数，避免 g 标志状态残留） */
  INLINE_CODE: () => /`[^`]*`/g,
  /** 标题符号（gm 标志，保持不变） */
  HEADING: /^#{1,6}\s/gm,
  /** 加粗（工厂函数，避免 g 标志状态残留） */
  BOLD: () => /(\*\*|__)(.*?)\1/g,
  /** 斜体（工厂函数，避免 g 标志状态残留） */
  ITALIC: () => /(\*|_)(.*?)\1/g,
  /** Obsidian 内部链接（工厂函数，避免 g 标志状态残留） */
  INTERNAL_LINK: () => /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
  /** 普通链接（工厂函数，避免 g 标志状态残留） */
  LINK: () => /\[([^\]]*)\]\([^)]*\)/g,
  /** 图片（工厂函数，避免 g 标志状态残留） */
  IMAGE: () => /!\[[^\]]*\]\([^)]*\)/g,
  /** HTML 标签（工厂函数，避免 g 标志状态残留） */
  HTML_TAG: () => /<[^>]+>/g,
  /** 引用符号（gm 标志，保持不变） */
  QUOTE: /^>\s?/gm,
  /** 分隔线（gm 标志，保持不变） */
  SEPARATOR: /^[-*_]{3,}\s*$/gm,
  /** 无序列表符号（gm 标志，保持不变） */
  UNORDERED_LIST: /^[\s]*[-*+]\s/gm,
  /** 有序列表符号（gm 标志，保持不变） */
  ORDERED_LIST: /^[\s]*\d+\.\s/gm,
  /** 删除线（工厂函数，避免 g 标志状态残留） */
  STRIKETHROUGH: () => /~~(.*?)~~/g,
  /** 脚注引用标记（工厂函数，避免 g 标志状态残留） */
  FOOTNOTE_REF: () => /\[\^[^\]]+\]/g,
  /** 任务列表标记（gm 标志，保持不变） */
  TASK_LIST: /^[\s]*[-*+]\s\[[ xX]\]\s/gm,
  /** 表格分隔行（gm 标志，保持不变） */
  TABLE_SEPARATOR: /^\|?[\s:]*-{3,}[\s:]*(?:\|[\s:]*-{3,}[\s:]*)*\|?\s*$/gm,
  /** 空白字符（工厂函数，避免 g 标志状态残留） */
  WHITESPACE: () => /\s+/g
};
var VALIDATION_RULES = {
  /** 端口号范围 */
  PORT_RANGE: { min: 1024, max: 65535 },
  /** 空闲超时范围（秒） */
  IDLE_TIMEOUT_RANGE: { min: 10, max: 3600 },
  /** 不透明度范围 */
  OPACITY_RANGE: { min: 0.1, max: 1 },
  /** 目标字数最小值 */
  MIN_GOAL: 0
};
var DEFAULT_SETTINGS = {
  defaultGoal: 3e3,
  dailyGoal: 5e3,
  showGoal: true,
  showExplorerCounts: false,
  // 默认关闭，避免性能问题
  enableSmartChapterSort: false,
  // 默认关闭，避免与用户习惯冲突
  chapterNamingRules: [
    { name: "\u963F\u62C9\u4F2F\u6570\u5B57\uFF08\u7B2C1\u7AE0\u3001\u7B2C01\u7AE0\uFF09", pattern: "^\u7B2C?(\\d+)[\u7AE0\u8282\u56DE\u5377\u90E8\u518C\u7BC7]?", enabled: true },
    { name: "\u4E2D\u6587\u6570\u5B57\uFF08\u7B2C\u4E00\u7AE0\u3001\u7B2C\u4E8C\u7AE0\uFF09", pattern: "^\u7B2C?([\u96F6\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u58F9\u8D30\u53C1\u8086\u4F0D\u9646\u67D2\u634C\u7396\u62FE\u4F70\u4EDF\u842C\u3007]+)[\u7AE0\u8282\u56DE\u5377\u90E8\u518C\u7BC7]?", enabled: true },
    { name: "\u7EAF\u6570\u5B57\uFF081\u300101\u3001001\uFF09", pattern: "^(\\d+)$", enabled: true }
  ],
  workspaceFolders: [],
  enableObs: false,
  enableLegacyObsExport: false,
  obsPath: "",
  openNotes: [],
  noteOpacity: 0.9,
  dailyHistory: {},
  // @deprecated 保留用于降级兼容，实际数据已迁移到 history-data.json
  idleTimeoutThreshold: 60 * 1e3,
  noteThemes: [
    { bg: "#FDF3B8", text: "#2C3E50" },
    // 鹅黄色
    { bg: "#FCDDEC", text: "#5D2E46" },
    // 樱花粉
    { bg: "#CCE8CF", text: "#2A4A30" },
    // 豆沙绿
    { bg: "#2C3E50", text: "#F8F9FA" },
    // 暗夜蓝
    { bg: "#E8DFF5", text: "#4A3B69" },
    // 薰衣草
    { bg: "#FDE0C1", text: "#593D2B" }
    // 杏仁黄
  ],
  obsPort: 24816,
  obsOverlayTheme: "dark",
  obsOverlayOpacity: 0.85,
  obsCustomCss: "",
  obsShowFocusTime: true,
  obsShowSlackTime: true,
  obsShowTotalTime: true,
  obsShowTodayWords: true,
  obsShowDailyGoal: true,
  obsShowSessionWords: true,
  // 已恢复
  foreshadowing: {
    fileName: "\u4F0F\u7B14",
    showTimestamp: true,
    defaultTags: ["\u4EBA\u7269", "\u60C5\u8282", "\u4E16\u754C\u89C2", "\u9053\u5177", "\u7EBF\u7D22"]
  },
  timeline: {
    fileName: "\u65F6\u95F4\u7EBF",
    defaultTypes: ["\u4E3B\u7EBF", "\u652F\u7EBF", "\u56DE\u5FC6", "\u4F0F\u7B14\u7EBF", "\u6697\u7EBF"]
  },
  eyeCareEnabled: false,
  eyeCareColor: "#E8F5E9",
  showMobileFloatingStats: true,
  // 默认显示移动端浮窗
  enableStrictChapterMode: false,
  // 严格章节模式，默认关闭
  enableWordCountGutter: true,
  wordCountInterval: 2e3,
  // 沉浸模式默认设置
  immersiveShowChapterList: true,
  immersiveShowReference: true,
  immersiveShowStickyNotes: true,
  immersiveShowForeshadowing: true,
  immersiveShowTimeline: true,
  immersiveShowTotalTime: true,
  immersiveShowFocusTime: true,
  immersiveShowSlackTime: true,
  immersiveShowChapterProgress: true,
  immersiveShowDailyProgress: true,
  immersiveShowSessionWords: true,
  nextNoteThemeIndex: 0,
  immersivePanelPosition: "bottom",
  immersiveLeftSize: 11,
  immersiveRightSize: 30,
  immersiveBottomSize: 20,
  immersiveBottomInternalSizes: [70, 16, 14],
  stickyNoteAutoSave: true,
  immersiveNoteSize: 280,
  immersiveNoteFontSize: 14,
  immersiveTypewriterMode: false,
  immersiveLayout: null
};

// src/services/CacheManager.ts
var CacheManager = class {
  constructor(plugin) {
    this.maxCacheSize = CACHE_CONFIG.MAX_SIZE;
    // 独立缓存文件路径
    // 写入队列：确保数据保存的原子性
    this.saveQueue = Promise.resolve();
    this.cache = /* @__PURE__ */ new Map();
    this.plugin = plugin;
    this.cacheFilePath = `${plugin.manifest.dir}/cache-data.json`;
  }
  /**
   * 从持久化存储加载缓存
   */
  async loadCache() {
    if (!this.plugin) return false;
    try {
      let cacheData;
      const adapter = this.plugin.app.vault.adapter;
      if (await adapter.exists(this.cacheFilePath)) {
        const content = await adapter.read(this.cacheFilePath);
        cacheData = JSON.parse(content);
        console.log("[CacheManager] \u5DF2\u4ECE\u72EC\u7ACB\u6587\u4EF6\u8BFB\u53D6\u7F13\u5B58\u6570\u636E");
      } else {
        const data = await this.plugin.loadData();
        if (data && data.cacheData) {
          cacheData = data.cacheData;
          console.log("[CacheManager] \u68C0\u6D4B\u5230\u65E7\u7248\u672C\u4F4D\u4E8E data.json \u7684\u7F13\u5B58\u6570\u636E\uFF0C\u5C06\u901A\u8FC7\u9996\u6B21\u4FDD\u5B58\u8FC1\u79FB\u5230\u72EC\u7ACB\u6587\u4EF6");
          this.saveCache().catch((e) => console.warn("\u7F13\u5B58\u521D\u59CB\u8FC1\u79FB\u4FDD\u5B58\u5931\u8D25:", e));
        }
      }
      if (!cacheData) {
        console.log("[CacheManager] \u6CA1\u6709\u627E\u5230\u6301\u4E45\u5316\u7F13\u5B58");
        return false;
      }
      if (cacheData.version !== 1) {
        console.warn("[CacheManager] \u7F13\u5B58\u7248\u672C\u4E0D\u5339\u914D\uFF0C\u5FFD\u7565");
        return false;
      }
      const age = Date.now() - cacheData.timestamp;
      const maxAge = 7 * 24 * 60 * 60 * 1e3;
      if (age > maxAge) {
        console.log("[CacheManager] \u7F13\u5B58\u5DF2\u8FC7\u671F\uFF0C\u5C06\u91CD\u65B0\u6784\u5EFA");
        return false;
      }
      this.cache = new Map(cacheData.entries);
      console.log(`[CacheManager] \u5DF2\u52A0\u8F7D ${this.cache.size} \u4E2A\u7F13\u5B58\u6761\u76EE\uFF08${Math.round(age / 1e3 / 60)} \u5206\u949F\u524D\uFF09`);
      return true;
    } catch (error) {
      console.error("[CacheManager] \u52A0\u8F7D\u7F13\u5B58\u5931\u8D25:", error);
      return false;
    }
  }
  /**
   * 保存缓存到持久化存储（原子操作）
   */
  async saveCache() {
    if (!this.plugin) return;
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        const cacheData = {
          version: 1,
          timestamp: Date.now(),
          entries: Array.from(this.cache.entries())
        };
        const adapter = this.plugin.app.vault.adapter;
        const content = JSON.stringify(cacheData, null, 2);
        await adapter.write(this.cacheFilePath, content);
        console.log(`[CacheManager] \u5DF2\u4FDD\u5B58 ${this.cache.size} \u4E2A\u7F13\u5B58\u6761\u76EE\u5230\u72EC\u7ACB\u6587\u4EF6`);
      } catch (error) {
        console.error("[CacheManager] \u4FDD\u5B58\u7F13\u5B58\u5931\u8D25:", error);
      }
    });
    return this.saveQueue;
  }
  /**
   * 初始化缓存 - 一次性读取所有文件构建完整缓存
   * @param vault Obsidian Vault 实例
   * @param calculateWords 字数计算函数
   * @param isFileInWorkspace 工作区检查函数（可选）
   */
  async buildInitialCache(vault, calculateWords, isFileInWorkspace) {
    console.log("[CacheManager] \u5F00\u59CB\u6784\u5EFA\u521D\u59CB\u7F13\u5B58...");
    const startTime = Date.now();
    try {
      const allFiles = vault.getMarkdownFiles();
      const filesToProcess = isFileInWorkspace ? allFiles.filter((f) => isFileInWorkspace(f)) : allFiles;
      let successCount = 0;
      let failCount = 0;
      for (const file of filesToProcess) {
        try {
          const content = await vault.cachedRead(file);
          const count = calculateWords(content);
          this.updateFileCache(file, count, vault);
          successCount++;
        } catch (error) {
          console.error(`[CacheManager] \u8BFB\u53D6\u6587\u4EF6\u5931\u8D25: ${file.path}`, error);
          failCount++;
        }
      }
      const elapsed = Date.now() - startTime;
      console.log(
        `[CacheManager] \u7F13\u5B58\u6784\u5EFA\u5B8C\u6210: ${successCount} \u4E2A\u6587\u4EF6\u6210\u529F, ${failCount} \u4E2A\u6587\u4EF6\u5931\u8D25, ${this.cache.size} \u4E2A\u7F13\u5B58\u6761\u76EE, \u8017\u65F6 ${elapsed}ms`
      );
      if (failCount > 0) {
        console.warn(`[CacheManager] \u8B66\u544A: ${failCount} \u4E2A\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25\uFF0C\u7F13\u5B58\u53EF\u80FD\u4E0D\u5B8C\u6574`);
      }
      await this.saveCache();
    } catch (error) {
      console.error("[CacheManager] \u7F13\u5B58\u6784\u5EFA\u5931\u8D25:", error);
      throw error;
    }
  }
  /**
   * 获取文件夹字数（从缓存）
   * @param folderPath 文件夹路径
   * @returns 字数，如果缓存未命中则返回 null
   */
  getFolderCount(folderPath) {
    const entry = this.cache.get(folderPath);
    return entry ? entry.wordCount : null;
  }
  /**
   * 更新单个文件的缓存（增量更新）
   * @param file 文件对象
   * @param newWordCount 新的字数
   * @param vault Vault 实例
   */
  updateFileCache(file, newWordCount, vault) {
    const oldEntry = this.cache.get(file.path);
    if (oldEntry && oldEntry.lastModified > file.stat.mtime) {
      console.debug(`[CacheManager] \u5FFD\u7565\u8FC7\u65F6\u7684\u7F13\u5B58\u66F4\u65B0: ${file.path} (\u73B0\u6709: ${oldEntry.lastModified}, \u4F20\u5165: ${file.stat.mtime})`);
      return;
    }
    const oldCount = oldEntry ? oldEntry.wordCount : 0;
    const delta = newWordCount - oldCount;
    this.cache.set(file.path, {
      path: file.path,
      wordCount: newWordCount,
      lastModified: file.stat.mtime
    });
    let parent = file.parent;
    while (parent) {
      const parentEntry = this.cache.get(parent.path);
      if (parentEntry) {
        parentEntry.wordCount += delta;
        parentEntry.lastModified = Date.now();
      } else {
        this.cache.set(parent.path, {
          path: parent.path,
          wordCount: Math.max(0, delta),
          lastModified: Date.now()
        });
      }
      parent = parent.parent;
    }
    if (this.cache.size > this.maxCacheSize) {
      this.clearOldEntries();
    }
    console.log(`[CacheManager] \u5DF2\u66F4\u65B0\u6587\u4EF6\u7F13\u5B58: ${file.path} (${oldCount} \u2192 ${newWordCount}, \u0394${delta})`);
  }
  /**
   * 使缓存失效
   * @param path 文件或文件夹路径
   * @param vault Vault 实例
   */
  invalidateCache(path, vault) {
    const entry = this.cache.get(path);
    if (!entry) return;
    const wordCount = entry.wordCount;
    this.cache.delete(path);
    const abstractFile = vault.getAbstractFileByPath(path);
    if (abstractFile) {
      let parent = abstractFile.parent;
      while (parent) {
        const parentEntry = this.cache.get(parent.path);
        if (parentEntry) {
          parentEntry.wordCount = Math.max(0, parentEntry.wordCount - wordCount);
          parentEntry.lastModified = Date.now();
        }
        parent = parent.parent;
      }
    }
  }
  /**
   * 清空所有缓存
   */
  clearCache() {
    this.cache.clear();
    console.log("[CacheManager] \u7F13\u5B58\u5DF2\u6E05\u7A7A");
  }
  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    const memoryUsage = this.cache.size * 100;
    return {
      size: this.cache.size,
      memoryUsage
    };
  }
  /**
   * 获取文件的缓存字数
   * @param filePath 文件路径
   * @returns 缓存的字数，如果不存在则返回 null
   */
  getFileCache(filePath) {
    const entry = this.cache.get(filePath);
    return entry ? entry.wordCount : null;
  }
  /**
   * 清理最旧的 20% 条目
   */
  clearOldEntries() {
    console.warn("[CacheManager] \u7F13\u5B58\u5927\u5C0F\u8D85\u8FC7\u9650\u5236\uFF0C\u6B63\u5728\u6E05\u7406...");
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].lastModified - b[1].lastModified);
    const toDelete = Math.floor(entries.length * 0.2);
    for (let i = 0; i < toDelete; i++) {
      this.cache.delete(entries[i][0]);
    }
    console.log(`[CacheManager] \u5DF2\u6E05\u7406 ${toDelete} \u4E2A\u65E7\u7F13\u5B58\u6761\u76EE`);
  }
};

// src/services/AdaptiveDebounceManager.ts
var AdaptiveDebounceManager = class {
  constructor() {
    // 防抖延迟配置（毫秒）
    this.FAST_TYPING_DELAY = 500;
    // 快速输入
    this.MEDIUM_TYPING_DELAY = 300;
    // 中速输入
    this.SLOW_TYPING_DELAY = 150;
    // 慢速输入
    // 输入速度阈值（毫秒）
    this.FAST_THRESHOLD = 200;
    // < 200ms 为快速
    this.SLOW_THRESHOLD = 500;
    // > 500ms 为慢速
    // 统计窗口大小
    this.STATS_WINDOW_SIZE = 5;
    this.timers = /* @__PURE__ */ new Map();
    this.speedStats = /* @__PURE__ */ new Map();
  }
  /**
   * 自适应防抖函数
   * 根据输入速度自动调整延迟时间
   * 
   * @param key 唯一标识符
   * @param callback 要执行的回调函数
   */
  debounce(key, callback) {
    const now = Date.now();
    this.updateSpeedStats(key, now);
    const delay = this.calculateDelay(key);
    if (this.timers.has(key)) {
      window.clearTimeout(this.timers.get(key));
    }
    const timer = window.setTimeout(() => {
      callback();
      this.timers.delete(key);
    }, delay);
    this.timers.set(key, timer);
  }
  /**
   * 固定延迟的防抖函数（兼容旧接口）
   * 
   * @param key 唯一标识符
   * @param callback 要执行的回调函数
   * @param delay 延迟时间（毫秒）
   */
  debounceFixed(key, callback, delay) {
    if (this.timers.has(key)) {
      window.clearTimeout(this.timers.get(key));
    }
    const timer = window.setTimeout(() => {
      callback();
      this.timers.delete(key);
    }, delay);
    this.timers.set(key, timer);
  }
  /**
   * 限流函数 - 限制执行频率
   * 在指定时间间隔内，最多执行一次
   * 
   * @param key 唯一标识符
   * @param callback 要执行的回调函数
   * @param interval 时间间隔（毫秒）
   */
  throttle(key, callback, interval) {
    const stats = this.speedStats.get(key);
    const now = Date.now();
    const lastTime = stats?.lastInputTime || 0;
    if (now - lastTime >= interval) {
      callback();
      this.updateSpeedStats(key, now);
    }
  }
  /**
   * 更新输入速度统计
   */
  updateSpeedStats(key, now) {
    let stats = this.speedStats.get(key);
    if (!stats) {
      stats = {
        lastInputTime: now,
        recentIntervals: [],
        averageInterval: 0
      };
      this.speedStats.set(key, stats);
      return;
    }
    const interval = now - stats.lastInputTime;
    stats.recentIntervals.push(interval);
    if (stats.recentIntervals.length > this.STATS_WINDOW_SIZE) {
      stats.recentIntervals.shift();
    }
    stats.averageInterval = stats.recentIntervals.reduce((sum, val) => sum + val, 0) / stats.recentIntervals.length;
    stats.lastInputTime = now;
  }
  /**
   * 根据输入速度计算防抖延迟
   */
  calculateDelay(key) {
    const stats = this.speedStats.get(key);
    if (!stats || stats.recentIntervals.length < 2) {
      return this.MEDIUM_TYPING_DELAY;
    }
    const avgInterval = stats.averageInterval;
    if (avgInterval < this.FAST_THRESHOLD) {
      return this.FAST_TYPING_DELAY;
    }
    if (avgInterval > this.SLOW_THRESHOLD) {
      return this.SLOW_TYPING_DELAY;
    }
    return this.MEDIUM_TYPING_DELAY;
  }
  /**
   * 获取当前输入速度统计（用于调试）
   */
  getSpeedStats(key) {
    const stats = this.speedStats.get(key);
    if (!stats) return null;
    return {
      averageInterval: Math.round(stats.averageInterval),
      delay: this.calculateDelay(key)
    };
  }
  /**
   * 取消待处理的防抖操作
   * 
   * @param key 唯一标识符
   */
  cancel(key) {
    const timer = this.timers.get(key);
    if (timer) {
      window.clearTimeout(timer);
      this.timers.delete(key);
    }
  }
  /**
   * 取消所有待处理操作
   */
  cancelAll() {
    this.timers.forEach((timer) => {
      window.clearTimeout(timer);
    });
    this.timers.clear();
    this.speedStats.clear();
    console.log("[AdaptiveDebounceManager] \u6240\u6709\u9632\u6296\u64CD\u4F5C\u5DF2\u53D6\u6D88");
  }
  /**
   * 立即执行并取消防抖
   * 
   * @param key 唯一标识符
   * @param callback 要执行的回调函数
   */
  flush(key, callback) {
    this.cancel(key);
    callback();
  }
  /**
   * 获取当前待处理的防抖操作数量
   */
  getPendingCount() {
    return this.timers.size;
  }
  /**
   * 清除指定 key 的统计数据
   */
  clearStats(key) {
    this.speedStats.delete(key);
  }
  /**
   * 清除所有统计数据
   */
  clearAllStats() {
    this.speedStats.clear();
  }
};

// src/core/SettingsManager.ts
var SettingsManager = class {
  constructor(plugin, defaultSettings) {
    // 写入队列：确保数据保存的原子性
    this.saveQueue = Promise.resolve();
    // 验证规则
    this.validationRules = [
      {
        field: "obsPort",
        validate: (port) => {
          const p = Number(port);
          return !isNaN(p) && p >= VALIDATION_RULES.PORT_RANGE.min && p <= VALIDATION_RULES.PORT_RANGE.max;
        },
        errorMessage: `\u7AEF\u53E3\u53F7\u5FC5\u987B\u5728 ${VALIDATION_RULES.PORT_RANGE.min}-${VALIDATION_RULES.PORT_RANGE.max} \u4E4B\u95F4`
      },
      {
        field: "idleTimeoutThreshold",
        validate: (timeout) => {
          const t = Number(timeout);
          const min = VALIDATION_RULES.IDLE_TIMEOUT_RANGE.min * 1e3;
          const max = VALIDATION_RULES.IDLE_TIMEOUT_RANGE.max * 1e3;
          return !isNaN(t) && t >= min && t <= max;
        },
        errorMessage: `\u7A7A\u95F2\u8D85\u65F6\u5FC5\u987B\u5728 ${VALIDATION_RULES.IDLE_TIMEOUT_RANGE.min}-${VALIDATION_RULES.IDLE_TIMEOUT_RANGE.max} \u79D2\u4E4B\u95F4`
      },
      {
        field: "noteOpacity",
        validate: (opacity) => {
          const o = Number(opacity);
          return !isNaN(o) && o >= VALIDATION_RULES.OPACITY_RANGE.min && o <= VALIDATION_RULES.OPACITY_RANGE.max;
        },
        errorMessage: `\u4FBF\u7B7E\u4E0D\u900F\u660E\u5EA6\u5FC5\u987B\u5728 ${VALIDATION_RULES.OPACITY_RANGE.min}-${VALIDATION_RULES.OPACITY_RANGE.max} \u4E4B\u95F4`
      },
      {
        field: "obsOverlayOpacity",
        validate: (opacity) => {
          const o = Number(opacity);
          return !isNaN(o) && o >= 0 && o <= VALIDATION_RULES.OPACITY_RANGE.max;
        },
        errorMessage: `OBS \u53E0\u52A0\u5C42\u4E0D\u900F\u660E\u5EA6\u5FC5\u987B\u5728 0-${VALIDATION_RULES.OPACITY_RANGE.max} \u4E4B\u95F4`
      },
      {
        field: "defaultGoal",
        validate: (goal) => {
          const g = Number(goal);
          return !isNaN(g) && g >= VALIDATION_RULES.MIN_GOAL;
        },
        errorMessage: "\u9ED8\u8BA4\u76EE\u6807\u5B57\u6570\u5FC5\u987B\u4E3A\u975E\u8D1F\u6570"
      }
    ];
    this.plugin = plugin;
    this.defaultSettings = defaultSettings;
    this.settings = { ...defaultSettings };
  }
  /**
   * 加载设置
   */
  async loadSettings() {
    try {
      const data = await this.plugin.loadData();
      this.settings = this.deepMerge(this.defaultSettings, data || {});
      this.settings = this.migrateSettings(this.settings, data);
      const validation = this.validateSettings(this.settings);
      if (!validation.valid) {
        console.warn("[SettingsManager] \u8BBE\u7F6E\u9A8C\u8BC1\u5931\u8D25:", validation.errors);
        this.settings = this.fixInvalidSettings(this.settings);
      }
      console.log("[SettingsManager] \u8BBE\u7F6E\u52A0\u8F7D\u6210\u529F");
      return this.settings;
    } catch (error) {
      console.error("[SettingsManager] \u52A0\u8F7D\u8BBE\u7F6E\u5931\u8D25:", error);
      const { Notice: Notice13 } = require("obsidian");
      new Notice13("\u52A0\u8F7D\u8BBE\u7F6E\u5931\u8D25\uFF0C\u5DF2\u4F7F\u7528\u9ED8\u8BA4\u8BBE\u7F6E");
      this.settings = { ...this.defaultSettings };
      return this.settings;
    }
  }
  /**
   * 保存设置（原子操作）
   */
  async saveSettings() {
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        const pluginSettings = this.plugin.settings;
        if (pluginSettings) {
          this.settings = pluginSettings;
        }
        const data = await this.plugin.loadData() || {};
        if ("cacheData" in data) {
          delete data.cacheData;
        }
        if ("historyData" in data) {
          delete data.historyData;
        }
        const newData = { ...data, ...this.settings };
        await this.plugin.saveData(newData);
      } catch (error) {
        console.error("[SettingsManager] \u4FDD\u5B58\u8BBE\u7F6E\u5931\u8D25:", error);
        const { Notice: Notice13 } = require("obsidian");
        new Notice13("\u4FDD\u5B58\u8BBE\u7F6E\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u78C1\u76D8\u7A7A\u95F4\u548C\u6743\u9650");
        throw error;
      }
    });
    return this.saveQueue;
  }
  /**
   * 验证设置
   */
  validateSettings(settings) {
    const errors = [];
    for (const rule of this.validationRules) {
      const value = settings[rule.field];
      if (value !== void 0 && !rule.validate(value)) {
        errors.push(rule.errorMessage);
      }
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }
  /**
   * 修复无效设置
   */
  fixInvalidSettings(settings) {
    const fixed = { ...settings };
    for (const rule of this.validationRules) {
      const value = fixed[rule.field];
      if (value !== void 0 && !rule.validate(value)) {
        fixed[rule.field] = this.defaultSettings[rule.field];
        console.warn(
          `[SettingsManager] \u4FEE\u590D\u65E0\u6548\u8BBE\u7F6E: ${rule.field} = ${value} -> ${this.defaultSettings[rule.field]}`
        );
      }
    }
    return fixed;
  }
  /**
   * 深度合并两个对象，default 的字段优先级低于 source
   * 对嵌套对象递归合并，确保新增字段有默认值
   */
  deepMerge(defaults, source) {
    const result = { ...defaults };
    for (const key of Object.keys(source)) {
      const srcVal = source[key];
      const defVal = defaults[key];
      if (srcVal !== null && typeof srcVal === "object" && !Array.isArray(srcVal) && defVal !== null && typeof defVal === "object" && !Array.isArray(defVal)) {
        result[key] = this.deepMerge(
          defVal,
          srcVal
        );
      } else if (srcVal !== void 0) {
        result[key] = srcVal;
      }
    }
    return result;
  }
  /**
   * 迁移旧版本设置
   */
  migrateSettings(settings, oldData) {
    const migrated = { ...settings };
    if (oldData && typeof oldData === "object" && "noteColors" in oldData) {
      const noteColors = oldData.noteColors;
      if (noteColors && Array.isArray(noteColors) && (!migrated.noteThemes || migrated.noteThemes.length === 0)) {
        migrated.noteThemes = noteColors.map((color) => ({
          bg: color,
          text: "#2C3E50"
        }));
        console.log("[SettingsManager] \u5DF2\u8FC1\u79FB\u65E7\u7248\u4FBF\u7B7E\u989C\u8272\u5230\u65B0\u7248\u4E3B\u9898");
      }
    }
    return migrated;
  }
  /**
   * 获取当前设置
   */
  getSettings() {
    return this.settings;
  }
  /**
   * 更新设置
   */
  async updateSettings(partial) {
    const validation = this.validateSettings(partial);
    if (!validation.valid) {
      throw new Error(`\u8BBE\u7F6E\u9A8C\u8BC1\u5931\u8D25: ${validation.errors.join(", ")}`);
    }
    this.settings = Object.assign(this.settings, partial);
    await this.saveSettings();
  }
  /**
   * 重置为默认设置
   */
  async resetToDefaults() {
    this.settings = { ...this.defaultSettings };
    await this.saveSettings();
    console.log("[SettingsManager] \u5DF2\u91CD\u7F6E\u4E3A\u9ED8\u8BA4\u8BBE\u7F6E");
  }
};

// src/services/HistoryDataManager.ts
var HistoryDataManager = class {
  constructor(plugin) {
    this.historyData = {};
    this.saveQueue = Promise.resolve();
    this.dirty = false;
    this.plugin = plugin;
    this.historyFilePath = `${plugin.manifest.dir}/history-data.json`;
  }
  /**
   * 加载历史数据
   * 支持从旧版 dailyHistory 自动迁移到新版独立文件
   */
  async loadHistory() {
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (await adapter.exists(this.historyFilePath)) {
        const content = await adapter.read(this.historyFilePath);
        this.historyData = JSON.parse(content);
        console.log(`[HistoryDataManager] \u5DF2\u4ECE\u72EC\u7ACB\u6587\u4EF6\u52A0\u8F7D ${Object.keys(this.historyData).length} \u6761\u5386\u53F2\u8BB0\u5F55`);
        return this.historyData;
      }
      const data = await this.plugin.loadData();
      if (data && data.historyData && Object.keys(data.historyData).length > 0) {
        console.log("[HistoryDataManager] \u68C0\u6D4B\u5230 data.json \u4E2D\u7684\u5386\u53F2\u6570\u636E\uFF0C\u5F00\u59CB\u8FC1\u79FB\u5230\u72EC\u7ACB\u6587\u4EF6");
        this.historyData = data.historyData;
        this.dirty = true;
        await this.saveHistory();
        console.log(`[HistoryDataManager] \u5DF2\u8FC1\u79FB ${Object.keys(this.historyData).length} \u6761\u5386\u53F2\u8BB0\u5F55\u5230\u72EC\u7ACB\u6587\u4EF6`);
        return this.historyData;
      }
      if (data && data.dailyHistory && Object.keys(data.dailyHistory).length > 0) {
        console.log("[HistoryDataManager] \u68C0\u6D4B\u5230\u65E7\u7248\u5386\u53F2\u6570\u636E\uFF0C\u5F00\u59CB\u8FC1\u79FB\u5230\u72EC\u7ACB\u6587\u4EF6");
        this.historyData = data.dailyHistory;
        this.dirty = true;
        await this.saveHistory();
        console.log(`[HistoryDataManager] \u5DF2\u8FC1\u79FB ${Object.keys(this.historyData).length} \u6761\u5386\u53F2\u8BB0\u5F55\u5230\u72EC\u7ACB\u6587\u4EF6`);
        return this.historyData;
      }
      console.log("[HistoryDataManager] \u65E0\u5386\u53F2\u6570\u636E\uFF0C\u521B\u5EFA\u7A7A\u8BB0\u5F55");
      return {};
    } catch (error) {
      console.error("[HistoryDataManager] \u52A0\u8F7D\u5386\u53F2\u6570\u636E\u5931\u8D25:", error);
      return {};
    }
  }
  /**
   * 保存历史数据到独立文件
   * 使用队列确保串行化，避免并发写入冲突
   */
  async saveHistory() {
    this.saveQueue = this.saveQueue.then(async () => {
      if (!this.dirty) return;
      try {
        const adapter = this.plugin.app.vault.adapter;
        const content = JSON.stringify(this.historyData, null, 2);
        await adapter.write(this.historyFilePath, content);
        this.dirty = false;
        console.log("[HistoryDataManager] \u5386\u53F2\u6570\u636E\u5DF2\u4FDD\u5B58\u5230\u72EC\u7ACB\u6587\u4EF6");
      } catch (error) {
        console.error("[HistoryDataManager] \u4FDD\u5B58\u5386\u53F2\u6570\u636E\u5931\u8D25:", error);
        throw error;
      }
    });
    return this.saveQueue;
  }
  /**
   * 获取所有历史数据
   */
  getHistory() {
    return this.historyData;
  }
  /**
   * 更新指定日期的统计数据
   */
  updateDailyStat(date, stat) {
    this.historyData[date] = stat;
    this.dirty = true;
  }
  /**
   * 获取指定日期的统计数据
   */
  getDailyStat(date) {
    return this.historyData[date];
  }
  /**
   * 获取或创建指定日期的统计数据
   * 便利方法，减少调用方代码量
   */
  getOrCreateDailyStat(date) {
    if (!this.historyData[date]) {
      this.historyData[date] = {
        focusMs: 0,
        slackMs: 0,
        addedWords: 0
      };
      this.dirty = true;
    }
    return this.historyData[date];
  }
  /**
   * 增加指定日期的字数统计
   * 自动设置脏标记
   */
  addWords(date, words) {
    const stat = this.getOrCreateDailyStat(date);
    stat.addedWords += words;
    this.dirty = true;
  }
  /**
   * 增加指定日期的专注时长
   * 自动设置脏标记
   */
  addFocusTime(date, ms) {
    const stat = this.getOrCreateDailyStat(date);
    stat.focusMs += ms;
    this.dirty = true;
  }
  /**
   * 增加指定日期的摸鱼时长
   * 自动设置脏标记
   */
  addSlackTime(date, ms) {
    const stat = this.getOrCreateDailyStat(date);
    stat.slackMs += ms;
    this.dirty = true;
  }
  /**
   * 获取历史数据条目数量
   */
  getHistorySize() {
    return Object.keys(this.historyData).length;
  }
  /**
   * 检查是否有未保存的变更
   */
  isDirty() {
    return this.dirty;
  }
};

// src/services/FileExplorerPatcher.ts
var import_obsidian3 = require("obsidian");

// src/services/ChapterSorter.ts
var import_obsidian2 = require("obsidian");
var ChapterSorter = class _ChapterSorter {
  static {
    // 中文数字映射表（从常量导入）
    this.chineseToArabic = CHINESE_NUMBERS;
  }
  static {
    // 自定义章节命名规则（由插件设置提供）
    this.customRules = [];
  }
  /**
   * 设置自定义章节命名规则
   * 会对用户输入的正则表达式进行预编译验证，过滤掉无效规则，
   * 并限制模式长度，降低灾难性回溯（ReDoS）导致 UI 冻结的风险。
   */
  static setCustomRules(rules) {
    this.customRules = rules.filter((rule) => {
      if (!rule.enabled) return true;
      if (rule.pattern.length > 200) {
        console.warn(`[ChapterSorter] \u6B63\u5219\u8868\u8FBE\u5F0F\u8FC7\u957F\uFF08>200\u5B57\u7B26\uFF09\uFF0C\u5DF2\u8DF3\u8FC7: "${rule.name}"`);
        return false;
      }
      try {
        new RegExp(rule.pattern, "i");
        return true;
      } catch {
        console.error(`[ChapterSorter] \u65E0\u6548\u7684\u6B63\u5219\u8868\u8FBE\u5F0F\uFF0C\u5DF2\u8DF3\u8FC7\u89C4\u5219 "${rule.name}": ${rule.pattern}`);
        return false;
      }
    });
  }
  /**
   * 解析中文数字（支持一到九百九十九）
   */
  static parseChineseNumber(str) {
    let result = 0;
    let temp = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const num = this.chineseToArabic[char];
      if (num !== void 0) {
        if (num === 0) {
          continue;
        } else if (num < 10) {
          temp = num;
        } else if (num === 10) {
          if (temp === 0) {
            temp = 1;
          }
          result += temp * 10;
          temp = 0;
        } else if (num === 100) {
          if (temp === 0) {
            temp = 1;
          }
          result += temp * 100;
          temp = 0;
        }
      }
    }
    result += temp;
    return result;
  }
  /**
   * 从文件名中提取章节编号（使用自定义规则）
   * 
   * @returns { number: 章节编号, ruleIndex: 规则索引 } 或 null
   */
  static extractChapterNumber(filename) {
    const basename = filename.replace(/\.md$/i, "");
    if (this.customRules && this.customRules.length > 0) {
      for (let i = 0; i < this.customRules.length; i++) {
        const rule = this.customRules[i];
        if (!rule.enabled) continue;
        try {
          const regex = new RegExp(rule.pattern, "i");
          const match = basename.match(regex);
          if (match) {
            if (match[1]) {
              const numStr = match[1];
              if (numStr.includes(".")) {
                const num = parseFloat(numStr);
                if (!isNaN(num)) {
                  return { number: num, ruleIndex: i };
                }
              }
              const arabicNum = parseInt(numStr, 10);
              if (!isNaN(arabicNum)) {
                return { number: arabicNum, ruleIndex: i };
              }
              const chineseNum = this.parseChineseNumber(numStr);
              if (chineseNum > 0) {
                return { number: chineseNum, ruleIndex: i };
              }
            }
            return { number: -1, ruleIndex: i };
          }
        } catch (error) {
          console.error(`[ChapterSorter] \u65E0\u6548\u7684\u6B63\u5219\u8868\u8FBE\u5F0F: ${rule.pattern}`, error);
        }
      }
      return null;
    }
    const arabicMatch = basename.match(/(?:第|chapter|ch)?(\d+(?:\.\d+)?)(?:[章节回卷部册篇\s\-]|$)/i);
    if (arabicMatch) {
      const num = parseFloat(arabicMatch[1]);
      if (!isNaN(num)) {
        return { number: num, ruleIndex: 0 };
      }
    }
    const chineseMatch = basename.match(/(?:第)?([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)(?:[章节回卷部册篇]|$)/);
    if (chineseMatch) {
      const num = this.parseChineseNumber(chineseMatch[1]);
      if (num > 0) {
        return { number: num, ruleIndex: 1 };
      }
    }
    return null;
  }
  /**
   * 智能排序比较函数
   * 
   * 排序规则：
   * 1. 文件夹优先于文件
   * 2. 按规则索引分组（规则顺序决定大块排序）
   * 3. 同一规则内按章节编号排序
   * 4. 无章节编号的文件保持原始顺序
   */
  static compareFiles(a, b) {
    const aIsFolder = a instanceof import_obsidian2.TFolder;
    const bIsFolder = b instanceof import_obsidian2.TFolder;
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    const aChapter = _ChapterSorter.extractChapterNumber(a.name);
    const bChapter = _ChapterSorter.extractChapterNumber(b.name);
    if (aChapter !== null && bChapter !== null) {
      if (aChapter.ruleIndex !== bChapter.ruleIndex) {
        return aChapter.ruleIndex - bChapter.ruleIndex;
      }
      if (aChapter.number !== bChapter.number) {
        return aChapter.number - bChapter.number;
      }
      return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
    }
    if (aChapter !== null) return -1;
    if (bChapter !== null) return 1;
    return 0;
  }
  /**
   * 将阿拉伯数字转换为中文数字（支持一到九百九十九）
   */
  static toChineseNumber(num) {
    if (num === 0) return "\u96F6";
    if (num > 999) return num.toString();
    const digits = ["\u96F6", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u4E03", "\u516B", "\u4E5D"];
    let result = "";
    const hundreds = Math.floor(num / 100);
    if (hundreds > 0) {
      result += digits[hundreds] + "\u767E";
      num %= 100;
      if (num > 0 && num < 10) {
        result += "\u96F6";
      }
    }
    const tens = Math.floor(num / 10);
    if (tens > 0) {
      if (hundreds === 0 && tens === 1) {
        result += "\u5341";
      } else {
        result += digits[tens] + "\u5341";
      }
      num %= 10;
    }
    if (num > 0) {
      result += digits[num];
    }
    return result;
  }
  /**
   * 根据当前文件名生成下一章的文件名
   * 支持阿拉伯数字、小数点和中文数字格式
   * @returns 新文件名（含 .md），或 null 表示无法识别
   */
  static getNextChapterName(basename, siblingNames) {
    const decimalMatch = basename.match(/^([^0-9]*)(\d+)\.(\d+)(.*)$/);
    if (decimalMatch) {
      const prefix = decimalMatch[1];
      const mainNum = parseInt(decimalMatch[2], 10);
      const subNum = parseInt(decimalMatch[3], 10);
      const suffix = decimalMatch[4];
      if (subNum >= 9) {
        return `${prefix}${mainNum + 1}.0${suffix}.md`;
      } else {
        return `${prefix}${mainNum}.${subNum + 1}${suffix}.md`;
      }
    }
    const arabicMatch = basename.match(/^([^0-9]*)(\d+)([章节回卷部册篇]?)(.*)$/);
    if (arabicMatch) {
      const prefix = arabicMatch[1];
      const currentNumStr = arabicMatch[2];
      const unit = arabicMatch[3];
      const nextNum = parseInt(currentNumStr, 10) + 1;
      let paddingLength = currentNumStr.length;
      const maxChapter = siblingNames.reduce((max, name) => {
        const m = name.match(/^([^0-9]*)(\d+)/);
        if (m && m[1].toLowerCase() === prefix.toLowerCase()) {
          return Math.max(max, parseInt(m[2], 10));
        }
        return max;
      }, 0);
      if (maxChapter >= 100 && paddingLength < 3) paddingLength = 3;
      else if (maxChapter >= 10 && paddingLength < 2) paddingLength = 2;
      const nextNumStr = nextNum.toString().padStart(paddingLength, "0");
      return `${prefix}${nextNumStr}${unit}.md`;
    }
    const chineseMatch = basename.match(/^([^零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]*)([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)([章节回卷部册篇]?)(.*)$/);
    if (chineseMatch) {
      const prefix = chineseMatch[1];
      const currentNumStr = chineseMatch[2];
      const unit = chineseMatch[3];
      const currentNum = this.parseChineseNumber(currentNumStr);
      if (currentNum === 0) return null;
      const nextNumStr = this.toChineseNumber(currentNum + 1);
      return `${prefix}${nextNumStr}${unit}.md`;
    }
    return null;
  }
  static sortFiles(files) {
    return files.slice().sort(this.compareFiles);
  }
  /**
   * 测试文件名是否包含章节编号
   */
  static isChapterFile(filename) {
    return this.extractChapterNumber(filename) !== null;
  }
};

// src/services/FileExplorerPatcher.ts
var FileExplorerPatcher = class {
  constructor(app) {
    this.enabled = false;
    this.unpatchFunc = null;
    this.eventRefs = [];
    this.app = app;
  }
  /**
   * 启用智能排序
   */
  enable() {
    if (this.enabled) return true;
    try {
      const success = this.patchFileExplorerPrototype();
      if (success) {
        this.enabled = true;
        console.log("[WebNovel Assistant] Smart chapter sorting enabled (Prototype Patch)");
        this.refreshAllExplorers();
        this.setupFileSystemListeners();
        return true;
      }
      return false;
    } catch (error) {
      console.error("[WebNovel Assistant] Failed to enable smart sorting:", error);
      return false;
    }
  }
  /**
   * Patch FileExplorerView 的原型方法
   */
  patchFileExplorerPrototype() {
    try {
      const fileExplorerLeaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
      if (!fileExplorerLeaf) {
        console.log("[WebNovel Assistant] File Explorer not found, will retry patching when ready");
        return false;
      }
      const view = fileExplorerLeaf.view;
      if (!view) return false;
      const proto = Object.getPrototypeOf(view);
      if (!proto || !proto.getSortedFolderItems) {
        console.warn("[WebNovel Assistant] FileExplorerView prototype or method not found");
        return false;
      }
      if (proto.getSortedFolderItems.__webnovel_patched) {
        console.log("[WebNovel Assistant] FileExplorerView already patched");
        return true;
      }
      const originalMethod = proto.getSortedFolderItems;
      const self = this;
      proto.getSortedFolderItems = function(folder) {
        const sortedItems = originalMethod.call(this, folder);
        if (!self.enabled) return sortedItems;
        if (!Array.isArray(sortedItems) || sortedItems.length === 0) return sortedItems;
        const smartItems = [];
        for (let i = 0; i < sortedItems.length; i++) {
          const item = sortedItems[i];
          if (item && item.file instanceof import_obsidian3.TFile) {
            const chapterInfo = ChapterSorter.extractChapterNumber(item.file.name);
            if (chapterInfo !== null) {
              smartItems.push({ item, chapterInfo, pos: i });
            }
          }
        }
        if (smartItems.length < 2) return sortedItems;
        const sortedSmartItems = [...smartItems].sort((a, b) => {
          if (a.chapterInfo.ruleIndex !== b.chapterInfo.ruleIndex) {
            return a.chapterInfo.ruleIndex - b.chapterInfo.ruleIndex;
          }
          if (a.chapterInfo.number !== b.chapterInfo.number) {
            return a.chapterInfo.number - b.chapterInfo.number;
          }
          return a.pos - b.pos;
        });
        const result = [...sortedItems];
        const originalPositions = smartItems.map((si) => si.pos);
        originalPositions.forEach((pos, i) => {
          result[pos] = sortedSmartItems[i].item;
        });
        return result;
      };
      proto.getSortedFolderItems.__webnovel_patched = true;
      this.unpatchFunc = () => {
        proto.getSortedFolderItems = originalMethod;
        console.log("[WebNovel Assistant] FileExplorerView unpatched");
      };
      return true;
    } catch (error) {
      console.error("[WebNovel Assistant] Error patching prototype:", error);
      return false;
    }
  }
  /**
   * 刷新所有文件浏览器视图
   */
  refreshAllExplorers() {
    const leaves = this.app.workspace.getLeavesOfType("file-explorer");
    leaves.forEach((leaf) => {
      const view = leaf.view;
      if (view && typeof view.sort === "function") {
        try {
          view.sort();
        } catch (e) {
        }
      }
    });
  }
  /**
   * 文件系统事件监听
   */
  setupFileSystemListeners() {
    const handler = () => {
      if (!this.enabled) return;
      setTimeout(() => this.refreshAllExplorers(), 100);
    };
    this.eventRefs.push(this.app.vault.on("create", handler));
    this.eventRefs.push(this.app.vault.on("delete", handler));
    this.eventRefs.push(this.app.vault.on("rename", handler));
  }
  /**
   * 禁用智能排序
   */
  disable() {
    this.enabled = false;
    this.eventRefs.forEach((ref) => this.app.vault.offref(ref));
    this.eventRefs = [];
    this.refreshAllExplorers();
    console.log("[WebNovel Assistant] Smart chapter sorting disabled (logic bypassed)");
  }
  /**
   * 物理还原补丁（仅在插件 unload 时调用）
   */
  unpatch() {
    if (this.unpatchFunc) {
      this.unpatchFunc();
      this.unpatchFunc = null;
    }
  }
  isEnabled() {
    return this.enabled;
  }
  refreshManually() {
    if (this.enabled) {
      this.refreshAllExplorers();
    }
  }
};

// src/services/WordCounter.ts
var WordCounter = class {
  /**
   * 计算准确字数
   * 清理所有 Markdown 语法标记，只保留纯文本内容
   * 
   * @param text - 原始 Markdown 文本
   * @returns 纯文本字符数
   */
  calculateAccurateWords(text) {
    let cleaned = text.replace(REGEX_PATTERNS.FRONTMATTER, "").replace(REGEX_PATTERNS.CODE_BLOCK(), "").replace(REGEX_PATTERNS.INLINE_CODE(), "").replace(REGEX_PATTERNS.HEADING, "").replace(REGEX_PATTERNS.STRIKETHROUGH(), "$1").replace(REGEX_PATTERNS.BOLD(), "$2").replace(REGEX_PATTERNS.ITALIC(), "$2").replace(REGEX_PATTERNS.INTERNAL_LINK(), (_, name, alias) => alias || name).replace(REGEX_PATTERNS.LINK(), "$1").replace(REGEX_PATTERNS.IMAGE(), "").replace(REGEX_PATTERNS.FOOTNOTE_REF(), "").replace(REGEX_PATTERNS.HTML_TAG(), "").replace(REGEX_PATTERNS.QUOTE, "").replace(REGEX_PATTERNS.SEPARATOR, "").replace(REGEX_PATTERNS.TABLE_SEPARATOR, "").replace(REGEX_PATTERNS.TASK_LIST, "").replace(REGEX_PATTERNS.UNORDERED_LIST, "").replace(REGEX_PATTERNS.ORDERED_LIST, "").replace(REGEX_PATTERNS.WHITESPACE(), "");
    return cleaned.length;
  }
};

// src/services/EditorTracker.ts
var import_obsidian4 = require("obsidian");
var EditorTracker = class {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
  /**
   * 处理编辑器内容变化
   * 更新字数统计和每日历史
   */
  handleEditorChange() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (!view) return;
    if (view.file && !this.plugin.isEligibleForWordCount(view.file)) return;
    this.plugin.lastEditTime = Date.now();
    if (view.file.path !== this.plugin.lastFilePath) {
      this.handleFileChange();
      return;
    }
    const currentCount = this.plugin.calculateAccurateWords(view.getViewData());
    const delta = currentCount - this.plugin.lastFileWords;
    if (delta !== 0) {
      this.plugin.sessionAddedWords += delta;
      const today = window.moment().format("YYYY-MM-DD");
      this.plugin.historyManager.addWords(today, delta);
      this.plugin.adaptiveDebounceManager.debounceFixed("save-history", () => {
        this.plugin.historyManager.saveHistory().catch((err) => {
          console.error("[Plugin] \u4FDD\u5B58\u5386\u53F2\u6570\u636E\u5931\u8D25:", err);
        });
      }, 1e3);
    }
    this.plugin.lastFileWords = currentCount;
    this.plugin.cacheManager.updateFileCache(view.file, currentCount, this.app.vault);
    this.updateWordCount();
    this.plugin.refreshStatusViews();
  }
  /**
   * 处理文件切换
   * 重置字数统计
   */
  handleFileChange() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (view?.file && !this.plugin.isEligibleForWordCount(view.file)) {
      this.plugin.lastFileWords = 0;
      this.plugin.statusBarItemEl.setText("");
      return;
    }
    this.plugin.lastFileWords = view ? this.plugin.calculateAccurateWords(view.getViewData()) : 0;
    this.plugin.lastFilePath = view?.file?.path || "";
    if (view?.file) {
      this.plugin.cacheManager.updateFileCache(view.file, this.plugin.lastFileWords, this.app.vault);
    }
    this.updateWordCount();
    this.plugin.refreshStatusViews();
  }
  /**
   * 更新状态栏字数显示
   */
  updateWordCount() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (!view) {
      this.plugin.statusBarItemEl.setText("");
      return;
    }
    if (view.file && !this.plugin.isEligibleForWordCount(view.file)) {
      this.plugin.statusBarItemEl.setText("");
      return;
    }
    if (isMobile() && this.plugin.settings.showMobileFloatingStats) {
      this.plugin.statusBarItemEl.setText("");
      return;
    }
    const totalCount = this.plugin.calculateAccurateWords(view.getViewData());
    const displaySessionWords = Math.max(0, this.plugin.sessionAddedWords);
    const stateStr = this.plugin.isTracking ? "[\u8BB0\u5F55\u4E2D]" : "[\u5DF2\u6682\u505C]";
    if (this.plugin.settings.showGoal && view.file) {
      const cache = this.app.metadataCache.getFileCache(view.file);
      let targetGoal = this.plugin.settings.defaultGoal;
      if (cache?.frontmatter && cache.frontmatter["word-goal"]) {
        const fmGoal = parseInt(cache.frontmatter["word-goal"]);
        if (!isNaN(fmGoal)) targetGoal = fmGoal;
      }
      if (targetGoal > 0) {
        const percent = Math.min(Math.round(totalCount / targetGoal * 100), 100);
        const status = percent >= 100 ? "[\u5B8C\u6210]" : "";
        this.plugin.statusBarItemEl.setText(`[${stateStr}] ${status} \u5B57\u6570: ${totalCount} / ${targetGoal} (${percent}%) | \u51C0\u589E: ${displaySessionWords}`);
        return;
      }
    }
    const cnChars = (view.getViewData().match(/[\u4e00-\u9fa5]/g) || []).length;
    this.plugin.statusBarItemEl.setText(`[${stateStr}] \u5B57\u6570: ${totalCount} (\u4E2D\u6587\u5B57: ${cnChars}) | \u51C0\u589E: ${displaySessionWords}`);
  }
};

// src/services/StyleManager.ts
var StyleManager = class {
  constructor(settings) {
    this.settings = settings;
  }
  /**
   * 注入全局样式
   * 包含状态视图、伏笔视图、时间线视图、移动端优化等所有样式
   */
  injectGlobalStyles() {
    const styleId = "accurate-count-global-styles";
    const styleContent = `
				.folder-word-count { font-variant-numeric: tabular-nums; pointer-events: none; }

				.status-view-container { padding: 15px; }
				.status-card { background: var(--background-secondary); border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--background-modifier-border); }
				
				.status-title { font-weight: bold; margin-bottom: 12px; font-size: 1.1em; display: flex; flex-direction: row; align-items: center; justify-content: space-between; }
				.status-title-badge { font-size: 0.75em; background: var(--interactive-accent); color: #ffffff; padding: 2px 6px; border-radius: 4px; font-weight: normal; }
				
				.status-goal-label { font-size: 0.78em; color: var(--text-muted); margin-top: 14px; margin-bottom: 2px; font-weight: 500; }
				.goal-display-row-right { display: flex; align-items: baseline; justify-content: flex-end; gap: 4px; margin-top: 4px; margin-bottom: 8px; font-family: var(--font-monospace); flex-wrap: wrap; }
				.goal-current { font-size: 1.8em; font-weight: bold; color: var(--text-normal); }
				.goal-separator { font-size: 1.1em; color: var(--text-muted); opacity: 0.5; }
				.goal-target { font-size: 1.4em; color: var(--text-muted); opacity: 0.8; }
				.goal-percent { font-size: 1.1em; color: var(--interactive-accent); font-weight: 600; margin-left: 8px; }
				
				.progress-bar-bg { width: 100%; height: 10px; background: var(--background-modifier-border); border-radius: 5px; overflow: hidden; margin: 0; }
				.progress-bar-fill { height: 100%; background: var(--interactive-accent); transition: width 0.3s ease; }
				
				.time-box-total { background: var(--background-primary); padding: 12px; border-radius: 6px; text-align: center; border: 1px solid var(--background-modifier-border); margin-bottom: 10px; }
				.time-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
				.time-box { background: var(--background-primary); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid var(--background-modifier-border); min-width: 0; }
				.time-box-title { font-size: 0.8em; color: var(--text-muted); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				.time-box-value { font-family: var(--font-monospace); font-size: 1.1em; font-weight: bold; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				
				.history-chart { margin-top: 20px; padding-top: 15px; border-top: 1px dashed var(--background-modifier-border); }
				.history-chart-title { font-size: 0.95em; font-weight: 600; color: var(--text-normal); margin-bottom: 4px; }
				.history-chart-subtitle { font-size: 0.75em; color: var(--text-muted); margin-bottom: 8px; cursor: pointer; }
				.history-chart-subtitle:hover { color: var(--interactive-accent); text-decoration: underline; }

				/* \u5B57\u6570\u5B9E\u65F6\u63D0\u9192 (\u884C\u53F7\u5B57\u6570\u7EDF\u8BA1) \u6837\u5F0F - \u5B8C\u5168\u96F6\u5BBD\u5EA6\uFF0C\u7EDD\u4E0D\u5360\u7528/\u63A8\u6324\u6B63\u6587\u6392\u7248 */
				.webnovel-word-count-gutter { width: 0px !important; min-width: 0px !important; border: none !important; padding: 0 !important; margin: 0 !important; overflow: visible !important; }
				
				/* \u5F53\u672C\u63D2\u4EF6\u7684 Gutter \u662F\u552F\u4E00\u7684 Gutter \u65F6\uFF08\u5373\u6CA1\u5F00\u884C\u53F7\u7B49\uFF09\uFF0C\u6E05\u9664 Obsidian \u9ED8\u8BA4\u7ED9 Gutter \u5BB9\u5668\u52A0\u7684\u6240\u6709\u8FB9\u8DDD\uFF0C\u5F7B\u5E95\u6D88\u9664\u7F29\u8FDB\u5360\u4F4D */
				.cm-gutters:has(.webnovel-word-count-gutter:only-child) {
					margin-right: 0 !important;
					padding-right: 0 !important;
					border-right: none !important;
					background: transparent !important;
				}

				/* \u975E\u5DE5\u4F5C\u533A/\u975E\u7AE0\u8282\u65F6\uFF0C\u76F4\u63A5\u9690\u85CF\u6574\u4E2A\u5BB9\u5668\uFF08\u5982\u679C\u53EA\u6709\u6211\u4EEC\u7684\u8BDD\uFF09 */
				.cm-editor:not(.webnovel-show-gutter) .cm-gutters:has(.webnovel-word-count-gutter:only-child) {
					display: none !important;
				}

				/* \u975E\u5DE5\u4F5C\u533A/\u975E\u7AE0\u8282\u65F6\uFF0C\u9690\u85CF\u6211\u4EEC\u7684 gutter */
				.cm-editor:not(.webnovel-show-gutter) .webnovel-word-count-gutter {
					display: none !important;
				}

				/* \u9ED8\u8BA4\u9690\u85CF\u6807\u7B7E */
				.webnovel-word-count-marker-wrapper { display: none; }
				
				/* \u6FC0\u6D3B\u72B6\u6001\u4E0B\u60AC\u6D6E\u663E\u793A\uFF0C\u4F7F\u7528 wrapper \u5B8C\u7F8E\u6D88\u89E3\u5BBD\u9AD8\u5F71\u54CD */
				.webnovel-show-gutter .webnovel-word-count-marker-wrapper { 
					display: flex;
					align-items: center; /* \u4F9D\u6258\u5185\u90E8\u7684\u96F6\u5BBD\u5B57\u7B26\u5B9E\u73B0\u5B8C\u7F8E\u7684\u6587\u672C\u57FA\u7EBF\u7EA7\u5782\u76F4\u5C45\u4E2D */
					justify-content: flex-end;
					width: 0px !important;
					/* \u79FB\u9664\u6240\u6709\u786C\u7F16\u7801\u9AD8\u5EA6\uFF0C\u5B8C\u5168\u9760 \u200B \u6491\u5F00\uFF0C\u7EDD\u5BF9\u5339\u914D\u5F53\u524D\u7F16\u8F91\u5668\u884C\u9AD8 */
					overflow: visible !important;
				}
				
				.webnovel-show-gutter .webnovel-word-count-marker {
					display: inline-block; 
					font-size: 0.75em; 
					color: var(--text-on-accent); 
					background-color: #F5A623; 
					border-radius: 4px; 
					padding: 2px 4px; 
					line-height: 1; 
					font-family: var(--font-monospace); 
					font-weight: bold; 
					box-shadow: 0 1px 2px rgba(0,0,0,0.2);
					white-space: nowrap;
					z-index: 99;
					pointer-events: none; /* \u907F\u514D\u963B\u6321\u9F20\u6807\u70B9\u51FB\u5DE6\u4FA7\u533A\u57DF */
					/* \u76F8\u5BF9\u4E8E wrapper \u5411\u5DE6\u63A8\uFF0C\u5FAE\u8C03\u4F7F\u5176\u5BF9\u9F50\u6587\u672C\u884C */
					margin-right: 12px;
					/* \u79FB\u9664 margin-top\uFF0C\u5B8C\u5168\u4EA4\u7ED9 flex-center \u81EA\u52A8\u8C03\u5EA6 */
				}

				.history-stats-modal { min-width: 600px; }
				.stats-tab-group { display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px; }
				.stats-tab-btn { background: transparent; border: none; box-shadow: none; color: var(--text-muted); cursor: pointer; padding: 6px 12px; border-radius: 4px; transition: all 0.2s; }
				.stats-tab-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
				.stats-tab-btn.is-active { background: var(--interactive-accent); color: var(--text-on-accent); font-weight: bold; }
				
				.stats-large-chart-container { display: flex; align-items: flex-end; justify-content: flex-start; height: 260px; padding: 20px 8px 10px 8px; border-bottom: 1px dashed var(--background-modifier-border); margin-top: 10px; overflow-x: auto; gap: 4px;}
				.stats-large-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 20px; flex: 1; max-width: 36px; }
				.stats-large-bar { width: 70%; min-width: 8px; max-width: 24px; border-radius: 3px 3px 0 0; opacity: 0.85; transition: height 0.4s ease, opacity 0.2s; cursor: crosshair; }
				.stats-large-bar:hover { opacity: 1; filter: brightness(1.2); }
				.stats-large-label { font-size: 0.7em; margin-top: 8px; color: var(--text-muted); white-space: nowrap; }
				.stats-large-value { font-size: 0.75em; margin-top: 4px; font-weight: bold; font-family: var(--font-monospace); white-space: nowrap; }

				/* \u79FB\u52A8\u7AEF\u89E6\u6478\u4F18\u5316 (\u9700\u6C42 8.5) */
				@media (hover: none) and (pointer: coarse) {
					/* \u7981\u7528\u60AC\u505C\u6548\u679C */
					.stats-tab-btn:hover { background: transparent; color: var(--text-muted); }
					.history-chart-subtitle:hover { color: var(--text-muted); text-decoration: none; }
					.stats-large-bar:hover { opacity: 0.8; filter: none; }
					.foreshadowing-filter-btn:hover { border-color: var(--background-modifier-border); color: var(--text-muted); }
					.foreshadowing-action-btn:hover { border-color: var(--background-modifier-border); color: var(--text-muted); }
					.timeline-action-btn:hover { border-color: var(--background-modifier-border); color: var(--text-muted); }
					.timeline-chapter-link:hover { color: var(--text-accent); }
					
					/* \u89E6\u6478\u76EE\u6807 - \u6700\u5C0F 44px */
					.stats-tab-btn { min-height: 44px; padding: 12px 16px; }
					button, .clickable-icon { min-height: 44px; min-width: 44px; }
					.foreshadowing-filter-btn { min-height: 44px; padding: 8px 16px; }
					.foreshadowing-action-btn { min-height: 44px; padding: 8px 16px; font-size: 0.85em; }
					.timeline-action-btn { min-height: 44px; padding: 8px 16px; font-size: 0.85em; }
					.timeline-add-btn { width: 44px; height: 44px; font-size: 1.4em; }
					.timeline-chapter-link { min-height: 44px; display: inline-flex; align-items: center; padding: 4px 8px; }
					
					/* \u589E\u52A0\u95F4\u8DDD\u907F\u514D\u8BEF\u89E6 */
					.stats-tab-group { gap: 12px; }
					.time-grid { gap: 12px; }
					.foreshadowing-view-filter-row { gap: 8px; }
					.foreshadowing-entry-actions { gap: 8px; }
					.timeline-actions { gap: 6px; }
					
					/* \u4F18\u5316\u79FB\u52A8\u7AEF\u5361\u7247\u95F4\u8DDD */
					.status-card { padding: 18px; margin-bottom: 18px; }
					.foreshadowing-entry-card { padding: 14px 16px; margin-bottom: 12px; }
					.timeline-content { padding: 12px 14px 12px 28px; }
					
					/* \u4F18\u5316\u8868\u5355\u8F93\u5165\u6846 */
					.timeline-form-input { min-height: 44px; padding: 10px 12px; font-size: 0.9em; }
					.timeline-form-textarea { min-height: 80px; padding: 10px 12px; font-size: 0.9em; }
					
					/* \u62D6\u62FD\u624B\u67C4\u66F4\u5927 */
					.timeline-drag-handle { font-size: 1.2em; left: 8px; }
					.timeline-content:hover .timeline-drag-handle { opacity: 0.6; }
				}

				.foreshadowing-view-container { padding: 12px; overflow-y: auto; }
				.foreshadowing-view-header { margin-bottom: 12px; }
				.foreshadowing-view-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
				.foreshadowing-view-title { font-size: 1.1em; font-weight: bold; color: var(--text-normal); }
				.foreshadowing-view-folder { font-size: 0.75em; color: var(--text-muted); margin-bottom: 8px; }
				.foreshadowing-view-filter-row { display: flex; gap: 4px; flex-wrap: wrap; }
				.foreshadowing-filter-btn { padding: 2px 8px; border-radius: 10px; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 0.8em; }
				.foreshadowing-filter-btn:hover { border-color: var(--interactive-accent); color: var(--interactive-accent); }
				.foreshadowing-filter-btn.is-active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
				.foreshadowing-view-empty { color: var(--text-muted); font-size: 0.9em; padding: 20px 0; text-align: center; }
				.foreshadowing-view-hint { font-size: 0.8em; }
				.foreshadowing-group-header { display: flex; align-items: center; gap: 6px; margin: 12px 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--background-modifier-border); }
				.foreshadowing-group-label { font-size: 0.8em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
				.foreshadowing-group-count { font-size: 0.75em; background: var(--background-modifier-border); color: var(--text-muted); padding: 1px 6px; border-radius: 8px; }
				.foreshadowing-entry-card { background: var(--background-secondary); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; border-left: 3px solid var(--background-modifier-border); }
				.foreshadowing-entry-card.status-pending { border-left-color: var(--color-orange, #f59e0b); }
				.foreshadowing-entry-card.status-recovered { border-left-color: var(--color-green, #10b981); opacity: 0.75; }
				.foreshadowing-entry-card.status-deprecated { border-left-color: var(--text-muted); opacity: 0.5; }
				.foreshadowing-entry-desc { margin-bottom: 6px; }
				.foreshadowing-entry-desc-text { font-weight: 600; font-size: 0.9em; color: var(--text-normal); }
				.foreshadowing-entry-quotes { margin-bottom: 6px; }
				.foreshadowing-entry-quote { margin-bottom: 4px; }
				.foreshadowing-entry-quote-meta { font-size: 0.72em; color: var(--text-muted); margin-bottom: 2px; }
				.foreshadowing-entry-quote-text { font-size: 0.82em; color: var(--text-muted); padding-left: 8px; border-left: 2px solid var(--background-modifier-border); line-height: 1.5; white-space: pre-wrap; }
				.foreshadowing-entry-footer { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
				.foreshadowing-entry-tags { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
				.foreshadowing-entry-tag { font-size: 0.72em; color: var(--interactive-accent); background: var(--background-primary); padding: 1px 6px; border-radius: 8px; border: 1px solid var(--interactive-accent); opacity: 0.8; }
				.foreshadowing-entry-actions { display: flex; gap: 4px; flex-shrink: 0; margin-left: auto; }
				.foreshadowing-action-btn { padding: 2px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 0.75em; }
				.foreshadowing-action-btn:hover { border-color: var(--interactive-accent); color: var(--interactive-accent); }
				.foreshadowing-recover-btn { border-color: var(--color-orange, #f59e0b); color: var(--color-orange, #f59e0b); }
				.foreshadowing-recover-btn:hover { background: var(--color-orange, #f59e0b); color: white; }
				.foreshadowing-deprecate-btn { border-color: var(--text-muted); color: var(--text-muted); }
				.foreshadowing-deprecate-btn:hover { background: var(--text-muted); color: white; }
				.foreshadowing-entry-recovery { font-size: 0.78em; color: var(--text-muted); margin-top: 4px; }
				.foreshadowing-entry-recovery-link { color: var(--color-green, #10b981); cursor: pointer; text-decoration: underline; }

				.timeline-view-container { padding: 12px; overflow-y: auto; }
				.timeline-view-header { margin-bottom: 12px; }
				.timeline-view-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
				.timeline-view-title { font-size: 1.1em; font-weight: bold; color: var(--text-normal); }
				.timeline-add-btn { background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 50%; width: 24px; height: 24px; font-size: 1.2em; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; padding: 0; }
				.timeline-add-btn:hover { filter: brightness(1.1); }
				.timeline-view-folder { font-size: 0.75em; color: var(--text-muted); }
				.timeline-view-empty { color: var(--text-muted); font-size: 0.9em; padding: 20px 0; text-align: center; }
				.timeline-view-hint { font-size: 0.8em; }
				.timeline-create-btn { margin-top: 10px; }
				.timeline-list { padding-top: 8px; }
				.timeline-item { display: flex; gap: 10px; margin-bottom: 4px; cursor: grab; }
				.timeline-item:active { cursor: grabbing; }
				.timeline-dragging { opacity: 0.4; }
				.timeline-drag-over-top .timeline-content { border-top: 2px solid var(--interactive-accent) !important; }
				.timeline-drag-over-bottom .timeline-content { border-bottom: 2px solid var(--interactive-accent) !important; }
				.timeline-line { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 16px; padding-top: 4px; }
				.timeline-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--interactive-accent); flex-shrink: 0; }
				.timeline-connector { width: 2px; flex: 1; background: var(--background-modifier-border); min-height: 20px; margin-top: 4px; }
				.timeline-content { flex: 1; background: var(--background-secondary); border-radius: 6px; padding: 8px 10px 8px 22px; margin-bottom: 8px; min-width: 0; position: relative; }
				.timeline-content:hover .timeline-actions { opacity: 1; pointer-events: auto; }
				.timeline-drag-handle { position: absolute; top: 8px; left: 6px; color: var(--text-muted); opacity: 0; font-size: 1em; cursor: grab; line-height: 1; transition: opacity 0.15s; user-select: none; }
				.timeline-content:hover .timeline-drag-handle { opacity: 0.4; }
				.timeline-drag-handle:hover { opacity: 1 !important; cursor: grab; }
				.timeline-time { font-weight: 600; font-size: 0.9em; color: var(--interactive-accent); margin-bottom: 4px; }
				.timeline-list-item { display: flex; flex-direction: column; margin-bottom: 6px; padding-left: 8px; border-left: 2px solid var(--background-modifier-border); }
				.timeline-desc { font-size: 0.85em; color: var(--text-normal); line-height: 1.5; white-space: pre-wrap; }
				.timeline-desc::before { content: "- "; color: var(--text-muted); }
				.timeline-footer { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
				.timeline-chapter-link { font-size: 0.78em; color: var(--text-accent); cursor: pointer; text-decoration: underline; }
				.timeline-chapter-link:hover { color: var(--interactive-accent); }
				.timeline-type-tag { font-size: 0.72em; color: var(--text-muted); background: var(--background-primary); padding: 1px 6px; border-radius: 8px; border: 1px solid var(--background-modifier-border); }
				.timeline-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 3px; opacity: 0; pointer-events: none; transition: opacity 0.15s; }
				.timeline-action-btn { padding: 2px 7px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); cursor: pointer; font-size: 0.72em; }
				.timeline-action-btn:hover { border-color: var(--interactive-accent); color: var(--interactive-accent); }
				.timeline-delete-btn:hover { border-color: var(--color-red, #ef4444); color: var(--color-red, #ef4444); }
				.timeline-edit-form { background: var(--background-secondary); border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; border: 1px solid var(--interactive-accent); }
				.timeline-form-title { font-weight: 600; font-size: 0.9em; margin-bottom: 8px; color: var(--text-normal); }
				.timeline-form-label { display: block; font-size: 0.78em; color: var(--text-muted); margin-bottom: 3px; margin-top: 8px; }
				.timeline-form-input { width: 100%; padding: 5px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-size: 0.85em; box-sizing: border-box; }
				.timeline-form-textarea { width: 100%; height: 60px; padding: 5px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-size: 0.85em; resize: vertical; box-sizing: border-box; font-family: var(--font-text); }
				.timeline-form-btns { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }

				/* ==========================================
				 * \u6C89\u6D78\u6A21\u5F0F (Immersive Mode) CSS
				 * ========================================== */
				body.immersive-mode-active .workspace-ribbon,
				body.immersive-mode-active .workspace-tab-header-container,
				body.immersive-mode-active .titlebar,
				body.immersive-mode-active .status-bar,
				body.immersive-mode-active .workspace-split.mod-left-split,
				body.immersive-mode-active .workspace-split.mod-right-split,
				body.immersive-mode-active .floating-sticky-note,
				body.immersive-mode-active .my-floating-sticky-note,
				body.immersive-mode-active .view-header {
					display: none !important;
				}

				body.immersive-mode-active .workspace {
					margin-top: 40px !important;
					height: calc(100% - 40px) !important;
					top: 0 !important;
				}

				/* \u6C89\u6D78\u6A21\u5F0F\uFF1A\u7F16\u8F91\u5668\u5E03\u5C40\u9002\u914D */
				/* \u9ED8\u8BA4\u975E\u9002\u914D\u72B6\u6001 */
				.immersive-mode-active .view-content {
					padding-top: 30px !important;
				}

				/* \u9002\u914D\u5F00\u542F\u72B6\u6001 (\u901A\u8FC7 body class \u63A7\u5236) */
				body.immersive-typewriter-mode.immersive-mode-active .view-content {
					padding-top: 0 !important;
				}

				/* \u6253\u5B57\u673A\u6A21\u5F0F\u4F18\u5316\uFF1A\u4F7F\u7528 scroll-padding \u548C\u5185\u5BB9\u7559\u767D */
				body.immersive-typewriter-mode.immersive-mode-active .markdown-source-view.mod-cm6 .cm-scroller {
					scroll-padding-top: 10vh !important;
					scroll-padding-bottom: 15vh !important;
					padding-top: 20px !important;
				}
				body.immersive-typewriter-mode.immersive-mode-active .markdown-source-view.mod-cm6 .cm-content {
					padding-bottom: 40vh !important;
				}

				/* \u9762\u677F\u7C7B\u5BB9\u5668\u59CB\u7EC8\u4FDD\u6301\u6B63\u5E38\u7684\u9876\u8FB9\u8DDD */
				.immersive-mode-active .foreshadowing-view-container,
				.immersive-mode-active .timeline-view-container,
				.immersive-mode-active .markdown-reading-view .markdown-preview-view {
					padding-top: 30px !important;
				}

				.immersive-mode-active .workspace-split {
					gap: 8px !important;
					padding: 8px !important;
					background-color: var(--background-secondary) !important;
				}

				/* \u6C89\u6D78\u6A21\u5F0F\uFF1A\u5361\u7247\u5F0F\u9762\u677F\u5E03\u5C40\u4E0E\u8FB9\u754C\u5F3A\u5316 */
				.immersive-mode-active .workspace-leaf {
					background-color: var(--background-primary) !important;
					border: 1px solid var(--background-modifier-border) !important;
					border-radius: 12px !important;
					margin: 0 !important;
					box-shadow: 0 4px 15px rgba(0,0,0,0.05) !important;
				}

				.immersive-mode-active .workspace-leaf:hover {
					box-shadow: 0 6px 20px rgba(0,0,0,0.1) !important;
				}



				/* \u8F85\u52A9\u9762\u677F\u5185\u5BB9\u5FAE\u8C03 */
				.immersive-mode-active .foreshadowing-view-container,
				.immersive-mode-active .timeline-view-container {
					background-color: transparent !important;
				}

				/* \u8BBE\u7F6E\u9009\u9879\u5361\u6837\u5F0F */
				.webnovel-settings-tabs {
					display: flex;
					gap: 10px;
					margin-bottom: 25px;
					border-bottom: 1px solid var(--background-modifier-border);
					padding-bottom: 10px;
					overflow-x: auto;
				}

				.webnovel-tab-item {
					padding: 6px 16px;
					border-radius: 6px;
					cursor: pointer;
					background: var(--background-secondary);
					color: var(--text-muted);
					font-weight: 500;
					transition: all 0.2s ease;
					white-space: nowrap;
				}

				.webnovel-tab-item:hover {
					background: var(--background-modifier-hover);
					color: var(--text-normal);
				}

				.webnovel-tab-item.is-active {
					background: var(--interactive-accent);
					color: var(--text-on-accent);
				}

				/* \u6C89\u6D78\u6A21\u5F0F\uFF1A\u667A\u80FD\u6EDA\u52A8\u6761 (\u4EC5\u5728\u9F20\u6807\u79FB\u5165\u65F6\u663E\u793A) */
				.immersive-mode-active *::-webkit-scrollbar {
					width: 4px !important;
					height: 4px !important;
				}

				.immersive-mode-active *::-webkit-scrollbar-thumb {
					background-color: transparent !important;
					border-radius: 4px !important;
				}

				.immersive-mode-active *:hover::-webkit-scrollbar-thumb {
					background-color: var(--scrollbar-thumb-bg, rgba(128, 128, 128, 0.3)) !important;
				}

				.immersive-top-bar {
					position: fixed;
					top: 0;
					left: 0;
					right: 0;
					height: 40px;
					background: var(--interactive-accent);
					color: var(--text-on-accent);
					z-index: 100;
					display: flex;
					align-items: center;
					justify-content: space-between;
					padding: 0 16px;
					font-family: var(--font-interface);
					box-shadow: 0 2px 8px rgba(0,0,0,0.2);
				}

				.immersive-top-bar-left {
					display: flex;
					align-items: center;
					gap: 12px;
					font-weight: bold;
					font-size: 1.1em;
				}

				.immersive-top-bar-center {
					display: flex;
					align-items: center;
					gap: 20px;
					font-size: 0.9em;
				}

				.immersive-top-bar-center .stat-item {
					background: rgba(0,0,0,0.15);
					padding: 4px 10px;
					border-radius: 12px;
				}

				.immersive-top-bar-center .stat-item.focus {
					background: rgba(16, 185, 129, 0.25); /* \u7EFF\u8272\u5F3A\u8C03\u4E13\u6CE8 */
				}

				.immersive-top-bar-center .stat-item.slack {
					background: rgba(245, 158, 11, 0.25); /* \u6A59\u8272\u5F3A\u8C03\u6478\u9C7C */
				}

				.immersive-exit-btn {
					background: rgba(255, 255, 255, 0.1);
					color: var(--text-on-accent);
					border: 1px solid rgba(255, 255, 255, 0.3);
					padding: 4px 12px;
					border-radius: 6px;
					cursor: pointer;
					font-size: 0.85em;
					opacity: 0; /* \u9ED8\u8BA4\u5B8C\u5168\u9690\u85CF */
					transition: all 0.3s ease;
				}

				.immersive-exit-btn:hover {
					opacity: 1 !important;
					background: rgba(255, 255, 255, 0.3) !important;
				}

				/* \u9F20\u6807\u9760\u8FD1\u53F3\u4FA7\u533A\u57DF\u65F6\u81EA\u52A8\u663E\u793A\u63D0\u793A */
				.immersive-top-bar-right:hover .immersive-exit-btn {
					opacity: 0.7;
				}

				.immersive-panel-title {
					margin: 0 0 10px 0;
					font-size: 1.1em;
					color: var(--text-normal);
				}

				/* \u7AE0\u8282\u5217\u8868 */
				.immersive-chapter-list {
					display: flex;
					flex-direction: column;
					gap: 4px;
					overflow-y: auto;
				}
				.immersive-chapter-item {
					display: flex;
					justify-content: space-between;
					padding: 6px 10px;
					border-radius: 4px;
					cursor: pointer;
					transition: background 0.2s;
				}
				.immersive-chapter-item:hover {
					background: var(--background-modifier-hover);
				}
				.immersive-chapter-count {
					font-size: 0.8em;
					color: var(--text-muted);
				}

				/* \u4FBF\u7B7E\u5217\u8868 */
				.immersive-sticky-dock {
					display: flex;
					flex-direction: row;
					gap: 15px;
					overflow-x: auto;
					overflow-y: hidden;
					padding: 10px 5px;
					height: 100%;
					align-items: center;
				}
				.immersive-sticky-card {
					flex: 0 0 200px; /* \u56FA\u5B9A\u5BBD\u5EA6\uFF0C\u4E0D\u4F38\u7F29 */
					width: 200px;
					height: 200px; /* \u6B63\u65B9\u5F62 */
					border-radius: 8px;
					padding: 12px;
					box-shadow: 0 4px 10px rgba(0,0,0,0.15);
					display: flex;
					flex-direction: column;
					transition: transform 0.2s;
				}
				.immersive-sticky-card:hover {
					transform: translateY(-5px);
				}
				.immersive-sticky-card textarea {
					flex: 1;
					width: 100%;
					border: none;
					background: transparent;
					resize: none;
					font-family: inherit;
					color: inherit;
				}
				.immersive-sticky-card textarea:focus {
					outline: none;
					box-shadow: none;
				}
			`;
    injectGlobalStyle(styleId, styleContent);
  }
  /**
   * 移除全局样式
   */
  removeGlobalStyles() {
    removeGlobalStyle("accurate-count-global-styles");
  }
  /**
   * 应用护眼模式
   * 为 Markdown 编辑器添加护眼背景色
   */
  applyEyeCare() {
    const color = this.settings.eyeCareColor || "#E8F5E9";
    const css = `
			.workspace-leaf-content[data-type="markdown"] .view-content {
				background-color: ${color} !important;
			}
			.markdown-source-view .cm-editor .cm-scroller,
			.markdown-reading-view .markdown-preview-view {
				background-color: transparent !important;
			}
		`;
    injectGlobalStyle("accurate-count-eye-care", css);
  }
  /**
   * 移除护眼模式
   */
  removeEyeCare() {
    removeGlobalStyle("accurate-count-eye-care");
  }
  /**
   * 更新设置引用
   * 当设置更新时调用，确保 StyleManager 使用最新的设置
   */
  updateSettings(settings) {
    this.settings = settings;
  }
};

// src/ui/SettingsTab.ts
var import_obsidian7 = require("obsidian");

// src/services/ObsServer.ts
var import_obsidian5 = require("obsidian");
var ObsOverlayServer = class {
  constructor(plugin, port) {
    this.server = null;
    this.plugin = plugin;
    this.port = port;
  }
  /**
   * 启动 OBS HTTP 服务器
   * @returns 是否成功启动
   */
  start() {
    if (!import_obsidian5.Platform.isDesktop) return false;
    try {
      const http = window.require("http");
      const plugin = this.plugin;
      this.server = http.createServer((req, res) => {
        if (!req.url) {
          res.writeHead(400);
          res.end();
          return;
        }
        if (req.method !== "GET") {
          res.writeHead(405);
          res.end();
          return;
        }
        const url = new URL(req.url, `http://localhost:${this.port}`);
        if (url.pathname === "/api/stats") {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          });
          res.end(JSON.stringify(plugin.getObsStats()));
        } else {
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
          });
          res.end(plugin.buildObsOverlayHtml());
        }
      });
      this.server.listen(this.port, "127.0.0.1", () => {
        console.log(`[WebNovel Assistant] OBS Overlay server started at http://127.0.0.1:${this.port}`);
        new import_obsidian5.Notice(`OBS \u53E0\u52A0\u5C42\u5DF2\u542F\u52A8: http://127.0.0.1:${this.port}`);
      });
      this.server.on("error", async (e) => {
        console.error("[WebNovel Assistant] OBS \u670D\u52A1\u5668\u9519\u8BEF:", e);
        this.plugin.settings.enableObs = false;
        this.plugin.settings.enableLegacyObsExport = true;
        await this.plugin.saveSettings();
        if (e.code === "EADDRINUSE") {
          const suggestedPorts = [this.port + 1, this.port + 2, this.port + 10];
          new import_obsidian5.Notice(
            `\u7AEF\u53E3 ${this.port} \u5DF2\u88AB\u5360\u7528\uFF01
\u5DF2\u81EA\u52A8\u5207\u6362\u5230\u6587\u4EF6\u5BFC\u51FA\u6A21\u5F0F

\u5982\u9700\u4F7F\u7528 OBS HTTP \u670D\u52A1\u5668\uFF0C\u8BF7:
1. \u5728\u8BBE\u7F6E\u4E2D\u66F4\u6362\u7AEF\u53E3 (\u5EFA\u8BAE: ${suggestedPorts.join(", ")})
2. \u91CD\u65B0\u542F\u7528 OBS \u670D\u52A1\u5668`,
            15e3
          );
        } else {
          new import_obsidian5.Notice(
            `OBS \u670D\u52A1\u5668\u542F\u52A8\u5931\u8D25
\u5DF2\u81EA\u52A8\u5207\u6362\u5230\u6587\u4EF6\u5BFC\u51FA\u6A21\u5F0F

\u9519\u8BEF: ${e.message}
\u60A8\u53EF\u4EE5\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u6587\u4EF6\u5BFC\u51FA\u8DEF\u5F84`,
            12e3
          );
        }
      });
      return true;
    } catch (e) {
      console.error("[WebNovel Assistant] \u65E0\u6CD5\u542F\u52A8 OBS \u670D\u52A1\u5668:", e);
      this.plugin.settings.enableObs = false;
      this.plugin.settings.enableLegacyObsExport = true;
      this.plugin.saveSettings();
      new import_obsidian5.Notice(
        "OBS \u670D\u52A1\u5668\u542F\u52A8\u5931\u8D25\n\u5DF2\u81EA\u52A8\u5207\u6362\u5230\u6587\u4EF6\u5BFC\u51FA\u6A21\u5F0F\n\n\u53EF\u80FD\u539F\u56E0: Node.js \u6A21\u5757\u4E0D\u53EF\u7528\n\u60A8\u53EF\u4EE5\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u6587\u4EF6\u5BFC\u51FA\u8DEF\u5F84",
        12e3
      );
      return false;
    }
  }
  /**
   * 停止 OBS HTTP 服务器
   */
  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
  /**
   * 更新服务器端口
   * 如果端口变化，会自动重启服务器
   */
  updatePort(newPort) {
    if (this.port === newPort && this.server) return;
    this.stop();
    this.port = newPort;
    this.start();
  }
};

// src/ui/MobileFloatingStats.ts
var import_obsidian6 = require("obsidian");
var MobileFloatingStats = class {
  constructor(app, plugin) {
    this.containerEl = null;
    this.position = { x: 20, y: 100 };
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    // 显示元素
    this.wordCountEl = null;
    this.progressEl = null;
    this.touchMoveHandler = (e) => {
      if (!this.isDragging || !this.containerEl) return;
      const touch = e.touches[0];
      this.updatePosition(touch.clientX, touch.clientY);
      e.preventDefault();
    };
    this.touchEndHandler = () => {
      this.endDragging();
    };
    this.mouseMoveHandler = (e) => {
      if (!this.isDragging || !this.containerEl) return;
      this.updatePosition(e.clientX, e.clientY);
    };
    this.mouseUpHandler = () => {
      this.endDragging();
    };
    this.app = app;
    this.plugin = plugin;
    this.loadPosition();
  }
  /**
   * 加载浮窗
   */
  load() {
    if (this.containerEl) return;
    this.containerEl = document.body.createDiv({
      cls: "mobile-floating-stats",
      attr: {
        style: `
					position: fixed;
					left: ${this.position.x}px;
					top: ${this.position.y}px;
					z-index: 50;
					background: var(--background-primary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 6px;
					box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
					padding: 10px 16px;
					min-height: 44px;
					font-size: 13px;
					user-select: none;
					touch-action: none;
					cursor: move;
					display: flex;
					align-items: center;
					gap: 12px;
					opacity: 0.9;
				`
      }
    });
    this.wordCountEl = this.containerEl.createSpan({
      text: "0\u5B57",
      attr: {
        style: `
					font-weight: 500;
					color: var(--text-normal);
					white-space: nowrap;
				`
      }
    });
    this.containerEl.createSpan({
      text: "|",
      attr: {
        style: `
					color: var(--text-muted);
					opacity: 0.5;
				`
      }
    });
    this.progressEl = this.containerEl.createSpan({
      text: "0%",
      attr: {
        style: `
					font-weight: 500;
					color: var(--text-accent);
					white-space: nowrap;
				`
      }
    });
    this.bindDragEvents(this.containerEl);
    this.update();
  }
  /**
   * 卸载浮窗
   */
  unload() {
    if (this.containerEl) {
      document.removeEventListener("touchmove", this.touchMoveHandler);
      document.removeEventListener("touchend", this.touchEndHandler);
      document.removeEventListener("mousemove", this.mouseMoveHandler);
      document.removeEventListener("mouseup", this.mouseUpHandler);
      this.containerEl.remove();
      this.containerEl = null;
    }
  }
  /**
   * 更新显示内容
   */
  update() {
    if (!this.containerEl) return;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    if (!view || !view.file) {
      if (this.wordCountEl) this.wordCountEl.textContent = "0\u5B57";
      if (this.progressEl) this.progressEl.textContent = "0%";
      return;
    }
    const content = view.getViewData();
    const wordCount = this.plugin.calculateAccurateWords(content);
    let targetGoal = this.plugin.settings.defaultGoal;
    const cache = this.app.metadataCache.getFileCache(view.file);
    const fmGoal = cache?.frontmatter?.["word-goal"];
    if (fmGoal !== void 0) {
      const parsed = parseInt(fmGoal);
      if (!isNaN(parsed)) targetGoal = parsed;
    }
    const percent = targetGoal > 0 ? Math.min(Math.round(wordCount / targetGoal * 100), 100) : 0;
    if (this.wordCountEl) this.wordCountEl.textContent = wordCount.toLocaleString() + "\u5B57";
    if (this.progressEl) {
      this.progressEl.textContent = percent + "%";
      if (percent >= 100) {
        this.progressEl.style.color = "#10b981";
      } else if (percent >= 80) {
        this.progressEl.style.color = "#f59e0b";
      } else {
        this.progressEl.style.color = "var(--text-accent)";
      }
    }
  }
  /**
   * 绑定拖动事件
   */
  bindDragEvents(element) {
    element.addEventListener("touchstart", (e) => {
      this.isDragging = true;
      const touch = e.touches[0];
      this.dragOffset.x = touch.clientX - this.position.x;
      this.dragOffset.y = touch.clientY - this.position.y;
      if (this.containerEl) this.containerEl.style.opacity = "0.7";
      e.preventDefault();
    }, { passive: false });
    element.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.dragOffset.x = e.clientX - this.position.x;
      this.dragOffset.y = e.clientY - this.position.y;
      if (this.containerEl) this.containerEl.style.opacity = "0.7";
    });
    document.addEventListener("touchmove", this.touchMoveHandler, { passive: false });
    document.addEventListener("touchend", this.touchEndHandler);
    document.addEventListener("mousemove", this.mouseMoveHandler);
    document.addEventListener("mouseup", this.mouseUpHandler);
  }
  updatePosition(clientX, clientY) {
    if (!this.containerEl) return;
    this.position.x = clientX - this.dragOffset.x;
    this.position.y = clientY - this.dragOffset.y;
    this.position.x = Math.max(0, Math.min(this.position.x, window.innerWidth - this.containerEl.offsetWidth));
    this.position.y = Math.max(0, Math.min(this.position.y, window.innerHeight - this.containerEl.offsetHeight));
    this.containerEl.style.left = `${this.position.x}px`;
    this.containerEl.style.top = `${this.position.y}px`;
  }
  endDragging() {
    if (this.isDragging) {
      this.isDragging = false;
      if (this.containerEl) this.containerEl.style.opacity = "0.9";
      this.savePosition();
    }
  }
  /**
   * 保存位置
   */
  savePosition() {
    const state = {
      x: this.position.x,
      y: this.position.y
    };
    localStorage.setItem("mobile-floating-stats-state", JSON.stringify(state));
  }
  /**
   * 加载位置
   */
  loadPosition() {
    try {
      const saved = localStorage.getItem("mobile-floating-stats-state");
      if (saved) {
        const state = JSON.parse(saved);
        this.position = { x: state.x || 20, y: state.y || 100 };
      }
    } catch (error) {
      console.error("[MobileFloatingStats] \u52A0\u8F7D\u4F4D\u7F6E\u5931\u8D25:", error);
    }
  }
};

// src/ui/SettingsTab.ts
var AccurateCountSettingTab = class extends import_obsidian7.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.activeTab = "general";
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h1", { text: "WebNovel Assistant \u8BBE\u7F6E" });
    const navContainer = containerEl.createDiv({ cls: "webnovel-settings-tabs" });
    const tier = getPlatformTier();
    const allTabs = [
      { id: "general", name: "\u57FA\u7840\u8BBE\u7F6E" },
      { id: "immersive", name: "\u6C89\u6D78\u6A21\u5F0F", desktopOnly: true },
      { id: "sticky", name: "\u60AC\u6D6E\u4FBF\u7B7E", desktopOnly: true },
      { id: "creative", name: "\u521B\u4F5C\u5DE5\u5177", tabletSupported: true },
      { id: "obs", name: "\u6570\u636E\u8F93\u51FA", desktopOnly: true }
    ];
    const tabs = allTabs.filter((tab) => {
      if (tier === "desktop") return true;
      if (tier === "tablet") return tab.id === "general" || tab.tabletSupported;
      return tab.id === "general";
    });
    tabs.forEach((tab) => {
      const tabEl = navContainer.createDiv({
        cls: `webnovel-tab-item ${this.activeTab === tab.id ? "is-active" : ""}`,
        text: tab.name
      });
      tabEl.onclick = () => {
        this.activeTab = tab.id;
        this.display();
      };
    });
    if (this.activeTab === "general") {
      this.displayGeneralSettings(containerEl);
    } else if (this.activeTab === "immersive") {
      this.displayImmersiveModeSettings(containerEl);
    } else if (this.activeTab === "sticky") {
      this.displayStickyNoteSettings(containerEl);
    } else if (this.activeTab === "creative") {
      this.displayForeshadowingSettings(containerEl);
      this.displayTimelineSettings(containerEl);
      this.displayEyeCareSettings(containerEl);
    } else if (this.activeTab === "obs") {
      this.displayDataSettings(containerEl);
    }
  }
  displayGeneralSettings(containerEl) {
    const tier = getPlatformTier();
    if (tier !== "desktop") {
      const mobileNotice = containerEl.createDiv({
        cls: "setting-item-description",
        attr: {
          style: "background: var(--background-secondary); padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 3px solid var(--interactive-accent);"
        }
      });
      mobileNotice.createEl("strong", { text: tier === "mobile" ? "\u{1F4F1} \u79FB\u52A8\u7AEF\u6A21\u5F0F" : "\u{1F4F1} \u5E73\u677F\u7AEF\u6A21\u5F0F" });
      mobileNotice.createEl("br");
      mobileNotice.appendText(tier === "mobile" ? "\u90E8\u5206\u9AD8\u7EA7\u529F\u80FD(\u9762\u677F\u3001\u4FBF\u7B7E\u3001OBS)\u4EC5\u5728\u684C\u9762\u7AEF\u53EF\u7528\u3002" : "\u5DF2\u542F\u7528\u9762\u677F\u529F\u80FD\u3002\u4FBF\u7B7E\u548C OBS \u4EC5\u5728\u684C\u9762\u7AEF\u53EF\u7528\u3002");
      new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u6D6E\u52A8\u5B57\u6570\u7EDF\u8BA1").setDesc("\u5728\u5C4F\u5E55\u4E0A\u663E\u793A\u6D6E\u52A8\u5C0F\u7A97\uFF0C\u5B9E\u65F6\u663E\u793A\u5B57\u6570\u8FDB\u5EA6\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.showMobileFloatingStats).onChange(async (value) => {
        this.plugin.settings.showMobileFloatingStats = value;
        await this.plugin.saveSettings();
        if (value) {
          if (!this.plugin.mobileFloatingStats) this.plugin.mobileFloatingStats = new MobileFloatingStats(this.app, this.plugin);
          this.plugin.mobileFloatingStats.load();
        } else {
          this.plugin.mobileFloatingStats?.unload();
        }
      }));
    }
    containerEl.createEl("h2", { text: "\u6838\u5FC3\u529F\u80FD\u8BBE\u7F6E" });
    new import_obsidian7.Setting(containerEl).setName("\u5DE5\u4F5C\u533A\u6587\u4EF6\u5939").setDesc("\u7559\u7A7A\u5168\u5C40\u751F\u6548\u3002\u591A\u4E2A\u7528\u9017\u53F7\u5206\u9694\u3002").addTextArea((text) => {
      text.setPlaceholder("\u4F8B\u5982\uFF1A\u5C0F\u8BF4/\u7B2C\u4E00\u5377").setValue((this.plugin.settings.workspaceFolders || []).join(", ")).onChange(async (value) => {
        this.plugin.settings.workspaceFolders = value.trim() ? value.split(",").map((f) => f.trim()).filter(Boolean) : [];
        await this.plugin.saveSettings();
      });
      text.inputEl.style.width = "100%";
    });
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u72B6\u6001\u680F\u8FDB\u5EA6").setDesc("\u5728 Obsidian \u5E95\u90E8\u72B6\u6001\u680F\u663E\u793A\u5F53\u524D\u7AE0\u8282\u8FDB\u5EA6\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.showGoal).onChange(async (value) => {
      this.plugin.settings.showGoal = value;
      await this.plugin.saveSettings();
      this.plugin.updateWordCount();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u6587\u4EF6\u5217\u8868\u5B57\u6570").setDesc("\u5728\u4FA7\u8FB9\u680F\u6587\u4EF6\u6811\u4E2D\u663E\u793A\u6C47\u603B\u5B57\u6570\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.showExplorerCounts).onChange(async (value) => {
      this.plugin.settings.showExplorerCounts = value;
      await this.plugin.saveSettings();
      if (value) await this.plugin.buildFolderCache();
      else this.plugin.refreshFolderCounts();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u542F\u7528\u5B57\u6570\u5B9E\u65F6\u63D0\u9192").setDesc("\u5F00\u542F\u540E\uFF0C\u5C06\u5728\u7F16\u8F91\u5668\u7684\u5DE6\u4FA7\u884C\u53F7\u533A\u57DF\uFF0C\u6309\u7167\u8BBE\u5B9A\u7684\u5B57\u6570\u95F4\u9694\u5B9E\u65F6\u663E\u793A\u5F53\u524D\u884C\u7684\u7D2F\u8BA1\u5B57\u6570\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.enableWordCountGutter).onChange(async (value) => {
      this.plugin.settings.enableWordCountGutter = value;
      await this.plugin.saveSettings();
      this.app.workspace.trigger("webnovel:word-count-gutter-settings-changed");
    }));
    new import_obsidian7.Setting(containerEl).setName("\u5B57\u6570\u63D0\u9192\u95F4\u9694").setDesc("\u8BBE\u7F6E\u6BCF\u9694\u591A\u5C11\u5B57\u5728\u5DE6\u4FA7\u663E\u793A\u4E00\u6B21\u63D0\u793A\u6807\u7B7E\u3002").addText((text) => text.setValue((this.plugin.settings.wordCountInterval || 2e3).toString()).onChange(async (v) => {
      const p = parseInt(v);
      if (!isNaN(p) && p > 0) {
        this.plugin.settings.wordCountInterval = p;
        await this.plugin.saveSettings();
        this.app.workspace.trigger("webnovel:word-count-gutter-settings-changed");
      }
    }));
    new import_obsidian7.Setting(containerEl).setName("\u542F\u7528\u4E25\u683C\u7AE0\u8282\u6A21\u5F0F").setDesc("\u6240\u6709\u6D89\u53CA\u5B57\u6570\u76F8\u5173\uFF08\u76EE\u6807\u3001\u7EDF\u8BA1\u3001\u5B57\u6570\u63D0\u9192\u7B49\uFF09\u7684\u529F\u80FD\u5747\u53EA\u5728\u7B26\u5408\u547D\u540D\u89C4\u5219\u7684\u6587\u6863\u4E2D\u751F\u6548\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.enableStrictChapterMode).onChange(async (value) => {
      this.plugin.settings.enableStrictChapterMode = value;
      await this.plugin.saveSettings();
      this.plugin.updateWordCount();
      if (this.plugin.settings.showExplorerCounts) {
        this.plugin.buildFolderCache();
      }
    }));
    new import_obsidian7.Setting(containerEl).setName("\u9ED8\u8BA4\u7AE0\u8282\u76EE\u6807").addText((text) => text.setValue(this.plugin.settings.defaultGoal.toString()).onChange(async (v) => {
      const p = parseInt(v);
      if (!isNaN(p)) {
        this.plugin.settings.defaultGoal = p;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian7.Setting(containerEl).setName("\u4ECA\u65E5\u76EE\u6807\u5B57\u6570").addText((text) => text.setValue((this.plugin.settings.dailyGoal || 5e3).toString()).onChange(async (v) => {
      const p = parseInt(v);
      if (!isNaN(p)) {
        this.plugin.settings.dailyGoal = p;
        await this.plugin.saveSettings();
      }
    }));
    if (isDesktop()) {
      new import_obsidian7.Setting(containerEl).setName("\u542F\u7528\u667A\u80FD\u7AE0\u8282\u6392\u5E8F").setDesc("\u81EA\u52A8\u8BC6\u522B\u7AE0\u8282\u7F16\u53F7\u8FDB\u884C\u6570\u5B57\u6392\u5E8F\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.enableSmartChapterSort).onChange(async (value) => {
        this.plugin.settings.enableSmartChapterSort = value;
        await this.plugin.saveSettings();
        if (value) this.plugin.fileExplorerPatcher.enable();
        else this.plugin.fileExplorerPatcher.disable();
        this.display();
      }));
      if (this.plugin.settings.enableSmartChapterSort) {
        this.displaySortingRules(containerEl);
      }
    }
  }
  displaySortingRules(containerEl) {
    new import_obsidian7.Setting(containerEl).setName("\u6392\u5E8F\u89C4\u5219\u914D\u7F6E").setHeading();
    const rulesContainer = containerEl.createDiv({ style: "width: 100%;" });
    const renderRules = () => {
      rulesContainer.empty();
      this.plugin.settings.chapterNamingRules.forEach((rule, index) => {
        const s = new import_obsidian7.Setting(rulesContainer);
        s.settingEl.style.background = "var(--background-secondary)";
        s.settingEl.style.borderRadius = "8px";
        s.settingEl.style.marginBottom = "10px";
        s.settingEl.style.padding = "10px 15px";
        s.settingEl.style.borderTop = "none";
        s.settingEl.style.display = "flex";
        s.settingEl.style.alignItems = "center";
        s.settingEl.style.gap = "10px";
        s.infoEl.remove();
        const rules = this.plugin.settings.chapterNamingRules;
        const orderBtns = s.settingEl.createDiv({ attr: { style: "display:flex;flex-direction:column;gap:2px;flex-shrink:0;" } });
        const upBtn = orderBtns.createEl("button", { text: "\u25B2", attr: { title: "\u4E0A\u79FB", style: "font-size:10px;padding:1px 5px;cursor:pointer;line-height:1.2;" } });
        const downBtn = orderBtns.createEl("button", { text: "\u25BC", attr: { title: "\u4E0B\u79FB", style: "font-size:10px;padding:1px 5px;cursor:pointer;line-height:1.2;" } });
        if (index === 0) upBtn.disabled = true;
        if (index === rules.length - 1) downBtn.disabled = true;
        upBtn.onclick = async () => {
          [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
          await this.plugin.saveSettings();
          ChapterSorter.setCustomRules(rules);
          this.plugin.fileExplorerPatcher.refreshManually();
          renderRules();
        };
        downBtn.onclick = async () => {
          [rules[index + 1], rules[index]] = [rules[index], rules[index + 1]];
          await this.plugin.saveSettings();
          ChapterSorter.setCustomRules(rules);
          this.plugin.fileExplorerPatcher.refreshManually();
          renderRules();
        };
        s.addToggle((chk) => chk.setValue(rule.enabled).onChange(async (value) => {
          rule.enabled = value;
          await this.plugin.saveSettings();
          ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
          this.plugin.fileExplorerPatcher.refreshManually();
        }));
        s.addText((text) => {
          text.setValue(rule.name).setPlaceholder("\u540D\u79F0").onChange(async (value) => {
            rule.name = value;
            await this.plugin.saveSettings();
          });
          text.inputEl.style.flex = "1 1 0px";
          text.inputEl.style.minWidth = "0";
        });
        s.addText((text) => {
          text.setValue(rule.pattern).setPlaceholder("\u6B63\u5219\u8868\u8FBE\u5F0F").onChange(async (value) => {
            rule.pattern = value;
            await this.plugin.saveSettings();
            ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
            this.plugin.fileExplorerPatcher.refreshManually();
          });
          text.inputEl.style.flex = "3 1 0px";
          text.inputEl.style.minWidth = "0";
          text.inputEl.style.fontFamily = "monospace";
        });
        s.addButton((btn) => btn.setButtonText("\u5220\u9664").setWarning().onClick(async () => {
          this.plugin.settings.chapterNamingRules.splice(index, 1);
          await this.plugin.saveSettings();
          ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
          this.plugin.fileExplorerPatcher.refreshManually();
          renderRules();
        }));
      });
      const addBtnRow = new import_obsidian7.Setting(rulesContainer);
      addBtnRow.infoEl.remove();
      addBtnRow.settingEl.style.borderTop = "none";
      addBtnRow.settingEl.style.padding = "0";
      addBtnRow.addButton((btn) => btn.setButtonText("+ \u6DFB\u52A0\u65B0\u89C4\u5219").onClick(async () => {
        this.plugin.settings.chapterNamingRules.push({ name: "\u65B0\u89C4\u5219", pattern: "^(\\d+)", enabled: true });
        await this.plugin.saveSettings();
        renderRules();
      }).buttonEl.style.width = "100%");
    };
    renderRules();
  }
  displayStickyNoteSettings(containerEl) {
    if (!isDesktop()) {
      containerEl.createEl("p", { text: "\u26A0\uFE0F \u60AC\u6D6E\u4FBF\u7B7E\u529F\u80FD\u4EC5\u5728\u684C\u9762\u7AEF\u53EF\u7528\u3002", cls: "setting-item-description" });
      return;
    }
    new import_obsidian7.Setting(containerEl).setName("\u95F2\u7F6E\u900F\u660E\u5EA6").addSlider((slider) => slider.setLimits(0.1, 1, 0.05).setValue(this.plugin.settings.noteOpacity).onChange(async (v) => {
      this.plugin.settings.noteOpacity = v;
      await this.plugin.saveSettings();
      this.plugin.activeNotes.forEach((n) => n.updateVisuals());
    }));
    new import_obsidian7.Setting(containerEl).setName("\u4FBF\u7B7E\u81EA\u52A8\u4FDD\u5B58").setDesc("\u5F00\u542F\u540E\uFF0C\u5728\u4FBF\u7B7E\u4E2D\u8F93\u5165\u5185\u5BB9\u4F1A\u5B9E\u65F6\u4FDD\u5B58\u5230\u5185\u5B58\u548C\u6587\u4EF6\uFF1B\u5173\u95ED\u540E\uFF0C\u4EC5\u5728\u5173\u95ED\u4FBF\u7B7E\u65F6\u63D0\u793A\u624B\u52A8\u4FDD\u5B58\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.stickyNoteAutoSave).onChange(async (value) => {
      this.plugin.settings.stickyNoteAutoSave = value;
      await this.plugin.saveSettings();
    }));
    const colorSetting = new import_obsidian7.Setting(containerEl).setName("\u4E3B\u9898\u8272\u65B9\u6848").setDesc("\u81EA\u5B9A\u4E49 6 \u79CD\u9884\u8BBE\u914D\u8272\u3002");
    const colorContainer = colorSetting.controlEl.createDiv({ attr: { style: "display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;" } });
    this.plugin.settings.noteThemes.forEach((theme, index) => {
      const themeDiv = colorContainer.createDiv({ attr: { style: "display: flex; align-items: center; gap: 4px; background: var(--background-modifier-form-field); padding: 4px; border-radius: 4px;" } });
      const bg = themeDiv.createEl("input", { type: "color", value: theme.bg });
      const txt = themeDiv.createEl("input", { type: "color", value: theme.text });
      bg.onchange = async (e) => {
        this.plugin.settings.noteThemes[index].bg = e.target.value;
        await this.plugin.saveSettings();
      };
      txt.onchange = async (e) => {
        this.plugin.settings.noteThemes[index].text = e.target.value;
        await this.plugin.saveSettings();
      };
    });
  }
  displayImmersiveModeSettings(containerEl) {
    containerEl.createEl("h3", { text: "\u7F16\u8F91\u5668\u9002\u914D" });
    new import_obsidian7.Setting(containerEl).setName("\u9002\u914D\u6253\u5B57\u673A\u6A21\u5F0F (Typewriter Scroll)").setDesc("\u5F00\u542F\u540E\u5C06\u4F18\u5316\u6C89\u6D78\u6A21\u5F0F\u4E0B\u7684\u6EDA\u52A8\u533A\u57DF\uFF08\u589E\u52A0\u9875\u8FB9\u8DDD\u548C\u6EDA\u52A8\u5185\u8FB9\u8DDD\uFF09\uFF0C\u89E3\u51B3\u914D\u5408\u6253\u5B57\u673A\u63D2\u4EF6\u4F7F\u7528\u65F6\u7684\u754C\u9762\u8DF3\u52A8\u95EE\u9898\u3002\u82E5\u4E0D\u4F7F\u7528\u6253\u5B57\u673A\u63D2\u4EF6\uFF0C\u5EFA\u8BAE\u5173\u95ED\u4EE5\u83B7\u5F97\u539F\u751F\u7F16\u8F91\u5668\u4F53\u9A8C\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveTypewriterMode).onChange(async (value) => {
      this.plugin.settings.immersiveTypewriterMode = value;
      await this.plugin.saveSettings();
      if (value) {
        document.body.classList.add("immersive-typewriter-mode");
      } else {
        document.body.classList.remove("immersive-typewriter-mode");
      }
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view instanceof MarkdownView) {
          leaf.view.editor?.refresh();
        }
      });
    }));
    containerEl.createEl("h3", { text: "\u8F85\u52A9\u9762\u677F\u663E\u793A\u5F00\u5173" });
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u5DE6\u4FA7\u7AE0\u8282\u5217\u8868").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveShowChapterList).onChange(async (value) => {
      this.plugin.settings.immersiveShowChapterList = value;
      this.plugin.settings.immersiveLayout = null;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u53F3\u4FA7\u53C2\u8003\u6587\u6863\u533A").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveShowReference).onChange(async (value) => {
      this.plugin.settings.immersiveShowReference = value;
      this.plugin.settings.immersiveLayout = null;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u60AC\u6D6E\u4FBF\u7B7E\u9648\u5217\u533A").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveShowStickyNotes).onChange(async (value) => {
      this.plugin.settings.immersiveShowStickyNotes = value;
      this.plugin.settings.immersiveLayout = null;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u4F0F\u7B14\u9762\u677F").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveShowForeshadowing).onChange(async (value) => {
      this.plugin.settings.immersiveShowForeshadowing = value;
      this.plugin.settings.immersiveLayout = null;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u65F6\u95F4\u7EBF\u9762\u677F").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveShowTimeline).onChange(async (value) => {
      this.plugin.settings.immersiveShowTimeline = value;
      this.plugin.settings.immersiveLayout = null;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u8F85\u52A9\u9762\u677F\u663E\u793A\u4F4D\u7F6E").setDesc("\u8F85\u52A9\u9762\u677F\uFF08\u4FBF\u7B7E\u3001\u4F0F\u7B14\u3001\u65F6\u95F4\u7EBF\uFF09\u4F5C\u4E3A\u4E00\u4E2A\u6574\u4F53\u663E\u793A\u5728\u4E3B\u7F16\u8F91\u533A\u7684\u4E0A\u65B9\u6216\u4E0B\u65B9\u3002").addDropdown((dropdown) => dropdown.addOption("bottom", "\u4E3B\u89C6\u56FE\u4E0B\u65B9").addOption("top", "\u4E3B\u89C6\u56FE\u4E0A\u65B9").setValue(this.plugin.settings.immersivePanelPosition || "bottom").onChange(async (value) => {
      this.plugin.settings.immersivePanelPosition = value;
      this.plugin.settings.immersiveLayout = null;
      await this.plugin.saveSettings();
      new import_obsidian7.Notice(`\u4F4D\u7F6E\u5DF2\u5207\u6362\u4E3A: ${value === "top" ? "\u4E0A\u65B9" : "\u4E0B\u65B9"}\uFF0C\u4E0B\u6B21\u8FDB\u5165\u6C89\u6D78\u6A21\u5F0F\u751F\u6548`);
    }));
    containerEl.createEl("h3", { text: "\u6C89\u6D78\u6A21\u5F0F\u4FBF\u7B7E\u8BBE\u7F6E" });
    new import_obsidian7.Setting(containerEl).setName("\u4FBF\u7B7E\u663E\u793A\u5C3A\u5BF8 (px)").setDesc("\u6C89\u6D78\u6A21\u5F0F\u4E0B\u4FBF\u7B7E\u7684\u6B63\u65B9\u5F62\u8FB9\u957F\u3002").addSlider((slider) => slider.setLimits(150, 600, 10).setValue(this.plugin.settings.immersiveNoteSize || 280).setDynamicTooltip().onChange(async (value) => {
      this.plugin.settings.immersiveNoteSize = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u4FBF\u7B7E\u5B57\u4F53\u5927\u5C0F (px)").setDesc("\u6C89\u6D78\u6A21\u5F0F\u4E0B\u4FBF\u7B7E\u6587\u672C\u6846\u5185\u7684\u5B57\u4F53\u5927\u5C0F\u3002").addSlider((slider) => slider.setLimits(10, 30, 1).setValue(this.plugin.settings.immersiveNoteFontSize || 14).setDynamicTooltip().onChange(async (value) => {
      this.plugin.settings.immersiveNoteFontSize = value;
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("h3", { text: "\u9876\u90E8\u4EEA\u8868\u76D8\u6570\u636E\u5F00\u5173" });
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u603B\u8BA1\u65F6\u95F4").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveShowTotalTime).onChange(async (value) => {
      this.plugin.settings.immersiveShowTotalTime = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u4E13\u6CE8\u65F6\u95F4").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveShowFocusTime).onChange(async (value) => {
      this.plugin.settings.immersiveShowFocusTime = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u6478\u9C7C\u65F6\u95F4").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveShowSlackTime).onChange(async (value) => {
      this.plugin.settings.immersiveShowSlackTime = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u7AE0\u8282\u76EE\u6807\u8FDB\u5EA6").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveShowChapterProgress).onChange(async (value) => {
      this.plugin.settings.immersiveShowChapterProgress = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u4ECA\u65E5\u76EE\u6807\u8FDB\u5EA6").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveShowDailyProgress).onChange(async (value) => {
      this.plugin.settings.immersiveShowDailyProgress = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u672C\u573A\u51C0\u589E").addToggle((toggle) => toggle.setValue(this.plugin.settings.immersiveShowSessionWords).onChange(async (value) => {
      this.plugin.settings.immersiveShowSessionWords = value;
      await this.plugin.saveSettings();
    }));
  }
  displayForeshadowingSettings(containerEl) {
    containerEl.createEl("h2", { text: "\u4F0F\u7B14\u6807\u6CE8\u8BBE\u7F6E" });
    new import_obsidian7.Setting(containerEl).setName("\u4F0F\u7B14\u6587\u4EF6\u540D").setDesc("\u6807\u6CE8\u7684\u4F0F\u7B14\u5C06\u4FDD\u5B58\u5230\u5F53\u524D\u6587\u4EF6\u5939\u4E0B\u7684\u6B64\u6587\u4EF6\u4E2D\uFF08\u65E0\u9700 .md \u540E\u7F00\uFF09\u3002").addText((text) => text.setPlaceholder("\u4F0F\u7B14").setValue(this.plugin.settings.foreshadowing?.fileName || "\u4F0F\u7B14").onChange(async (value) => {
      const trimmed = value.trim().replace(/\.md$/i, "");
      if (!this.plugin.settings.foreshadowing) {
        this.plugin.settings.foreshadowing = { fileName: "\u4F0F\u7B14", showTimestamp: true, defaultTags: [] };
      }
      this.plugin.settings.foreshadowing.fileName = trimmed || "\u4F0F\u7B14";
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u65F6\u95F4\u6233").setDesc("\u5728\u4F0F\u7B14\u6761\u76EE\u6807\u9898\u4E2D\u663E\u793A\u6807\u6CE8\u65F6\u95F4\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.foreshadowing?.showTimestamp !== false).onChange(async (value) => {
      if (!this.plugin.settings.foreshadowing) {
        this.plugin.settings.foreshadowing = { fileName: "\u4F0F\u7B14", showTimestamp: true, defaultTags: [] };
      }
      this.plugin.settings.foreshadowing.showTimestamp = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u5E38\u7528\u6807\u7B7E").setDesc("\u7528\u7A7A\u683C\u5206\u9694\uFF0C\u6807\u6CE8\u4F0F\u7B14\u65F6\u53EF\u5FEB\u901F\u70B9\u51FB\u6DFB\u52A0\u3002").addText((text) => {
      const tags = this.plugin.settings.foreshadowing?.defaultTags || [];
      text.setPlaceholder("\u4EBA\u7269 \u60C5\u8282 \u4E16\u754C\u89C2 \u9053\u5177 \u4F0F\u7EBF").setValue(tags.join(" ")).onChange(async (value) => {
        if (!this.plugin.settings.foreshadowing) {
          this.plugin.settings.foreshadowing = { fileName: "\u4F0F\u7B14", showTimestamp: true, defaultTags: [] };
        }
        this.plugin.settings.foreshadowing.defaultTags = value.trim() ? value.trim().split(/\s+/).filter(Boolean) : [];
        await this.plugin.saveSettings();
      });
      text.inputEl.style.width = "100%";
    });
  }
  displayTimelineSettings(containerEl) {
    containerEl.createEl("h2", { text: "\u65F6\u95F4\u7EBF\u8BBE\u7F6E" });
    new import_obsidian7.Setting(containerEl).setName("\u65F6\u95F4\u7EBF\u6587\u4EF6\u540D").setDesc("\u65F6\u95F4\u7EBF\u6570\u636E\u4FDD\u5B58\u5230\u5F53\u524D\u6587\u4EF6\u5939\u4E0B\u7684\u6B64\u6587\u4EF6\u4E2D\uFF08\u65E0\u9700 .md \u540E\u7F00\uFF09\u3002").addText((text) => text.setPlaceholder("\u65F6\u95F4\u7EBF").setValue(this.plugin.settings.timeline?.fileName || "\u65F6\u95F4\u7EBF").onChange(async (value) => {
      const trimmed = value.trim().replace(/\.md$/i, "");
      if (!this.plugin.settings.timeline) {
        this.plugin.settings.timeline = { fileName: "\u65F6\u95F4\u7EBF", defaultTypes: [] };
      }
      this.plugin.settings.timeline.fileName = trimmed || "\u65F6\u95F4\u7EBF";
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u5E38\u7528\u7C7B\u578B").setDesc("\u7528\u7A7A\u683C\u5206\u9694\uFF0C\u6DFB\u52A0\u65F6\u95F4\u7EBF\u4E8B\u4EF6\u65F6\u53EF\u4ECE\u4E0B\u62C9\u5217\u8868\u9009\u62E9\u3002").addText((text) => {
      const types = this.plugin.settings.timeline?.defaultTypes || [];
      text.setPlaceholder("\u4E3B\u7EBF \u652F\u7EBF \u4F0F\u7B14 \u4E16\u754C\u89C2 \u4EBA\u7269").setValue(types.join(" ")).onChange(async (value) => {
        if (!this.plugin.settings.timeline) {
          this.plugin.settings.timeline = { fileName: "\u65F6\u95F4\u7EBF", defaultTypes: [] };
        }
        this.plugin.settings.timeline.defaultTypes = value.trim() ? value.trim().split(/\s+/).filter(Boolean) : [];
        await this.plugin.saveSettings();
      });
      text.inputEl.style.width = "100%";
    });
  }
  displayEyeCareSettings(containerEl) {
    containerEl.createEl("h2", { text: "\u62A4\u773C\u6A21\u5F0F" });
    new import_obsidian7.Setting(containerEl).setName("\u542F\u7528\u62A4\u773C\u6A21\u5F0F").setDesc("\u5C06\u7F16\u8F91\u533A\u548C\u9605\u8BFB\u533A\u7684\u80CC\u666F\u8272\u66FF\u6362\u4E3A\u62A4\u773C\u8272\uFF0C\u5176\u4ED6\u754C\u9762\u4FDD\u6301\u4E0D\u53D8\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.eyeCareEnabled ?? false).onChange(async (value) => {
      this.plugin.settings.eyeCareEnabled = value;
      await this.plugin.saveSettings();
      if (value) {
        this.plugin.applyEyeCare();
      } else {
        this.plugin.removeEyeCare();
      }
    }));
    new import_obsidian7.Setting(containerEl).setName("\u62A4\u773C\u80CC\u666F\u8272").setDesc("\u63A8\u8350\u4F7F\u7528\u4F4E\u9971\u548C\u5EA6\u7684\u7EFF\u8272\u6216\u6696\u8272\u8C03\uFF0C\u51CF\u5C11\u89C6\u89C9\u75B2\u52B3\u3002").addColorPicker((picker) => picker.setValue(this.plugin.settings.eyeCareColor || "#E8F5E9").onChange(async (value) => {
      this.plugin.settings.eyeCareColor = value;
      await this.plugin.saveSettings();
      if (this.plugin.settings.eyeCareEnabled) {
        this.plugin.applyEyeCare();
      }
    })).addExtraButton((btn) => btn.setIcon("reset").setTooltip("\u6062\u590D\u9ED8\u8BA4\u989C\u8272 (#E8F5E9)").onClick(async () => {
      this.plugin.settings.eyeCareColor = "#E8F5E9";
      await this.plugin.saveSettings();
      if (this.plugin.settings.eyeCareEnabled) {
        this.plugin.applyEyeCare();
      }
      this.display();
    }));
  }
  displayDataSettings(containerEl) {
    containerEl.createEl("h2", { text: "\u6570\u636E\u7EDF\u8BA1\u4E0E\u8F93\u51FA\u8BBE\u7F6E" });
    new import_obsidian7.Setting(containerEl).setName("\u7CBE\u51C6\u4E13\u6CE8\u5EA6\u5224\u5B9A\u9608\u503C (\u79D2)").setDesc('\u5728\u6B64\u65F6\u95F4\u5185\u6CA1\u6709\u952E\u76D8\u8F93\u5165\uFF0C\u5373\u4F7F\u8F6F\u4EF6\u5904\u4E8E\u805A\u7126\u72B6\u6001\uFF0C\u4E5F\u4F1A\u88AB\u5224\u5B9A\u4E3A"\u6478\u9C7C"\u3002').addSlider((slider) => slider.setLimits(30, 600, 30).setValue(this.plugin.settings.idleTimeoutThreshold / 1e3).setDynamicTooltip().onChange(async (value) => {
      this.plugin.settings.idleTimeoutThreshold = value * 1e3;
      await this.plugin.saveSettings();
    }));
    this.displayObsSettings(containerEl);
    this.displayLegacyExportSettings(containerEl);
  }
  displayObsSettings(containerEl) {
    new import_obsidian7.Setting(containerEl).setName("\u542F\u7528\u6570\u636E\u53E0\u52A0\u5C42 (OBS/\u76F4\u64AD)").setDesc("\u5728\u672C\u5730\u542F\u52A8 HTTP \u670D\u52A1\uFF0COBS \u901A\u8FC7\u300C\u6D4F\u89C8\u5668\u6E90\u300D\u52A0\u8F7D\u5B9E\u65F6\u7EDF\u8BA1\u9762\u677F\uFF0C\u96F6\u78C1\u76D8 I/O\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.enableObs).onChange(async (value) => {
      this.plugin.settings.enableObs = value;
      await this.plugin.saveSettings();
      if (value) {
        if (this.plugin.obsServer) {
          this.plugin.obsServer.stop();
        }
        this.plugin.obsServer = new ObsOverlayServer(this.plugin, this.plugin.settings.obsPort);
        this.plugin.obsServer.start();
      } else {
        this.plugin.obsServer?.stop();
      }
    }));
    new import_obsidian7.Setting(containerEl).setName("\u53E0\u52A0\u5C42\u7AEF\u53E3").setDesc("OBS \u6D4F\u89C8\u5668\u6E90\u8BBF\u95EE\u7684\u7AEF\u53E3\u53F7\uFF0C\u4FEE\u6539\u540E\u9700\u91CD\u542F\u53E0\u52A0\u5C42\u3002").addText((text) => text.setValue(this.plugin.settings.obsPort.toString()).onChange(async (value) => {
      const parsed = parseInt(value);
      if (parsed >= VALIDATION_RULES.PORT_RANGE.min && parsed <= VALIDATION_RULES.PORT_RANGE.max) {
        this.plugin.settings.obsPort = parsed;
        await this.plugin.saveSettings();
        if (this.plugin.settings.enableObs && this.plugin.obsServer) {
          this.plugin.obsServer.stop();
          this.plugin.obsServer = new ObsOverlayServer(this.plugin, this.plugin.settings.obsPort);
          this.plugin.obsServer.start();
          new import_obsidian7.Notice(`OBS \u53E0\u52A0\u5C42\u5DF2\u91CD\u542F\uFF0C\u65B0\u7AEF\u53E3\uFF1A${parsed}`);
        }
      } else if (!isNaN(parsed)) {
        new import_obsidian7.Notice(`\u7AEF\u53E3\u53F7\u5FC5\u987B\u5728 ${VALIDATION_RULES.PORT_RANGE.min}-${VALIDATION_RULES.PORT_RANGE.max} \u4E4B\u95F4`);
      }
    }));
    new import_obsidian7.Setting(containerEl).setName("\u53E0\u52A0\u5C42\u80CC\u666F\u900F\u660E\u5EA6").setDesc("\u8C03\u6574 OBS \u53E0\u52A0\u5C42\u5361\u7247\u80CC\u666F\u7684\u900F\u660E\u5EA6 (0\u4E3A\u5B8C\u5168\u900F\u660E)\u3002").addSlider((slider) => slider.setLimits(0, 1, 0.05).setValue(this.plugin.settings.obsOverlayOpacity ?? 0.85).setDynamicTooltip().onChange(async (value) => {
      this.plugin.settings.obsOverlayOpacity = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u81EA\u5B9A\u4E49 CSS").setDesc("\u901A\u8FC7\u8986\u76D6 CSS \u7C7B\u540D\u4FEE\u6539\u6837\u5F0F").addTextArea((text) => {
      text.setPlaceholder("/* \u4F8B\uFF1A\u4FEE\u6539\u6478\u9C7C\u65F6\u95F4\u4E3A\u7EFF\u8272 */ .time-value.slack { color: #4CAF50 !important; }").setValue(this.plugin.settings.obsCustomCss).onChange(async (value) => {
        this.plugin.settings.obsCustomCss = value;
        await this.plugin.saveSettings();
      });
      text.inputEl.style.cssText = "width: 100%; height: 100px; font-family: monospace;";
      return text;
    });
    new import_obsidian7.Setting(containerEl).setName("\u53E0\u52A0\u5C42\u4E3B\u9898").addDropdown((dropdown) => {
      dropdown.addOption("dark", "\u6697\u8272 (\u6DF1\u8272\u80CC\u666F+\u767D\u5B57)");
      dropdown.addOption("light", "\u4EAE\u8272 (\u6D45\u8272\u80CC\u666F+\u6DF1\u5B57)");
      this.plugin.settings.noteThemes.forEach((theme, index) => {
        dropdown.addOption(`note-${index}`, `\u4FBF\u7B7E\u9884\u8BBE\u8272 ${index + 1}`);
      });
      dropdown.setValue(this.plugin.settings.obsOverlayTheme);
      dropdown.onChange(async (value) => {
        this.plugin.settings.obsOverlayTheme = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u603B\u8BA1\u65F6\u95F4").addToggle((toggle) => toggle.setValue(this.plugin.settings.obsShowTotalTime).onChange(async (v) => {
      this.plugin.settings.obsShowTotalTime = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u4E13\u6CE8\u65F6\u95F4").addToggle((toggle) => toggle.setValue(this.plugin.settings.obsShowFocusTime).onChange(async (v) => {
      this.plugin.settings.obsShowFocusTime = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u6478\u9C7C\u65F6\u95F4").addToggle((toggle) => toggle.setValue(this.plugin.settings.obsShowSlackTime).onChange(async (v) => {
      this.plugin.settings.obsShowSlackTime = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u4ECA\u65E5\u76EE\u6807\u8FDB\u5EA6").addToggle((toggle) => toggle.setValue(this.plugin.settings.obsShowDailyGoal ?? true).onChange(async (v) => {
      this.plugin.settings.obsShowDailyGoal = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u7AE0\u8282\u76EE\u6807\u8FDB\u5EA6").addToggle((toggle) => toggle.setValue(this.plugin.settings.obsShowTodayWords).onChange(async (v) => {
      this.plugin.settings.obsShowTodayWords = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u663E\u793A\u672C\u573A\u51C0\u589E").addToggle((toggle) => toggle.setValue(this.plugin.settings.obsShowSessionWords).onChange(async (v) => {
      this.plugin.settings.obsShowSessionWords = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u590D\u5236\u6570\u636E\u53E0\u52A0\u5C42 URL").setDesc("\u70B9\u51FB\u540E\u590D\u5236 URL\uFF0C\u5728 OBS \u4E2D\u6DFB\u52A0\u300C\u6D4F\u89C8\u5668\u6E90\u300D\u5E76\u7C98\u8D34\u6B64 URL\u3002").addButton((btn) => btn.setButtonText("\u590D\u5236 URL").onClick(() => {
      const url = `http://127.0.0.1:${this.plugin.settings.obsPort}/`;
      navigator.clipboard.writeText(url);
      new import_obsidian7.Notice(`\u5DF2\u590D\u5236: ${url}`);
    }));
  }
  displayLegacyExportSettings(containerEl) {
    containerEl.createEl("h3", { text: "\u6587\u672C\u6587\u4EF6\u5BFC\u51FA (\u517C\u5BB9)" });
    new import_obsidian7.Setting(containerEl).setName("\u542F\u7528\u672C\u5730\u6587\u672C\u6587\u4EF6\u5BFC\u51FA").setDesc("\u5F00\u542F\u540E\uFF0C\u63D2\u4EF6\u5C06\u50CF\u4EE5\u524D\u4E00\u6837\u6BCF\u79D2\u5C06\u4E13\u6CE8\u65F6\u95F4\u3001\u6478\u9C7C\u65F6\u95F4\u7B49\u6570\u636E\u5199\u5165\u7EAF\u6587\u672C\u6587\u4EF6\u4E2D\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.enableLegacyObsExport).onChange(async (value) => {
      this.plugin.settings.enableLegacyObsExport = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian7.Setting(containerEl).setName("\u6570\u636E\u8F93\u51FA\u8DEF\u5F84 (\u7EDD\u5BF9\u8DEF\u5F84)").setDesc("\u8BF7\u586B\u5165\u7EDD\u5BF9\u8DEF\u5F84 (\u4F8B\u5982 D:\\OBS\\Stats)").addText((text) => text.setPlaceholder("\u8BF7\u8F93\u5165\u6587\u4EF6\u5939\u8DEF\u5F84").setValue(this.plugin.settings.obsPath).onChange(async (value) => {
      this.plugin.settings.obsPath = value;
      await this.plugin.saveSettings();
    }));
  }
};

// src/ui/StickyNote.ts
var import_obsidian8 = require("obsidian");
var SaveStickyNoteModal = class extends import_obsidian8.Modal {
  constructor(app, plugin, onSubmit) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "\u4FDD\u5B58\u4FBF\u7B7E\u4E3A\u6587\u4EF6" });
    const activeFile = this.app.workspace.getActiveFile();
    const defaultFolder = activeFile?.parent?.path || "";
    new import_obsidian8.Setting(contentEl).setName("\u6587\u4EF6\u540D").setDesc("\u8F93\u5165\u6587\u4EF6\u540D\uFF08\u65E0\u9700 .md \u540E\u7F00\uFF09").addText((text) => {
      this.fileNameInput = text.inputEl;
      text.setValue(`\u4FBF\u7B7E_${window.moment().format("YYYYMMDD_HHmmss")}`).onChange(() => {
        const fileName = this.fileNameInput.value.trim();
        if (!fileName) {
          this.fileNameInput.style.borderColor = "var(--background-modifier-error)";
        } else {
          this.fileNameInput.style.borderColor = "";
        }
      });
      text.inputEl.style.width = "100%";
      setTimeout(() => {
        const underscoreIndex = text.inputEl.value.indexOf("_");
        if (underscoreIndex > 0) {
          text.inputEl.setSelectionRange(0, underscoreIndex);
        } else {
          text.inputEl.select();
        }
        text.inputEl.focus();
      }, 50);
    });
    new import_obsidian8.Setting(contentEl).setName("\u4FDD\u5B58\u4F4D\u7F6E").setDesc("\u6587\u4EF6\u5939\u8DEF\u5F84\uFF08\u7559\u7A7A\u4FDD\u5B58\u5230\u6839\u76EE\u5F55\uFF09").addText((text) => {
      this.folderPathInput = text.inputEl;
      text.setValue(defaultFolder).setPlaceholder("\u4F8B\u5982: \u6211\u7684\u6587\u4EF6\u5939/\u5B50\u6587\u4EF6\u5939");
      text.inputEl.style.width = "100%";
    });
    contentEl.createEl("p", {
      text: "\u63D0\u793A\uFF1A\u9ED8\u8BA4\u4FDD\u5B58\u5230\u5F53\u524D\u5DE5\u4F5C\u6587\u4EF6\u5939",
      cls: "setting-item-description"
    });
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    buttonContainer.style.display = "flex";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.gap = "10px";
    buttonContainer.style.marginTop = "20px";
    const cancelBtn = buttonContainer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const saveBtn = buttonContainer.createEl("button", {
      text: "\u4FDD\u5B58",
      cls: "mod-cta"
    });
    saveBtn.onclick = () => {
      const fileName = this.fileNameInput.value.trim();
      const folderPath = this.folderPathInput.value.trim();
      if (!fileName) {
        new import_obsidian8.Notice("[\u9519\u8BEF] \u8BF7\u8F93\u5165\u6587\u4EF6\u540D");
        this.fileNameInput.focus();
        return;
      }
      this.onSubmit(fileName, folderPath);
      this.close();
    };
    this.fileNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveBtn.click();
      }
    });
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};
var ConfirmCloseModal = class extends import_obsidian8.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "\u6709\u672A\u4FDD\u5B58\u7684\u66F4\u6539" });
    contentEl.createEl("p", {
      text: "\u4FBF\u7B7E\u5185\u5BB9\u5DF2\u4FEE\u6539\u4F46\u5C1A\u672A\u4FDD\u5B58\uFF0C\u662F\u5426\u8981\u4FDD\u5B58\u66F4\u6539\uFF1F"
    });
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    buttonContainer.style.display = "flex";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.gap = "10px";
    buttonContainer.style.marginTop = "20px";
    const dontSaveBtn = buttonContainer.createEl("button", { text: "\u4E0D\u4FDD\u5B58" });
    dontSaveBtn.onclick = () => {
      this.onSubmit(false);
      this.close();
    };
    const cancelBtn = buttonContainer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const saveBtn = buttonContainer.createEl("button", {
      text: "\u4FDD\u5B58",
      cls: "mod-cta"
    });
    saveBtn.onclick = () => {
      this.onSubmit(true);
      this.close();
    };
    contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};
var FloatingStickyNote = class extends import_obsidian8.Component {
  // ResizeObserver 防抖计时器
  constructor(app, plugin, options) {
    super();
    // 用于检测未保存的更改
    this.lastSavedContent = "";
    // 最后一次保存的内容
    this.resizeObserver = null;
    // ResizeObserver 实例
    this.resizeTimer = null;
    this.app = app;
    this.plugin = plugin;
    if (options.state) {
      this.state = options.state;
      if (!this.state.zoomLevel) this.state.zoomLevel = 1;
      if (!this.state.textColor) this.state.textColor = "#2C3E50";
    } else {
      const themes = this.plugin.settings.noteThemes;
      const themeIndex = (this.plugin.settings.nextNoteThemeIndex || 0) % themes.length;
      const theme = themes[themeIndex];
      this.state = {
        id: Math.random().toString(36).substring(2, 11),
        filePath: options.file?.path,
        content: options.content || "",
        title: options.title || (options.file ? options.file.basename : "\u65B0\u4FBF\u7B7E"),
        top: "150px",
        left: "150px",
        width: "320px",
        height: "450px",
        color: theme.bg,
        textColor: theme.text,
        isEditing: !options.file && !options.content,
        isPinned: false,
        zoomLevel: 1
      };
      this.plugin.settings.nextNoteThemeIndex = (themeIndex + 1) % themes.length;
      this.plugin.saveSettings().catch((err) => {
        console.error("[StickyNote] \u66F4\u65B0\u989C\u8272\u7D22\u5F15\u5931\u8D25:", err);
      });
    }
    this.initialContent = this.state.content || "";
  }
  /**
   * 静默销毁实例（通常由同步逻辑调用）
   * 不触发保存提示，不从 settings 中删除，仅清理 DOM 和监听器
   */
  destroy() {
    this.unload();
  }
  onunload() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.containerEl) {
      this.containerEl.remove();
    }
    const index = this.plugin.activeNotes.indexOf(this);
    if (index !== -1) {
      this.plugin.activeNotes.splice(index, 1);
    }
  }
  async onload() {
    if (!isDesktop()) {
      this.unload();
      return;
    }
    this.plugin.activeNotes.push(this);
    this.injectCSS();
    this.containerEl = document.body.createDiv({ cls: "my-floating-sticky-note" });
    if (this.state.filePath && !this.state.content) {
      const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
      if (file instanceof import_obsidian8.TFile) {
        this.state.content = await this.app.vault.read(file);
      }
    }
    this.lastSavedContent = this.state.content || "";
    this.updateVisuals();
    this.containerEl.addEventListener("wheel", (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const currentZoom = this.state.zoomLevel || 1;
        const zoomStep = 0.1;
        const delta = e.deltaY < 0 ? zoomStep : -zoomStep;
        this.state.zoomLevel = Math.max(0.5, Math.min(4, currentZoom + delta));
        this.updateVisuals();
        this.saveState();
      }
    }, { passive: false });
    this.createHeader();
    await this.renderContent();
    const notes = this.plugin.stickyNoteManager.getNotes();
    if (!notes.find((n) => n.id === this.state.id)) {
      notes.push(this.state);
      this.plugin.stickyNoteManager.saveNotes(notes).catch((err) => {
        console.error("[StickyNote] \u4FDD\u5B58\u4FBF\u7B7E\u5217\u8868\u5931\u8D25:", err);
      });
    }
  }
  createHeader() {
    const headerEl = this.containerEl.createDiv({ cls: "my-sticky-header" });
    const titleWrapper = headerEl.createDiv({ cls: "my-sticky-title-wrapper" });
    const titleIcon = titleWrapper.createSpan({ cls: "my-sticky-title-icon" });
    (0, import_obsidian8.setIcon)(titleIcon, "sticky-note");
    titleWrapper.createSpan({ text: this.state.title || "", cls: "my-sticky-title" });
    const controlsEl = headerEl.createDiv({ cls: "my-sticky-controls" });
    const pinBtn = this.createButton(controlsEl, "pin", this.state.isPinned);
    const saveBtn = this.createButton(controlsEl, "save");
    saveBtn.title = "\u4FDD\u5B58\u4FBF\u7B7E\u5185\u5BB9 (Ctrl+S)";
    saveBtn.style.opacity = "0.5";
    const toggleEditBtn = this.createButton(controlsEl, this.state.isEditing ? "eye" : "pencil");
    const paletteBtn = this.createButton(controlsEl, "palette", false, "palette-btn-target");
    const closeBtn = controlsEl.createEl("button", { cls: "my-sticky-close" });
    (0, import_obsidian8.setIcon)(closeBtn, "x");
    this.contentContainer = this.containerEl.createDiv({ cls: "my-sticky-content markdown-rendered" });
    this.contentContainer.tabIndex = -1;
    this.textareaEl = this.containerEl.createEl("textarea", { cls: "my-sticky-textarea" });
    const stopPropagation = (e) => e.stopPropagation();
    this.textareaEl.addEventListener("keydown", stopPropagation);
    this.textareaEl.addEventListener("keyup", stopPropagation);
    this.textareaEl.addEventListener("keypress", stopPropagation);
    this.textareaEl.addEventListener("focus", () => {
      const activeLeaf = this.app.workspace.activeLeaf;
      if (activeLeaf && activeLeaf.view.getViewType() !== "markdown") {
        const mdLeaves = this.app.workspace.getLeavesOfType("markdown");
        if (mdLeaves.length > 0) {
          this.app.workspace.setActiveLeaf(mdLeaves[0], { focus: false });
        }
      }
    });
    this.textareaEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    this.textareaEl.addEventListener("input", () => {
      const isDirty = this.textareaEl.value !== this.lastSavedContent;
      if (isDirty && !this.plugin.settings.stickyNoteAutoSave) {
        saveBtn.style.opacity = "1";
        saveBtn.style.color = "var(--interactive-accent)";
      } else {
        saveBtn.style.opacity = "0.5";
        saveBtn.style.color = "";
      }
      if (this.plugin.settings.stickyNoteAutoSave) {
        const debounceKey = `save-note-${this.state.id}`;
        this.plugin.adaptiveDebounceManager.debounceFixed(debounceKey, async () => {
          this.state.content = this.textareaEl.value;
          this.saveState();
          if (this.state.filePath) {
            const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
            if (file instanceof import_obsidian8.TFile) {
              await this.app.vault.modify(file, this.state.content || "");
              this.lastSavedContent = this.state.content || "";
            }
          }
          saveBtn.style.opacity = "0.5";
          saveBtn.style.color = "";
        }, 500);
      }
    });
    const popupEl = this.createPalettePopup(controlsEl);
    this.bindHeaderEvents(pinBtn, saveBtn, toggleEditBtn, paletteBtn, closeBtn, popupEl, titleWrapper);
    this.setupDragging(headerEl);
    this.setupResizing();
  }
  createButton(parent, icon, isActive = false, extraClass = "") {
    const btn = parent.createEl("button", { cls: `my-sticky-btn ${extraClass}` });
    (0, import_obsidian8.setIcon)(btn, icon);
    if (isActive) btn.classList.add("is-active");
    return btn;
  }
  createPalettePopup(parent) {
    const popupEl = parent.createDiv({ cls: "my-sticky-palette-popup" });
    this.plugin.settings.noteThemes.forEach((theme) => {
      const swatch = popupEl.createDiv({ cls: "my-sticky-swatch" });
      swatch.style.backgroundColor = theme.bg;
      swatch.style.color = theme.text;
      swatch.innerText = "Aa";
      swatch.onclick = (e) => {
        e.stopPropagation();
        this.state.color = theme.bg;
        this.state.textColor = theme.text;
        this.updateVisuals();
        this.saveState();
        popupEl.classList.remove("is-active");
      };
    });
    this.containerEl.addEventListener("click", (e) => {
      if (!e.target.closest(".my-sticky-palette-popup") && !e.target.closest(".palette-btn-target")) {
        popupEl.classList.remove("is-active");
      }
    });
    return popupEl;
  }
  bindHeaderEvents(pinBtn, saveBtn, toggleEditBtn, paletteBtn, closeBtn, popupEl, titleWrapper) {
    paletteBtn.onclick = (e) => {
      e.stopPropagation();
      popupEl.classList.toggle("is-active");
    };
    pinBtn.onclick = () => {
      this.state.isPinned = !this.state.isPinned;
      pinBtn.classList.toggle("is-active", this.state.isPinned);
      this.updateVisuals();
      this.saveState();
    };
    toggleEditBtn.onclick = async () => {
      if (this.state.isEditing) {
        this.state.content = this.textareaEl.value;
        if (this.state.filePath) {
          const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
          if (file instanceof import_obsidian8.TFile) await this.app.vault.modify(file, this.state.content);
        }
        this.state.isEditing = false;
        (0, import_obsidian8.setIcon)(toggleEditBtn, "pencil");
      } else {
        if (this.state.filePath) {
          const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
          if (file instanceof import_obsidian8.TFile) {
            this.state.content = await this.app.vault.read(file);
          }
        }
        this.state.isEditing = true;
        (0, import_obsidian8.setIcon)(toggleEditBtn, "eye");
      }
      await this.renderContent();
      this.saveState();
      if (this.state.isEditing) {
        requestAnimationFrame(() => {
          this.textareaEl.focus();
        });
      }
    };
    saveBtn.onclick = async () => {
      if (this.state.isEditing) {
        this.state.content = this.textareaEl.value;
      }
      if (this.state.filePath) {
        const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
        if (file instanceof import_obsidian8.TFile) {
          await this.app.vault.modify(file, this.state.content || "");
          this.lastSavedContent = this.state.content || "";
          new import_obsidian8.Notice("[\u6210\u529F] \u4FBF\u7B7E\u5DF2\u540C\u6B65\u81F3\u539F\u6587\u6863");
        }
        return;
      }
      const modal = new SaveStickyNoteModal(this.app, this.plugin, async (fileName, folderPath) => {
        try {
          if (!fileName.endsWith(".md")) {
            fileName += ".md";
          }
          const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
          if (this.app.vault.getAbstractFileByPath(fullPath)) {
            new import_obsidian8.Notice(`[\u9519\u8BEF] \u6587\u4EF6\u5DF2\u5B58\u5728: ${fullPath}`);
            return;
          }
          const file = await this.app.vault.create(fullPath, this.state.content || "");
          this.state.filePath = file.path;
          this.state.title = file.basename;
          this.lastSavedContent = this.state.content || "";
          const titleEl = titleWrapper.querySelector(".my-sticky-title");
          if (titleEl) titleEl.innerText = this.state.title;
          this.saveState();
          new import_obsidian8.Notice(`[\u6210\u529F] \u5DF2\u4FDD\u5B58\u4E3A: ${fullPath}`);
        } catch (error) {
          console.error("\u4FDD\u5B58\u4FBF\u7B7E\u5931\u8D25:", error);
          new import_obsidian8.Notice(`[\u9519\u8BEF] \u4FDD\u5B58\u5931\u8D25: ${error}`);
        }
      });
      modal.open();
    };
    closeBtn.onclick = () => {
      const currentContent = this.state.isEditing ? this.textareaEl.value : this.state.content;
      const hasContent = (currentContent || "").trim().length > 0;
      const hasUnsavedChanges = currentContent !== this.lastSavedContent;
      const shouldPrompt = !this.state.filePath && hasContent || this.state.filePath && hasUnsavedChanges;
      if (shouldPrompt) {
        const modal = new ConfirmCloseModal(this.app, async (shouldSave) => {
          if (shouldSave) {
            if (this.state.isEditing) {
              this.state.content = this.textareaEl.value;
            }
            if (this.state.filePath) {
              const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
              if (file instanceof import_obsidian8.TFile) {
                await this.app.vault.modify(file, this.state.content || "");
                new import_obsidian8.Notice("[\u6210\u529F] \u4FBF\u7B7E\u5DF2\u4FDD\u5B58");
              }
              this.close();
            } else {
              const saveModal = new SaveStickyNoteModal(this.app, this.plugin, async (fileName, folderPath) => {
                try {
                  if (!fileName.endsWith(".md")) {
                    fileName += ".md";
                  }
                  const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
                  if (this.app.vault.getAbstractFileByPath(fullPath)) {
                    new import_obsidian8.Notice(`[\u9519\u8BEF] \u6587\u4EF6\u5DF2\u5B58\u5728: ${fullPath}`);
                    return;
                  }
                  await this.app.vault.create(fullPath, this.state.content || "");
                  new import_obsidian8.Notice(`[\u6210\u529F] \u5DF2\u4FDD\u5B58\u4E3A: ${fullPath}`);
                  this.close();
                } catch (error) {
                  console.error("\u4FDD\u5B58\u4FBF\u7B7E\u5931\u8D25:", error);
                  new import_obsidian8.Notice(`[\u9519\u8BEF] \u4FDD\u5B58\u5931\u8D25: ${error}`);
                }
              });
              saveModal.open();
            }
          } else {
            this.close();
          }
        });
        modal.open();
      } else {
        this.close();
      }
    };
  }
  updateVisuals() {
    this.containerEl.style.top = this.state.top;
    this.containerEl.style.left = this.state.left;
    this.containerEl.style.width = this.state.width;
    this.containerEl.style.height = this.state.height;
    this.containerEl.style.resize = this.state.isPinned ? "none" : "both";
    this.containerEl.style.setProperty("--sticky-zoom", (this.state.zoomLevel || 1).toString());
    const bgWithAlpha = hexToRgba(this.state.color, this.plugin.settings.noteOpacity);
    this.containerEl.style.setProperty("--note-bg-color", this.state.color);
    this.containerEl.style.setProperty("--note-bg-color-alpha", bgWithAlpha);
    this.containerEl.style.setProperty("--note-text-color", this.state.textColor || "#2C3E50");
    this.containerEl.classList.toggle("is-pinned", this.state.isPinned);
  }
  async renderContent() {
    if (this.state.isEditing) {
      this.contentContainer.style.display = "none";
      this.textareaEl.style.display = "block";
      if (document.activeElement !== this.textareaEl) {
        const newContent = this.state.content || "";
        if (this.textareaEl.value !== newContent) {
          this.textareaEl.value = newContent;
        }
      }
    } else {
      this.textareaEl.style.display = "none";
      this.contentContainer.style.display = "block";
      this.contentContainer.empty();
      let text = this.state.content || "";
      if (this.state.filePath) {
        const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
        if (file instanceof import_obsidian8.TFile) text = await this.app.vault.read(file);
      }
      await import_obsidian8.MarkdownRenderer.renderMarkdown(text, this.contentContainer, this.state.filePath || "", this);
    }
  }
  saveState() {
    this.plugin.stickyNoteManager.updateNote(this.state);
    this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes()).catch((err) => {
      console.error("[StickyNote] \u4FDD\u5B58\u72B6\u6001\u5931\u8D25:", err);
    });
  }
  close() {
    this.plugin.stickyNoteManager.removeNote(this.state.id);
    this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes()).catch((err) => {
      console.error("[StickyNote] \u79FB\u9664\u4FBF\u7B7E\u5931\u8D25:", err);
    });
    this.unload();
  }
  setupDragging(handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const onMouseMove = (e) => {
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      this.state.top = this.containerEl.offsetTop - pos2 + "px";
      this.state.left = this.containerEl.offsetLeft - pos1 + "px";
      this.containerEl.style.top = this.state.top;
      this.containerEl.style.left = this.state.left;
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      this.saveState();
    };
    handle.onmousedown = (e) => {
      if (this.state.isPinned) return;
      const target = e.target;
      if (target.tagName === "BUTTON" || target.closest(".my-sticky-btn") || target.closest(".my-sticky-close")) return;
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };
  }
  setupResizing() {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.state.isPinned) return;
      if (this.resizeTimer !== null) {
        window.clearTimeout(this.resizeTimer);
      }
      this.resizeTimer = window.setTimeout(() => {
        this.resizeTimer = null;
        const width = this.containerEl.style.width;
        const height = this.containerEl.style.height;
        if (width && width !== "0px" && height && height !== "0px") {
          this.state.width = width;
          this.state.height = height;
          this.saveState();
        }
      }, 300);
    });
    this.resizeObserver.observe(this.containerEl);
  }
  injectCSS() {
    const styleId = "sticky-note-plugin-styles-v15";
    const styleContent = `
			.my-floating-sticky-note { 
				position: fixed; min-width: 200px; min-height: 200px; 
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
		`;
    injectGlobalStyle(styleId, styleContent);
  }
};

// src/ui/StatusView.ts
var import_obsidian10 = require("obsidian");

// src/ui/HistoryModal.ts
var import_obsidian9 = require("obsidian");
var HistoryStatsModal = class extends import_obsidian9.Modal {
  constructor(app, history) {
    super(app);
    this.currentTab = "7day";
    this.currentMetric = "words";
    this.history = history;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("history-stats-modal");
    this.titleEl = contentEl.createEl("h2", { text: "\u5386\u53F2\u7EDF\u8BA1 - \u5B57\u6570\u7EDF\u8BA1" });
    const tabGroup = contentEl.createDiv({ cls: "stats-tab-group" });
    const tabs = [
      { id: "7day", name: "\u8FD17\u65E5" },
      { id: "day", name: "\u8FD130\u65E5" },
      { id: "week", name: "\u6309\u5468" },
      { id: "month", name: "\u6309\u6708" },
      { id: "year", name: "\u6309\u5E74" }
    ];
    tabs.forEach((tab) => {
      const btn = tabGroup.createEl("button", { text: tab.name, cls: "stats-tab-btn" });
      if (this.currentTab === tab.id) btn.addClass("is-active");
      btn.onclick = () => {
        this.currentTab = tab.id;
        tabGroup.querySelectorAll(".stats-tab-btn").forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        this.renderData();
      };
    });
    const metricGroup = contentEl.createDiv({ cls: "stats-tab-group", attr: { style: "margin-top: 10px;" } });
    const metricTabs = [
      { id: "words", name: "\u5B57\u6570\u7EDF\u8BA1" },
      { id: "totalTime", name: "\u603B\u8BA1\u65F6\u95F4" },
      { id: "focusTime", name: "\u4E13\u6CE8\u65F6\u95F4" },
      { id: "slackTime", name: "\u6478\u9C7C\u65F6\u95F4" }
    ];
    metricTabs.forEach((tab) => {
      const btn = metricGroup.createEl("button", { text: tab.name, cls: "stats-tab-btn" });
      if (this.currentMetric === tab.id) btn.addClass("is-active");
      btn.onclick = () => {
        this.currentMetric = tab.id;
        metricGroup.querySelectorAll(".stats-tab-btn").forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        this.renderData();
      };
    });
    this.chartContainer = contentEl.createDiv({ cls: "stats-large-chart-container" });
    this.renderData();
  }
  renderData() {
    if (this.titleEl) {
      let metricName = "\u5B57\u6570\u7EDF\u8BA1";
      if (this.currentMetric === "totalTime") metricName = "\u603B\u8BA1\u65F6\u95F4";
      else if (this.currentMetric === "focusTime") metricName = "\u4E13\u6CE8\u65F6\u95F4";
      else if (this.currentMetric === "slackTime") metricName = "\u6478\u9C7C\u65F6\u95F4";
      this.titleEl.setText(`\u5386\u53F2\u7EDF\u8BA1 - ${metricName}`);
    }
    this.chartContainer.empty();
    const aggregated = this.aggregateData();
    const keys = Object.keys(aggregated).sort();
    let displayKeys = keys;
    if (this.currentTab === "7day") displayKeys = keys.slice(-7);
    if (this.currentTab === "day") displayKeys = keys.slice(-30);
    if (this.currentTab === "week") displayKeys = keys.slice(-12);
    if (displayKeys.length === 0) {
      this.chartContainer.createDiv({ text: "\u6682\u65E0\u6570\u636E" });
      return;
    }
    const getValue = (data) => {
      if (this.currentMetric === "words") return data.words;
      if (this.currentMetric === "focusTime") return data.focusMs;
      if (this.currentMetric === "slackTime") return data.slackMs;
      if (this.currentMetric === "totalTime") return data.focusMs + data.slackMs;
      return 0;
    };
    const formatDuration = (ms) => {
      const totalMinutes = Math.floor(ms / 6e4);
      if (totalMinutes === 0) return "0m";
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    };
    const maxAbsValue = Math.max(...displayKeys.map((k) => Math.abs(getValue(aggregated[k]))), 1);
    displayKeys.forEach((key, i) => {
      const data = aggregated[key];
      const col = this.chartContainer.createDiv({ cls: "stats-large-col" });
      const val = getValue(data);
      const heightPercent = Math.max(2, Math.abs(val) / maxAbsValue * 100);
      const bar = col.createDiv({ cls: "stats-large-bar" });
      bar.style.height = `${heightPercent}%`;
      let barColor;
      if (val < 0) {
        barColor = "#E74C3C";
      } else {
        const ratio = val / maxAbsValue;
        if (ratio >= 0.8) barColor = "#F5A623";
        else if (ratio >= 0.5) barColor = "#8B5CF6";
        else if (ratio >= 0.2) barColor = "var(--interactive-accent)";
        else barColor = "var(--background-modifier-border)";
      }
      bar.style.background = barColor;
      const totalMs = data.focusMs + data.slackMs;
      bar.setAttribute("title", `\u65F6\u95F4: ${key}
\u603B\u5B57\u6570: ${data.words.toLocaleString()}
\u603B\u8BA1\u65F6\u95F4: ${formatDuration(totalMs)}
\u4E13\u6CE8\u65F6\u95F4: ${formatDuration(data.focusMs)}
\u6478\u9C7C\u65F6\u95F4: ${formatDuration(data.slackMs)}`);
      col.createDiv({ cls: "stats-large-label", text: this.formatLabel(key) });
      let displayStr = "";
      if (this.currentMetric === "words") {
        displayStr = formatCount(val);
      } else {
        displayStr = formatDuration(val);
      }
      const valueEl = col.createDiv({ cls: "stats-large-value", text: displayStr });
      if (val < 0) {
        valueEl.style.color = "#E74C3C";
      }
    });
  }
  aggregateData() {
    const result = {};
    for (const [date, stat] of Object.entries(this.history)) {
      const m = window.moment(date);
      let key = date;
      if (this.currentTab === "7day") {
        key = date;
      } else if (this.currentTab === "week") {
        key = `${m.year()}\u5E74 \u7B2C${m.isoWeek()}\u5468`;
      } else if (this.currentTab === "month") {
        key = m.format("YYYY-MM");
      } else if (this.currentTab === "year") {
        key = m.format("YYYY");
      }
      if (!result[key]) result[key] = { words: 0, focusMs: 0, slackMs: 0 };
      result[key].words += stat.addedWords || 0;
      result[key].focusMs += stat.focusMs || 0;
      result[key].slackMs += stat.slackMs || 0;
    }
    return result;
  }
  formatLabel(key) {
    if (this.currentTab === "7day" || this.currentTab === "day") return key.substring(5);
    if (this.currentTab === "month") return key.substring(2);
    if (this.currentTab === "week") {
      const match = key.match(/第(\d+)周/);
      return match ? `W${match[1]}` : key;
    }
    return key;
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/StatusView.ts
var STATUS_VIEW_TYPE = "writing-status-view";
var WritingStatusView = class extends import_obsidian10.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.chartBarEls = [];
    this.plugin = plugin;
  }
  getViewType() {
    return STATUS_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u5199\u4F5C\u5B9E\u65F6\u72B6\u6001";
  }
  getIcon() {
    return "bar-chart-2";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("status-view-container");
    this.createGoalCard(container);
    this.createTimeCard(container);
    this.createHistoryCard(container);
    this.updateData();
    this.renderChart();
  }
  createGoalCard(container) {
    const goalCard = container.createDiv({ cls: "status-card" });
    const titleRow = goalCard.createDiv({ cls: "status-title" });
    titleRow.createSpan({ text: "\u4ECA\u65E5\u72B6\u6001" });
    if (!isMobile()) {
      this.statusBadgeEl = titleRow.createSpan({ cls: "status-title-badge", text: "\u5DF2\u6682\u505C" });
      this.statusBadgeEl.style.cursor = "pointer";
      this.statusBadgeEl.title = "\u70B9\u51FB\u5F00\u59CB/\u6682\u505C\u7EDF\u8BA1";
      this.statusBadgeEl.addEventListener("click", () => {
        const p = this.plugin;
        if (this.plugin.isTracking) {
          p.stopTracking();
        } else {
          p.startTracking();
        }
      });
    }
    goalCard.createDiv({ cls: "status-goal-label", text: "\u4ECA\u65E5\u76EE\u6807" });
    const dailyRow = goalCard.createDiv({ cls: "goal-display-row-right" });
    this.dailyWordEl = dailyRow.createSpan({ cls: "goal-current", text: "0" });
    dailyRow.createSpan({ cls: "goal-separator", text: " / " });
    this.dailyGoalEl = dailyRow.createSpan({ cls: "goal-target", text: "0" });
    this.dailyPercentEl = dailyRow.createSpan({ cls: "goal-percent", text: "0%" });
    const dailyProgressBg = goalCard.createDiv({ cls: "progress-bar-bg" });
    this.dailyProgressFillEl = dailyProgressBg.createDiv({ cls: "progress-bar-fill" });
    goalCard.createDiv({ cls: "status-goal-label", text: "\u7AE0\u8282\u76EE\u6807" });
    const goalRow = goalCard.createDiv({ cls: "goal-display-row-right" });
    this.todayWordEl = goalRow.createSpan({ cls: "goal-current", text: "0" });
    goalRow.createSpan({ cls: "goal-separator", text: " / " });
    this.goalWordEl = goalRow.createSpan({ cls: "goal-target", text: "0" });
    this.percentEl = goalRow.createSpan({ cls: "goal-percent", text: "0%" });
    const progressBg = goalCard.createDiv({ cls: "progress-bar-bg" });
    this.progressFillEl = progressBg.createDiv({ cls: "progress-bar-fill" });
  }
  createTimeCard(container) {
    if (isMobile()) return;
    const timeCard = container.createDiv({ cls: "status-card" });
    timeCard.createDiv({ cls: "status-title", text: "\u672C\u6B21\u7EDF\u8BA1" });
    const totalBox = timeCard.createDiv({ cls: "time-box time-box-total" });
    totalBox.createDiv({ cls: "time-box-title", text: "\u603B\u8BA1\u8017\u65F6" });
    this.totalTimeEl = totalBox.createDiv({ cls: "time-box-value", text: "00:00:00" });
    const timeGrid = timeCard.createDiv({ cls: "time-grid" });
    const focusBox = timeGrid.createDiv({ cls: "time-box" });
    focusBox.createDiv({ cls: "time-box-title", text: "\u4E13\u6CE8\u65F6\u957F" });
    this.focusTimeEl = focusBox.createDiv({ cls: "time-box-value", text: "00:00:00" });
    const slackBox = timeGrid.createDiv({ cls: "time-box" });
    slackBox.createDiv({ cls: "time-box-title", text: "\u6478\u9C7C\u65F6\u957F" });
    this.slackTimeEl = slackBox.createDiv({ cls: "time-box-value", text: "00:00:00" });
    this.chartContainerEl = timeCard.createDiv({ cls: "history-chart" });
    this.chartContainerEl.createDiv({
      text: "\u8FD17\u65E5\u5B57\u6570\u7EDF\u8BA1",
      cls: "history-chart-title"
    });
    const chartSubtitle = this.chartContainerEl.createDiv({
      text: "\u70B9\u51FB\u67E5\u770B\u8BE6\u60C5",
      cls: "history-chart-subtitle"
    });
    chartSubtitle.setAttribute("aria-label", "\u70B9\u51FB\u8FDB\u5165\u5B57\u6570\u7EDF\u8BA1\u8BE6\u60C5");
    chartSubtitle.onclick = () => {
      new HistoryStatsModal(this.plugin.app, this.plugin.historyManager.getHistory()).open();
    };
    this.chartBarsContainer = this.chartContainerEl.createDiv({
      attr: { style: "display: flex; flex-direction: column; gap: 6px; cursor: pointer;" }
    });
    this.chartBarsContainer.onclick = () => {
      new HistoryStatsModal(this.plugin.app, this.plugin.historyManager.getHistory()).open();
    };
  }
  createHistoryCard(container) {
    const historyCard = container.createDiv({ cls: "status-card" });
    historyCard.createDiv({ cls: "status-title", text: "\u5B57\u6570\u7EDF\u8BA1" });
    const historyGrid = historyCard.createDiv({ cls: "time-grid" });
    const weekBox = historyGrid.createDiv({ cls: "time-box" });
    weekBox.createDiv({ cls: "time-box-title", text: "\u672C\u5468\u51C0\u589E" });
    this.weekWordEl = weekBox.createDiv({ cls: "time-box-value", text: "0" });
    const monthBox = historyGrid.createDiv({ cls: "time-box" });
    monthBox.createDiv({ cls: "time-box-title", text: "\u672C\u6708\u51C0\u589E" });
    this.monthWordEl = monthBox.createDiv({ cls: "time-box-value", text: "0" });
    const yearBox = historyGrid.createDiv({ cls: "time-box" });
    yearBox.createDiv({ cls: "time-box-title", text: "\u4ECA\u5E74\u51C0\u589E" });
    this.yearWordEl = yearBox.createDiv({ cls: "time-box-value", text: "0" });
    const histTotalBox = historyGrid.createDiv({ cls: "time-box" });
    histTotalBox.createDiv({ cls: "time-box-title", text: "\u7D2F\u8BA1\u603B\u5B57\u6570" });
    this.historyTotalWordEl = histTotalBox.createDiv({ cls: "time-box-value", text: "0" });
  }
  updateData() {
    if (!isMobile() && this.statusBadgeEl) {
      if (this.plugin.isTracking) {
        this.statusBadgeEl.innerText = "\u8BB0\u5F55\u4E2D";
        this.statusBadgeEl.style.background = "var(--color-green)";
        this.statusBadgeEl.style.color = "#ffffff";
      } else {
        this.statusBadgeEl.innerText = "\u5DF2\u6682\u505C";
        this.statusBadgeEl.style.background = "var(--text-muted)";
        this.statusBadgeEl.style.color = "#ffffff";
      }
    }
    const today = window.moment().format("YYYY-MM-DD");
    const todayStat = this.plugin.historyManager.getDailyStat(today) || { focusMs: 0, slackMs: 0, addedWords: 0 };
    const dailyAdded = todayStat.addedWords;
    const dailyGoal = this.plugin.settings.dailyGoal || 0;
    this.dailyWordEl.innerText = Math.max(0, dailyAdded).toLocaleString();
    this.dailyGoalEl.innerText = dailyGoal.toLocaleString();
    let dailyPercent = 0;
    if (dailyAdded < 0) {
      dailyPercent = dailyGoal > 0 ? Math.round(dailyAdded / dailyGoal * 100) : 0;
    } else {
      dailyPercent = dailyGoal > 0 ? Math.min(Math.round(dailyAdded / dailyGoal * 100), 100) : 0;
    }
    this.dailyPercentEl.innerText = ` ${dailyPercent}%`;
    const dailyProgressWidth = Math.max(0, dailyPercent);
    this.dailyProgressFillEl.style.width = `${dailyProgressWidth}%`;
    const dailyDone = dailyGoal > 0 && dailyAdded >= dailyGoal;
    if (dailyAdded < 0) {
      this.dailyProgressFillEl.style.background = "#E74C3C";
      this.dailyWordEl.style.color = "#E74C3C";
      this.dailyPercentEl.style.color = "#E74C3C";
    } else if (dailyDone) {
      this.dailyProgressFillEl.style.background = "#F5A623";
      this.dailyWordEl.style.color = "#F5A623";
      this.dailyPercentEl.style.color = "#F5A623";
    } else {
      this.dailyProgressFillEl.style.background = "var(--background-modifier-border)";
      this.dailyWordEl.style.color = "var(--text-normal)";
      this.dailyPercentEl.style.color = "var(--interactive-accent)";
    }
    let targetGoal = this.plugin.settings.defaultGoal;
    const view = this.plugin.app.workspace.getActiveViewOfType(import_obsidian10.MarkdownView);
    let chapterWords = 0;
    if (view?.file) {
      const cache = this.plugin.app.metadataCache.getFileCache(view.file);
      const fmGoal = parseInt(cache?.frontmatter?.["word-goal"]);
      if (!isNaN(fmGoal)) targetGoal = fmGoal;
      chapterWords = this.plugin.calculateAccurateWords(view.getViewData());
    }
    this.todayWordEl.innerText = chapterWords.toLocaleString();
    this.goalWordEl.innerText = targetGoal.toLocaleString();
    const percent = targetGoal > 0 ? Math.min(Math.round(chapterWords / targetGoal * 100), 100) : 0;
    this.percentEl.innerText = ` ${percent}%`;
    this.progressFillEl.style.width = `${percent}%`;
    const chapterDone = targetGoal > 0 && chapterWords >= targetGoal;
    this.progressFillEl.style.background = chapterDone ? "#8B5CF6" : "var(--background-modifier-border)";
    this.todayWordEl.style.color = chapterDone ? "#8B5CF6" : "var(--text-normal)";
    if (!isMobile()) {
      const focusSec = Math.floor(this.plugin.focusMs / 1e3);
      const slackSec = Math.floor(this.plugin.slackMs / 1e3);
      const totalSec = focusSec + slackSec;
      if (this.focusTimeEl) this.focusTimeEl.innerText = formatTime(focusSec);
      if (this.slackTimeEl) this.slackTimeEl.innerText = formatTime(slackSec);
      if (this.totalTimeEl) this.totalTimeEl.innerText = formatTime(totalSec);
    }
    this.updateWordStats();
  }
  updateWordStats() {
    let weekWords = 0;
    let monthWords = 0;
    let yearWords = 0;
    let totalWords = 0;
    const now = window.moment();
    for (const [dateStr, stat] of Object.entries(this.plugin.historyManager.getHistory())) {
      const dailyAdded = stat.addedWords || 0;
      totalWords += dailyAdded;
      const dateMoment = window.moment(dateStr);
      if (dateMoment.isSame(now, "isoWeek")) weekWords += dailyAdded;
      if (dateMoment.isSame(now, "month")) monthWords += dailyAdded;
      if (dateMoment.isSame(now, "year")) yearWords += dailyAdded;
    }
    if (this.weekWordEl) this.weekWordEl.innerText = weekWords.toLocaleString();
    if (this.monthWordEl) this.monthWordEl.innerText = monthWords.toLocaleString();
    if (this.yearWordEl) this.yearWordEl.innerText = yearWords.toLocaleString();
    if (this.historyTotalWordEl) this.historyTotalWordEl.innerText = totalWords.toLocaleString();
  }
  renderChart() {
    const history = this.plugin.historyManager.getHistory();
    const dates = Object.keys(history).sort().slice(-7);
    if (dates.length === 0) {
      this.chartBarsContainer.empty();
      this.chartBarsContainer.createDiv({
        text: "\u6682\u65E0\u5386\u53F2\u6570\u636E",
        attr: { style: "color: var(--text-muted); font-size: 0.8em; padding: 10px 0;" }
      });
      this.chartBarEls = [];
      return;
    }
    if (this.chartBarEls.length !== dates.length) {
      this.chartBarsContainer.empty();
      this.chartBarEls = [];
      for (let i = 0; i < dates.length; i++) {
        const row = this.chartBarsContainer.createDiv({
          attr: { style: "display: flex; align-items: center; gap: 8px;" }
        });
        const dateEl = row.createDiv({
          attr: { style: "font-size: 0.7em; color: var(--text-muted); min-width: 35px; text-align: right; flex-shrink: 0;" }
        });
        const barContainer = row.createDiv({
          attr: { style: "flex: 1; height: 18px; background: var(--background-modifier-border); border-radius: 3px; overflow: hidden; position: relative; min-width: 0;" }
        });
        const barEl = barContainer.createDiv({
          attr: { style: `height: 100%; border-radius: 3px; transition: width 0.4s ease;` }
        });
        const valueEl = row.createDiv({
          attr: { style: `font-size: 0.75em; font-weight: bold; font-family: var(--font-monospace); min-width: 40px; text-align: right; flex-shrink: 0;` }
        });
        this.chartBarEls.push({ container: row, dateEl, barEl, valueEl });
      }
    }
    const maxAbsWords = Math.max(...dates.map((d) => Math.abs(history[d].addedWords)), 100);
    dates.forEach((date, index) => {
      const stat = history[date];
      const words = stat.addedWords;
      const els = this.chartBarEls[index];
      const shortDate = date.substring(5);
      if (els.dateEl.innerText !== shortDate) els.dateEl.innerText = shortDate;
      const barWidthPercent = Math.max(2, Math.abs(words) / maxAbsWords * 100);
      const barColor = words >= 0 ? "var(--interactive-accent)" : "#E74C3C";
      els.barEl.style.width = `${barWidthPercent}%`;
      els.barEl.style.background = barColor;
      const focusHours = (stat.focusMs / 36e5).toFixed(1);
      els.barEl.setAttribute("title", `\u65E5\u671F: ${date}
\u5B57\u6570: ${words}
\u4E13\u6CE8\u65F6\u957F: ${focusHours}h`);
      const formattedWords = formatCount(words);
      if (els.valueEl.innerText !== formattedWords) {
        els.valueEl.innerText = formattedWords;
        if (words < 0) {
          els.valueEl.style.color = "#E74C3C";
        } else {
          els.valueEl.style.color = "";
        }
      }
    });
  }
  async onClose() {
  }
};

// src/ui/ForeshadowingView.ts
var import_obsidian13 = require("obsidian");

// src/ui/ForeshadowingModal.ts
var import_obsidian11 = require("obsidian");
var ForeshadowingInputModal = class extends import_obsidian11.Modal {
  constructor(app, plugin, sourceFileName, selectedContent, onSubmit) {
    super(app);
    this.plugin = plugin;
    this.sourceFileName = sourceFileName;
    this.selectedContent = selectedContent;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("foreshadowing-input-modal");
    contentEl.createEl("h2", { text: "\u6807\u6CE8\u4E3A\u4F0F\u7B14" });
    const infoEl = contentEl.createDiv({ cls: "foreshadowing-info" });
    infoEl.createEl("div", {
      text: `\u6765\u6E90\uFF1A${this.sourceFileName}`,
      cls: "foreshadowing-source"
    });
    const preview = this.selectedContent.length > 80 ? this.selectedContent.slice(0, 80) + "\u2026" : this.selectedContent;
    infoEl.createEl("div", {
      text: `\u5185\u5BB9\uFF1A\u300C${preview}\u300D`,
      cls: "foreshadowing-preview"
    });
    new import_obsidian11.Setting(contentEl).setName("\u8865\u5145\u8BF4\u660E").setDesc("\u8BF7\u8F93\u5165\u4F0F\u7B14\u7684\u8BF4\u660E\u4FE1\u606F\uFF08\u5FC5\u586B\uFF09");
    this.descriptionEl = contentEl.createEl("textarea", {
      cls: "foreshadowing-description",
      placeholder: "\u4F8B\u5982\uFF1A\u8FD9\u662F\u4E3B\u89D2\u8EAB\u4E16\u7684\u4F0F\u7B14\uFF0C\u5C06\u5728\u7B2C\u5341\u7AE0\u63ED\u6653..."
    });
    this.descriptionEl.style.cssText = "width:100%;height:80px;resize:vertical;margin-bottom:12px;padding:8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);font-family:var(--font-text);";
    new import_obsidian11.Setting(contentEl).setName("\u6807\u7B7E\uFF08\u53EF\u9009\uFF09").setDesc("\u591A\u4E2A\u6807\u7B7E\u7528\u7A7A\u683C\u5206\u9694\uFF0C\u65E0\u9700\u52A0 #");
    this.tagsEl = contentEl.createEl("input", {
      type: "text",
      placeholder: "\u4F8B\u5982\uFF1A\u4EBA\u7269 \u60C5\u8282 \u4E16\u754C\u89C2",
      cls: "foreshadowing-tags-input"
    });
    this.tagsEl.style.cssText = "width:100%;margin-bottom:8px;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);";
    const defaultTags = this.plugin.settings.foreshadowing?.defaultTags || ["\u4EBA\u7269", "\u60C5\u8282", "\u4E16\u754C\u89C2", "\u9053\u5177", "\u4F0F\u7EBF"];
    if (defaultTags.length > 0) {
      const tagBtnContainer = contentEl.createDiv({ cls: "foreshadowing-tag-buttons" });
      tagBtnContainer.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;";
      for (const tag of defaultTags) {
        const btn = tagBtnContainer.createEl("button", { text: `#${tag}` });
        btn.style.cssText = "padding:2px 10px;border-radius:12px;border:1px solid var(--interactive-accent);color:var(--interactive-accent);background:transparent;cursor:pointer;font-size:0.85em;";
        btn.onclick = () => {
          const current = this.tagsEl.value.trim();
          const existing = current ? current.split(/\s+/) : [];
          if (!existing.includes(tag)) {
            this.tagsEl.value = [...existing, tag].join(" ");
          }
        };
      }
    }
    const btnContainer = contentEl.createDiv();
    btnContainer.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:8px;";
    const cancelBtn = btnContainer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const confirmBtn = btnContainer.createEl("button", { text: "\u786E\u8BA4\u6807\u6CE8", cls: "mod-cta" });
    confirmBtn.onclick = () => this.submit();
    setTimeout(() => this.descriptionEl.focus(), 50);
    contentEl.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this.submit();
      }
    });
  }
  submit() {
    const description = this.descriptionEl.value.trim();
    if (!description) {
      this.descriptionEl.style.borderColor = "var(--background-modifier-error)";
      new import_obsidian11.Notice("[\u9519\u8BEF] \u8BF7\u586B\u5199\u8865\u5145\u8BF4\u660E");
      this.descriptionEl.focus();
      return;
    }
    const tagsRaw = this.tagsEl.value.trim();
    const tags = tagsRaw ? tagsRaw.split(/\s+/).filter(Boolean) : [];
    this.onSubmit(description, tags);
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ChapterMultiSelectModal = class extends import_obsidian11.Modal {
  constructor(app, chapters, onSubmit) {
    super(app);
    this.selectedChapters = /* @__PURE__ */ new Set();
    this.chapters = chapters;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "\u9009\u62E9\u56DE\u6536\u7AE0\u8282" });
    contentEl.createEl("p", {
      text: "\u53EF\u4EE5\u9009\u62E9\u591A\u4E2A\u7AE0\u8282\uFF08\u652F\u6301\u4E00\u4E2A\u4F0F\u7B14\u5728\u591A\u4E2A\u7AE0\u8282\u4E2D\u56DE\u6536\uFF09",
      cls: "setting-item-description"
    });
    const searchInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "\u641C\u7D22\u7AE0\u8282..."
    });
    searchInput.style.cssText = "width:100%;margin-bottom:12px;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);";
    this.listEl = contentEl.createDiv({ cls: "chapter-multi-select-list" });
    this.listEl.style.cssText = "max-height:300px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:4px;margin-bottom:12px;";
    this.renderChapterList(this.chapters);
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase();
      const filtered = this.chapters.filter((ch) => ch.toLowerCase().includes(query));
      this.renderChapterList(filtered);
    });
    const selectedEl = contentEl.createDiv({ cls: "selected-chapters" });
    selectedEl.style.cssText = "margin-bottom:12px;padding:8px;background:var(--background-secondary);border-radius:4px;min-height:30px;";
    const updateSelected = () => {
      selectedEl.empty();
      if (this.selectedChapters.size === 0) {
        selectedEl.createSpan({ text: "\u672A\u9009\u62E9\u7AE0\u8282", cls: "setting-item-description" });
      } else {
        selectedEl.createSpan({ text: `\u5DF2\u9009\u62E9 ${this.selectedChapters.size} \u4E2A\u7AE0\u8282\uFF1A`, cls: "setting-item-description" });
        selectedEl.createEl("br");
        Array.from(this.selectedChapters).forEach((ch) => {
          const tag = selectedEl.createSpan({ text: ch, cls: "tag" });
          tag.style.cssText = "display:inline-block;margin:4px 4px 0 0;padding:2px 8px;background:var(--interactive-accent);color:var(--text-on-accent);border-radius:12px;font-size:0.9em;";
        });
      }
    };
    const btnContainer = contentEl.createDiv();
    btnContainer.style.cssText = "display:flex;justify-content:flex-end;gap:10px;";
    const cancelBtn = btnContainer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const confirmBtn = btnContainer.createEl("button", { text: "\u786E\u8BA4", cls: "mod-cta" });
    confirmBtn.onclick = () => {
      if (this.selectedChapters.size === 0) {
        new import_obsidian11.Notice("[\u9519\u8BEF] \u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u7AE0\u8282");
        return;
      }
      this.onSubmit(Array.from(this.selectedChapters));
      this.close();
    };
    updateSelected();
    this.listEl.addEventListener("change", () => updateSelected());
  }
  renderChapterList(chapters) {
    this.listEl.empty();
    chapters.forEach((chapter) => {
      const item = this.listEl.createDiv({ cls: "chapter-item" });
      item.style.cssText = "padding:8px 12px;border-bottom:1px solid var(--background-modifier-border);cursor:pointer;display:flex;align-items:center;gap:8px;";
      const checkbox = item.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selectedChapters.has(chapter);
      checkbox.style.cssText = "cursor:pointer;";
      const label = item.createSpan({ text: chapter });
      label.style.cssText = "flex:1;cursor:pointer;";
      const toggle = () => {
        if (this.selectedChapters.has(chapter)) {
          this.selectedChapters.delete(chapter);
          checkbox.checked = false;
        } else {
          this.selectedChapters.add(chapter);
          checkbox.checked = true;
        }
        this.listEl.dispatchEvent(new Event("change"));
      };
      checkbox.addEventListener("change", toggle);
      label.addEventListener("click", toggle);
      item.addEventListener("click", (e) => {
        if (e.target !== checkbox && e.target !== label) toggle();
      });
    });
    if (chapters.length === 0) {
      this.listEl.createDiv({ text: "\u6CA1\u6709\u627E\u5230\u5339\u914D\u7684\u7AE0\u8282", cls: "setting-item-description" }).style.padding = "12px";
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ForeshadowingRecoveryModal = class extends import_obsidian11.Modal {
  constructor(app, contentPreview, folderPath, onSubmit) {
    super(app);
    this.chapters = [];
    this.contentPreview = contentPreview;
    this.folderPath = folderPath;
    this.onSubmit = onSubmit;
    const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
    if (folder && "children" in folder) {
      folder.children.forEach((child) => {
        if (child.extension === "md") this.chapters.push(child.basename);
      });
      this.chapters.sort((a, b) => a.localeCompare(b, "zh-CN"));
    }
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "\u6807\u8BB0\u4F0F\u7B14\u5DF2\u56DE\u6536" });
    const preview = this.contentPreview.length > 60 ? this.contentPreview.slice(0, 60) + "\u2026" : this.contentPreview;
    contentEl.createEl("p", {
      text: `\u4F0F\u7B14\uFF1A\u300C${preview}\u300D`,
      cls: "foreshadowing-preview"
    });
    new import_obsidian11.Setting(contentEl).setName("\u56DE\u6536\u7AE0\u8282").setDesc("\u8F93\u5165\u5B8C\u6210\u56DE\u6536\u7684\u7AE0\u8282\u6587\u4EF6\u540D\uFF08\u65E0\u9700 .md \u540E\u7F00\uFF09\uFF0C\u591A\u4E2A\u7AE0\u8282\u7528\u9017\u53F7\u6216\u7A7A\u683C\u5206\u9694");
    this.inputEl = contentEl.createEl("input", {
      type: "text",
      placeholder: "\u4F8B\u5982\uFF1A\u7B2C\u5341\u7AE0, \u7B2C\u5341\u4E00\u7AE0"
    });
    this.inputEl.style.cssText = "width:100%;margin-bottom:8px;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);";
    if (this.chapters.length > 0) {
      const btnRow = contentEl.createDiv();
      btnRow.style.cssText = "display:flex;gap:8px;margin-bottom:12px;";
      const selectBtn = btnRow.createEl("button", { text: "\u4ECE\u5217\u8868\u9009\u62E9\uFF08\u652F\u6301\u591A\u9009\uFF09" });
      selectBtn.style.cssText = "flex:1;padding:6px 12px;border-radius:4px;border:1px solid var(--interactive-accent);color:var(--interactive-accent);background:transparent;cursor:pointer;";
      selectBtn.onclick = () => {
        this.close();
        new ChapterMultiSelectModal(this.app, this.chapters, (selectedChapters) => {
          this.onSubmit(selectedChapters);
        }).open();
      };
      const hint = contentEl.createEl("p", {
        text: `\u63D0\u793A\uFF1A\u5F53\u524D\u6587\u4EF6\u5939\u6709 ${this.chapters.length} \u4E2A\u7AE0\u8282\u6587\u4EF6`,
        cls: "setting-item-description"
      });
      hint.style.marginBottom = "12px";
    }
    const btnContainer = contentEl.createDiv();
    btnContainer.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:16px;";
    const cancelBtn = btnContainer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const confirmBtn = btnContainer.createEl("button", { text: "\u786E\u8BA4\u56DE\u6536", cls: "mod-cta" });
    confirmBtn.onclick = () => this.submit();
    setTimeout(() => this.inputEl.focus(), 50);
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      }
    });
  }
  submit() {
    const value = this.inputEl.value.trim().replace(/\.md$/gi, "");
    if (!value) {
      this.inputEl.style.borderColor = "var(--background-modifier-error)";
      new import_obsidian11.Notice("[\u9519\u8BEF] \u8BF7\u8F93\u5165\u56DE\u6536\u7AE0\u8282\u540D");
      this.inputEl.focus();
      return;
    }
    const chapters = value.split(/[,，\s]+/).filter(Boolean).map((ch) => ch.trim());
    this.onSubmit(chapters);
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConfirmCreateForeshadowingFileModal = class extends import_obsidian11.Modal {
  constructor(app, fileName, folderPath, onConfirm) {
    super(app);
    this.fileName = fileName;
    this.folderPath = folderPath;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "\u521B\u5EFA\u4F0F\u7B14\u6587\u4EF6" });
    const location = this.folderPath ? `\u300C${this.folderPath}/${this.fileName}.md\u300D` : `\u300C${this.fileName}.md\u300D`;
    contentEl.createEl("p", {
      text: `\u5F53\u524D\u6587\u4EF6\u5939\u4E0B\u4E0D\u5B58\u5728 ${location}\uFF0C\u662F\u5426\u521B\u5EFA\uFF1F`
    });
    const btnContainer = contentEl.createDiv();
    btnContainer.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:20px;";
    const cancelBtn = btnContainer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const confirmBtn = btnContainer.createEl("button", { text: "\u521B\u5EFA\u5E76\u7EE7\u7EED", cls: "mod-cta" });
    confirmBtn.onclick = () => {
      this.onConfirm();
      this.close();
    };
    contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.onConfirm();
        this.close();
      }
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/CreativeView.ts
var import_obsidian12 = require("obsidian");
var CreativeView = class extends import_obsidian12.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.currentFolder = "";
    this.plugin = plugin;
  }
  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.onActiveFileChange())
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        const watchName = this.getWatchFileName() + ".md";
        if (file instanceof import_obsidian12.TFile && file.name === watchName) {
          this.refresh();
        }
      })
    );
    await this.onActiveFileChange();
  }
  async onActiveFileChange() {
    const activeFile = this.app.workspace.getActiveViewOfType(import_obsidian12.MarkdownView)?.file;
    if (!activeFile) return;
    const folder = activeFile.parent?.path || "";
    if (folder !== this.currentFolder) {
      this.currentFolder = folder;
      await this.onFolderChange();
    }
  }
  /**
   * 文件夹切换时的钩子，子类可覆盖
   * 默认行为是刷新面板
   */
  async onFolderChange() {
    await this.refresh();
  }
  async onClose() {
  }
};

// src/ui/ForeshadowingView.ts
var FORESHADOWING_VIEW_TYPE = "foreshadowing-view";
var ForeshadowingView = class extends CreativeView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
    this.filterStatus = "all";
  }
  getViewType() {
    return FORESHADOWING_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u4F0F\u7B14";
  }
  getIcon() {
    return "bookmark";
  }
  getWatchFileName() {
    return this.plugin.settings.foreshadowing?.fileName || "\u4F0F\u7B14";
  }
  async refresh() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("foreshadowing-view-container");
    const header = container.createDiv({ cls: "foreshadowing-view-header" });
    const titleRow = header.createDiv({ cls: "foreshadowing-view-title-row" });
    titleRow.createSpan({ text: "\u4F0F\u7B14", cls: "foreshadowing-view-title" });
    const folderLabel = header.createDiv({ cls: "foreshadowing-view-folder" });
    folderLabel.setText(this.currentFolder || "\u6839\u76EE\u5F55");
    const filterRow = header.createDiv({ cls: "foreshadowing-view-filter-row" });
    const filters = [
      { label: "\u5168\u90E8", value: "all" },
      { label: "\u672A\u56DE\u6536", value: "\u672A\u56DE\u6536" /* Pending */ },
      { label: "\u5DF2\u56DE\u6536", value: "\u5DF2\u56DE\u6536" /* Recovered */ },
      { label: "\u5DF2\u5E9F\u5F03", value: "\u5DF2\u5E9F\u5F03" /* Deprecated */ }
    ];
    filters.forEach((f) => {
      const btn = filterRow.createEl("button", { text: f.label, cls: "foreshadowing-filter-btn" });
      if (this.filterStatus === f.value) btn.addClass("is-active");
      btn.onclick = () => {
        this.filterStatus = f.value;
        this.refresh();
      };
    });
    const entries = await this.loadEntries();
    if (entries === null) {
      const empty = container.createDiv({ cls: "foreshadowing-view-empty" });
      empty.createEl("p", { text: "\u5F53\u524D\u6587\u4EF6\u5939\u4E0B\u6CA1\u6709\u4F0F\u7B14\u6587\u4EF6" });
      const fileName = this.plugin.settings.foreshadowing?.fileName || "\u4F0F\u7B14";
      empty.createEl("p", { text: `\uFF08${fileName}.md\uFF09`, cls: "foreshadowing-view-hint" });
      return;
    }
    const filtered = this.filterStatus === "all" ? entries : entries.filter((e) => e.status === this.filterStatus);
    if (filtered.length === 0) {
      container.createDiv({ cls: "foreshadowing-view-empty", text: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u4F0F\u7B14" });
      return;
    }
    const groups = [
      { status: "\u672A\u56DE\u6536" /* Pending */, label: "\u672A\u56DE\u6536", items: [] },
      { status: "\u5DF2\u56DE\u6536" /* Recovered */, label: "\u5DF2\u56DE\u6536", items: [] },
      { status: "\u5DF2\u5E9F\u5F03" /* Deprecated */, label: "\u5DF2\u5E9F\u5F03", items: [] }
    ];
    filtered.forEach((e) => {
      const g = groups.find((g2) => g2.status === e.status);
      if (g) g.items.push(e);
    });
    const list = container.createDiv({ cls: "foreshadowing-view-list" });
    groups.forEach((group) => {
      if (group.items.length === 0) return;
      const groupHeader = list.createDiv({ cls: "foreshadowing-group-header" });
      groupHeader.createSpan({ text: `${group.label}`, cls: "foreshadowing-group-label" });
      groupHeader.createSpan({ text: `${group.items.length}`, cls: "foreshadowing-group-count" });
      group.items.forEach((entry) => this.renderEntry(list, entry));
    });
  }
  renderEntry(container, entry) {
    const card = container.createDiv({ cls: `foreshadowing-entry-card status-${entry.status === "\u672A\u56DE\u6536" /* Pending */ ? "pending" : entry.status === "\u5DF2\u56DE\u6536" /* Recovered */ ? "recovered" : "deprecated"}` });
    const descRow = card.createDiv({ cls: "foreshadowing-entry-desc" });
    descRow.createSpan({ text: entry.description, cls: "foreshadowing-entry-desc-text" });
    const quotesEl = card.createDiv({ cls: "foreshadowing-entry-quotes" });
    entry.contents.forEach((c) => {
      const quoteEl = quotesEl.createDiv({ cls: "foreshadowing-entry-quote" });
      if (c.source || c.time) {
        quoteEl.createDiv({
          text: `${c.source ? `[[${c.source}]]` : ""}${c.time ? ` \xB7 ${c.time}` : ""}`,
          cls: "foreshadowing-entry-quote-meta"
        });
      }
      quoteEl.createDiv({ text: c.text, cls: "foreshadowing-entry-quote-text" });
    });
    const footer = card.createDiv({ cls: "foreshadowing-entry-footer" });
    if (entry.tags.length > 0) {
      const tagsEl = footer.createDiv({ cls: "foreshadowing-entry-tags" });
      entry.tags.forEach((tag) => {
        tagsEl.createSpan({ text: `#${tag}`, cls: "foreshadowing-entry-tag" });
      });
    }
    const actions = footer.createDiv({ cls: "foreshadowing-entry-actions" });
    const jumpBtn = actions.createEl("button", { text: "\u8DF3\u8F6C", cls: "foreshadowing-action-btn" });
    jumpBtn.onclick = async (e) => {
      const sources = entry.contents.filter((c) => c.source).map((c) => c.source);
      if (!sources.includes(entry.sourceFile)) sources.unshift(entry.sourceFile);
      if (sources.length <= 1) {
        const target = sources[0] || entry.sourceFile;
        const file = this.app.vault.getMarkdownFiles().find((f) => f.basename === target);
        if (file) {
          await this.app.workspace.getLeaf(false).openFile(file);
        } else {
          new import_obsidian13.Notice(`\u627E\u4E0D\u5230\u6587\u4EF6\uFF1A${target}`);
        }
      } else {
        const menu = new import_obsidian13.Menu();
        for (const source of sources) {
          menu.addItem((item) => {
            item.setTitle(source).onClick(async () => {
              const file = this.app.vault.getMarkdownFiles().find((f) => f.basename === source);
              if (file) {
                await this.app.workspace.getLeaf(false).openFile(file);
              } else {
                new import_obsidian13.Notice(`\u627E\u4E0D\u5230\u6587\u4EF6\uFF1A${source}`);
              }
            });
          });
        }
        menu.showAtMouseEvent(e);
      }
    };
    if (entry.status === "\u672A\u56DE\u6536" /* Pending */) {
      const recoverBtn = actions.createEl("button", { text: "\u6807\u8BB0\u56DE\u6536", cls: "foreshadowing-action-btn foreshadowing-recover-btn" });
      recoverBtn.onclick = () => {
        const foreshadowingFile = this.getForeshadowingFile();
        if (!foreshadowingFile) return;
        new ForeshadowingRecoveryModal(
          this.app,
          entry.contents[0]?.text || "",
          this.currentFolder,
          async (recoveryFileNames) => {
            const success = await this.plugin.foreshadowingManager.markAsRecovered(
              foreshadowingFile,
              entry.sourceFile,
              entry.createdAt,
              recoveryFileNames
            );
            if (success) {
              const fileList = recoveryFileNames.map((f) => `[[${f}]]`).join("\u3001");
              new import_obsidian13.Notice(`[\u6210\u529F] \u5DF2\u6807\u8BB0\u4E3A\u56DE\u6536\uFF1A${fileList}`);
              setTimeout(() => this.refresh(), 100);
            } else {
              new import_obsidian13.Notice("[\u9519\u8BEF] \u6807\u8BB0\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u4F0F\u7B14\u6587\u4EF6");
            }
          }
        ).open();
      };
      const deprecateBtn = actions.createEl("button", { text: "\u5E9F\u5F03", cls: "foreshadowing-action-btn foreshadowing-deprecate-btn" });
      deprecateBtn.onclick = async () => {
        const foreshadowingFile = this.getForeshadowingFile();
        if (!foreshadowingFile) return;
        const success = await this.plugin.foreshadowingManager.markAsDeprecated(
          foreshadowingFile,
          entry.sourceFile,
          entry.createdAt
        );
        if (success) {
          new import_obsidian13.Notice("\u5DF2\u6807\u8BB0\u4E3A\u5E9F\u5F03");
          setTimeout(() => this.refresh(), 100);
        } else {
          new import_obsidian13.Notice("[\u9519\u8BEF] \u64CD\u4F5C\u5931\u8D25");
        }
      };
    }
    if (entry.status === "\u5DF2\u5E9F\u5F03" /* Deprecated */) {
      const restoreBtn = actions.createEl("button", { text: "\u6062\u590D", cls: "foreshadowing-action-btn" });
      restoreBtn.onclick = async () => {
        const foreshadowingFile = this.getForeshadowingFile();
        if (!foreshadowingFile) return;
        const success = await this.plugin.foreshadowingManager.markAsPending(
          foreshadowingFile,
          entry.sourceFile,
          entry.createdAt
        );
        if (success) {
          new import_obsidian13.Notice("\u5DF2\u6062\u590D\u4E3A\u672A\u56DE\u6536");
          setTimeout(() => this.refresh(), 100);
        } else {
          new import_obsidian13.Notice("[\u9519\u8BEF] \u64CD\u4F5C\u5931\u8D25");
        }
      };
    }
    if (entry.status === "\u5DF2\u56DE\u6536" /* Recovered */) {
      const recoveryEl = card.createDiv({ cls: "foreshadowing-entry-recovery" });
      recoveryEl.createSpan({ text: "\u56DE\u6536\u4E8E\uFF1A", cls: "foreshadowing-entry-recovery-label" });
      if (entry.recoveryFiles && entry.recoveryFiles.length > 0) {
        entry.recoveryFiles.forEach((file, index) => {
          if (index > 0) recoveryEl.createSpan({ text: "\u3001" });
          const recoveryLink = recoveryEl.createEl("a", { text: file, cls: "foreshadowing-entry-recovery-link" });
          recoveryLink.onclick = async () => {
            const targetFile = this.app.vault.getMarkdownFiles().find((f) => f.basename === file);
            if (targetFile) await this.app.workspace.getLeaf(false).openFile(targetFile);
          };
        });
      } else if (entry.recoveryFile) {
        const recoveryLink = recoveryEl.createEl("a", { text: entry.recoveryFile, cls: "foreshadowing-entry-recovery-link" });
        recoveryLink.onclick = async () => {
          const file = this.app.vault.getMarkdownFiles().find((f) => f.basename === entry.recoveryFile);
          if (file) await this.app.workspace.getLeaf(false).openFile(file);
        };
      }
    }
  }
  getForeshadowingFile() {
    return this.plugin.foreshadowingManager.getForeshadowingFileByFolder(this.currentFolder);
  }
  async loadEntries() {
    const file = this.getForeshadowingFile();
    if (!file) return null;
    const content = await this.app.vault.read(file);
    return this.plugin.foreshadowingManager.parseEntries(content);
  }
};

// src/ui/TimelineView.ts
var import_obsidian15 = require("obsidian");

// src/services/TimelineManager.ts
var import_obsidian14 = require("obsidian");
var TimelineManager = class {
  constructor(app, plugin, currentFolder = "") {
    this.app = app;
    this.plugin = plugin;
    this.currentFolder = currentFolder;
  }
  getTimelineFilePath() {
    const fileName = (this.plugin.settings.timeline?.fileName || "\u65F6\u95F4\u7EBF") + ".md";
    return this.currentFolder ? `${this.currentFolder}/${fileName}` : fileName;
  }
  getTimelineFile() {
    const path = this.getTimelineFilePath();
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof import_obsidian14.TFile ? file : null;
  }
  async createTimelineFile() {
    const path = this.getTimelineFilePath();
    return await this.app.vault.create(path, "");
  }
  async loadEntries() {
    const file = this.getTimelineFile();
    if (!file) return null;
    const content = await this.app.vault.read(file);
    return this.parseEntries(content);
  }
  parseEntries(content) {
    const entries = [];
    const blocks = content.split(/\n---\n/);
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed.startsWith("## ")) continue;
      const lines = trimmed.split("\n");
      const time = lines[0].replace(/^## /, "").trim();
      const items = [];
      const typeMatch = trimmed.match(/\*\*类型\*\*：(.+)/);
      let i = 1;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim() || line.startsWith("**")) {
          i++;
          continue;
        }
        if (line.startsWith("- ")) {
          const itemText = line.slice(2);
          const chapterMatches = itemText.matchAll(/\[\[(.+?)\]\]/g);
          const chapters = [];
          for (const match of chapterMatches) {
            chapters.push(match[1]);
          }
          let desc = itemText.replace(/\[\[.+?\]\]/g, "").trim();
          i++;
          while (i < lines.length && lines[i].startsWith("  ") && !lines[i].startsWith("- ")) {
            const continuationLine = lines[i].slice(2);
            if (continuationLine.trim()) {
              desc += "\n" + continuationLine;
            }
            i++;
          }
          const chapter = chapters.join(", ");
          items.push({ description: desc, chapter });
          continue;
        }
        i++;
      }
      if (items.length === 0) {
        const descLines = [];
        let j = 1;
        while (j < lines.length && !lines[j].startsWith("**") && !lines[j].startsWith("- ")) {
          if (lines[j].trim()) descLines.push(lines[j].trim());
          j++;
        }
        const description = descLines.join("\n");
        if (description) {
          items.push({ description, chapter: "" });
        }
      }
      const finalItems = items.length > 0 ? items : [{ description: "", chapter: "" }];
      entries.push({
        time,
        description: finalItems.map((it) => it.description).filter(Boolean).join("\n"),
        chapter: finalItems.map((it) => it.chapter).filter(Boolean).join(", "),
        type: typeMatch ? typeMatch[1].trim() : "",
        rawBlock: trimmed,
        items: finalItems
      });
    }
    return entries;
  }
  formatEntry(entry) {
    const lines = [];
    lines.push(`## ${entry.time}`);
    lines.push("");
    const items = entry.items;
    if (items && items.length > 0) {
      for (const it of items) {
        const descriptions = it.description ? it.description.split("\n").filter((line) => line.trim()) : [];
        if (descriptions.length > 0) {
          const firstLineParts = [descriptions[0]];
          if (it.chapter) {
            const chapters = it.chapter.split(/[,，]/).map((c) => c.trim()).filter(Boolean);
            const chapterLinks = chapters.map((c) => `[[${c}]]`).join(" ");
            if (chapterLinks) firstLineParts.push(chapterLinks);
          }
          lines.push(`- ${firstLineParts.join(" ")}`);
          for (let i = 1; i < descriptions.length; i++) {
            lines.push(`  ${descriptions[i]}`);
          }
        } else if (it.chapter) {
          const chapters = it.chapter.split(/[,，]/).map((c) => c.trim()).filter(Boolean);
          const chapterLinks = chapters.map((c) => `[[${c}]]`).join(" ");
          if (chapterLinks) lines.push(`- ${chapterLinks}`);
        }
      }
    } else {
      const descriptions = entry.description ? entry.description.split("\n").filter((line) => line.trim()) : [];
      if (descriptions.length > 0) {
        const firstLineParts = [descriptions[0]];
        if (entry.chapter) {
          const chapters = entry.chapter.split(/[,，]/).map((c) => c.trim()).filter(Boolean);
          const chapterLinks = chapters.map((c) => `[[${c}]]`).join(" ");
          if (chapterLinks) firstLineParts.push(chapterLinks);
        }
        lines.push(`- ${firstLineParts.join(" ")}`);
        for (let i = 1; i < descriptions.length; i++) {
          lines.push(`  ${descriptions[i]}`);
        }
      } else if (entry.chapter) {
        const chapters = entry.chapter.split(/[,，]/).map((c) => c.trim()).filter(Boolean);
        const chapterLinks = chapters.map((c) => `[[${c}]]`).join(" ");
        if (chapterLinks) lines.push(`- ${chapterLinks}`);
      }
    }
    if (entry.type) {
      lines.push("");
      lines.push(`**\u7C7B\u578B**\uFF1A${entry.type}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("");
    return lines.join("\n");
  }
  async appendEntry(entry) {
    let file = this.getTimelineFile();
    if (!file) file = await this.createTimelineFile();
    const existing = await this.app.vault.read(file);
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headerPattern = new RegExp(
      `(## ${escapeRegex(entry.time)}\\n)([\\s\\S]*?)(\\n---\\n)`,
      "m"
    );
    const match = headerPattern.exec(existing);
    let newContent;
    if (match) {
      const fullMatch = match[0];
      const header = match[1];
      const body = match[2];
      const separator = match[3];
      const descriptions = entry.description ? entry.description.split("\n").filter((line) => line.trim()) : [];
      const newItemLines = [];
      if (descriptions.length > 0) {
        const firstLineParts = [descriptions[0]];
        if (entry.chapter) {
          const chapters = entry.chapter.split(/[,，]/).map((c) => c.trim()).filter(Boolean);
          const chapterLinks = chapters.map((c) => `[[${c}]]`).join(" ");
          if (chapterLinks) firstLineParts.push(chapterLinks);
        }
        newItemLines.push(`- ${firstLineParts.join(" ")}`);
        for (let i = 1; i < descriptions.length; i++) {
          newItemLines.push(`  ${descriptions[i]}`);
        }
      } else if (entry.chapter) {
        const chapters = entry.chapter.split(/[,，]/).map((c) => c.trim()).filter(Boolean);
        const chapterLinks = chapters.map((c) => `[[${c}]]`).join(" ");
        if (chapterLinks) newItemLines.push(`- ${chapterLinks}`);
      }
      const boldIndex = body.indexOf("\n**\u7C7B\u578B**");
      let newBody;
      if (newItemLines.length > 0) {
        const newItemText = newItemLines.join("\n");
        if (boldIndex !== -1) {
          newBody = body.slice(0, boldIndex) + "\n" + newItemText + body.slice(boldIndex);
        } else {
          newBody = body.trimEnd() + "\n" + newItemText + "\n";
        }
      } else {
        newBody = body;
      }
      newContent = existing.replace(fullMatch, header + newBody + separator);
    } else {
      const sep = existing.endsWith("\n") || existing === "" ? "" : "\n";
      newContent = existing + sep + this.formatEntry(entry);
    }
    await this.app.vault.modify(file, newContent);
    return newContent;
  }
  async updateEntry(index, updated) {
    const file = this.getTimelineFile();
    if (!file) return "";
    const entries = await this.loadEntries();
    if (!entries) return "";
    entries[index] = updated;
    return await this.writeAllEntries(file, entries);
  }
  async deleteEntry(index) {
    const file = this.getTimelineFile();
    if (!file) return "";
    const entries = await this.loadEntries();
    if (!entries) return "";
    entries.splice(index, 1);
    return await this.writeAllEntries(file, entries);
  }
  async moveEntry(fromIndex, toIndex) {
    const file = this.getTimelineFile();
    if (!file) return "";
    const entries = await this.loadEntries();
    if (!entries) return "";
    const [moved] = entries.splice(fromIndex, 1);
    entries.splice(toIndex, 0, moved);
    return await this.writeAllEntries(file, entries);
  }
  async writeAllEntries(file, entries) {
    let content = "";
    for (const entry of entries) {
      content += this.formatEntry(entry);
    }
    await this.app.vault.modify(file, content);
    return content;
  }
};

// src/ui/TimelineView.ts
var TIMELINE_VIEW_TYPE = "timeline-view";
var TimelineAddModal = class extends import_obsidian15.Modal {
  constructor(app, plugin, description, sourceFile, folderPath, onSubmit, returnFullEntry = true) {
    super(app);
    this.plugin = plugin;
    this.description = description;
    this.sourceFile = sourceFile;
    this.folderPath = folderPath;
    this.onSubmit = onSubmit;
    this.returnFullEntry = returnFullEntry;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "\u6DFB\u52A0\u5230\u65F6\u95F4\u7EBF" });
    const inputStyle = "width:100%;margin-bottom:8px;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;";
    new import_obsidian15.Setting(contentEl).setName("\u65F6\u95F4\u70B9").setDesc("\u4F8B\u5982\uFF1A\u6C38\u5386\u4E09\u5E74\u6625 / 2024-03-15");
    const timeInput = contentEl.createEl("input", { type: "text" });
    timeInput.placeholder = "\u65F6\u95F4\u70B9\uFF08\u5FC5\u586B\uFF09";
    timeInput.style.cssText = inputStyle;
    new import_obsidian15.Setting(contentEl).setName("\u4E8B\u4EF6\u63CF\u8FF0");
    const descInput = contentEl.createEl("textarea");
    descInput.value = this.description;
    descInput.style.cssText = inputStyle + "height:80px;resize:vertical;font-family:var(--font-text);";
    new import_obsidian15.Setting(contentEl).setName("\u5173\u8054\u7AE0\u8282\uFF08\u53EF\u9009\uFF09").setDesc("\u70B9\u51FB + \u53F7\u6DFB\u52A0\u66F4\u591A\u7AE0\u8282");
    const chapterListContainer = contentEl.createDiv();
    chapterListContainer.style.cssText = "margin-bottom:12px;";
    const getChapterFiles = () => {
      const folder = this.folderPath ? this.app.vault.getAbstractFileByPath(this.folderPath) : null;
      if (folder && "children" in folder) {
        return folder.children.filter((c) => c.extension === "md").map((c) => c.basename).sort();
      }
      return [];
    };
    const chapterFiles = getChapterFiles();
    const selectedChapters = this.sourceFile ? [this.sourceFile] : [];
    const createChapterRow = (initialValue = "") => {
      const row = chapterListContainer.createDiv();
      row.style.cssText = "display:flex;gap:8px;margin-bottom:8px;align-items:center;";
      const select = row.createEl("select");
      select.style.cssText = "flex:1;padding:6px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);";
      select.createEl("option", { value: "", text: "-- \u9009\u62E9\u7AE0\u8282 --" });
      chapterFiles.forEach((file) => {
        const option = select.createEl("option", { value: file, text: file });
        if (file === initialValue) option.selected = true;
      });
      const removeBtn = row.createEl("button", { text: "\u2212", cls: "timeline-chapter-remove-btn" });
      removeBtn.style.cssText = "width:32px;height:32px;padding:0;border-radius:4px;background:var(--background-modifier-error);color:var(--text-on-accent);border:none;cursor:pointer;font-size:20px;line-height:1;";
      removeBtn.title = "\u5220\u9664\u6B64\u7AE0\u8282";
      removeBtn.onclick = () => {
        row.remove();
        if (chapterListContainer.children.length === 1) {
          createChapterRow();
        }
      };
      return { row, select };
    };
    if (this.sourceFile) {
      createChapterRow(this.sourceFile);
    } else {
      createChapterRow();
    }
    const addBtn = chapterListContainer.createEl("button", { text: "+ \u6DFB\u52A0\u7AE0\u8282", cls: "timeline-chapter-add-btn" });
    addBtn.style.cssText = "width:100%;padding:6px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;cursor:pointer;margin-top:4px;";
    addBtn.onclick = () => {
      const { row } = createChapterRow();
      chapterListContainer.insertBefore(row, addBtn);
    };
    new import_obsidian15.Setting(contentEl).setName("\u7C7B\u578B\uFF08\u53EF\u9009\uFF09");
    const typeSelect = contentEl.createEl("select");
    typeSelect.style.cssText = inputStyle;
    const emptyOption = typeSelect.createEl("option", { value: "", text: "-- \u9009\u62E9\u7C7B\u578B --" });
    const defaultTypes = this.plugin.settings.timeline?.defaultTypes || ["\u4E3B\u7EBF", "\u652F\u7EBF", "\u4F0F\u7B14", "\u4E16\u754C\u89C2", "\u4EBA\u7269"];
    defaultTypes.forEach((type) => {
      typeSelect.createEl("option", { value: type, text: type });
    });
    const customOption = typeSelect.createEl("option", { value: "__custom__", text: "-- \u81EA\u5B9A\u4E49 --" });
    const customInput = contentEl.createEl("input", { type: "text" });
    customInput.placeholder = "\u8F93\u5165\u81EA\u5B9A\u4E49\u7C7B\u578B";
    customInput.style.cssText = inputStyle + "display:none;margin-top:4px;";
    typeSelect.addEventListener("change", () => {
      if (typeSelect.value === "__custom__") {
        customInput.style.display = "block";
        customInput.focus();
      } else {
        customInput.style.display = "none";
      }
    });
    const btnContainer = contentEl.createDiv();
    btnContainer.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:16px;";
    btnContainer.createEl("button", { text: "\u53D6\u6D88" }).onclick = () => this.close();
    const saveBtn = btnContainer.createEl("button", { text: "\u6DFB\u52A0", cls: "mod-cta" });
    saveBtn.onclick = async () => {
      const time = timeInput.value.trim();
      if (!time) {
        new import_obsidian15.Notice("\u8BF7\u586B\u5199\u65F6\u95F4\u70B9");
        timeInput.focus();
        return;
      }
      const chapters = [];
      const selects = chapterListContainer.querySelectorAll("select");
      selects.forEach((select) => {
        const value = select.value.trim();
        if (value) chapters.push(value);
      });
      const uniqueChapters = [...new Set(chapters)];
      let typeValue = typeSelect.value;
      if (typeValue === "__custom__") {
        typeValue = customInput.value.trim();
        if (typeValue && !this.plugin.settings.timeline.defaultTypes.includes(typeValue)) {
          this.plugin.settings.timeline.defaultTypes.push(typeValue);
          await this.plugin.saveSettings();
        }
      }
      const entry = {
        time,
        description: descInput.value.trim(),
        chapter: uniqueChapters.join(", "),
        // 用逗号+空格连接
        type: typeValue
      };
      if (this.returnFullEntry) {
        entry.rawBlock = "";
      }
      this.onSubmit(entry);
      this.close();
    };
    setTimeout(() => timeInput.focus(), 50);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var TimelineAddFromSelectionModal = class extends TimelineAddModal {
  constructor(app, plugin, timelineFileName, description, sourceFile, folderPath, onSubmit) {
    super(app, plugin, description, sourceFile, folderPath, onSubmit, false);
  }
};
var TimelineView = class extends CreativeView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
    this.editingIndex = -1;
    this.manager = new TimelineManager(this.app, this.plugin);
  }
  getViewType() {
    return TIMELINE_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u65F6\u95F4\u7EBF";
  }
  getIcon() {
    return "calendar-clock";
  }
  getWatchFileName() {
    return this.plugin.settings.timeline?.fileName || "\u65F6\u95F4\u7EBF";
  }
  async onFolderChange() {
    this.manager.currentFolder = this.currentFolder;
    this.editingIndex = -1;
    await this.refresh();
  }
  async refresh() {
    const file = this.manager.getTimelineFile();
    const content = file ? await this.app.vault.read(file) : null;
    await this.renderFromContent(content);
  }
  async renderFromContent(content) {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("timeline-view-container");
    const header = container.createDiv({ cls: "timeline-view-header" });
    const titleRow = header.createDiv({ cls: "timeline-view-title-row" });
    titleRow.createSpan({ text: "\u65F6\u95F4\u7EBF", cls: "timeline-view-title" });
    const addBtn = titleRow.createEl("button", { cls: "timeline-add-btn", title: "\u65B0\u589E\u4E8B\u4EF6" });
    addBtn.innerHTML = "+";
    addBtn.onclick = () => this.showAddForm(container);
    header.createDiv({ cls: "timeline-view-folder", text: this.currentFolder || "\u6839\u76EE\u5F55" });
    if (content === null) {
      const empty = container.createDiv({ cls: "timeline-view-empty" });
      const fileName = this.plugin.settings.timeline?.fileName || "\u65F6\u95F4\u7EBF";
      empty.createEl("p", { text: "\u5F53\u524D\u6587\u4EF6\u5939\u4E0B\u6CA1\u6709\u65F6\u95F4\u7EBF\u6587\u4EF6" });
      empty.createEl("p", { text: `\uFF08${fileName}.md\uFF09`, cls: "timeline-view-hint" });
      const createBtn = empty.createEl("button", { text: "\u521B\u5EFA\u65F6\u95F4\u7EBF\u6587\u4EF6", cls: "mod-cta timeline-create-btn" });
      createBtn.onclick = async () => {
        await this.manager.createTimelineFile();
        await this.refresh();
      };
      return;
    }
    const entries = this.manager.parseEntries(content);
    if (entries.length === 0) {
      container.createDiv({ cls: "timeline-view-empty" }).createEl("p", { text: "\u65F6\u95F4\u7EBF\u4E3A\u7A7A\uFF0C\u70B9\u51FB + \u6DFB\u52A0\u7B2C\u4E00\u4E2A\u4E8B\u4EF6" });
      return;
    }
    const timeline = container.createDiv({ cls: "timeline-list" });
    entries.forEach((entry, index) => {
      if (this.editingIndex === index) {
        this.renderEditForm(timeline, entry, index, entries);
      } else {
        this.renderEntry(timeline, entry, index, entries);
      }
    });
  }
  renderEntry(container, entry, index, allEntries) {
    const item = container.createDiv({ cls: "timeline-item" });
    item.setAttribute("data-index", String(index));
    item.setAttribute("draggable", "true");
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", String(index));
      setTimeout(() => item.addClass("timeline-dragging"), 0);
    });
    item.addEventListener("dragend", () => {
      item.removeClass("timeline-dragging");
      container.querySelectorAll(".timeline-drag-over-top, .timeline-drag-over-bottom").forEach((el) => {
        el.removeClass("timeline-drag-over-top");
        el.removeClass("timeline-drag-over-bottom");
      });
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      container.querySelectorAll(".timeline-drag-over-top, .timeline-drag-over-bottom").forEach((el) => {
        el.removeClass("timeline-drag-over-top");
        el.removeClass("timeline-drag-over-bottom");
      });
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        item.addClass("timeline-drag-over-top");
      } else {
        item.addClass("timeline-drag-over-bottom");
      }
    });
    item.addEventListener("dragleave", (e) => {
      if (!item.contains(e.relatedTarget)) {
        item.removeClass("timeline-drag-over-top");
        item.removeClass("timeline-drag-over-bottom");
      }
    });
    item.addEventListener("drop", async (e) => {
      e.preventDefault();
      const fromIndex = parseInt(e.dataTransfer?.getData("text/plain") || "-1");
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      let toIndex = e.clientY < midY ? index : index + 1;
      if (fromIndex < toIndex) toIndex -= 1;
      item.removeClass("timeline-drag-over-top");
      item.removeClass("timeline-drag-over-bottom");
      if (fromIndex !== -1 && fromIndex !== toIndex) {
        const newContent = await this.manager.moveEntry(fromIndex, toIndex);
        await this.renderFromContent(newContent || null);
      }
    });
    const line = item.createDiv({ cls: "timeline-line" });
    line.createDiv({ cls: "timeline-dot" });
    if (index < allEntries.length - 1) {
      line.createDiv({ cls: "timeline-connector" });
    }
    const content = item.createDiv({ cls: "timeline-content" });
    content.createDiv({ cls: "timeline-drag-handle", text: "\u283F" });
    content.createDiv({ cls: "timeline-time", text: entry.time });
    const itemsToRender = entry.items && entry.items.length > 0 ? entry.items : [{ description: entry.description, chapter: entry.chapter }];
    for (const it of itemsToRender) {
      if (!it.description && !it.chapter) continue;
      const itemEl = content.createDiv({ cls: "timeline-list-item" });
      if (it.description) {
        const descEl = itemEl.createDiv({ cls: "timeline-desc" });
        const lines = it.description.split("\n");
        lines.forEach((line2, index2) => {
          descEl.appendText(line2);
          if (index2 < lines.length - 1) {
            descEl.createEl("br");
          }
        });
      }
      if (it.chapter) {
        const chapters = it.chapter.split(/[,，]/).map((c) => c.trim()).filter(Boolean);
        const linksContainer = itemEl.createDiv({ cls: "timeline-chapter-links" });
        chapters.forEach((chapterName, index2) => {
          const link = linksContainer.createEl("a", {
            text: chapterName,
            cls: "timeline-chapter-link"
          });
          link.onclick = async () => {
            const file = this.app.vault.getMarkdownFiles().find((f) => f.basename === chapterName);
            if (file) await this.app.workspace.getLeaf(false).openFile(file);
            else new import_obsidian15.Notice(`\u627E\u4E0D\u5230\u6587\u4EF6\uFF1A${chapterName}`);
          };
          if (index2 < chapters.length - 1) {
            linksContainer.createSpan({ text: ", ", cls: "timeline-chapter-separator" });
          }
        });
      }
    }
    const footer = content.createDiv({ cls: "timeline-footer" });
    if (entry.type) {
      footer.createSpan({ text: entry.type, cls: "timeline-type-tag" });
    }
    const actions = content.createDiv({ cls: "timeline-actions" });
    const editBtn = actions.createEl("button", { text: "\u7F16\u8F91", cls: "timeline-action-btn" });
    editBtn.onclick = () => {
      this.editingIndex = index;
      this.refresh();
    };
    const deleteBtn = actions.createEl("button", { text: "\u5220\u9664", cls: "timeline-action-btn timeline-delete-btn" });
    deleteBtn.onclick = async () => {
      const newContent = await this.manager.deleteEntry(index);
      await this.renderFromContent(newContent || null);
    };
  }
  renderEditForm(container, entry, index, allEntries) {
    const form = container.createDiv({ cls: "timeline-edit-form" });
    form.createEl("label", { text: "\u65F6\u95F4\u70B9", cls: "timeline-form-label" });
    const timeInput = form.createEl("input", { type: "text", cls: "timeline-form-input" });
    timeInput.value = entry.time;
    timeInput.placeholder = "\u4F8B\u5982\uFF1A\u6C38\u5386\u4E09\u5E74\u6625 / 2024-03-15";
    form.createEl("label", { text: "\u4E8B\u4EF6\u5217\u8868", cls: "timeline-form-label" });
    form.createDiv({ cls: "timeline-form-hint", text: "\u6BCF\u4E2A\u4E8B\u4EF6\u53EF\u4EE5\u6709\u81EA\u5DF1\u7684\u63CF\u8FF0\u548C\u5173\u8054\u7AE0\u8282" }).style.cssText = "font-size:0.85em;color:var(--text-muted);margin-bottom:8px;";
    const eventsContainer = form.createDiv();
    eventsContainer.style.cssText = "margin-bottom:12px;";
    const folder = this.app.vault.getAbstractFileByPath(this.currentFolder);
    const chapterFiles = [];
    if (folder && "children" in folder) {
      folder.children.filter((c) => c.extension === "md").forEach((c) => {
        chapterFiles.push(c.basename);
      });
      chapterFiles.sort();
    }
    const existingItems = entry.items && entry.items.length > 0 ? entry.items : [{ description: entry.description, chapter: entry.chapter }];
    const createEventBlock = (item = { description: "", chapter: "" }) => {
      const eventBlock = eventsContainer.createDiv({ cls: "timeline-event-block" });
      eventBlock.style.cssText = "border:1px solid var(--background-modifier-border);border-radius:6px;padding:12px;margin-bottom:12px;background:var(--background-secondary);";
      eventBlock.createEl("label", { text: "\u4E8B\u4EF6\u63CF\u8FF0", cls: "timeline-form-label" });
      const descInput = eventBlock.createEl("textarea", { cls: "timeline-form-textarea" });
      descInput.value = item.description;
      descInput.placeholder = "\u63CF\u8FF0\u8FD9\u4E2A\u4E8B\u4EF6...";
      descInput.style.cssText = "margin-bottom:8px;height:60px;";
      eventBlock.createEl("label", { text: "\u5173\u8054\u7AE0\u8282", cls: "timeline-form-label" });
      const chapterListContainer = eventBlock.createDiv();
      chapterListContainer.style.cssText = "margin-bottom:8px;";
      const existingChapters = item.chapter ? item.chapter.split(/[,，]/).map((c) => c.trim()).filter(Boolean) : [];
      const createChapterRow = (initialValue = "") => {
        const row = chapterListContainer.createDiv();
        row.style.cssText = "display:flex;gap:8px;margin-bottom:4px;align-items:center;";
        const select = row.createEl("select", { cls: "timeline-form-input" });
        select.style.cssText = "flex:1;";
        select.createEl("option", { value: "", text: "-- \u9009\u62E9\u7AE0\u8282 --" });
        chapterFiles.forEach((file) => {
          const option = select.createEl("option", { value: file, text: file });
          if (file === initialValue) option.selected = true;
        });
        const removeBtn = row.createEl("button", { text: "\u2212" });
        removeBtn.style.cssText = "width:28px;height:28px;padding:0;border-radius:4px;background:var(--background-modifier-error);color:var(--text-on-accent);border:none;cursor:pointer;font-size:16px;";
        removeBtn.onclick = () => {
          row.remove();
          if (chapterListContainer.children.length === 1) createChapterRow();
        };
        return { row, select };
      };
      if (existingChapters.length > 0) {
        existingChapters.forEach((chapter) => createChapterRow(chapter));
      } else {
        createChapterRow();
      }
      const addChapterBtn = chapterListContainer.createEl("button", { text: "+ \u6DFB\u52A0\u7AE0\u8282" });
      addChapterBtn.style.cssText = "width:100%;padding:4px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;cursor:pointer;font-size:12px;margin-top:4px;";
      addChapterBtn.onclick = () => {
        const { row } = createChapterRow();
        chapterListContainer.insertBefore(row, addChapterBtn);
      };
      const deleteEventBtn = eventBlock.createEl("button", { text: "\u5220\u9664\u6B64\u4E8B\u4EF6" });
      deleteEventBtn.style.cssText = "width:100%;padding:6px;border-radius:4px;background:var(--background-modifier-error);color:var(--text-on-accent);border:none;cursor:pointer;margin-top:8px;";
      deleteEventBtn.onclick = () => {
        eventBlock.remove();
        if (eventsContainer.querySelectorAll(".timeline-event-block").length === 0) {
          createEventBlock();
        }
      };
      return { eventBlock, descInput, chapterListContainer };
    };
    existingItems.forEach((item) => createEventBlock(item));
    const addEventBtn = eventsContainer.createEl("button", { text: "+ \u6DFB\u52A0\u4E8B\u4EF6" });
    addEventBtn.style.cssText = "width:100%;padding:8px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;cursor:pointer;margin-top:8px;";
    addEventBtn.onclick = () => {
      const { eventBlock } = createEventBlock();
      eventsContainer.insertBefore(eventBlock, addEventBtn);
    };
    form.createEl("label", { text: "\u7C7B\u578B\uFF08\u53EF\u9009\uFF09", cls: "timeline-form-label" });
    const typeSelect = form.createEl("select", { cls: "timeline-form-input" });
    typeSelect.createEl("option", { value: "", text: "-- \u9009\u62E9\u7C7B\u578B --" });
    const defaultTypes = this.plugin.settings.timeline?.defaultTypes || ["\u4E3B\u7EBF", "\u652F\u7EBF", "\u4F0F\u7B14", "\u4E16\u754C\u89C2", "\u4EBA\u7269"];
    defaultTypes.forEach((type) => {
      const option = typeSelect.createEl("option", { value: type, text: type });
      if (type === entry.type) option.selected = true;
    });
    typeSelect.createEl("option", { value: "__custom__", text: "-- \u81EA\u5B9A\u4E49 --" });
    const customInput = form.createEl("input", { type: "text", cls: "timeline-form-input" });
    customInput.placeholder = "\u8F93\u5165\u81EA\u5B9A\u4E49\u7C7B\u578B";
    customInput.style.cssText = "margin-top:4px;display:none;";
    if (entry.type && !defaultTypes.includes(entry.type)) {
      typeSelect.value = "__custom__";
      customInput.value = entry.type;
      customInput.style.display = "block";
    }
    typeSelect.addEventListener("change", () => {
      if (typeSelect.value === "__custom__") {
        customInput.style.display = "block";
        customInput.focus();
      } else {
        customInput.style.display = "none";
      }
    });
    const btnRow = form.createDiv({ cls: "timeline-form-btns" });
    const cancelBtn = btnRow.createEl("button", { text: "\u53D6\u6D88", cls: "timeline-action-btn" });
    cancelBtn.onclick = () => {
      this.editingIndex = -1;
      this.refresh();
    };
    const saveBtn = btnRow.createEl("button", { text: "\u4FDD\u5B58", cls: "timeline-action-btn mod-cta" });
    saveBtn.onclick = async () => {
      const items = [];
      const eventBlocks = eventsContainer.querySelectorAll(".timeline-event-block");
      eventBlocks.forEach((block) => {
        const htmlBlock = block;
        const descInput = htmlBlock.querySelector("textarea");
        const description = descInput.value.trim();
        const chapters = [];
        const selects = htmlBlock.querySelectorAll("select");
        selects.forEach((select) => {
          const value = select.value.trim();
          if (value) chapters.push(value);
        });
        const chapter = [...new Set(chapters)].join(", ");
        if (description || chapter) {
          items.push({ description, chapter });
        }
      });
      if (items.length === 0) {
        items.push({ description: "", chapter: "" });
      }
      let typeValue = typeSelect.value;
      if (typeValue === "__custom__") {
        typeValue = customInput.value.trim();
        if (typeValue && !this.plugin.settings.timeline.defaultTypes.includes(typeValue)) {
          this.plugin.settings.timeline.defaultTypes.push(typeValue);
          await this.plugin.saveSettings();
        }
      }
      const updated = {
        time: timeInput.value.trim(),
        description: items.map((it) => it.description).filter(Boolean).join("\n"),
        chapter: items.map((it) => it.chapter).filter(Boolean).join(", "),
        type: typeValue,
        rawBlock: entry.rawBlock,
        items
      };
      if (!updated.time) {
        new import_obsidian15.Notice("\u8BF7\u586B\u5199\u65F6\u95F4\u70B9");
        timeInput.focus();
        return;
      }
      const newContent = await this.manager.updateEntry(index, updated);
      this.editingIndex = -1;
      await this.renderFromContent(newContent);
    };
    setTimeout(() => timeInput.focus(), 50);
  }
  showAddForm(container) {
    if (container.querySelector(".timeline-add-form")) return;
    const form = container.createDiv({ cls: "timeline-edit-form timeline-add-form" });
    form.createEl("div", { text: "\u65B0\u589E\u4E8B\u4EF6", cls: "timeline-form-title" });
    form.createEl("label", { text: "\u65F6\u95F4\u70B9", cls: "timeline-form-label" });
    const timeInput = form.createEl("input", { type: "text", cls: "timeline-form-input" });
    timeInput.placeholder = "\u4F8B\u5982\uFF1A\u6C38\u5386\u4E09\u5E74\u6625 / 2024-03-15";
    form.createEl("label", { text: "\u4E8B\u4EF6\u63CF\u8FF0", cls: "timeline-form-label" });
    const descInput = form.createEl("textarea", { cls: "timeline-form-textarea" });
    descInput.placeholder = "\u63CF\u8FF0\u8FD9\u4E2A\u65F6\u95F4\u70B9\u53D1\u751F\u7684\u4E8B\u4EF6...";
    form.createEl("label", { text: "\u5173\u8054\u7AE0\u8282\uFF08\u53EF\u9009\uFF09", cls: "timeline-form-label" });
    const chapterInputDesc = form.createDiv({ cls: "timeline-form-hint" });
    chapterInputDesc.setText("\u70B9\u51FB + \u53F7\u6DFB\u52A0\u66F4\u591A\u7AE0\u8282");
    chapterInputDesc.style.cssText = "font-size:0.85em;color:var(--text-muted);margin-bottom:4px;";
    const chapterListContainer = form.createDiv();
    chapterListContainer.style.cssText = "margin-bottom:12px;";
    const folder = this.app.vault.getAbstractFileByPath(this.currentFolder);
    const chapterFiles = [];
    if (folder && "children" in folder) {
      folder.children.filter((c) => c.extension === "md").forEach((c) => {
        chapterFiles.push(c.basename);
      });
      chapterFiles.sort();
    }
    const createChapterRow = (initialValue = "") => {
      const row = chapterListContainer.createDiv();
      row.style.cssText = "display:flex;gap:8px;margin-bottom:8px;align-items:center;";
      const select = row.createEl("select", { cls: "timeline-form-input" });
      select.style.cssText = "flex:1;";
      select.createEl("option", { value: "", text: "-- \u9009\u62E9\u7AE0\u8282 --" });
      chapterFiles.forEach((file) => {
        const option = select.createEl("option", { value: file, text: file });
        if (file === initialValue) option.selected = true;
      });
      const removeBtn = row.createEl("button", { text: "\u2212", cls: "timeline-chapter-remove-btn" });
      removeBtn.style.cssText = "width:32px;height:32px;padding:0;border-radius:4px;background:var(--background-modifier-error);color:var(--text-on-accent);border:none;cursor:pointer;font-size:20px;line-height:1;";
      removeBtn.title = "\u5220\u9664\u6B64\u7AE0\u8282";
      removeBtn.onclick = () => {
        row.remove();
        if (chapterListContainer.children.length === 1) {
          createChapterRow();
        }
      };
      return { row, select };
    };
    createChapterRow();
    const addBtn = chapterListContainer.createEl("button", { text: "+ \u6DFB\u52A0\u7AE0\u8282", cls: "timeline-chapter-add-btn" });
    addBtn.style.cssText = "width:100%;padding:6px;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;cursor:pointer;margin-top:4px;";
    addBtn.onclick = () => {
      const { row } = createChapterRow();
      chapterListContainer.insertBefore(row, addBtn);
    };
    form.createEl("label", { text: "\u7C7B\u578B\uFF08\u53EF\u9009\uFF09", cls: "timeline-form-label" });
    const typeSelect = form.createEl("select", { cls: "timeline-form-input" });
    typeSelect.createEl("option", { value: "", text: "-- \u9009\u62E9\u7C7B\u578B --" });
    const defaultTypes = this.plugin.settings.timeline?.defaultTypes || ["\u4E3B\u7EBF", "\u652F\u7EBF", "\u4F0F\u7B14", "\u4E16\u754C\u89C2", "\u4EBA\u7269"];
    defaultTypes.forEach((type) => {
      typeSelect.createEl("option", { value: type, text: type });
    });
    typeSelect.createEl("option", { value: "__custom__", text: "-- \u81EA\u5B9A\u4E49 --" });
    const customInput = form.createEl("input", { type: "text", cls: "timeline-form-input" });
    customInput.placeholder = "\u8F93\u5165\u81EA\u5B9A\u4E49\u7C7B\u578B";
    customInput.style.cssText = "margin-top:4px;display:none;";
    typeSelect.addEventListener("change", () => {
      if (typeSelect.value === "__custom__") {
        customInput.style.display = "block";
        customInput.focus();
      } else {
        customInput.style.display = "none";
      }
    });
    const btnRow = form.createDiv({ cls: "timeline-form-btns" });
    const cancelBtn = btnRow.createEl("button", { text: "\u53D6\u6D88", cls: "timeline-action-btn" });
    cancelBtn.onclick = () => form.remove();
    const saveBtn = btnRow.createEl("button", { text: "\u6DFB\u52A0", cls: "timeline-action-btn mod-cta" });
    saveBtn.onclick = async () => {
      const time = timeInput.value.trim();
      if (!time) {
        new import_obsidian15.Notice("\u8BF7\u586B\u5199\u65F6\u95F4\u70B9");
        timeInput.focus();
        return;
      }
      const chapters = [];
      const selects = chapterListContainer.querySelectorAll("select");
      selects.forEach((select) => {
        const value = select.value.trim();
        if (value) chapters.push(value);
      });
      const uniqueChapters = [...new Set(chapters)];
      let typeValue = typeSelect.value;
      if (typeValue === "__custom__") {
        typeValue = customInput.value.trim();
        if (typeValue && !this.plugin.settings.timeline.defaultTypes.includes(typeValue)) {
          this.plugin.settings.timeline.defaultTypes.push(typeValue);
          await this.plugin.saveSettings();
        }
      }
      const entry = {
        time,
        description: descInput.value.trim(),
        chapter: uniqueChapters.join(", "),
        type: typeValue,
        rawBlock: ""
      };
      const newContent = await this.manager.appendEntry(entry);
      form.remove();
      this.renderFromContent(newContent);
    };
    setTimeout(() => timeInput.focus(), 50);
  }
  // ─── 文件操作 ───────────────────────────────────────
  async appendEntry(entry) {
    this.manager.currentFolder = this.currentFolder;
    return await this.manager.appendEntry(entry);
  }
  /**
   * 从正文添加到时间线（供 main.ts 调用）
   * 直接弹出 Modal，不依赖面板状态
   */
  async addFromSelection(selectedText, sourceFile, folderPath) {
    const fileName = (this.plugin.settings.timeline?.fileName || "\u65F6\u95F4\u7EBF") + ".md";
    const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
    let file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file) {
      file = await this.app.vault.create(filePath, `# ${this.plugin.settings.timeline?.fileName || "\u65F6\u95F4\u7EBF"}

`);
      new import_obsidian15.Notice(`\u5DF2\u521B\u5EFA\u65F6\u95F4\u7EBF\u6587\u4EF6\uFF1A${fileName}`);
    }
    const modal = new TimelineAddModal(
      this.app,
      this.plugin,
      selectedText.trim(),
      sourceFile,
      folderPath,
      async (entry) => {
        const existing = await this.app.vault.read(file);
        const separator = existing.endsWith("\n") ? "" : "\n";
        await this.app.vault.modify(file, existing + separator + this.manager.formatEntry(entry));
        new import_obsidian15.Notice("[\u6210\u529F] \u5DF2\u6DFB\u52A0\u5230\u65F6\u95F4\u7EBF");
        const leaves = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);
        if (leaves.length > 0) {
          leaves[0].view.refresh();
        }
      },
      true
      // 返回完整 TimelineEntry
    );
    modal.open();
  }
};

// src/services/ForeshadowingManager.ts
var import_obsidian16 = require("obsidian");
var ForeshadowingManager = class _ForeshadowingManager {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
  static {
    /** 正则表达式缓存，避免重复编译（最多缓存 100 个） */
    this.entryPatternCache = /* @__PURE__ */ new Map();
  }
  static {
    this.MAX_CACHE_SIZE = 100;
  }
  /**
   * 获取伏笔文件路径（与来源文件同文件夹）
   */
  getForeshadowingFilePath(sourceFile) {
    const fileName = this.plugin.settings.foreshadowing.fileName || "\u4F0F\u7B14";
    const folder = sourceFile.parent?.path || "";
    return folder ? `${folder}/${fileName}.md` : `${fileName}.md`;
  }
  /**
   * 检查伏笔文件是否存在
   */
  foreshadowingFileExists(sourceFile) {
    const path = this.getForeshadowingFilePath(sourceFile);
    return !!this.app.vault.getAbstractFileByPath(path);
  }
  /**
   * 创建伏笔文件（空文件，不添加标题）
   */
  async createForeshadowingFile(sourceFile) {
    const path = this.getForeshadowingFilePath(sourceFile);
    const folder = sourceFile.parent?.path;
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    return await this.app.vault.create(path, "");
  }
  /**
   * 将伏笔条目格式化为 Markdown 字符串
   */
  formatEntry(entry) {
    const showTimestamp = this.plugin.settings.foreshadowing.showTimestamp !== false;
    const timestamp = showTimestamp ? ` - ${entry.createdAt}` : "";
    const lines = [];
    lines.push(`## [[${entry.sourceFile}]]${timestamp}`);
    lines.push("");
    const contentLines = entry.content.split("\n");
    for (const line of contentLines) {
      lines.push(`> ${line}`);
    }
    lines.push("");
    lines.push(`**\u8BF4\u660E**\uFF1A${entry.description}`);
    lines.push("");
    if (entry.tags.length > 0) {
      lines.push(`**\u6807\u7B7E**\uFF1A${entry.tags.map((t) => `#${t}`).join(" ")}`);
      lines.push("");
    }
    lines.push(`**\u72B6\u6001**\uFF1A${entry.status}`);
    if (entry.status === "\u5DF2\u56DE\u6536" /* Recovered */) {
      if (entry.recoveryFiles && entry.recoveryFiles.length > 0) {
        lines.push("");
        lines.push(`**\u56DE\u6536\u4E8E**\uFF1A`);
        entry.recoveryFiles.forEach((file, index) => {
          const time = entry.recoveredAts && entry.recoveredAts[index] ? ` - ${entry.recoveredAts[index]}` : "";
          lines.push(`- [[${file}]]${time}`);
        });
      } else if (entry.recoveryFile) {
        const recoveryTimestamp = entry.recoveredAt ? ` - ${entry.recoveredAt}` : "";
        lines.push("");
        lines.push(`**\u56DE\u6536\u4E8E**\uFF1A[[${entry.recoveryFile}]]${recoveryTimestamp}`);
      }
    }
    lines.push("");
    lines.push("---");
    lines.push("");
    return lines.join("\n");
  }
  /**
   * 将伏笔条目追加到伏笔文件末尾
   */
  async appendEntry(targetFile, entry) {
    const existing = await this.app.vault.read(targetFile);
    const formatted = this.formatEntry(entry);
    const separator = existing.endsWith("\n") ? "" : "\n";
    await this.app.vault.modify(targetFile, existing + separator + formatted);
  }
  /**
   * 在现有条目中查找相同说明的条目，返回其位置信息
   * 用于判断是否需要合并
   */
  findEntryByDescription(content, description) {
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const descPattern = new RegExp(
      `\\*\\*\u8BF4\u660E\\*\\*\uFF1A${escapeRegex(description)}`,
      "m"
    );
    const descMatch = descPattern.exec(content);
    if (!descMatch) return { found: false, insertPos: -1 };
    const beforeDesc = content.slice(0, descMatch.index);
    const lastQuoteMatch = [...beforeDesc.matchAll(/^> .*/gm)].pop();
    if (!lastQuoteMatch || lastQuoteMatch.index === void 0) {
      return { found: false, insertPos: -1 };
    }
    const insertPos = lastQuoteMatch.index + lastQuoteMatch[0].length;
    return { found: true, insertPos };
  }
  /**
   * 完整的标注伏笔流程：检查文件、必要时创建、追加条目
   * 如果伏笔文件中已存在相同说明的条目，则将新引用追加到该条目
   * @returns 伏笔文件，供调用方决定是否打开
   */
  async addForeshadowing(sourceFile, content, description, tags) {
    let targetFile = null;
    if (this.foreshadowingFileExists(sourceFile)) {
      const path = this.getForeshadowingFilePath(sourceFile);
      targetFile = this.app.vault.getAbstractFileByPath(path);
    } else {
      targetFile = await this.createForeshadowingFile(sourceFile);
    }
    const now = window.moment().format("YYYY-MM-DD HH:mm");
    const existingContent = await this.app.vault.read(targetFile);
    const { found, insertPos } = this.findEntryByDescription(existingContent, description);
    if (found && insertPos !== -1) {
      const newQuote = content.trim().split("\n").map((line) => `> ${line}`).join("\n");
      const insertion = `

> [[${sourceFile.basename}]] - ${now}
${newQuote}`;
      const newContent = existingContent.slice(0, insertPos) + insertion + existingContent.slice(insertPos);
      await this.app.vault.modify(targetFile, newContent);
      return { file: targetFile, merged: true };
    }
    const entry = {
      sourceFile: sourceFile.basename,
      content: content.trim(),
      description,
      tags,
      status: "\u672A\u56DE\u6536" /* Pending */,
      createdAt: now
    };
    await this.appendEntry(targetFile, entry);
    return { file: targetFile, merged: false };
  }
  /**
   * 获取光标所在伏笔条目的信息（用于标记回收）
   * 向上查找最近的 ## [[ 标题行
   */
  getEntryAtCursor(editor, cursorLine) {
    let titleLine = -1;
    for (let i = cursorLine; i >= 0; i--) {
      const line = editor.getLine(i);
      if (/^## \[\[.+\]\]/.test(line)) {
        titleLine = i;
        break;
      }
    }
    if (titleLine === -1) return null;
    const titleText = editor.getLine(titleLine);
    const titleMatch = titleText.match(/^## \[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
    if (!titleMatch) return null;
    const sourceFile = titleMatch[1];
    const createdAt = titleMatch[2]?.trim() || "";
    let contentPreview = "";
    for (let i = titleLine + 1; i < editor.lineCount(); i++) {
      const line = editor.getLine(i);
      if (line.startsWith("> ")) {
        contentPreview = line.replace(/^> /, "");
        break;
      }
      if (/^## \[\[/.test(line)) break;
    }
    return { sourceFile, createdAt, contentPreview };
  }
  /**
   * 获取缓存的条目匹配正则表达式
   * @param sourceFile 来源文件名
   * @param createdAt 创建时间
   * @param status 要匹配的状态（如 "未回收|已废弃"）
   */
  getEntryPattern(sourceFile, createdAt, status) {
    const key = `${sourceFile}:${createdAt}:${status}`;
    if (!_ForeshadowingManager.entryPatternCache.has(key)) {
      if (_ForeshadowingManager.entryPatternCache.size >= _ForeshadowingManager.MAX_CACHE_SIZE) {
        const firstKey = _ForeshadowingManager.entryPatternCache.keys().next().value;
        _ForeshadowingManager.entryPatternCache.delete(firstKey);
      }
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(
        `(## \\[\\[${escapeRegex(sourceFile)}\\]\\]` + (createdAt ? `[^\\n]*${escapeRegex(createdAt)}` : "") + `[\\s\\S]*?)(\\*\\*\u72B6\u6001\\*\\*\uFF1A)(${status})`,
        "m"
      );
      _ForeshadowingManager.entryPatternCache.set(key, pattern);
    }
    return _ForeshadowingManager.entryPatternCache.get(key);
  }
  /**
   * 将指定条目标记为已回收，更新状态和回收信息
   * 支持多章节回收
   * 通过来源文件名 + 创建时间定位条目
   */
  async markAsRecovered(targetFile, sourceFile, createdAt, recoveryFiles) {
    const content = await this.app.vault.read(targetFile);
    const now = window.moment().format("YYYY-MM-DD HH:mm");
    const titlePattern = this.getEntryPattern(sourceFile, createdAt, "\u672A\u56DE\u6536|\u5DF2\u5E9F\u5F03");
    if (!titlePattern.test(content)) return false;
    const newContent = content.replace(
      titlePattern,
      (match, before, statusLabel) => {
        const recoveryLines = recoveryFiles.map((file) => `- [[${file}]] - ${now}`).join("\n");
        return `${before}${statusLabel}\u5DF2\u56DE\u6536

**\u56DE\u6536\u4E8E**\uFF1A
${recoveryLines}`;
      }
    );
    await this.app.vault.modify(targetFile, newContent);
    return true;
  }
  /**
   * 添加回收章节到已回收的伏笔条目
   * 用于在已回收的伏笔上追加新的回收章节
   */
  async addRecoveryChapter(targetFile, sourceFile, createdAt, newRecoveryFile) {
    const content = await this.app.vault.read(targetFile);
    const now = window.moment().format("YYYY-MM-DD HH:mm");
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(## \\[\\[${escapeRegex(sourceFile)}\\]\\]` + (createdAt ? `[^\\n]*${escapeRegex(createdAt)}` : "") + `[\\s\\S]*?\\*\\*\u56DE\u6536\u4E8E\\*\\*\uFF1A\\n)([\\s\\S]*?)(\\n\\n|$)`,
      "m"
    );
    const match = pattern.exec(content);
    if (!match) return false;
    const newLine = `- [[${newRecoveryFile}]] - ${now}
`;
    const newContent = content.slice(0, match.index + match[1].length + match[2].length) + newLine + content.slice(match.index + match[1].length + match[2].length);
    await this.app.vault.modify(targetFile, newContent);
    return true;
  }
  /**
   * 将指定条目标记为已废弃
   */
  async markAsDeprecated(targetFile, sourceFile, createdAt) {
    const content = await this.app.vault.read(targetFile);
    const titlePattern = this.getEntryPattern(sourceFile, createdAt, "\u672A\u56DE\u6536");
    if (!titlePattern.test(content)) return false;
    const newContent = content.replace(
      titlePattern,
      (match, before, statusLabel) => `${before}${statusLabel}\u5DF2\u5E9F\u5F03`
    );
    await this.app.vault.modify(targetFile, newContent);
    return true;
  }
  /**
   * 将指定条目从已废弃恢复为未回收
   */
  async markAsPending(targetFile, sourceFile, createdAt) {
    const content = await this.app.vault.read(targetFile);
    const titlePattern = this.getEntryPattern(sourceFile, createdAt, "\u5DF2\u5E9F\u5F03");
    if (!titlePattern.test(content)) return false;
    const newContent = content.replace(
      titlePattern,
      (match, before, statusLabel) => `${before}${statusLabel}\u672A\u56DE\u6536`
    );
    await this.app.vault.modify(targetFile, newContent);
    return true;
  }
  async openForeshadowingFile(targetFile) {
    await this.app.workspace.getLeaf("tab").openFile(targetFile);
  }
  /**
   * 根据文件夹路径获取伏笔文件（供视图使用）
   */
  getForeshadowingFileByFolder(folderPath) {
    const fileName = this.plugin.settings.foreshadowing?.fileName || "\u4F0F\u7B14";
    const path = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof import_obsidian16.TFile ? file : null;
  }
  /**
   * 解析伏笔文件内容为结构化数据
   * 统一的解析逻辑，供 View 层调用
   */
  parseEntries(content) {
    const entries = [];
    const blocks = content.split(/\n---\n/);
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed || !trimmed.startsWith("## ")) continue;
      const titleMatch = trimmed.match(/^## \[\[(.+?)\]\](?:\s*-\s*(.+))?/m);
      if (!titleMatch) continue;
      const sourceFile = titleMatch[1];
      const createdAt = titleMatch[2]?.trim() || "";
      const contents = [];
      const lines = trimmed.split("\n");
      let i = 0;
      while (i < lines.length && lines[i].startsWith("## ")) i++;
      while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith("> ")) {
          let source = "";
          let time = "";
          const quoteLines = [];
          const sourceLine = line.replace(/^> /, "");
          const sourceMatch = sourceLine.match(/^\[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
          if (sourceMatch) {
            source = sourceMatch[1];
            time = sourceMatch[2]?.trim() || "";
            i++;
            while (i < lines.length && lines[i].startsWith("> ")) {
              quoteLines.push(lines[i].replace(/^> /, ""));
              i++;
            }
          } else {
            while (i < lines.length && lines[i].startsWith("> ")) {
              quoteLines.push(lines[i].replace(/^> /, ""));
              i++;
            }
          }
          if (quoteLines.length > 0) {
            contents.push({
              source: source || sourceFile,
              time: time || createdAt,
              text: quoteLines.join("\n")
            });
          }
        } else {
          i++;
        }
      }
      if (contents.length === 0) {
        const firstQuote = lines.find((l) => l.startsWith("> "));
        if (firstQuote) {
          contents.push({ source: sourceFile, time: createdAt, text: firstQuote.replace(/^> /, "") });
        }
      }
      const descMatch = trimmed.match(/\*\*说明\*\*：(.+)/);
      const description = descMatch ? descMatch[1].trim() : "";
      const tagsMatch = trimmed.match(/\*\*标签\*\*：(.+)/);
      const tags = tagsMatch ? tagsMatch[1].trim().split(/\s+/).map((t) => t.replace(/^#/, "")) : [];
      const statusMatch = trimmed.match(/\*\*状态\*\*：(.+)/);
      const statusText = statusMatch ? statusMatch[1].trim() : "\u672A\u56DE\u6536";
      let status = "\u672A\u56DE\u6536" /* Pending */;
      if (statusText === "\u5DF2\u56DE\u6536") status = "\u5DF2\u56DE\u6536" /* Recovered */;
      else if (statusText === "\u5DF2\u5E9F\u5F03") status = "\u5DF2\u5E9F\u5F03" /* Deprecated */;
      const recoveryListMatch = trimmed.match(/\*\*回收于\*\*：\n((?:- \[\[.+?\]\].*\n?)+)/);
      let recoveryFiles;
      let recoveredAts;
      let recoveryFile;
      let recoveredAt;
      if (recoveryListMatch) {
        const listLines = recoveryListMatch[1].trim().split("\n");
        recoveryFiles = [];
        recoveredAts = [];
        listLines.forEach((line) => {
          const match = line.match(/^- \[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
          if (match) {
            recoveryFiles.push(match[1]);
            recoveredAts.push(match[2]?.trim() || "");
          }
        });
      } else {
        const singleRecoveryMatch = trimmed.match(/\*\*回收于\*\*：\[\[(.+?)\]\](?:\s*-\s*(.+))?/);
        if (singleRecoveryMatch) {
          recoveryFile = singleRecoveryMatch[1];
          recoveredAt = singleRecoveryMatch[2]?.trim();
        }
      }
      if (description) {
        entries.push({ sourceFile, createdAt, contents, description, tags, status, recoveryFiles, recoveredAts, recoveryFile, recoveredAt });
      }
    }
    return entries;
  }
};

// src/services/ObsHtmlBuilder.ts
var import_obsidian17 = require("obsidian");
var ObsHtmlBuilder = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  /**
   * 获取 OBS 统计数据
   */
  getObsStats() {
    const focusSec = Math.floor(this.plugin.focusMs / 1e3);
    const slackSec = Math.floor(this.plugin.slackMs / 1e3);
    const totalSec = focusSec + slackSec;
    const today = window.moment().format("YYYY-MM-DD");
    const todayStat = this.plugin.historyManager.getDailyStat(today) || { focusMs: 0, slackMs: 0, addedWords: 0 };
    let targetGoal = this.plugin.settings.defaultGoal;
    let currentFile = "";
    let currentFolder = "";
    let chapterWords = 0;
    const view = this.plugin.app.workspace.getActiveViewOfType(import_obsidian17.MarkdownView);
    if (view?.file) {
      currentFile = view.file.basename;
      currentFolder = view.file.parent?.isRoot() ? "" : view.file.parent?.name || "";
      const cache = this.plugin.app.metadataCache.getFileCache(view.file);
      const fmGoal = parseInt(cache?.frontmatter?.["word-goal"]);
      if (!isNaN(fmGoal)) targetGoal = fmGoal;
      chapterWords = this.plugin.calculateAccurateWords(view.getViewData());
    }
    const todayAdded = todayStat.addedWords;
    const dailyGoal = this.plugin.settings.dailyGoal || 0;
    return {
      isTracking: this.plugin.isTracking,
      focusTime: formatTime(focusSec),
      slackTime: formatTime(slackSec),
      totalTime: formatTime(totalSec),
      sessionWords: Math.max(0, this.plugin.sessionAddedWords),
      todayWords: chapterWords,
      goal: targetGoal,
      percent: targetGoal > 0 ? Math.max(0, Math.min(Math.round(chapterWords / targetGoal * 100), 100)) : 0,
      dailyWords: Math.max(0, todayAdded),
      dailyGoal,
      dailyPercent: dailyGoal > 0 ? Math.max(0, Math.min(Math.round(todayAdded / dailyGoal * 100), 100)) : 0,
      currentFile,
      currentFolder
    };
  }
  /**
   * 过滤用户自定义 CSS，防止 XSS 注入
   * 使用严格的白名单策略，移除所有潜在的脚本注入
   */
  sanitizeCss(css) {
    if (!css) return "";
    let sanitized = css.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<\/style/gi, "<\\/style").replace(/@import\b[^;]*/gi, "/* @import blocked */").replace(/javascript:/gi, "").replace(/url\s*\(\s*['"]?\s*(?:javascript|data|vbscript):/gi, "url(blocked:").replace(/expression\s*\(/gi, "").replace(/behavior\s*:/gi, "").replace(/-moz-binding\s*:/gi, "").replace(/vbscript:/gi, "");
    const allowedProperties = [
      "color",
      "background",
      "font",
      "margin",
      "padding",
      "border",
      "width",
      "height",
      "display",
      "position",
      "top",
      "left",
      "right",
      "bottom",
      "opacity",
      "transform",
      "transition",
      "animation",
      "flex",
      "grid",
      "text",
      "line",
      "letter",
      "word",
      "white",
      "overflow",
      "visibility",
      "z-index",
      "cursor",
      "pointer",
      "box",
      "shadow",
      "radius",
      "align",
      "justify",
      "gap",
      "content",
      "wrap",
      "break",
      "decoration",
      "style",
      "weight",
      "size",
      "family",
      "variant",
      "stretch",
      "spacing"
    ];
    const lines = sanitized.split("\n");
    const suspiciousLines = lines.filter((line) => {
      const hasProperty = line.includes(":");
      if (!hasProperty) return false;
      const property = line.split(":")[0].trim().toLowerCase();
      if (!property || property.startsWith("/*") || property.startsWith("//")) return false;
      return !allowedProperties.some((allowed) => property.includes(allowed));
    });
    if (suspiciousLines.length > 0) {
      console.warn("[ObsHtmlBuilder] \u68C0\u6D4B\u5230\u53EF\u80FD\u4E0D\u5B89\u5168\u7684 CSS \u5C5E\u6027:", suspiciousLines);
    }
    return sanitized;
  }
  /**
   * 构建 OBS 叠加层 HTML
   */
  buildObsOverlayHtml() {
    const theme = this.plugin.settings.obsOverlayTheme || "dark";
    let isDark = theme === "dark";
    const overlayOpacity = this.plugin.settings.obsOverlayOpacity ?? 0.85;
    let cardBg = isDark ? `rgba(20, 20, 30, ${overlayOpacity})` : `rgba(255, 255, 255, ${overlayOpacity})`;
    let textColor = isDark ? "#E8E8E8" : "#2C3E50";
    if (theme.startsWith("note-")) {
      const index = parseInt(theme.split("-")[1]);
      const noteTheme = this.plugin.settings.noteThemes[index];
      if (noteTheme) {
        cardBg = hexToRgba(noteTheme.bg, overlayOpacity);
        textColor = noteTheme.text;
        isDark = false;
      }
    }
    const mutedColor = isDark ? "#888" : "#999";
    const accentColor = isDark ? "#6C9EFF" : "#4A90D9";
    const greenColor = "#4CAF50";
    const redColor = "#E74C3C";
    let timeRowHtml = "";
    if (this.plugin.settings.obsShowFocusTime || this.plugin.settings.obsShowSlackTime || this.plugin.settings.obsShowTotalTime) {
      timeRowHtml = `
	<div class="time-row">`;
      if (this.plugin.settings.obsShowTotalTime) timeRowHtml += `
		<div class="time-item"><div class="time-label">\u603B\u8BA1\u65F6\u95F4</div><div class="time-value" id="totalTime">00:00:00</div></div>`;
      if (this.plugin.settings.obsShowFocusTime) timeRowHtml += `
		<div class="time-item"><div class="time-label">\u4E13\u6CE8\u65F6\u95F4</div><div class="time-value focus" id="focusTime">00:00:00</div></div>`;
      if (this.plugin.settings.obsShowSlackTime) timeRowHtml += `
		<div class="time-item"><div class="time-label">\u6478\u9C7C\u65F6\u95F4</div><div class="time-value slack" id="slackTime">00:00:00</div></div>`;
      timeRowHtml += `
	</div>
	<div class="divider"></div>`;
    }
    let todayGoalHtml = "";
    if (this.plugin.settings.obsShowDailyGoal) {
      todayGoalHtml += `
	<div class="goal-row">
		<span class="goal-label">\u4ECA\u65E5\u76EE\u6807\u5B57\u6570</span>
		<span class="goal-value"><span id="dailyWords" class="current-val">0</span> <span class="sep">/</span> <span id="dailyGoalValue" class="target-val">0</span><span class="percent" id="dailyPercentText">0%</span></span>
	</div>
	<div class="progress-bg">
		<div class="progress-fill" id="dailyProgressFill" style="width: 0%"></div>
	</div>`;
    }
    if (this.plugin.settings.obsShowTodayWords) {
      todayGoalHtml += `
	<div class="goal-row"${this.plugin.settings.obsShowDailyGoal ? ' style="margin-top:8px"' : ""}>
		<span class="goal-label">\u672C\u7AE0\u76EE\u6807\u5B57\u6570</span>
		<span class="goal-value"><span id="todayWords" class="current-val">0</span> <span class="sep">/</span> <span id="goalValue" class="target-val">0</span><span class="percent" id="percentText">0%</span></span>
	</div>
	<div class="progress-bg">
		<div class="progress-fill" id="progressFill" style="width: 0%"></div>
	</div>`;
    }
    let sessionRowHtml = "";
    if (this.plugin.settings.obsShowSessionWords) {
      sessionRowHtml = `
	<div class="session-row">
		<span>\u672C\u573A\u51C0\u589E</span>
		<span class="val" id="sessionWords">0</span>
	</div>`;
    }
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
* { 
    margin: 0; 
    padding: 0; 
    box-sizing: border-box; 
    -webkit-font-smoothing: antialiased; 
    -moz-osx-font-smoothing: grayscale; 
}
body {
	background: transparent;
	font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
	color: ${textColor};
	margin: 0;
	padding: 0;
	display: flex;
	justify-content: flex-start;
	align-items: flex-start;
}
.overlay-card {
	background: ${cardBg};
	border-radius: 14px;
	padding: 20px 24px;
	backdrop-filter: ${overlayOpacity < 0.1 ? "none" : "blur(12px)"};
	border: ${overlayOpacity < 0.1 ? "none" : "1px solid " + (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)")};
	transition: all 0.3s ease;
	width: 280px;
	display: flex;
	flex-direction: column;
	gap: 6px;
	zoom: 1.1;
}
.overlay-title {
	font-size: 14px;
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
	background: ${greenColor};
	animation: pulse 1.5s ease-in-out infinite;
}
.status-dot.paused {
	background: ${mutedColor};
}
@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.3; }
}


.time-label {
	font-size: 16px;
	color: ${textColor};
	opacity: 0.9;
}
.time-value {
	font-family: 'Consolas', 'Courier New', monospace;
	font-size: 24px;
	font-weight: 700;
	letter-spacing: 1px;
}
.time-value.focus { color: ${accentColor}; }
.time-value.slack { color: ${redColor}; }
.divider {
	height: 1px;
	background: ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"};
	margin: 4px 0;
}





.goal-value .percent {
	font-size: 13px;
	color: ${accentColor};
	margin-left: 6px;
}
.progress-bg {
	width: 100%;
	height: 6px;
	background: ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"};
	border-radius: 3px;
	overflow: hidden;
	margin-bottom: 10px;
}
.progress-fill {
	height: 100%;
	border-radius: 3px;
	background: ${accentColor};
	transition: width 0.8s ease, background-color 0.5s ease;
}
.progress-fill.done {
	background: ${greenColor};
}

.session-row .val {
	text-align: right;
	font-family: 'Consolas', monospace;
	font-weight: 600;
	color: ${textColor};
	opacity: 1;
}


.time-value, 

.goal-value .current-val { color: inherit; }
.goal-value .sep { opacity: 0.5; margin: 0 2px; }
.goal-value .target-val { opacity: 0.8; }


.goal-value.done .current-val { color: #E74C3C !important; }


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
	align-items: flex-end;
	width: 100%;
	margin-bottom: 4px;
	gap: 2px;
}
.goal-header {
	font-size: 16px;
	color: ${textColor};
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
.goal-value .current-val { font-size: 24px; font-weight: 700; }
.goal-value .target-val { font-size: 20px; opacity: 0.8; }
.goal-value .sep { opacity: 0.4; }
.goal-value .percent { font-size: 14px; color: ${accentColor}; font-weight: normal; }

/* Custom User CSS */
${this.sanitizeCss(this.plugin.settings.obsCustomCss)}
</style>
</head>
<body>
<div class="overlay-card">
	<div class="overlay-title">
		<span class="status-dot paused" id="statusDot"></span>
	</div>
	${timeRowHtml}
	${todayGoalHtml}
	${sessionRowHtml}
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
			}
			if (d.dailyWords !== lastData.dailyWords) safeSetText('dailyWords', d.dailyWords.toLocaleString());
			if (d.dailyGoal !== lastData.dailyGoal) safeSetText('dailyGoalValue', d.dailyGoal.toLocaleString());
			if (d.dailyPercent !== lastData.dailyPercent) {
				safeSetText('dailyPercentText', d.dailyPercent + '%');
				const dailyFill = document.getElementById('dailyProgressFill');
				if (dailyFill) {
					dailyFill.style.width = d.dailyPercent + '%';
					dailyFill.className = 'progress-fill' + (d.dailyPercent >= 100 ? ' done' : '');
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
</html>`;
    return html;
  }
};

// src/ui/ImmersiveModeManager.ts
var import_obsidian18 = require("obsidian");
var ImmersiveModeManager = class {
  constructor(app, plugin) {
    this.isImmersiveActive = false;
    this.savedLayout = null;
    this.savedActiveFile = null;
    this.topBarEl = null;
    this.updateInterval = null;
    this.immersiveNovelTitle = "";
    // 追踪当前沉浸模式中的活跃叶子，用于精确抓取比例
    this.activeLeftLeaf = null;
    this.activeRightLeaf = null;
    this.activeBottomLeaf = null;
    // 顶部栏元素缓存
    this.topBarStatsEls = {};
    this.app = app;
    this.plugin = plugin;
  }
  /**
   * 切换沉浸模式状态
   */
  async toggleImmersiveMode() {
    if (this.isImmersiveActive || document.body.classList.contains("immersive-mode-active")) {
      await this.exitImmersiveMode();
    } else {
      await this.enterImmersiveMode();
    }
  }
  /**
   * 进入沉浸模式
   */
  async enterImmersiveMode() {
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian18.MarkdownView);
    if (!activeView || !activeView.file) {
      new import_obsidian18.Notice("[\u9519\u8BEF] \u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u5C0F\u8BF4\u7AE0\u8282\uFF0C\u518D\u8FDB\u5165\u6C89\u6D78\u6A21\u5F0F\uFF01");
      return;
    }
    this.savedActiveFile = activeView.file;
    this.immersiveNovelTitle = activeView.file.parent?.isRoot() ? activeView.file.basename : activeView.file.parent?.name || "\u672A\u547D\u540D\u5C0F\u8BF4";
    try {
      this.plugin.syncActiveNotesToManager();
      await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
      this.savedLayout = this.app.workspace.getLayout();
      document.body.classList.add("immersive-mode-active");
      this.createTopBar();
      await this.buildImmersiveLayout(this.savedActiveFile);
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {
          this.app.commands.executeCommandById("app:toggle-full-screen");
        });
      }
      this.plugin.startTracking();
      this.isImmersiveActive = true;
      new import_obsidian18.Notice("\u5DF2\u8FDB\u5165\u5168\u5C4F\u6C89\u6D78\u6A21\u5F0F");
    } catch (error) {
      console.error("[ImmersiveModeManager] \u8FDB\u5165\u6C89\u6D78\u6A21\u5F0F\u5931\u8D25:", error);
      new import_obsidian18.Notice("[\u9519\u8BEF] \u8FDB\u5165\u6C89\u6D78\u6A21\u5F0F\u5931\u8D25\uFF01");
      await this.exitImmersiveMode();
    }
  }
  /**
   * 退出沉浸模式并还原环境
   */
  async exitImmersiveMode() {
    try {
      this.saveCurrentPanelSizes();
      await this.plugin.saveSettings();
      const currentMainFile = this.app.workspace.getActiveViewOfType(import_obsidian18.MarkdownView)?.file;
      if (this.savedLayout) {
        await this.app.workspace.setLayout(this.savedLayout);
        if (currentMainFile) {
          requestAnimationFrame(async () => {
            const leaves = this.app.workspace.getLeavesOfType("markdown");
            const targetLeaf = leaves.find((l) => l.active) || leaves[0] || this.app.workspace.getLeaf(false);
            await targetLeaf.setViewState({
              type: "markdown",
              state: { file: currentMainFile.path },
              active: true
            });
          });
        }
      } else {
        console.warn("[ImmersiveModeManager] \u9000\u51FA\u65F6\u672A\u627E\u5230\u4FDD\u5B58\u7684\u5E03\u5C40\uFF0C\u8DF3\u8FC7\u5E03\u5C40\u8FD8\u539F");
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {
          this.app.commands.executeCommandById("app:toggle-full-screen");
        });
      }
      await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
      this.plugin.syncFloatingNotes();
      this.plugin.stopTracking();
    } catch (error) {
      console.error("[ImmersiveModeManager] \u9000\u51FA\u6C89\u6D78\u6A21\u5F0F\u65F6\u53D1\u751F\u9519\u8BEF:", error);
      new import_obsidian18.Notice("[\u8B66\u544A] \u9000\u51FA\u6C89\u6D78\u6A21\u5F0F\u51FA\u73B0\u5F02\u5E38\uFF0C\u5DF2\u5F3A\u5236\u6E05\u7406\u754C\u9762");
    } finally {
      document.body.classList.remove("immersive-mode-active");
      this.removeTopBar();
      this.isImmersiveActive = false;
      this.savedLayout = null;
      this.savedActiveFile = null;
      this.app.workspace.requestSaveLayout();
      this.activeLeftLeaf = null;
      this.activeRightLeaf = null;
      this.activeBottomLeaf = null;
      new import_obsidian18.Notice("\u5DF2\u9000\u51FA\u6C89\u6D78\u6A21\u5F0F");
    }
  }
  /**
   * 动态构建沉浸模式布局 (仅在第一次或没有保存过布局时调用)
   */
  async buildImmersiveLayout(activeFile) {
    const { workspace } = this.app;
    const { settings } = this.plugin;
    const getParentSplit = (leaf) => {
      let node = leaf.parent;
      while (node && node.direction === void 0 && node.parent) {
        node = node.parent;
      }
      return node;
    };
    let mainLeaf = null;
    const markdownLeaves = workspace.getLeavesOfType("markdown");
    mainLeaf = markdownLeaves.find((l) => l.active) || markdownLeaves[0];
    if (!mainLeaf) {
      mainLeaf = workspace.getLeaf(true);
    }
    workspace.iterateRootLeaves((leaf) => {
      if (leaf !== mainLeaf) {
        leaf.detach();
      }
    });
    await mainLeaf.setViewState({
      type: "markdown",
      state: { file: activeFile.path },
      active: true
    });
    const pendingSizes = [];
    let finalLeftLeaf = null;
    let finalRightLeaf = null;
    let finalBottomLeaf = null;
    const showBottom = settings.immersiveShowStickyNotes || settings.immersiveShowForeshadowing || settings.immersiveShowTimeline;
    if (showBottom) {
      const isTop = settings.immersivePanelPosition === "top";
      const bottomSplitLeaf = workspace.createLeafBySplit(mainLeaf, "horizontal", isTop);
      finalBottomLeaf = bottomSplitLeaf;
      const bottomSize = settings.immersiveBottomSize || 25;
      const parentSplit = getParentSplit(mainLeaf);
      if (parentSplit && parentSplit.children) {
        const size0 = isTop ? bottomSize : 100 - bottomSize;
        const size1 = isTop ? 100 - bottomSize : bottomSize;
        pendingSizes.push({ split: parentSplit, sizes: [size0, size1] });
      }
      let currentBottomLeaf = bottomSplitLeaf;
      let isFirst = true;
      let bottomPanelCount = 0;
      if (settings.immersiveShowStickyNotes) {
        await currentBottomLeaf.setViewState({ type: VIEW_TYPES.IMMERSIVE_STICKY_NOTES });
        isFirst = false;
        bottomPanelCount++;
      }
      if (settings.immersiveShowForeshadowing) {
        if (!isFirst) currentBottomLeaf = workspace.createLeafBySplit(currentBottomLeaf, "vertical", false);
        await currentBottomLeaf.setViewState({ type: VIEW_TYPES.FORESHADOWING });
        isFirst = false;
        bottomPanelCount++;
      }
      if (settings.immersiveShowTimeline) {
        if (!isFirst) currentBottomLeaf = workspace.createLeafBySplit(currentBottomLeaf, "vertical", false);
        await currentBottomLeaf.setViewState({ type: VIEW_TYPES.TIMELINE });
        bottomPanelCount++;
      }
      if (bottomPanelCount > 1) {
        const bottomInternalSplit = getParentSplit(bottomSplitLeaf);
        if (bottomInternalSplit && bottomInternalSplit.direction === "vertical" && bottomInternalSplit.children) {
          const savedSizes = settings.immersiveBottomInternalSizes;
          if (savedSizes && savedSizes.length === bottomInternalSplit.children.length) {
            pendingSizes.push({ split: bottomInternalSplit, sizes: savedSizes });
          }
        }
      }
    }
    if (settings.immersiveShowChapterList) {
      const leftLeaf = workspace.createLeafBySplit(mainLeaf, "vertical", true);
      finalLeftLeaf = leftLeaf;
      const leftSize = settings.immersiveLeftSize || 15;
      const parentSplit = getParentSplit(mainLeaf);
      if (parentSplit && parentSplit.children) {
        pendingSizes.push({ split: parentSplit, sizes: [leftSize, 100 - leftSize] });
      }
      await leftLeaf.setViewState({ type: VIEW_TYPES.IMMERSIVE_CHAPTER_LIST });
    }
    if (settings.immersiveShowReference) {
      const rightLeaf = workspace.createLeafBySplit(mainLeaf, "vertical", false);
      finalRightLeaf = rightLeaf;
      const rightSize = settings.immersiveRightSize || 15;
      const parentSplit = getParentSplit(mainLeaf);
      if (parentSplit && parentSplit.children) {
        const childCount = parentSplit.children.length;
        if (childCount === 3) {
          const leftSize = settings.immersiveLeftSize || 15;
          const centerSize = 100 - leftSize - rightSize;
          pendingSizes.push({ split: parentSplit, sizes: [leftSize, centerSize, rightSize] });
        } else {
          pendingSizes.push({ split: parentSplit, sizes: [100 - rightSize, rightSize] });
        }
      }
      await rightLeaf.setViewState({ type: "markdown" });
      rightLeaf.containerEl.classList.add("immersive-reference-view");
    }
    this.applyPendingSizes(pendingSizes);
    this.activeLeftLeaf = finalLeftLeaf;
    this.activeRightLeaf = finalRightLeaf;
    this.activeBottomLeaf = finalBottomLeaf;
    workspace.setActiveLeaf(mainLeaf, { focus: true });
  }
  /**
   * 延迟应用面板比例
   * 策略：将百分比转换为像素后使用 setElSize 应用
   * - setElSize 接受像素值，是 Obsidian 拖拽 resize handle 时使用的同一方法
   * - 同时设置 .size 以保持内部状态一致
   */
  /**
   * 延迟应用面板比例
   * 策略：使用递归重试机制，确保在 DOM 渲染完成（offsetWidth > 0）后再应用比例
   */
  applyPendingSizes(pendingSizes) {
    const apply = (attempt = 0) => {
      let hasFailure = false;
      for (const { split, sizes } of pendingSizes) {
        if (!split || !split.children || !split.containerEl) continue;
        const isHorizontal = split.direction === "horizontal";
        const totalSize = isHorizontal ? split.containerEl.offsetHeight : split.containerEl.offsetWidth;
        if (totalSize === 0) {
          hasFailure = true;
          continue;
        }
        const childCount = Math.min(split.children.length, sizes.length);
        for (let i = 0; i < childCount; i++) {
          split.children[i].size = sizes[i];
          if (typeof split.setElSize === "function" && split.children[i].containerEl) {
            const pixelSize = Math.round(sizes[i] / 100 * totalSize);
            split.setElSize(split.children[i].containerEl, pixelSize);
          }
        }
      }
      if (hasFailure && attempt < 5 && this.isImmersiveActive) {
        setTimeout(() => apply(attempt + 1), 100 * (attempt + 1));
      }
    };
    requestAnimationFrame(() => apply(0));
    setTimeout(() => apply(0), 300);
  }
  /**
   * 创建顶部仪表盘
   */
  createTopBar() {
    if (this.topBarEl) return;
    this.topBarEl = document.createElement("div");
    this.topBarEl.id = "immersive-top-bar";
    this.topBarEl.className = "immersive-top-bar";
    const leftDiv = this.topBarEl.createDiv({ cls: "immersive-top-bar-left" });
    leftDiv.createSpan({ cls: "novel-title", text: this.immersiveNovelTitle });
    const centerDiv = this.topBarEl.createDiv({ cls: "immersive-top-bar-center" });
    const rightDiv = this.topBarEl.createDiv({ cls: "immersive-top-bar-right" });
    const exitBtn = rightDiv.createEl("button", { cls: "immersive-exit-btn", text: "\u9000\u51FA\u6C89\u6D78\u6A21\u5F0F" });
    exitBtn.addEventListener("click", () => this.exitImmersiveMode());
    this.topBarStatsEls = {
      totalTime: centerDiv.createSpan({ cls: "stat-item" }),
      focusTime: centerDiv.createSpan({ cls: "stat-item focus" }),
      slackTime: centerDiv.createSpan({ cls: "stat-item slack" }),
      chapterProgress: centerDiv.createSpan({ cls: "stat-item" }),
      dailyProgress: centerDiv.createSpan({ cls: "stat-item" }),
      sessionWords: centerDiv.createSpan({ cls: "stat-item" })
    };
    for (const el of Object.values(this.topBarStatsEls)) {
      el.style.display = "none";
    }
    document.body.appendChild(this.topBarEl);
    this.renderTopBarContent();
    this.updateInterval = window.setInterval(() => {
      this.renderTopBarContent();
    }, 1e3);
  }
  removeTopBar() {
    if (this.updateInterval) {
      window.clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.topBarEl) {
      this.topBarEl.remove();
      this.topBarEl = null;
    }
  }
  renderTopBarContent() {
    if (!this.topBarEl) return;
    const { settings } = this.plugin;
    const stats = this.plugin.obsHtmlBuilder.getObsStats();
    const updateStatEl = (key, show, text) => {
      const el = this.topBarStatsEls[key];
      if (!el) return;
      if (show) {
        if (el.style.display === "none") el.style.display = "";
        if (el.innerText !== text) el.innerText = text;
      } else {
        if (el.style.display !== "none") el.style.display = "none";
      }
    };
    updateStatEl("totalTime", !!settings.immersiveShowTotalTime, `\u603B\u8BA1 (${stats.totalTime})`);
    updateStatEl("focusTime", !!settings.immersiveShowFocusTime, `\u4E13\u6CE8 (${stats.focusTime})`);
    updateStatEl("slackTime", !!settings.immersiveShowSlackTime, `\u6478\u9C7C (${stats.slackTime})`);
    updateStatEl("chapterProgress", !!settings.immersiveShowChapterProgress, `\u7AE0\u8282\u8FDB\u5EA6 (${stats.todayWords}/${stats.goal})`);
    updateStatEl("dailyProgress", !!settings.immersiveShowDailyProgress, `\u4ECA\u65E5\u8FDB\u5EA6 (${stats.dailyWords}/${stats.dailyGoal})`);
    updateStatEl("sessionWords", !!settings.immersiveShowSessionWords, `\u672C\u573A\u51C0\u589E (${stats.sessionWords})`);
  }
  /**
   * 保存当前面板比例
   * 从 WorkspaceSplit 子节点的 containerEl 测量（与 setElSize 同级），避免累积误差
   */
  saveCurrentPanelSizes() {
    const { workspace } = this.app;
    const { settings } = this.plugin;
    const getParentSplit = (leaf, direction) => {
      let node = leaf.parent;
      while (node && node.parent) {
        if (node.direction !== void 0) {
          if (!direction || node.direction === direction) return node;
        }
        node = node.parent;
      }
      return node;
    };
    const leftLeaf = this.activeLeftLeaf || workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_CHAPTER_LIST)[0];
    const refLeaf = this.activeRightLeaf || workspace.getLeavesOfType("markdown").find((l) => l.containerEl.classList.contains("immersive-reference-view"));
    const anyBottomLeaf = this.activeBottomLeaf || [
      workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_STICKY_NOTES)[0],
      workspace.getLeavesOfType(VIEW_TYPES.FORESHADOWING)[0],
      workspace.getLeavesOfType(VIEW_TYPES.TIMELINE)[0]
    ].find((l) => l);
    if (leftLeaf && leftLeaf.containerEl && leftLeaf.containerEl.offsetParent) {
      const split = getParentSplit(leftLeaf);
      if (split && split.direction === "vertical" && split.containerEl && split.children) {
        const totalWidth = split.containerEl.offsetWidth;
        if (totalWidth > 0) {
          const child = split.children.find((c) => c.containerEl && c.containerEl.contains(leftLeaf.containerEl));
          if (child) {
            settings.immersiveLeftSize = Math.round(child.containerEl.offsetWidth / totalWidth * 100);
          }
        }
      }
    }
    if (refLeaf && refLeaf.containerEl && refLeaf.containerEl.offsetParent) {
      const split = getParentSplit(refLeaf, "vertical");
      if (split && split.direction === "vertical" && split.containerEl && split.children) {
        const totalWidth = split.containerEl.offsetWidth;
        if (totalWidth > 0) {
          const child = split.children.find((c) => c.containerEl && c.containerEl.contains(refLeaf.containerEl));
          if (child) {
            const pct = Math.round(child.containerEl.offsetWidth / totalWidth * 100);
            if (pct > 0 && pct < 100) {
              settings.immersiveRightSize = pct;
            }
          }
        }
      }
    }
    if (anyBottomLeaf) {
      const split = getParentSplit(anyBottomLeaf, "horizontal");
      if (split && split.direction === "horizontal" && split.containerEl && split.children) {
        const totalHeight = split.containerEl.offsetHeight;
        if (totalHeight > 0) {
          const child = split.children.find((c) => c.containerEl && c.containerEl.contains(anyBottomLeaf.containerEl));
          if (child) {
            settings.immersiveBottomSize = Math.round(child.containerEl.offsetHeight / totalHeight * 100);
          }
        }
      }
    }
    const stickyLeaf = workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_STICKY_NOTES)[0];
    const foreLeaf = workspace.getLeavesOfType(VIEW_TYPES.FORESHADOWING)[0];
    const timeLeaf = workspace.getLeavesOfType(VIEW_TYPES.TIMELINE)[0];
    const bottomLeaves = [stickyLeaf, foreLeaf, timeLeaf].filter((l) => l);
    if (bottomLeaves.length > 1) {
      const split = getParentSplit(bottomLeaves[0]);
      if (split && split.direction === "vertical" && split.containerEl && split.children) {
        const totalWidth = split.containerEl.offsetWidth;
        if (totalWidth > 0) {
          const internalSizes = [];
          for (const child of split.children) {
            if (child.containerEl) {
              internalSizes.push(Math.round(child.containerEl.offsetWidth / totalWidth * 100));
            }
          }
          if (internalSizes.length === split.children.length) {
            settings.immersiveBottomInternalSizes = internalSizes;
          }
        }
      }
    }
    console.log("[WebNovel Assistant] \u6C89\u6D78\u6A21\u5F0F\u6BD4\u4F8B\u5DF2\u4FDD\u5B58:", {
      left: settings.immersiveLeftSize,
      right: settings.immersiveRightSize,
      bottom: settings.immersiveBottomSize,
      bottomInternal: settings.immersiveBottomInternalSizes
    });
  }
};

// src/services/StickyNoteDataManager.ts
var StickyNoteDataManager = class {
  constructor(plugin) {
    this.notesData = [];
    this.saveQueue = Promise.resolve();
    this.dirty = false;
    this.plugin = plugin;
    this.notesFilePath = `${plugin.manifest.dir}/notes-data.json`;
  }
  /**
   * 加载便签数据
   */
  async loadNotes() {
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (await adapter.exists(this.notesFilePath)) {
        const content = await adapter.read(this.notesFilePath);
        const parsed = JSON.parse(content);
        this.notesData = Array.isArray(parsed) ? parsed : [];
        if (!Array.isArray(parsed)) {
          console.warn("[StickyNoteDataManager] \u4FBF\u7B7E\u6570\u636E\u683C\u5F0F\u5F02\u5E38\uFF0C\u5DF2\u91CD\u7F6E\u4E3A\u7A7A\u6570\u7EC4");
        }
        console.log(`[StickyNoteDataManager] \u5DF2\u4ECE\u72EC\u7ACB\u6587\u4EF6\u52A0\u8F7D ${this.notesData.length} \u4E2A\u4FBF\u7B7E`);
        return this.notesData;
      }
      const settings = this.plugin.settings;
      if (settings && settings.openNotes && settings.openNotes.length > 0) {
        console.log(`[StickyNoteDataManager] \u68C0\u6D4B\u5230\u65E7\u7248\u4FBF\u7B7E\u6570\u636E\uFF0C\u5F00\u59CB\u8FC1\u79FB...`);
        this.notesData = [...settings.openNotes];
        this.dirty = true;
        await this.saveNotes(this.notesData);
        console.log(`[StickyNoteDataManager] \u5DF2\u8FC1\u79FB ${this.notesData.length} \u4E2A\u4FBF\u7B7E\u5230\u72EC\u7ACB\u6587\u4EF6`);
        return this.notesData;
      }
      console.log("[StickyNoteDataManager] \u672A\u53D1\u73B0\u73B0\u6709\u4FBF\u7B7E\u6570\u636E");
      return [];
    } catch (error) {
      console.error("[StickyNoteDataManager] \u52A0\u8F7D\u4FBF\u7B7E\u6570\u636E\u5931\u8D25:", error);
      return [];
    }
  }
  /**
   * 保存便签数据
   */
  async saveNotes(notes) {
    this.notesData = notes;
    this.dirty = true;
    this.saveQueue = this.saveQueue.then(async () => {
      if (!this.dirty) return;
      try {
        const adapter = this.plugin.app.vault.adapter;
        const content = JSON.stringify(this.notesData, null, 2);
        await adapter.write(this.notesFilePath, content);
        this.dirty = false;
        this.plugin.app.workspace.trigger("webnovel:notes-changed");
      } catch (error) {
        console.error("[StickyNoteDataManager] \u4FDD\u5B58\u4FBF\u7B7E\u6570\u636E\u5931\u8D25:", error);
      }
    });
    return this.saveQueue;
  }
  /**
   * 获取当前内存中的便签数据
   */
  getNotes() {
    return this.notesData;
  }
  /**
   * 更新单个便签数据
   */
  updateNote(noteState) {
    const index = this.notesData.findIndex((n) => n.id === noteState.id);
    if (index !== -1) {
      this.notesData[index] = { ...noteState };
    } else {
      this.notesData.push({ ...noteState });
    }
    this.dirty = true;
  }
  /**
   * 移除便签
   */
  removeNote(id) {
    this.notesData = this.notesData.filter((n) => n.id !== id);
    this.dirty = true;
  }
  /**
   * 检查是否有未保存的更改
   */
  isDirty() {
    return this.dirty;
  }
};

// src/core/CommandManager.ts
var import_obsidian19 = require("obsidian");
var CommandManager = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  registerAllCommands() {
    this.registerViewCommands();
    this.registerTrackingCommands();
    this.registerStickyNoteCommands();
    this.registerChapterCommands();
    this.registerObsCommands();
    this.registerForeshadowingCommands();
    this.registerMobileCommands();
  }
  registerViewCommands() {
    this.plugin.addCommand({
      id: "toggle-writing-status-view",
      name: "\u6253\u5F00/\u5173\u95ED\u5199\u4F5C\u5B9E\u65F6\u72B6\u6001\u9762\u677F",
      callback: () => this.plugin.toggleStatusView()
    });
    this.plugin.addCommand({
      id: "toggle-foreshadowing-view",
      name: "\u6253\u5F00/\u5173\u95ED\u4F0F\u7B14\u9762\u677F",
      callback: () => this.plugin.toggleForeshadowingView()
    });
    this.plugin.addCommand({
      id: "toggle-timeline-view",
      name: "\u6253\u5F00/\u5173\u95ED\u65F6\u95F4\u7EBF\u9762\u677F",
      callback: () => this.plugin.toggleTimelineView()
    });
    if (this.plugin.app.isMobile === false) {
      this.plugin.addCommand({
        id: "toggle-immersive-mode",
        name: "\u8FDB\u5165/\u9000\u51FA\u5168\u5C4F\u6C89\u6D78\u5199\u4F5C\u6A21\u5F0F",
        callback: () => this.plugin.immersiveModeManager.toggleImmersiveMode()
      });
      this.plugin.addCommand({
        id: "reset-immersive-layout",
        name: "\u91CD\u7F6E\u6C89\u6D78\u6A21\u5F0F\u5E03\u5C40 (\u56DE\u5230\u9ED8\u8BA4\u6BD4\u4F8B\u548C\u4F4D\u7F6E)",
        callback: async () => {
          this.plugin.settings.immersiveLayout = null;
          await this.plugin.saveSettings();
          new import_obsidian19.Notice("\u6C89\u6D78\u6A21\u5F0F\u5E03\u5C40\u5DF2\u91CD\u7F6E\uFF0C\u4E0B\u6B21\u8FDB\u5165\u751F\u6548");
        }
      });
    }
  }
  registerTrackingCommands() {
    if (this.plugin.app.isMobile === false) {
      this.plugin.addCommand({
        id: "toggle-tracking",
        name: "\u5F00\u59CB/\u6682\u505C \u4E13\u6CE8\u65F6\u95F4\u7EDF\u8BA1",
        callback: () => {
          if (this.plugin.isTracking) this.plugin.stopTracking();
          else this.plugin.startTracking();
        }
      });
      this.plugin.addCommand({
        id: "reset-stream-session",
        name: "\u91CD\u7F6E\u76F4\u64AD\u7EDF\u8BA1\u6570\u636E (\u6E05\u7A7A\u65F6\u957F\u548C\u51C0\u589E\u5B57\u6570)",
        callback: () => {
          this.plugin.focusMs = 0;
          this.plugin.slackMs = 0;
          this.plugin.sessionAddedWords = 0;
          this.plugin.isTracking = false;
          this.plugin.worker?.postMessage("stop");
          this.plugin.editorTracker.handleFileChange();
          this.plugin.exportLegacyOBS(true);
          this.plugin.refreshStatusViews();
          new import_obsidian19.Notice("\u76F4\u64AD\u6570\u636E\u5DF2\u91CD\u7F6E\uFF01\u7EDF\u8BA1\u5DF2\u6682\u505C\uFF0C\u8BF7\u624B\u52A8\u5F00\u59CB\u65B0\u7684\u573A\u6B21\u3002");
        }
      });
    }
  }
  registerStickyNoteCommands() {
    if (this.plugin.app.isMobile === false) {
      this.plugin.addCommand({
        id: "create-blank-sticky-note",
        name: "\u65B0\u5EFA\u7A7A\u767D\u60AC\u6D6E\u4FBF\u7B7E",
        callback: () => {
          this.plugin.createStickyNote({ content: "", title: "\u65B0\u4FBF\u7B7E" });
        }
      });
    }
  }
  registerChapterCommands() {
    if (this.plugin.app.isMobile === false) {
      this.plugin.addCommand({
        id: "create-next-chapter",
        name: "\u81EA\u52A8\u521B\u5EFA\u4E0B\u4E00\u7AE0 (\u667A\u80FD\u9012\u589E)",
        editorCallback: async (editor, view) => {
          const currentFile = view.file;
          if (!currentFile) return;
          const folderPath = currentFile.parent;
          const siblingNames = folderPath ? folderPath.children.filter((f) => f instanceof import_obsidian19.TFile && f.extension === "md").map((f) => f.basename) : [];
          const newFileName = ChapterSorter.getNextChapterName(currentFile.basename, siblingNames);
          if (!newFileName) {
            new import_obsidian19.Notice("\u5F53\u524D\u6587\u4EF6\u540D\u65E0\u6CD5\u8BC6\u522B\u7AE0\u8282\u53F7\uFF08\u4EC5\u652F\u6301\u6570\u5B57\u6216\u6C49\u5B57\uFF09\uFF0C\u65E0\u6CD5\u81EA\u52A8\u521B\u5EFA");
            return;
          }
          const newFilePath = folderPath && folderPath.path !== "/" ? `${folderPath.path}/${newFileName}` : newFileName;
          const existingFile = this.plugin.app.vault.getAbstractFileByPath(newFilePath);
          if (existingFile) {
            await this.plugin.app.workspace.getLeaf(false).openFile(existingFile);
            return;
          }
          try {
            const newFile = await this.plugin.app.vault.create(newFilePath, "");
            await this.plugin.app.workspace.getLeaf(false).openFile(newFile);
            new import_obsidian19.Notice(`[\u6210\u529F] \u5DF2\u521B\u5EFA: ${newFileName}`);
          } catch (error) {
            console.error(error);
            new import_obsidian19.Notice(`[\u9519\u8BEF] \u521B\u5EFA\u5931\u8D25: ${error}`);
          }
        }
      });
      this.plugin.addCommand({
        id: "rebuild-folder-cache",
        name: "\u91CD\u5EFA\u6587\u4EF6\u5939\u5B57\u6570\u7F13\u5B58",
        callback: async () => {
          if (!this.plugin.settings.showExplorerCounts) {
            new import_obsidian19.Notice('\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u542F\u7528"\u6587\u4EF6\u6D4F\u89C8\u5668\u5B57\u6570\u7EDF\u8BA1"\u529F\u80FD');
            return;
          }
          this.plugin.cacheManager.clearCache();
          const notice = new import_obsidian19.Notice("\u6B63\u5728\u91CD\u5EFA\u6587\u4EF6\u6D4F\u89C8\u5668\u7F13\u5B58...", 0);
          try {
            await this.plugin.cacheManager.buildInitialCache(
              this.plugin.app.vault,
              this.plugin.calculateAccurateWords.bind(this.plugin)
            );
            notice.hide();
            this.plugin.refreshFolderCounts();
            new import_obsidian19.Notice("[\u6210\u529F] \u7F13\u5B58\u91CD\u5EFA\u5B8C\u6210\uFF01");
          } catch (error) {
            notice.hide();
            new import_obsidian19.Notice(`[\u9519\u8BEF] \u7F13\u5B58\u91CD\u5EFA\u5931\u8D25: ${error}`);
            console.error("[Plugin] \u7F13\u5B58\u91CD\u5EFA\u5931\u8D25:", error);
          }
        }
      });
      this.plugin.addCommand({
        id: "refresh-chapter-sort",
        name: "\u624B\u52A8\u5237\u65B0\u7AE0\u8282\u6392\u5E8F\uFF08\u901A\u5E38\u4E0D\u9700\u8981\uFF09",
        callback: () => {
          if (!this.plugin.settings.enableSmartChapterSort) {
            new import_obsidian19.Notice('\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u542F\u7528"\u667A\u80FD\u7AE0\u8282\u6392\u5E8F"\u529F\u80FD');
            return;
          }
          this.plugin.fileExplorerPatcher.refreshManually();
          new import_obsidian19.Notice("[\u6210\u529F] \u7AE0\u8282\u6392\u5E8F\u5DF2\u5237\u65B0\\n\\n[\u63D0\u793A] \u6392\u5E8F\u4F1A\u81EA\u52A8\u9002\u5E94\uFF0C\u901A\u5E38\u4E0D\u9700\u8981\u624B\u52A8\u5237\u65B0");
        }
      });
    }
  }
  registerObsCommands() {
    if (this.plugin.app.isMobile === false) {
      this.plugin.addCommand({
        id: "copy-obs-overlay-url",
        name: "\u590D\u5236 OBS \u53E0\u52A0\u5C42 URL \u5230\u526A\u8D34\u677F",
        callback: () => {
          const url = `http://127.0.0.1:${this.plugin.settings.obsPort}/`;
          navigator.clipboard.writeText(url);
          new import_obsidian19.Notice(`\u5DF2\u590D\u5236: ${url}`);
        }
      });
    }
  }
  registerForeshadowingCommands() {
    this.plugin.addCommand({
      id: "mark-as-foreshadowing",
      name: "\u6807\u6CE8\u4E3A\u4F0F\u7B14",
      editorCheckCallback: (checking, editor, view) => {
        const selectedText = editor.getSelection();
        if (!selectedText || !selectedText.trim()) return false;
        if (checking) return true;
        const file = view.file;
        if (!file) return false;
        const submitCallback = (tags, description) => {
          this.plugin.foreshadowingManager.addForeshadowing(file, selectedText, description, tags).then(({ file: foreshadowFile, merged }) => {
            if (merged) {
              new import_obsidian19.Notice(`[\u6210\u529F] \u5DF2\u5408\u5E76\u5230\u540C\u540D\u4F0F\u7B14\u6761\u76EE\u300C${foreshadowFile.name}\u300D`, 5e3);
            } else {
              new import_obsidian19.Notice(`[\u6210\u529F] \u5DF2\u6807\u6CE8\u4E3A\u4F0F\u7B14\uFF0C\u4FDD\u5B58\u81F3\u300C${foreshadowFile.name}\u300D`, 5e3);
            }
            if (this.plugin.app.isMobile === false) {
              const notice = new import_obsidian19.Notice("[\u63D0\u793A] \u70B9\u51FB\u6B64\u5904\u6253\u5F00\u4F0F\u7B14\u6587\u4EF6", 8e3);
              notice.noticeEl.style.cursor = "pointer";
              notice.noticeEl.onclick = () => {
                this.plugin.foreshadowingManager.openForeshadowingFile(foreshadowFile);
                notice.hide();
              };
            }
          }).catch((err) => {
            console.error("[ForeshadowingManager] addForeshadowing failed:", err);
            new import_obsidian19.Notice(`[\u9519\u8BEF] \u6807\u6CE8\u5931\u8D25\uFF1A${err}`);
          });
        };
        if (this.plugin.foreshadowingManager.foreshadowingFileExists(file)) {
          new ForeshadowingInputModal(this.plugin.app, this.plugin, file.basename, selectedText, submitCallback).open();
        } else {
          const fileName = this.plugin.settings.foreshadowing?.fileName || "\u4F0F\u7B14";
          const folderPath = file.parent?.path || "";
          new ConfirmCreateForeshadowingFileModal(this.plugin.app, fileName, folderPath, () => {
            new ForeshadowingInputModal(this.plugin.app, this.plugin, file.basename, selectedText, submitCallback).open();
          }).open();
        }
        return true;
      }
    });
    this.plugin.addCommand({
      id: "mark-foreshadowing-recovered",
      name: "\u6807\u8BB0\u4F0F\u7B14\u5DF2\u56DE\u6536",
      editorCheckCallback: (checking, editor, view) => {
        const file = view.file;
        if (!file) return false;
        const foreshadowingFileName = (this.plugin.settings.foreshadowing?.fileName || "\u4F0F\u7B14") + ".md";
        if (file.name !== foreshadowingFileName) return false;
        if (checking) return true;
        const cursorLine = editor.getCursor().line;
        const entry = this.plugin.foreshadowingManager.getEntryAtCursor(editor, cursorLine);
        if (entry) {
          new ForeshadowingRecoveryModal(
            this.plugin.app,
            entry.contentPreview,
            file.parent?.path || "",
            async (selectedChapters) => {
              const success = await this.plugin.foreshadowingManager.markAsRecovered(
                file,
                entry.sourceFile,
                entry.createdAt,
                selectedChapters
              );
              if (success) {
                const links = selectedChapters.map((c) => `[[${c}]]`).join("\u3001");
                new import_obsidian19.Notice(`[\u6210\u529F] \u5DF2\u6807\u8BB0\u4E3A\u5DF2\u56DE\u6536\uFF1A${links}`);
              } else {
                new import_obsidian19.Notice("[\u9519\u8BEF] \u672A\u627E\u5230\u5BF9\u5E94\u7684\u4F0F\u7B14\u6761\u76EE\uFF0C\u8BF7\u786E\u8BA4\u5149\u6807\u4F4D\u7F6E");
              }
            }
          ).open();
          return true;
        } else {
          new import_obsidian19.Notice("[\u9519\u8BEF] \u8BF7\u5C06\u5149\u6807\u653E\u5728\u4F0F\u7B14\u6761\u76EE\u4E0A");
          return true;
        }
      }
    });
  }
  registerMobileCommands() {
    this.plugin.addCommand({
      id: "copy-full-content-mobile",
      name: "\u590D\u5236\u672C\u6587\u6863",
      editorCallback: (editor, view) => {
        const rawContent = editor.getValue();
        const title = view.file?.basename ?? "";
        const contentWithTitle = title ? `${title}

${rawContent}` : rawContent;
        navigator.clipboard.writeText(contentWithTitle).then(() => {
          new import_obsidian19.Notice(`[\u6210\u529F] \u5DF2\u590D\u5236\u672C\u6587\u6863`);
        }).catch(() => {
          new import_obsidian19.Notice("[\u9519\u8BEF] \u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
        });
      }
    });
  }
};

// src/ui/ImmersiveChapterListView.ts
var import_obsidian20 = require("obsidian");
var ImmersiveChapterListView = class extends import_obsidian20.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPES.IMMERSIVE_CHAPTER_LIST;
  }
  getDisplayText() {
    return "\u6C89\u6D78\u7AE0\u8282\u5217\u8868";
  }
  getIcon() {
    return "list";
  }
  async onOpen() {
    this.refresh();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
  }
  /**
   * 刷新章节列表内容
   */
  async refresh() {
    const { containerEl } = this;
    containerEl.empty();
    const listContainer = containerEl.createDiv({ cls: "immersive-chapter-list" });
    let currentFolder = null;
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      currentFolder = activeFile.parent;
    }
    if (!currentFolder) {
      const mdLeaves = this.app.workspace.getLeavesOfType("markdown");
      for (const leaf of mdLeaves) {
        const view = leaf.view;
        if (view && view.file) {
          currentFolder = view.file.parent;
          break;
        }
      }
    }
    if (!currentFolder) {
      listContainer.createEl("p", { text: "\u6B63\u5728\u52A0\u8F7D\u6587\u4EF6\u5939\u4FE1\u606F...", cls: "immersive-empty-text" });
      setTimeout(() => {
        if (this.app.workspace.getActiveFile()) this.refresh();
      }, 1e3);
      return;
    }
    let files = currentFolder.children.filter((f) => f instanceof import_obsidian20.TFile && f.extension === "md");
    if (this.plugin.settings.enableSmartChapterSort) {
      files.sort((a, b) => ChapterSorter.compareFiles(a, b));
    } else {
      files.sort((a, b) => a.basename.localeCompare(b.basename, void 0, { numeric: true }));
    }
    for (const file of files) {
      const itemEl = listContainer.createDiv({ cls: "immersive-chapter-item" });
      itemEl.createSpan({ text: file.basename });
      const wordCount = this.plugin.cacheManager.getFileCache(file.path) || 0;
      if (this.plugin.settings.showExplorerCounts) {
        itemEl.createSpan({ text: `${wordCount}\u5B57`, cls: "immersive-chapter-count" });
      }
      itemEl.addEventListener("click", () => {
        const leaves = this.app.workspace.getLeavesOfType("markdown");
        if (leaves.length > 0) {
          leaves[0].openFile(file);
        }
      });
      itemEl.addEventListener("contextmenu", async (e) => {
        e.preventDefault();
        const { workspace } = this.app;
        let refLeaf = null;
        workspace.iterateRootLeaves((leaf) => {
          if (leaf.containerEl && leaf.containerEl.classList.contains("immersive-reference-view")) {
            refLeaf = leaf;
          }
        });
        if (!refLeaf) {
          const mdLeaves = workspace.getLeavesOfType("markdown");
          if (mdLeaves.length > 1) {
            refLeaf = mdLeaves[1];
          }
        }
        if (!refLeaf) {
          const emptyLeaves = workspace.getLeavesOfType("empty");
          if (emptyLeaves.length > 0) {
            refLeaf = emptyLeaves[0];
          }
        }
        if (!refLeaf) {
          const mainLeaf = workspace.getLeavesOfType("markdown")[0];
          if (mainLeaf) {
            refLeaf = workspace.createLeafBySplit(mainLeaf, "vertical", false);
            refLeaf.containerEl.classList.add("immersive-reference-view");
            this.plugin.settings.immersiveShowReference = true;
            this.plugin.saveSettings();
          }
        }
        if (refLeaf) {
          if (refLeaf.view.getViewType() !== "markdown") {
            await refLeaf.setViewState({ type: "markdown", active: false });
          }
          await refLeaf.openFile(file);
        }
      });
    }
  }
  async onClose() {
  }
};

// src/ui/ImmersiveStickyNotesView.ts
var import_obsidian21 = require("obsidian");
var FileSuggestModal = class extends import_obsidian21.FuzzySuggestModal {
  constructor(app, plugin, onChoose) {
    super(app);
    this.plugin = plugin;
    this.onChoose = onChoose;
    this.setPlaceholder("\u641C\u7D22\u8981\u4F5C\u4E3A\u4FBF\u7B7E\u6253\u5F00\u7684\u6587\u6863...");
  }
  getItems() {
    return this.app.vault.getMarkdownFiles();
  }
  getItemText(file) {
    return file.path;
  }
  onChooseItem(file, evt) {
    this.onChoose(file);
  }
};
var ImmersiveStickyNotesView = class extends import_obsidian21.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.lastSavedContents = /* @__PURE__ */ new Map();
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPES.IMMERSIVE_STICKY_NOTES;
  }
  getDisplayText() {
    return "\u4FBF\u7B7E\u5217\u8868";
  }
  getIcon() {
    return "sticky-note";
  }
  createNewNote(filePath, content, title) {
    const themeIndex = this.plugin.settings.nextNoteThemeIndex || 0;
    const themes = this.plugin.settings.noteThemes || [];
    const theme = themes[themeIndex] || { bg: "#FDF3B8", text: "#2C3E50" };
    this.plugin.settings.nextNoteThemeIndex = (themeIndex + 1) % Math.max(1, themes.length);
    const newNote = {
      id: Math.random().toString(36).substr(2, 9),
      filePath,
      content: content || "",
      title: title || "\u65B0\u5EFA\u4FBF\u7B7E",
      top: "100px",
      // 在沉浸模式下这些值不重要，但需要给个默认值
      left: "100px",
      width: "300px",
      height: "300px",
      color: theme.bg,
      textColor: theme.text,
      isEditing: true
      // 默认可编辑
    };
    this.plugin.stickyNoteManager.updateNote(newNote);
    this.lastSavedContents.set(newNote.id, newNote.content || "");
    this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes()).then(() => {
      this.renderNotes();
    });
    this.plugin.saveSettings();
  }
  async renderNotes() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.style.position = "relative";
    containerEl.style.display = "flex";
    containerEl.style.flexDirection = "column";
    containerEl.style.height = "100%";
    containerEl.style.overflow = "hidden";
    const hoverTrigger = containerEl.createDiv({ cls: "immersive-sticky-trigger" });
    hoverTrigger.style.position = "absolute";
    hoverTrigger.style.top = "0";
    hoverTrigger.style.left = "0";
    hoverTrigger.style.right = "0";
    hoverTrigger.style.height = "15px";
    hoverTrigger.style.zIndex = "9";
    const toolbar = containerEl.createDiv({ cls: "immersive-sticky-toolbar" });
    toolbar.style.display = "flex";
    toolbar.style.gap = "8px";
    toolbar.style.padding = "8px";
    toolbar.style.borderBottom = "1px solid var(--background-modifier-border)";
    toolbar.style.backgroundColor = "var(--background-secondary)";
    toolbar.style.position = "absolute";
    toolbar.style.top = "0";
    toolbar.style.left = "0";
    toolbar.style.right = "0";
    toolbar.style.zIndex = "10";
    toolbar.style.opacity = "0";
    toolbar.style.transition = "opacity 0.2s";
    toolbar.style.pointerEvents = "none";
    let hideTimeout;
    const showToolbar = () => {
      clearTimeout(hideTimeout);
      toolbar.style.opacity = "1";
      toolbar.style.pointerEvents = "auto";
    };
    const hideToolbar = () => {
      hideTimeout = window.setTimeout(() => {
        toolbar.style.opacity = "0";
        toolbar.style.pointerEvents = "none";
      }, 200);
    };
    hoverTrigger.addEventListener("mouseenter", showToolbar);
    hoverTrigger.addEventListener("mouseleave", hideToolbar);
    toolbar.addEventListener("mouseenter", showToolbar);
    toolbar.addEventListener("mouseleave", hideToolbar);
    const newBlankBtn = toolbar.createEl("button", { text: "\u65B0\u5EFA\u7A7A\u767D\u4FBF\u7B7E" });
    newBlankBtn.onclick = () => this.createNewNote();
    const openFileBtn = toolbar.createEl("button", { text: "\u6253\u5F00\u6587\u4EF6\u4E3A\u4FBF\u7B7E" });
    openFileBtn.onclick = () => {
      new FileSuggestModal(this.app, this.plugin, async (file) => {
        const content = await this.app.vault.read(file);
        this.createNewNote(file.path, content, file.basename);
      }).open();
    };
    const dockContainer = containerEl.createDiv({ cls: "immersive-sticky-dock" });
    dockContainer.style.flex = "1";
    dockContainer.style.overflowX = "auto";
    dockContainer.style.overflowY = "hidden";
    dockContainer.style.display = "flex";
    dockContainer.style.flexDirection = "row";
    dockContainer.style.flexWrap = "nowrap";
    dockContainer.style.gap = "10px";
    dockContainer.style.padding = "10px";
    dockContainer.style.paddingTop = "10px";
    dockContainer.style.alignItems = "center";
    dockContainer.addEventListener("wheel", (evt) => {
      if (evt.shiftKey) return;
      const target = evt.target;
      if (target.tagName.toLowerCase() === "textarea") {
        const ta = target;
        const canScrollUp = ta.scrollTop > 0;
        const canScrollDown = Math.ceil(ta.scrollTop + ta.clientHeight) < ta.scrollHeight;
        if (evt.deltaY < 0 && canScrollUp || evt.deltaY > 0 && canScrollDown) {
          return;
        }
      }
      if (evt.deltaY !== 0) {
        evt.preventDefault();
        dockContainer.scrollLeft += evt.deltaY;
      }
    });
    const notes = this.plugin.stickyNoteManager.getNotes();
    if (notes.length === 0) {
      dockContainer.createEl("p", { text: "\u6682\u65E0\u6253\u5F00\u7684\u4FBF\u7B7E\u3002\u70B9\u51FB\u4E0A\u65B9\u6309\u94AE\u65B0\u5EFA\u6216\u6253\u5F00\u6587\u4EF6\u3002", cls: "immersive-empty-text" });
      return;
    }
    for (const noteData of notes) {
      if (!this.lastSavedContents.has(noteData.id)) {
        this.lastSavedContents.set(noteData.id, noteData.content || "");
      }
      const noteCard = dockContainer.createDiv({ cls: "immersive-sticky-card" });
      noteCard.style.backgroundColor = noteData.color || "#FDF3B8";
      const noteSize = (this.plugin.settings.immersiveNoteSize || 280) + "px";
      noteCard.style.width = noteSize;
      noteCard.style.height = noteSize;
      noteCard.style.flex = "0 0 auto";
      noteCard.style.display = "flex";
      noteCard.style.flexDirection = "column";
      noteCard.style.borderRadius = "8px";
      noteCard.style.boxShadow = "0 4px 10px rgba(0,0,0,0.15)";
      noteCard.style.overflow = "hidden";
      noteCard.style.boxSizing = "border-box";
      if (noteData.textColor) {
        noteCard.style.color = noteData.textColor;
      }
      const titleEl = noteCard.createDiv({ cls: "immersive-sticky-title" });
      titleEl.style.display = "flex";
      titleEl.style.justifyContent = "space-between";
      titleEl.style.alignItems = "center";
      titleEl.style.padding = "4px 8px";
      titleEl.style.borderBottom = "1px solid rgba(0,0,0,0.1)";
      titleEl.style.backgroundColor = "rgba(0,0,0,0.05)";
      const titleSpan = titleEl.createSpan();
      titleSpan.setText(noteData.title || "\u4FBF\u7B7E");
      titleSpan.style.fontWeight = "bold";
      titleSpan.style.fontSize = "0.9em";
      titleSpan.style.whiteSpace = "nowrap";
      titleSpan.style.overflow = "hidden";
      titleSpan.style.textOverflow = "ellipsis";
      const closeBtn = titleEl.createSpan({ cls: "clickable-icon", text: "\xD7" });
      closeBtn.style.fontSize = "1.2em";
      closeBtn.style.lineHeight = "1";
      closeBtn.style.cursor = "pointer";
      closeBtn.style.padding = "0 4px";
      closeBtn.title = "\u5173\u95ED\u4FBF\u7B7E";
      const performRemove = async () => {
        this.plugin.stickyNoteManager.removeNote(noteData.id);
        this.lastSavedContents.delete(noteData.id);
        await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
        this.renderNotes();
      };
      closeBtn.onclick = async () => {
        const currentContent = noteData.content || "";
        const lastSaved = this.lastSavedContents.get(noteData.id) || "";
        if (!this.plugin.settings.stickyNoteAutoSave && currentContent !== lastSaved) {
          const modal = new ConfirmCloseModal(this.app, async (shouldSave) => {
            if (shouldSave) {
              if (noteData.filePath) {
                const file = this.app.vault.getAbstractFileByPath(noteData.filePath);
                if (file instanceof import_obsidian21.TFile) {
                  await this.app.vault.modify(file, currentContent);
                  new import_obsidian21.Notice("[\u6210\u529F] \u4FBF\u7B7E\u5DF2\u4FDD\u5B58");
                }
                await performRemove();
              } else {
                const saveModal = new SaveStickyNoteModal(this.app, this.plugin, async (fileName, folderPath) => {
                  try {
                    const fullPath = (folderPath ? `${folderPath}/` : "") + (fileName.endsWith(".md") ? fileName : `${fileName}.md`);
                    if (this.app.vault.getAbstractFileByPath(fullPath)) {
                      new import_obsidian21.Notice(`[\u9519\u8BEF] \u6587\u4EF6\u5DF2\u5B58\u5728: ${fullPath}`);
                      return;
                    }
                    await this.app.vault.create(fullPath, currentContent);
                    new import_obsidian21.Notice(`[\u6210\u529F] \u5DF2\u4FDD\u5B58\u4E3A: ${fullPath}`);
                    await performRemove();
                  } catch (error) {
                    new import_obsidian21.Notice(`[\u9519\u8BEF] \u4FDD\u5B58\u5931\u8D25: ${error}`);
                  }
                });
                saveModal.open();
              }
            } else {
              await performRemove();
            }
          });
          modal.open();
        } else {
          await performRemove();
        }
      };
      const textarea = noteCard.createEl("textarea");
      textarea.value = noteData.content || "";
      textarea.style.flex = "1";
      textarea.style.minHeight = "200px";
      textarea.style.resize = "none";
      textarea.style.padding = "8px";
      textarea.style.border = "none";
      textarea.style.background = "transparent";
      textarea.style.color = "inherit";
      textarea.style.fontSize = (this.plugin.settings.immersiveNoteFontSize || 14) + "px";
      textarea.style.lineHeight = "1.5";
      textarea.style.fontFamily = "inherit";
      textarea.style.outline = "none";
      textarea.style.width = "100%";
      textarea.style.boxSizing = "border-box";
      textarea.style.overflowY = "auto";
      textarea.addEventListener("input", () => {
        noteData.content = textarea.value;
        if (this.plugin.settings.stickyNoteAutoSave) {
          const debounceKey = `immersive-save-note-${noteData.id}`;
          this.plugin.adaptiveDebounceManager.debounceFixed(debounceKey, async () => {
            await this.plugin.stickyNoteManager.saveNotes(this.plugin.stickyNoteManager.getNotes());
            this.lastSavedContents.set(noteData.id, textarea.value);
            if (noteData.filePath) {
              const file = this.app.vault.getAbstractFileByPath(noteData.filePath);
              if (file instanceof import_obsidian21.TFile) {
                await this.app.vault.modify(file, textarea.value);
              }
            }
          }, 500);
        }
      });
    }
  }
  async onOpen() {
    this.containerEl.style.display = "flex";
    this.containerEl.style.flexDirection = "column";
    await this.renderNotes();
  }
  async onClose() {
  }
};

// src/core/ViewManager.ts
var ViewManager = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  registerAllViews() {
    this.plugin.registerView(STATUS_VIEW_TYPE, (leaf) => new WritingStatusView(leaf, this.plugin));
    this.plugin.registerView(FORESHADOWING_VIEW_TYPE, (leaf) => new ForeshadowingView(leaf, this.plugin));
    this.plugin.registerView(TIMELINE_VIEW_TYPE, (leaf) => new TimelineView(leaf, this.plugin));
    if (this.plugin.app.isMobile === false) {
      this.plugin.registerView(VIEW_TYPES.IMMERSIVE_CHAPTER_LIST, (leaf) => new ImmersiveChapterListView(leaf, this.plugin));
      this.plugin.registerView(VIEW_TYPES.IMMERSIVE_STICKY_NOTES, (leaf) => new ImmersiveStickyNotesView(leaf, this.plugin));
    }
  }
  async toggleView(viewType) {
    const { workspace } = this.plugin.app;
    let leaf = null;
    const leaves = workspace.getLeavesOfType(viewType);
    if (leaves.length > 0) {
      leaf = leaves[0];
      workspace.detachLeaf(leaf);
    } else {
      if (this.plugin.app.isMobile) {
        const rightLeaf = workspace.getRightLeaf(false);
        if (rightLeaf) {
          leaf = rightLeaf;
          await leaf.setViewState({ type: viewType, active: true });
        }
      } else {
        leaf = workspace.getRightLeaf(false);
        if (leaf) {
          await leaf.setViewState({ type: viewType, active: true });
        } else {
          const newLeaf = workspace.getLeaf("tab");
          if (newLeaf) {
            leaf = newLeaf;
            await leaf.setViewState({ type: viewType, active: true });
          }
        }
      }
      if (leaf) {
        workspace.revealLeaf(leaf);
        if (this.plugin.app.isMobile) {
          workspace.rightSplit?.expand();
        }
      }
    }
  }
};

// src/core/MenuManager.ts
var import_obsidian23 = require("obsidian");

// src/ui/GoalModal.ts
var import_obsidian22 = require("obsidian");
var GoalModal = class extends import_obsidian22.Modal {
  constructor(app, file) {
    super(app);
    this.goalInput = "";
    this.file = file;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: `\u4E3A\u300A${this.file.basename}\u300B\u8BBE\u5B9A\u76EE\u6807` });
    new import_obsidian22.Setting(contentEl).setName("\u76EE\u6807\u5B57\u6570").setDesc("\u8F93\u5165 0 \u6216\u6E05\u7A7A\u5219\u6062\u590D\u5168\u5C40\u9ED8\u8BA4\u76EE\u6807\u3002").addText((text) => {
      const cache = this.app.metadataCache.getFileCache(this.file);
      if (cache?.frontmatter && cache.frontmatter["word-goal"]) {
        text.setValue(cache.frontmatter["word-goal"].toString());
      }
      text.inputEl.focus();
      text.onChange((value) => {
        this.goalInput = value;
      });
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.saveGoal();
      });
    });
    new import_obsidian22.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("\u4FDD\u5B58").setCta().onClick(() => {
        this.saveGoal();
      })
    );
  }
  async saveGoal() {
    const goalNum = parseInt(this.goalInput);
    await this.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
      if (isNaN(goalNum) || goalNum <= 0) {
        delete frontmatter["word-goal"];
      } else {
        frontmatter["word-goal"] = goalNum;
      }
    });
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/core/MenuManager.ts
var MenuManager = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  registerAllMenus() {
    this.plugin.registerEvent(this.plugin.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof import_obsidian23.TFile && file.extension === "md") {
        menu.addItem((item) => {
          item.setTitle("\u8BBE\u5B9A\u672C\u7AE0\u76EE\u6807\u5B57\u6570").setIcon("target").onClick(() => {
            new GoalModal(this.plugin.app, file).open();
          });
        });
        menu.addItem((item) => {
          item.setTitle("\u590D\u5236\u672C\u6587\u6863").setIcon("copy").onClick(async () => {
            try {
              const rawContent = await this.plugin.app.vault.read(file);
              const title = file.basename;
              const contentWithTitle = `${title}

${rawContent}`;
              await navigator.clipboard.writeText(contentWithTitle);
              new import_obsidian23.Notice(`[\u6210\u529F] \u5DF2\u590D\u5236\u672C\u6587\u6863`);
            } catch (err) {
              console.error("[Plugin] \u590D\u5236\u5931\u8D25:", err);
              new import_obsidian23.Notice("[\u9519\u8BEF] \u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
            }
          });
        });
        if (this.plugin.app.isMobile === false) {
          menu.addItem((item) => {
            item.setTitle("\u62BD\u51FA\u4E3A\u4FBF\u7B7E").setIcon("popup-open").onClick(() => {
              this.plugin.createStickyNote({ file });
            });
          });
        }
      }
      if (file instanceof import_obsidian23.TFolder && this.plugin.app.isMobile === false) {
        menu.addItem((item) => {
          item.setTitle("\u5408\u5E76\u7AE0\u8282").setIcon("documents").onClick(() => this.handleMergeChapters(file));
        });
      }
    }));
    this.plugin.registerEvent(this.plugin.app.workspace.on("editor-menu", (menu, editor, view) => {
      if (editor.somethingSelected()) {
        menu.addItem((item) => {
          item.setTitle("\u6807\u6CE8\u4E3A\u4F0F\u7B14").setIcon("bookmark").onClick(() => {
            this.plugin.app.commands.executeCommandById("web-novel-assistant:mark-as-foreshadowing");
          });
        });
        menu.addItem((item) => {
          item.setTitle("\u6DFB\u52A0\u5230\u65F6\u95F4\u7EBF").setIcon("calendar-clock").onClick(async () => {
            const selectedText = editor.getSelection();
            if (!selectedText.trim()) {
              new import_obsidian23.Notice("\u8BF7\u5148\u9009\u4E2D\u6587\u5B57");
              return;
            }
            const chapterName = view.file?.basename || "";
            const folderPath = view.file?.parent?.path || "";
            new TimelineAddFromSelectionModal(
              this.plugin.app,
              this.plugin,
              this.plugin.settings.timeline?.fileName || "\u65F6\u95F4\u7EBF",
              selectedText.trim(),
              chapterName,
              folderPath,
              async (result) => {
                await new TimelineManager(this.plugin.app, this.plugin, folderPath).appendEntry({
                  time: result.time,
                  description: result.description,
                  chapter: result.chapter,
                  type: result.type,
                  rawBlock: ""
                });
                new import_obsidian23.Notice("[\u6210\u529F] \u5DF2\u6DFB\u52A0\u5230\u65F6\u95F4\u7EBF");
                const leaves = this.plugin.app.workspace.getLeavesOfType("timeline-view");
                if (leaves.length > 0) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  await leaves[0].view.refresh();
                }
              }
            ).open();
          });
        });
        if (this.plugin.app.isMobile === false) {
          menu.addItem((item) => {
            item.setTitle("\u62BD\u51FA\u4E3A\u4FBF\u7B7E").setIcon("quote").onClick(() => {
              this.plugin.createStickyNote({ content: editor.getSelection(), title: "\u9009\u4E2D\u7247\u6BB5" });
            });
          });
        }
      }
      if (view.file) {
        menu.addItem((item) => {
          item.setTitle("\u8BBE\u5B9A\u672C\u7AE0\u76EE\u6807\u5B57\u6570").setIcon("target").onClick(() => {
            new GoalModal(this.plugin.app, view.file).open();
          });
        });
        menu.addItem((item) => {
          item.setTitle("\u590D\u5236\u672C\u6587\u6863").setIcon("copy").onClick(async () => {
            try {
              const rawContent = await this.plugin.app.vault.read(view.file);
              const title = view.file.basename;
              const contentWithTitle = `${title}

${rawContent}`;
              await navigator.clipboard.writeText(contentWithTitle);
              new import_obsidian23.Notice(`[\u6210\u529F] \u5DF2\u590D\u5236\u672C\u6587\u6863`);
            } catch (err) {
              console.error("[Plugin] \u590D\u5236\u5931\u8D25:", err);
              new import_obsidian23.Notice("[\u9519\u8BEF] \u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
            }
          });
        });
        if (this.plugin.app.isMobile === false) {
          menu.addItem((item) => {
            item.setTitle("\u5F53\u524D\u6587\u4EF6\u62BD\u51FA\u4E3A\u4FBF\u7B7E").setIcon("popup-open").onClick(() => {
              this.plugin.createStickyNote({ file: view.file });
            });
          });
        }
      }
    }));
  }
  async handleMergeChapters(file) {
    const notice = new import_obsidian23.Notice(`\u6B63\u5728\u626B\u63CF\u5E76\u5408\u5E76${file.name}...`, 0);
    const mdFiles = [];
    const collectFiles = (folder) => {
      for (const child of folder.children) {
        if (child instanceof import_obsidian23.TFile && child.extension === "md") {
          if (ChapterSorter.isChapterFile(child.name)) {
            mdFiles.push(child);
          }
        } else if (child instanceof import_obsidian23.TFolder) {
          collectFiles(child);
        }
      }
    };
    collectFiles(file);
    if (mdFiles.length === 0) {
      notice.hide();
      new import_obsidian23.Notice(`\u6587\u4EF6\u5939${file.name}\u4E2D\u6CA1\u6709\u627E\u5230\u7AE0\u8282\u6587\u4EF6`);
      return;
    }
    mdFiles.sort((a, b) => ChapterSorter.compareFiles(a, b));
    let mergedContent = `# \u5408\u5E76\u7AE0\u8282\uFF1A${file.name}

`;
    let totalWords = 0;
    for (const mdFile of mdFiles) {
      const content = await this.plugin.app.vault.cachedRead(mdFile);
      mergedContent += `

## ${mdFile.basename}

`;
      mergedContent += content;
      totalWords += this.plugin.calculateAccurateWords(content);
    }
    let exportPath = `${file.parent?.path === "/" ? "" : file.parent?.path + "/"}${file.name}_\u5408\u5E76\u7AE0\u8282.md`;
    let counter = 1;
    while (this.plugin.app.vault.getAbstractFileByPath(exportPath)) {
      exportPath = `${file.parent?.path === "/" ? "" : file.parent?.path + "/"}${file.name}_\u5408\u5E76\u7AE0\u8282(${counter}).md`;
      counter++;
    }
    try {
      const newFile = await this.plugin.app.vault.create(exportPath, mergedContent.trim());
      notice.hide();
      await this.plugin.app.workspace.getLeaf(false).openFile(newFile);
      new import_obsidian23.Notice(`[\u6210\u529F] \u5408\u5E76\u6210\u529F\uFF01
\u5DF2\u5408\u5E76 ${mdFiles.length} \u4E2A\u7AE0\u8282
\u603B\u8BA1 ${totalWords.toLocaleString()} \u5B57`, 8e3);
    } catch (error) {
      console.error(error);
      notice.hide();
      new import_obsidian23.Notice("\u5408\u5E76\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u6743\u9650");
    }
  }
};

// src/editor/WordCountGutter.ts
var import_state = require("@codemirror/state");
var import_view = require("@codemirror/view");
var WordCountMarker = class extends import_view.GutterMarker {
  constructor(count) {
    super();
    this.count = count;
  }
  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "webnovel-word-count-marker-wrapper";
    wrapper.appendChild(document.createTextNode("\u200B"));
    const span = document.createElement("span");
    span.className = "webnovel-word-count-marker";
    span.textContent = `${this.count}\u5B57`;
    wrapper.appendChild(span);
    return wrapper;
  }
  eq(other) {
    return this.count === other.count;
  }
};
function getFileFromView(view, plugin) {
  if (view.file) return view.file;
  const values = view.state.values;
  if (Array.isArray(values)) {
    const editorInfo = values.find((v) => v && v.file && typeof v.file.path === "string");
    if (editorInfo) return editorInfo.file;
  }
  let file = null;
  plugin.app.workspace.iterateAllLeaves((l) => {
    const leafView = l.view;
    if (!leafView) return;
    const cm = leafView.editor?.cm || leafView.editor?.cm?.cm;
    if (cm === view || leafView.containerEl && leafView.containerEl.contains(view.dom)) {
      file = leafView.file;
    }
  });
  return file;
}
function createWordCountGutter(plugin) {
  const wordCountStateField = import_state.StateField.define({
    create(state) {
      const lineCounts = [];
      const doc = state.doc;
      const lines = doc.lines;
      for (let i = 1; i <= lines; i++) {
        const lineText = doc.line(i).text;
        lineCounts.push(plugin.calculateAccurateWords(lineText));
      }
      return { lineCounts, markers: null };
    },
    update(value, tr) {
      if (!tr.docChanged) {
        return value;
      }
      const lineCounts = [];
      const doc = tr.state.doc;
      const lines = doc.lines;
      for (let i = 1; i <= lines; i++) {
        const lineText = doc.line(i).text;
        const count = plugin.calculateAccurateWords(lineText);
        lineCounts.push(count);
      }
      return { lineCounts, markers: null };
    }
  });
  const wordCountGutter = (0, import_view.gutter)({
    class: "webnovel-word-count-gutter",
    markers: (view) => {
      const builder = new import_state.RangeSetBuilder();
      if (!plugin.settings.enableWordCountGutter) return builder.finish();
      const file = getFileFromView(view, plugin);
      if (!file || !plugin.isFileInWorkspace(file)) {
        return builder.finish();
      }
      if (plugin.settings.enableStrictChapterMode && !ChapterSorter.isChapterFile(file.name)) {
        return builder.finish();
      }
      const interval = parseInt(plugin.settings.wordCountInterval) || 2e3;
      const state = view.state.field(wordCountStateField);
      let currentTotal = 0;
      let nextTarget = interval;
      const doc = view.state.doc;
      const lines = doc.lines;
      for (let i = 1; i <= lines; i++) {
        const lineCount = state.lineCounts[i - 1] || 0;
        currentTotal += lineCount;
        if (currentTotal >= nextTarget && lineCount > 0) {
          const reachedTarget = Math.floor(currentTotal / interval) * interval;
          const linePos = doc.line(i).from;
          builder.add(linePos, linePos, new WordCountMarker(reachedTarget));
          nextTarget = reachedTarget + interval;
        }
      }
      return builder.finish();
    }
  });
  const wordCountWorkspacePlugin = import_view.ViewPlugin.fromClass(class {
    constructor(view) {
      this.updateClass(view);
    }
    update(update) {
      this.updateClass(update.view);
    }
    updateClass(view) {
      if (!plugin.settings.enableWordCountGutter) {
        view.dom.classList.remove("webnovel-show-gutter");
        return;
      }
      const file = getFileFromView(view, plugin);
      const inWorkspace = file && plugin.isFileInWorkspace(file);
      const strictOk = !plugin.settings.enableStrictChapterMode || file && ChapterSorter.isChapterFile(file.name);
      if (inWorkspace && strictOk) {
        view.dom.classList.add("webnovel-show-gutter");
      } else {
        view.dom.classList.remove("webnovel-show-gutter");
      }
    }
  });
  return [
    wordCountStateField,
    wordCountGutter,
    wordCountWorkspacePlugin
  ];
}

// main.ts
var AccurateChineseCountPlugin = class extends import_obsidian24.Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.wordCountExtensionHolder = [];
    this.isTracking = false;
    this.focusMs = 0;
    this.slackMs = 0;
    this.lastTickTime = 0;
    this.sessionAddedWords = 0;
    this.lastFileWords = 0;
    this.lastFilePath = "";
    this.lastEditTime = Date.now();
    this.worker = null;
    this.activeNotes = [];
    this.obsServer = null;
    this.mobileFloatingStats = null;
    // Worker 重启控制
    this.workerRestartAttempts = 0;
    this.MAX_WORKER_RESTARTS = 5;
    this.workerRestartTimer = null;
    this.isLayoutReady = false;
    this.wordCountElCache = /* @__PURE__ */ new WeakMap();
    this.cacheManager = new CacheManager(this);
    this.adaptiveDebounceManager = new AdaptiveDebounceManager();
    this.settingsManager = new SettingsManager(this, DEFAULT_SETTINGS);
    this.historyManager = new HistoryDataManager(this);
    this.stickyNoteManager = new StickyNoteDataManager(this);
    this.fileExplorerPatcher = new FileExplorerPatcher(this.app);
    this.obsHtmlBuilder = new ObsHtmlBuilder(this);
    this.wordCounter = new WordCounter();
    this.immersiveModeManager = new ImmersiveModeManager(this.app, this);
    this.commandManager = new CommandManager(this);
    this.viewManager = new ViewManager(this);
    this.menuManager = new MenuManager(this);
  }
  async onload() {
    await this.setupCoreFeatures();
    this.registerInterval(window.setInterval(() => {
      if (this.isTracking) {
        this.saveSettings().catch((err) => {
          console.error("[Plugin] \u5B9A\u671F\u4FDD\u5B58\u8BBE\u7F6E\u5931\u8D25:", err);
        });
      }
      this.cacheManager.saveCache().catch((err) => {
        console.error("[Plugin] \u5B9A\u671F\u4FDD\u5B58\u7F13\u5B58\u5931\u8D25:", err);
      });
      this.historyManager.saveHistory().catch((err) => {
        console.error("[Plugin] \u5B9A\u671F\u4FDD\u5B58\u5386\u53F2\u6570\u636E\u5931\u8D25:", err);
      });
    }, 60 * 1e3));
    this.app.workspace.onLayoutReady(() => {
      this.isLayoutReady = true;
    });
  }
  /**
   * 设置核心功能（跨越平台）
   * - 字数统计
   * - 目标追踪
   * - 状态栏显示
   * - 设置页面
   */
  async setupCoreFeatures() {
    await this.loadSettings();
    await this.historyManager.loadHistory();
    await this.stickyNoteManager.loadNotes();
    if (this.settings.openNotes && this.settings.openNotes.length > 0) {
      console.log("[Plugin] \u6570\u636E\u6E05\u7406\uFF1A\u65E7\u7248\u4FBF\u7B7E\u6570\u636E\u5DF2\u8FC1\u79FB\uFF0C\u4ECE settings \u4E2D\u79FB\u9664");
      this.settings.openNotes = [];
      await this.saveSettings();
    }
    await this.loadFloatingNotes();
    this.registerEvent(this.app.workspace.on("webnovel:notes-changed", () => {
      this.syncFloatingNotes();
      this.refreshImmersiveNotes();
    }));
    this.editorTracker = new EditorTracker(this.app, this);
    this.styleManager = new StyleManager(this.settings);
    this.styleManager.injectGlobalStyles();
    if (this.settings.eyeCareEnabled) this.styleManager.applyEyeCare();
    if (this.settings.immersiveTypewriterMode) {
      document.body.classList.add("immersive-typewriter-mode");
    }
    this.foreshadowingManager = new ForeshadowingManager(this.app, this);
    this.statusBarItemEl = this.addStatusBarItem();
    this.addSettingTab(new AccurateCountSettingTab(this.app, this));
    if (this.settings.enableWordCountGutter) {
      this.wordCountExtensionHolder.push(createWordCountGutter(this));
    }
    this.registerEditorExtension(this.wordCountExtensionHolder);
    this.registerEvent(this.app.workspace.on("webnovel:word-count-gutter-settings-changed", () => {
      this.wordCountExtensionHolder.length = 0;
      if (this.settings.enableWordCountGutter) {
        this.wordCountExtensionHolder.push(createWordCountGutter(this));
      }
      this.app.workspace.updateOptions();
    }));
    this.commandManager.registerAllCommands();
    this.viewManager.registerAllViews();
    this.menuManager.registerAllMenus();
    this.registerCommonRibbonIcons();
    this.registerEvent(this.app.workspace.on("editor-change", () => {
      this.adaptiveDebounceManager.debounce("editor-update", () => {
        this.editorTracker.handleEditorChange();
      });
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.editorTracker.handleFileChange();
    }));
    this.registerEvent(this.app.metadataCache.on("changed", () => {
      this.adaptiveDebounceManager.debounceFixed("word-count-update", () => {
        this.editorTracker.updateWordCount();
      }, 100);
    }));
    this.editorTracker.handleFileChange();
    this.editorTracker.updateWordCount();
    const platformTier = getPlatformTier();
    if (platformTier === "tablet") {
      this.setupTabletMode();
      return;
    }
    if (isMobile()) {
      this.setupFloatingStats();
      if (this.settings.showExplorerCounts) {
        this.app.workspace.onLayoutReady(() => {
          setTimeout(() => {
            this.buildFolderCache();
          }, 1500);
        });
      }
      this.registerEvent(this.app.workspace.on("layout-change", () => {
        if (this.settings.showExplorerCounts) {
          this.adaptiveDebounceManager.debounceFixed("mobile-folder-refresh", () => {
            this.refreshFolderCounts();
          }, 300);
        }
      }));
      return;
    }
    this.app.workspace.onLayoutReady(() => {
      setTimeout(() => {
        this.buildFolderCache();
      }, 500);
    });
    this.registerEvent(this.app.vault.on("modify", async (file) => {
      if (file instanceof import_obsidian24.TFile && file.extension === "md") {
        if (!this.isEligibleForWordCount(file)) return;
        const activeView = this.app.workspace.getActiveViewOfType(import_obsidian24.MarkdownView);
        const isActiveFile = activeView?.file?.path === file.path;
        if (!isActiveFile) {
          try {
            const content = await this.app.vault.cachedRead(file);
            const newWordCount = this.calculateAccurateWords(content);
            const oldWordCount = this.cacheManager.getFileCache(file.path);
            if (oldWordCount === null) {
              this.cacheManager.updateFileCache(file, newWordCount, this.app.vault);
              this.adaptiveDebounceManager.debounceFixed("folder-refresh", () => {
                this.updateFileCacheAndRefresh(file);
              }, 500);
              return;
            }
            const delta = newWordCount - oldWordCount;
            if (delta !== 0) {
              this.cacheManager.updateFileCache(file, newWordCount, this.app.vault);
              if (this.isLayoutReady) {
                const today = window.moment().format("YYYY-MM-DD");
                this.historyManager.addWords(today, delta);
                this.sessionAddedWords += delta;
                this.adaptiveDebounceManager.debounceFixed("save-settings", () => {
                  this.saveSettings().catch((err) => {
                    console.error("[Plugin] \u4FDD\u5B58\u8BBE\u7F6E\u5931\u8D25:", err);
                  });
                }, 1e3);
              }
            }
          } catch (error) {
            console.error("[Plugin] \u66F4\u65B0\u6BCF\u65E5\u5386\u53F2\u7EDF\u8BA1\u5931\u8D25:", error);
          }
        }
        this.adaptiveDebounceManager.debounceFixed("folder-refresh", () => {
          this.updateFileCacheAndRefresh(file);
        }, 500);
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian24.TFile && file.extension === "md") {
        if (!this.isEligibleForWordCount(file)) return;
        this.cacheManager.invalidateCache(file.path, this.app.vault);
        this.adaptiveDebounceManager.debounceFixed("folder-refresh", () => {
          this.refreshFolderCounts();
        }, 500);
      }
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof import_obsidian24.TFile && file.extension === "md") {
        if (!this.isFileInWorkspace(file)) return;
        const oldCache = this.cacheManager.getFileCache(oldPath);
        this.cacheManager.invalidateCache(oldPath, this.app.vault);
        if (this.isEligibleForWordCount(file) && oldCache !== null) {
          this.cacheManager.updateFileCache(file, oldCache, this.app.vault);
        }
        this.adaptiveDebounceManager.debounceFixed("folder-refresh", () => {
          this.updateFileCacheAndRefresh(file);
        }, 500);
      }
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.adaptiveDebounceManager.debounceFixed("folder-refresh", () => {
        this.refreshFolderCounts();
      }, 500);
    }));
    this.addRibbonIcon("sticky-note", "\u65B0\u5EFA\u7A7A\u767D\u60AC\u6D6E\u4FBF\u7B7E", () => {
      this.createStickyNote({ content: "", title: "\u65B0\u4FBF\u7B7E" });
    });
    this.setupDesktopFeatures();
  }
  // 专注计时逻辑
  /**
   * 开始专注计时
   */
  startTracking() {
    if (this.isTracking) return;
    if (!this.worker) {
      this.setupWorker();
    }
    this.isTracking = true;
    this.lastTickTime = Date.now();
    this.lastEditTime = Date.now();
    this.worker?.postMessage("start");
    this.editorTracker.updateWordCount();
    this.exportLegacyOBS(true);
    this.refreshStatusViews();
    new import_obsidian24.Notice("[\u8BB0\u5F55\u4E2D] \u4E13\u6CE8\u8BA1\u65F6\u5DF2\u5F00\u59CB");
  }
  /**
   * 停止专注计时
   */
  stopTracking() {
    if (!this.isTracking) return;
    this.isTracking = false;
    this.worker?.postMessage("stop");
    this.editorTracker.updateWordCount();
    this.exportLegacyOBS(true);
    this.refreshStatusViews();
    new import_obsidian24.Notice("[\u5DF2\u6682\u505C] \u4E13\u6CE8\u8BA1\u65F6\u5DF2\u6682\u505C");
  }
  setupDesktopFeatures() {
    this.setupWorker();
    if (this.settings.enableObs) {
      this.obsServer = new ObsOverlayServer(this, this.settings.obsPort);
      this.obsServer.start();
    }
    if (this.settings.enableSmartChapterSort) {
      ChapterSorter.setCustomRules(this.settings.chapterNamingRules || []);
      this.app.workspace.onLayoutReady(() => {
        this.fileExplorerPatcher.enable();
      });
    }
    this.registerMarkdownPostProcessor((el, ctx) => {
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!(file instanceof import_obsidian24.TFile)) return;
      const foreshadowingFileName = (this.settings.foreshadowing?.fileName || "\u4F0F\u7B14") + ".md";
      if (file.name !== foreshadowingFileName) return;
      el.querySelectorAll("p, li").forEach((p) => {
        const text = p.textContent || "";
        if (!text.includes("\u72B6\u6001") || !text.includes("\u672A\u56DE\u6536")) return;
        const strongs = p.querySelectorAll("strong");
        let statusStrong = null;
        strongs.forEach((s) => {
          if (s.textContent === "\u72B6\u6001") statusStrong = s;
        });
        if (!statusStrong) return;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.title = "\u6807\u8BB0\u4E3A\u5DF2\u56DE\u6536";
        checkbox.style.cssText = "margin-left:8px;cursor:pointer;vertical-align:middle;width:15px;height:15px;accent-color:var(--interactive-accent);";
        checkbox.addEventListener("change", async (e) => {
          e.preventDefault();
          checkbox.checked = false;
          const content = await this.app.vault.read(file);
          const lines = content.split("\n");
          const sectionInfo = ctx.getSectionInfo(el);
          if (!sectionInfo) return;
          let titleLine = -1;
          let createdAt = "";
          let sourceFileName = "";
          let contentPreview = "";
          for (let i = sectionInfo.lineStart; i >= 0; i--) {
            const match = lines[i].match(/^## \[\[(.+?)\]\](?:\s*-\s*(.+))?$/);
            if (match) {
              sourceFileName = match[1];
              createdAt = match[2]?.trim() || "";
              titleLine = i;
              break;
            }
          }
          if (titleLine === -1) return;
          for (let i = titleLine + 1; i < lines.length; i++) {
            if (lines[i].startsWith("> ")) {
              contentPreview = lines[i].replace(/^> /, "");
              break;
            }
            if (/^## \[\[/.test(lines[i])) break;
          }
          new ForeshadowingRecoveryModal(this.app, contentPreview, file.parent?.path || "", async (recoveryFileNames) => {
            const success = await this.foreshadowingManager.markAsRecovered(
              file,
              sourceFileName,
              createdAt,
              recoveryFileNames
            );
            if (success) {
              const fileList = recoveryFileNames.map((f) => `[[${f}]]`).join("\u3001");
              new import_obsidian24.Notice(`[\u6210\u529F] \u5DF2\u6807\u8BB0\u4E3A\u5DF2\u56DE\u6536\uFF1A${fileList}`);
            } else {
              new import_obsidian24.Notice("[\u9519\u8BEF] \u672A\u627E\u5230\u5BF9\u5E94\u7684\u4F0F\u7B14\u6761\u76EE");
            }
          }).open();
        });
        p.appendChild(checkbox);
      });
    });
  }
  /**
   * 注册共享 Ribbon 图标（平板端和桌面端都需要）
   */
  registerCommonRibbonIcons() {
    this.addRibbonIcon("bar-chart-2", "\u6253\u5F00/\u5173\u95ED\u5199\u4F5C\u5B9E\u65F6\u72B6\u6001\u9762\u677F", () => {
      this.toggleStatusView();
    });
    this.addRibbonIcon("bookmark", "\u6253\u5F00/\u5173\u95ED\u4F0F\u7B14\u9762\u677F", () => {
      this.toggleForeshadowingView();
    });
    this.addRibbonIcon("calendar-clock", "\u6253\u5F00/\u5173\u95ED\u65F6\u95F4\u7EBF\u9762\u677F", () => {
      this.toggleTimelineView();
    });
    if (isDesktop()) {
      this.addRibbonIcon("expand", "\u8FDB\u5165/\u9000\u51FA\u5168\u5C4F\u6C89\u6D78\u5199\u4F5C\u6A21\u5F0F", () => {
        this.immersiveModeManager.toggleImmersiveMode();
      });
    }
  }
  /**
   * 统一的浮动统计窗口设置
   * 用于移动端和平板端
   */
  setupFloatingStats() {
    if (!this.settings.showMobileFloatingStats) return;
    this.mobileFloatingStats = new MobileFloatingStats(this.app, this);
    this.app.workspace.onLayoutReady(() => {
      this.mobileFloatingStats?.load();
    });
    this.registerEvent(this.app.workspace.on("editor-change", () => {
      this.adaptiveDebounceManager.debounce("mobile-stats-update", () => {
        this.mobileFloatingStats?.update();
      });
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.mobileFloatingStats?.update();
    }));
  }
  /**
   * 设置平板端中间模式
   * 启用面板功能，但不启用重度功能（Worker、OBS、缓存）
   */
  setupTabletMode() {
    this.setupFloatingStats();
    if (this.settings.showExplorerCounts) {
      this.app.workspace.onLayoutReady(() => {
        setTimeout(() => {
          this.buildFolderCache();
        }, 1e3);
      });
      this.registerEvent(this.app.workspace.on("layout-change", () => {
        if (this.settings.showExplorerCounts) {
          this.adaptiveDebounceManager.debounceFixed("tablet-folder-refresh", () => {
            this.refreshFolderCounts();
          }, 300);
        }
      }));
    }
  }
  /**
   * 从独立文件加载并显示浮动便签
   */
  async loadFloatingNotes() {
    if (!isDesktop()) return;
    const notes = this.stickyNoteManager.getNotes();
    for (const noteState of notes) {
      if (this.activeNotes.some((n) => n.state.id === noteState.id)) continue;
      const newNote = new FloatingStickyNote(this.app, this, { state: noteState });
      newNote.load();
    }
  }
  /**
   * 将所有活跃悬浮便签的当前内容强制同步到管理器
   * 通常在切换工作区（如进入沉浸模式）或插件卸载前调用
   */
  syncActiveNotesToManager() {
    if (!isDesktop()) return;
    this.activeNotes.forEach((note) => {
      if (note.state.isEditing && note.textareaEl) {
        note.state.content = note.textareaEl.value;
      }
      this.stickyNoteManager.updateNote(note.state);
    });
    this.stickyNoteManager.saveNotes(this.stickyNoteManager.getNotes()).catch((err) => {
      console.error("[Plugin] syncActiveNotesToManager \u4FDD\u5B58\u4FBF\u7B7E\u5931\u8D25:", err);
    });
  }
  /**
   * 同步沉浸模式产生的便签变更到桌面悬浮便签
   */
  syncFloatingNotes() {
    if (!isDesktop()) return;
    const notes = this.stickyNoteManager.getNotes();
    const openNoteIds = new Set(notes.map((n) => n.id));
    [...this.activeNotes].forEach((note) => {
      if (!openNoteIds.has(note.state.id)) {
        note.destroy();
      }
    });
    notes.forEach((noteState) => {
      const activeNote = this.activeNotes.find((n) => n.state.id === noteState.id);
      if (activeNote) {
        activeNote.state = noteState;
        activeNote.renderContent();
        activeNote.updateVisuals();
      } else {
        const newNote = new FloatingStickyNote(this.app, this, { state: noteState });
        newNote.load();
      }
    });
  }
  /**
   * 创建便签（处理沉浸模式同步）
   */
  async createStickyNote(options) {
    if (!isDesktop()) {
      if (!document.body.classList.contains("immersive-mode-active")) {
        new import_obsidian24.Notice("\u60AC\u6D6E\u4FBF\u7B7E\u529F\u80FD\u4EC5\u5728\u684C\u9762\u7AEF\u53EF\u7528");
        return;
      }
    }
    const note = new FloatingStickyNote(this.app, this, options);
    await note.load();
    if (document.body.classList.contains("immersive-mode-active")) {
      setTimeout(() => {
        this.refreshImmersiveNotes();
      }, 200);
    }
  }
  /**
   * 刷新所有沉浸模式便签列表视图
   */
  refreshImmersiveNotes() {
    const activeEl = document.activeElement;
    if (activeEl && activeEl.tagName.toLowerCase() === "textarea" && (activeEl.closest(".immersive-sticky-card") || activeEl.closest(".my-sticky-note"))) {
      return;
    }
    this.app.workspace.getLeavesOfType(VIEW_TYPES.IMMERSIVE_STICKY_NOTES).forEach((leaf) => {
      if (leaf.view.getViewType() === VIEW_TYPES.IMMERSIVE_STICKY_NOTES) {
        leaf.view.renderNotes?.();
      }
    });
  }
  async onunload() {
    if (this.immersiveModeManager) {
      await this.immersiveModeManager.exitImmersiveMode();
    }
    if (this.obsServer) {
      this.obsServer.stop();
      this.obsServer = null;
    }
    if (this.mobileFloatingStats) {
      this.mobileFloatingStats.unload();
      this.mobileFloatingStats = null;
    }
    if (this.activeNotes) {
      [...this.activeNotes].forEach((note) => {
        const currentContent = note.state.isEditing ? note.textareaEl?.value : note.state.content;
        if (currentContent !== void 0) note.state.content = currentContent;
        this.stickyNoteManager.updateNote(note.state);
        note.destroy();
      });
      this.activeNotes = [];
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.adaptiveDebounceManager.cancelAll();
    if (this.workerRestartTimer) {
      clearTimeout(this.workerRestartTimer);
      this.workerRestartTimer = null;
    }
    if (this.styleManager) {
      this.styleManager.removeGlobalStyles();
      this.styleManager.removeEyeCare();
    }
    if (this.fileExplorerPatcher) {
      this.fileExplorerPatcher.disable();
      this.fileExplorerPatcher.unpatch();
    }
    try {
      await this.saveSettings();
      await this.historyManager.saveHistory();
      await this.stickyNoteManager.saveNotes(this.stickyNoteManager.getNotes());
      console.log("[WebNovel Assistant] \u6240\u6709\u6570\u636E\u5DF2\u5B89\u5168\u4FDD\u5B58");
    } catch (e) {
      console.error("[WebNovel Assistant] \u5378\u8F7D\u65F6\u4FDD\u5B58\u6570\u636E\u5931\u8D25:", e);
    }
    console.log("[WebNovel Assistant] Plugin unloaded and resources cleaned up");
  }
  /**
   * 构建文件浏览器缓存
   */
  async buildFolderCache() {
    if (!this.settings.showExplorerCounts) return;
    try {
      const loaded = await this.cacheManager.loadCache();
      const allFiles = this.app.vault.getMarkdownFiles();
      const workspaceFiles = allFiles.filter((f) => this.isEligibleForWordCount(f));
      const cacheStats = this.cacheManager.getCacheStats();
      console.log(`[Plugin] \u7F13\u5B58\u5B8C\u6574\u6027\u68C0\u67E5: ${cacheStats.size} \u6761\u76EE vs ${workspaceFiles.length} \u6587\u4EF6\uFF08\u5DE5\u4F5C\u533A\uFF09`);
      const shouldRebuild = !loaded || cacheStats.size < workspaceFiles.length;
      if (loaded && !shouldRebuild) {
        if (isMobile()) {
          setTimeout(() => {
            this.refreshFolderCounts();
          }, 500);
        } else {
          this.refreshFolderCounts();
        }
        console.log("[Plugin] \u5DF2\u4ECE\u6301\u4E45\u5316\u5B58\u50A8\u52A0\u8F7D\u7F13\u5B58");
        return;
      }
      if (loaded && shouldRebuild) {
        console.log(`[Plugin] \u7F13\u5B58\u4E0D\u5B8C\u6574\uFF08${cacheStats.size} \u6761\u76EE vs ${workspaceFiles.length} \u6587\u4EF6\uFF09\uFF0C\u91CD\u65B0\u6784\u5EFA...`);
      } else if (!loaded) {
        console.log("[Plugin] \u7F13\u5B58\u4E0D\u5B58\u5728\uFF0C\u5F00\u59CB\u6784\u5EFA...");
      }
      const notice = new import_obsidian24.Notice("\u6B63\u5728\u6784\u5EFA\u6587\u4EF6\u6D4F\u89C8\u5668\u7F13\u5B58...", 0);
      await this.cacheManager.buildInitialCache(
        this.app.vault,
        this.calculateAccurateWords.bind(this),
        this.isEligibleForWordCount.bind(this)
      );
      notice.hide();
      if (isMobile()) {
        setTimeout(() => {
          this.refreshFolderCounts();
        }, 500);
      } else {
        this.refreshFolderCounts();
      }
      new import_obsidian24.Notice("\u6587\u4EF6\u6D4F\u89C8\u5668\u7F13\u5B58\u6784\u5EFA\u5B8C\u6210", 3e3);
    } catch (error) {
      console.error("[Plugin] \u7F13\u5B58\u6784\u5EFA\u5931\u8D25:", error);
      this.settings.showExplorerCounts = false;
      await this.saveSettings();
      new import_obsidian24.Notice(
        `\u6587\u4EF6\u6D4F\u89C8\u5668\u7F13\u5B58\u6784\u5EFA\u5931\u8D25\uFF0C\u5DF2\u81EA\u52A8\u7981\u7528\u8BE5\u529F\u80FD
\u60A8\u4ECD\u53EF\u4EE5\u6B63\u5E38\u4F7F\u7528\u5176\u4ED6\u529F\u80FD
\u9519\u8BEF: ${error instanceof Error ? error.message : String(error)}`,
        1e4
      );
    }
  }
  /**
   * 更新文件缓存并刷新显示
   */
  async updateFileCacheAndRefresh(file) {
    try {
      const content = await this.app.vault.cachedRead(file);
      const wordCount = this.calculateAccurateWords(content);
      this.cacheManager.updateFileCache(file, wordCount, this.app.vault);
      this.refreshFolderCounts();
      this.adaptiveDebounceManager.debounceFixed("save-cache", () => {
        this.cacheManager.saveCache().catch((err) => {
          console.error("[Plugin] \u4FDD\u5B58\u7F13\u5B58\u5931\u8D25:", err);
        });
      }, 5e3);
    } catch (error) {
      console.error("[Plugin] \u66F4\u65B0\u6587\u4EF6\u7F13\u5B58\u5931\u8D25:", error);
      this.cacheManager.invalidateCache(file.path, this.app.vault);
    }
  }
  async toggleStatusView() {
    await this.viewManager.toggleView(STATUS_VIEW_TYPE);
  }
  async loadSettings() {
    this.settings = await this.settingsManager.loadSettings();
  }
  async toggleForeshadowingView() {
    await this.viewManager.toggleView(FORESHADOWING_VIEW_TYPE);
  }
  async toggleTimelineView() {
    await this.viewManager.toggleView(TIMELINE_VIEW_TYPE);
  }
  async saveSettings() {
    await this.settingsManager.saveSettings();
  }
  /**
   * 检查文件是否在工作区文件夹内
   * @param file 要检查的文件
   * @returns 如果工作区为空或文件在工作区内，返回 true
   */
  isFileInWorkspace(file) {
    if (!this.settings.workspaceFolders || this.settings.workspaceFolders.length === 0) {
      return true;
    }
    const filePath = file.path;
    return this.settings.workspaceFolders.some((folder) => {
      const normalizedFolder = folder.replace(/^\/+|\/+$/g, "");
      if (normalizedFolder === "") return true;
      return filePath === normalizedFolder + ".md" || filePath.startsWith(normalizedFolder + "/");
    });
  }
  /**
   * 检查文件是否符合字数统计的条件
   * @param file 要检查的文件
   * @returns 如果符合条件返回 true
   */
  isEligibleForWordCount(file) {
    if (!this.isFileInWorkspace(file)) return false;
    if (file.basename.includes("_\u5408\u5E76\u7AE0\u8282")) return false;
    if (this.settings.enableStrictChapterMode && !ChapterSorter.isChapterFile(file.name)) {
      return false;
    }
    return true;
  }
  calculateAccurateWords(text) {
    return this.wordCounter.calculateAccurateWords(text);
  }
  updateWordCount() {
    this.editorTracker.updateWordCount();
  }
  injectGlobalStyles() {
    this.styleManager.injectGlobalStyles();
  }
  removeGlobalStyles() {
    this.styleManager.removeGlobalStyles();
  }
  applyEyeCare() {
    this.styleManager.applyEyeCare();
  }
  removeEyeCare() {
    this.styleManager.removeEyeCare();
  }
  setupWorker() {
    if (this.workerRestartAttempts >= this.MAX_WORKER_RESTARTS) {
      new import_obsidian24.Notice("[\u8B66\u544A] \u65F6\u95F4\u8FFD\u8E2A\u529F\u80FD\u591A\u6B21\u542F\u52A8\u5931\u8D25\uFF0C\u5DF2\u81EA\u52A8\u7981\u7528\u3002\u8BF7\u91CD\u542F Obsidian \u6216\u68C0\u67E5\u6D4F\u89C8\u5668\u8BBE\u7F6E\u3002", 8e3);
      console.error("[Plugin] Worker \u8FBE\u5230\u6700\u5927\u91CD\u542F\u6B21\u6570\uFF0C\u5DF2\u505C\u6B62\u5C1D\u8BD5");
      return;
    }
    const workerCode = `
			let interval;
			self.onmessage = function(e) {
				if (e.data === 'start') {
					clearInterval(interval);
					interval = setInterval(() => self.postMessage('tick'), 1000);
				} else if (e.data === 'stop') {
					clearInterval(interval);
				}
			};
		`;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    this.worker = new Worker(blobUrl);
    URL.revokeObjectURL(blobUrl);
    this.worker.onerror = (error) => {
      this.workerRestartAttempts++;
      console.error(
        `[WebNovel Assistant] Worker \u9519\u8BEF (\u5C1D\u8BD5 ${this.workerRestartAttempts}/${this.MAX_WORKER_RESTARTS}):`,
        "\n  \u6D88\u606F:",
        error.message,
        "\n  \u6587\u4EF6:",
        error.filename,
        "\n  \u884C\u53F7:",
        error.lineno,
        "\n  \u5217\u53F7:",
        error.colno
      );
      const wasTracking = this.isTracking;
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      if (this.workerRestartTimer) {
        clearTimeout(this.workerRestartTimer);
        this.workerRestartTimer = null;
      }
      this.workerRestartTimer = window.setTimeout(() => {
        console.log("[WebNovel Assistant] \u6B63\u5728\u91CD\u542F Worker...");
        this.setupWorker();
        if (wasTracking && this.worker) {
          this.worker.postMessage("start");
          this.lastTickTime = Date.now();
          console.log("[WebNovel Assistant] Worker \u5DF2\u91CD\u542F\uFF0C\u8FFD\u8E2A\u72B6\u6001\u5DF2\u6062\u590D");
        }
        if (this.workerRestartAttempts < this.MAX_WORKER_RESTARTS) {
          new import_obsidian24.Notice("[\u8B66\u544A] \u65F6\u95F4\u8FFD\u8E2A Worker \u5DF2\u81EA\u52A8\u91CD\u542F\n\u8FFD\u8E2A\u529F\u80FD\u5DF2\u6062\u590D\u6B63\u5E38", 5e3);
        }
      }, 5e3);
    };
    this.worker.onmessage = () => {
      if (!this.isTracking) return;
      const now = Date.now();
      const delta = now - this.lastTickTime;
      this.lastTickTime = now;
      const isAppFocused = document.hasFocus();
      const isTypingActive = now - this.lastEditTime < this.settings.idleTimeoutThreshold;
      const today = window.moment().format("YYYY-MM-DD");
      if (isAppFocused && isTypingActive) {
        this.focusMs += delta;
        this.historyManager.addFocusTime(today, delta);
      } else {
        this.slackMs += delta;
        this.historyManager.addSlackTime(today, delta);
      }
      this.adaptiveDebounceManager.debounceFixed("save-history-worker", () => {
        this.historyManager.saveHistory().catch((err) => {
          console.error("[Plugin] \u4FDD\u5B58\u5386\u53F2\u6570\u636E\u5931\u8D25:", err);
        });
      }, 6e4);
      this.refreshStatusViews();
      if (this.settings.enableLegacyObsExport) this.exportLegacyOBS();
      if (this.settings.enableObs && this.obsServer) {
      }
    };
    if (this.workerRestartAttempts > 0) {
      setTimeout(() => {
        this.workerRestartAttempts = 0;
        console.log("[Plugin] Worker \u8FD0\u884C\u7A33\u5B9A\uFF0C\u91CD\u542F\u8BA1\u6570\u5668\u5DF2\u91CD\u7F6E");
      }, 6e4);
    }
  }
  refreshStatusViews() {
    const leaves = this.app.workspace.getLeavesOfType(STATUS_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof WritingStatusView) {
        leaf.view.updateData();
        leaf.view.renderChart();
      }
    }
  }
  exportLegacyOBS(force = false) {
    if (!isDesktop() || !this.settings.enableLegacyObsExport || !this.settings.obsPath) return;
    try {
      const fs = window.require("fs");
      const path = window.require("path");
      const dir = this.settings.obsPath;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const totalSec = Math.floor((this.focusMs + this.slackMs) / 1e3);
      const focusSec = Math.floor(this.focusMs / 1e3);
      const slackSec = totalSec - focusSec;
      fs.writeFileSync(path.join(dir, "obs_focus_time.txt"), formatTime(focusSec), "utf8");
      fs.writeFileSync(path.join(dir, "obs_slack_time.txt"), formatTime(slackSec), "utf8");
      fs.writeFileSync(path.join(dir, "obs_total_time.txt"), formatTime(totalSec), "utf8");
      fs.writeFileSync(path.join(dir, "obs_words_done.txt"), Math.max(0, this.sessionAddedWords).toString(), "utf8");
      let currentGoal = this.settings.defaultGoal;
      const view = this.app.workspace.getActiveViewOfType(import_obsidian24.MarkdownView);
      if (view?.file) {
        const cache = this.app.metadataCache.getFileCache(view.file);
        const fmGoal = parseInt(cache?.frontmatter?.["word-goal"]);
        if (!isNaN(fmGoal)) currentGoal = fmGoal;
      }
      fs.writeFileSync(path.join(dir, "obs_words_goal.txt"), currentGoal.toString(), "utf8");
    } catch (e) {
      if (force) {
        console.error("[WebNovel Assistant] Legacy OBS export failed:", e);
      } else {
        console.warn("[WebNovel Assistant] Legacy OBS export failed (silent mode):", e);
      }
    }
  }
  getObsStats() {
    return this.obsHtmlBuilder.getObsStats();
  }
  buildObsOverlayHtml() {
    return this.obsHtmlBuilder.buildObsOverlayHtml();
  }
  // [BUGFIX] 此方法内部无任何 await，移除多余的 async 标记，
  // 避免调用方误以为需要 await 从而产生隐式的 Promise 包装开销。
  refreshFolderCounts() {
    try {
      const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
      if (!fileExplorer || !fileExplorer.view) return;
      const view = fileExplorer.view;
      if (!view.fileItems || typeof view.fileItems !== "object") return;
      const fileExplorerItems = view.fileItems;
      if (!this.settings.showExplorerCounts) {
        for (const path in fileExplorerItems) {
          const item = fileExplorerItems[path];
          if (item.el) {
            const countEl = this.wordCountElCache.get(item.el) || item.el.querySelector(".folder-word-count");
            if (countEl) {
              countEl.remove();
              this.wordCountElCache.delete(item.el);
            }
          }
        }
        return;
      }
      let updatedCount = 0;
      for (const path in fileExplorerItems) {
        const item = fileExplorerItems[path];
        if (item.el && (item.file instanceof import_obsidian24.TFolder || item.file instanceof import_obsidian24.TFile && item.file.extension === "md")) {
          let isInWorkspace = true;
          if (item.file instanceof import_obsidian24.TFile) {
            isInWorkspace = this.isEligibleForWordCount(item.file);
          } else if (item.file instanceof import_obsidian24.TFolder) {
            if (this.settings.workspaceFolders && this.settings.workspaceFolders.length > 0) {
              const folderPath = item.file.path;
              isInWorkspace = this.settings.workspaceFolders.some((workspace) => {
                const normalizedWorkspace = workspace.replace(/^\/+|\/+$/g, "");
                return folderPath.startsWith(normalizedWorkspace) || normalizedWorkspace.startsWith(folderPath);
              });
            }
          }
          if (!isInWorkspace) continue;
          const count = this.cacheManager.getFolderCount(path);
          if (count === null) continue;
          const labelText = count > 0 ? ` (${formatCount(count)})` : "";
          let countEl = this.wordCountElCache.get(item.el);
          if (!countEl) {
            countEl = item.el.querySelector(".folder-word-count");
            if (!countEl) {
              const titleContent = item.el.querySelector(".nav-folder-title-content") || item.el.querySelector(".nav-file-title-content");
              if (titleContent) {
                countEl = titleContent.createEl("span", { cls: "folder-word-count" });
                countEl.style.fontSize = "0.8em";
                countEl.style.opacity = "0.5";
                countEl.style.marginLeft = "5px";
              }
            }
            if (countEl) {
              this.wordCountElCache.set(item.el, countEl);
            }
          }
          if (countEl && countEl.textContent !== labelText) {
            countEl.textContent = labelText;
            updatedCount++;
          }
        }
      }
      if (updatedCount > 0) {
        console.debug(`[WebNovel Assistant] refreshFolderCounts: Updated ${updatedCount} items`);
      }
    } catch (error) {
      console.error("[WebNovel Assistant] refreshFolderCounts failed:", error);
    }
  }
};
