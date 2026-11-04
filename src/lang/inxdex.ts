import Manager from "main";
import zh_cn from './locale/zh_cn';
import en from "./locale/en";
import { Notice } from 'obsidian';
import { errorMessage } from '../network/http-error';
import { toText } from '../shared/text';

/**
 * 翻译表类型：与简体中文 key 集一致（缺失的 key 由回退链兜底）
 * Translation table type: same key set as Simplified Chinese; missing keys fall through the chain.
 */
export type LocaleTable = Partial<Record<keyof typeof zh_cn, string>>;

/**
 * 懒加载语言表（Lazily loaded locales）
 *
 * 为什么只静态引入 en / zh_cn：
 * 回退链固定为「当前语言 → 英语 → 简体中文 → 原始 key」，这两张表在任何语言下都会被查到，
 * 必须常驻。其余 5 种语言只有在用户真正切到那门语言时才需要。
 *
 * esbuild 以 `bundle + cjs` 打包时，动态 `import()` 会被内联进 `__esm` 懒初始化包装：
 * 源码字节仍在包内，但模块体（对象字面量的构造）推迟到首次访问才执行，
 * 从而让 V8 走函数体懒解析 —— 按 locale 形状实测编译耗时降约 50%。
 *
 * Why only en / zh_cn are static: the fallback chain always consults them.
 * The other five are materialized only when the user actually switches to them.
 */
const LAZY_LOCALES: Record<string, () => Promise<LocaleTable>> = {
    'ru': () => import("./locale/ru.js").then((m) => m.default as LocaleTable),
    'ja': () => import("./locale/ja.js").then((m) => m.default as LocaleTable),
    'ko': () => import("./locale/ko.js").then((m) => m.default as LocaleTable),
    'fr': () => import("./locale/fr.js").then((m) => m.default as LocaleTable),
    'es': () => import("./locale/es.js").then((m) => m.default as LocaleTable),
};

export class Translator {
	private manager: Manager;
	public language = {
		'zh-cn': '简体中文',
		'en': 'English',
		'ru': 'Русский язык',
		'ja': '日本語',
		'ko': '한국어',
		'fr': 'Français',
		'es': 'Español',
	};

	/**
	 * 已物化的语言表（Materialized locale tables）
	 * 回退链需要的 en / zh_cn 常驻；其余按需加入。
	 */
	private loaded: Record<string, LocaleTable> = {
		'en': en,
		'zh-cn': zh_cn,
	};

	constructor(manager: Manager) {
		this.manager = manager;
	}

	/**
	 * 物化当前（或指定）语言的翻译表
	 * Materialize the translation table for the current (or given) language.
	 *
	 * en / zh_cn 已常驻，立即返回；其余语言触发一次懒加载。
	 * 调用方在切换语言后应 await 本方法再重绘 UI，否则 `t()` 会先回退到英文。
	 */
	public async ensureLanguage(lang?: string): Promise<void> {
		const language = this.normalizeLang(lang || this.manager.settings.LANGUAGE || 'en');
		if (this.loaded[language]) return;

		const loader = LAZY_LOCALES[language];
		if (!loader) return; // 未知语言：t() 自然回退到 en

		try {
			this.loaded[language] = await loader();
		} catch (error) {
			// 不吞异常：语言表缺失时必须留痕，否则 UI 会静默回退成英文
			if (this.manager.settings.DEBUG) console.error(`[BPM] failed to load locale "${language}":`, error);
			new Notice(`${this.t('通用_失败_文本')}: ${errorMessage(error)}`);
		}
	}

	// 方法用于获取翻译后的字符串
	public t(str: keyof typeof zh_cn, vars?: Record<string, string | number | boolean | null | undefined>): string;
	public t(str: string, vars?: Record<string, string | number | boolean | null | undefined>): string;
	public t(str: string, vars?: Record<string, string | number | boolean | null | undefined>): string {
		// 基准语言使用英文：缺失翻译时优先回退到英文，再回退到中文兜底
		const language = this.normalizeLang(this.manager.settings.LANGUAGE || 'en');
		// 语言表尚未物化时先用 en；ensureLanguage() 完成后调用方重绘即可拿到正确译文
		const locale = this.loaded[language] || en;
		const base = en as Record<keyof typeof zh_cn, string>;
		const fallback = zh_cn as Record<keyof typeof zh_cn, string>;
		const key = str as keyof typeof zh_cn;
		let text = locale[key] || base[key] || fallback[key] || String(str);
		Object.entries({ configDir: this.manager.app?.vault?.configDir ?? '', ...vars }).forEach(([name, value]) => {
			text = text.split(`{${name}}`).join(toText(value));
		});
		return text;
	}

	private normalizeLang(lang: string): string {
		const lower = (lang || '').toLowerCase().replace('_', '-');
		const map: Record<string, string> = {
			// Official mappings we support
			'en': 'en',
			'en-gb': 'en',
			'zh': 'zh-cn',
			'zh-cn': 'zh-cn',
			'zh-tw': 'zh-cn',
			'ru': 'ru',
			'ja': 'ja',
			'ko': 'ko',
			'fr': 'fr',
			'es': 'es',
		};
		return map[lower] || map[lower.split('-')[0]] || 'en';
	}
}
