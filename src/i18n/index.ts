import { Logger } from '../utils/Logger';
import zhCNJson from './zh-CN.json';

/**
 * 国际化 (i18n) 核心
 * 提供翻译函数 t() 和语言切换能力
 */

export type Locale = 'zh-CN' | 'en';

const SUPPORTED_LOCALES: readonly Locale[] = ['zh-CN', 'en'];

/** 类型守卫：校验 string 是否为合法 Locale */
function isLocale(value: string): value is Locale {
	return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

let currentLocale: Locale = 'zh-CN';
let translations: Record<string, string> = zhCNJson;

/**
 * 获取当前语言
 */
export function getLocale(): Locale {
	return currentLocale;
}

/**
 * 获取所有支持的语言
 */
export function getSupportedLocales(): readonly Locale[] {
	return SUPPORTED_LOCALES;
}

/**
 * 设置语言并加载对应翻译
 */
export async function setLocale(locale: string): Promise<void> {
	const validatedLocale: Locale = isLocale(locale) ? locale : 'zh-CN';
	if (!isLocale(locale)) {
		Logger.warn(`[i18n] Unsupported locale: ${locale}, falling back to zh-CN`);
	}
	currentLocale = validatedLocale;
	translations = await loadTranslations(validatedLocale);
}

/**
 * 翻译函数
 * @param key 翻译键（点分命名空间，如 "command.toggle-status-view"）
 * @param params 插值参数，如 { name: "test" } 替换 {name}
 */
export function t(key: string, params?: Record<string, string | number>): string {
	let text = translations[key] ?? (zhCNJson as Record<string, string>)[key] ?? key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
		}
	}
	return text;
}

/**
 * 检查翻译键是否存在
 */
export function hasTranslation(key: string): boolean {
	return key in translations;
}

/**
 * 动态加载翻译文件
 */
async function loadTranslations(locale: Locale): Promise<Record<string, string>> {
	try {
		switch (locale) {
			case 'en':
				return (await import('./en.json')).default;
			case 'zh-CN':
			default:
				return (await import('./zh-CN.json')).default;
		}
	} catch (err) {
		Logger.error(`[i18n] Failed to load translations for ${locale}:`, err);
		return {};
	}
}

/**
 * 将任意语言字符串映射为受支持的 Locale
 */
function toSupportedLocale(lang: string | null | undefined): Locale | null {
	if (!lang) return null;
	const lower = lang.toLowerCase();
	if (lower.startsWith('zh')) return 'zh-CN';
	if (lower.startsWith('en')) return 'en';
	return null;
}

/**
 * 从 Obsidian 环境检测语言
 * 优先级：
 * 1. Obsidian 内部语言配置（localStorage 或 app.locale）
 * 2. moment.locale（Obsidian 使用的 moment.js 语言）
 * 3. 浏览器 navigator.language / navigator.languages
 * 4. 默认 zh-CN
 */
export function detectLocale(): Locale {
	// 1. moment.locale — Obsidian 内部使用 moment.js，其 locale 与 Obsidian 设置精确同步
	if (typeof window.moment === 'function' && window.moment.locale) {
		const momentLocale = window.moment.locale();
		const fromMoment = toSupportedLocale(momentLocale);
		if (fromMoment) return fromMoment;
	}

	// 2. navigator.language / navigator.languages — 浏览器系统语言
	const fromNav = toSupportedLocale(navigator.language);
	if (fromNav) return fromNav;

	// 4. navigator.languages 数组（按优先级排列）
	if (navigator.languages && navigator.languages.length > 0) {
		for (const lang of navigator.languages) {
			const fromLangs = toSupportedLocale(lang);
			if (fromLangs) return fromLangs;
		}
	}

	// 5. 默认中文
	return 'zh-CN';
}