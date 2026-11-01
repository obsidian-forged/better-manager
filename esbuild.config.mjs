import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";

const banner = ``;

const prod = (process.argv[2] === "production");

const context = await esbuild.context({
	banner: {
		js: banner,
	},
	// 修改启动路径
	entryPoints: ["main.ts"],
	// 截图随插件离线分发，仅介绍弹窗使用；Bundle offline screenshots for the upgrade tour.
	loader: { ".webp": "dataurl" },
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab", 
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules],
	format: "cjs",
	target: "es2018",
	// 产物直接以 UTF-8 落盘。esbuild 默认用 \uXXXX 转义非 ASCII，
	// 而本地化表里全是中/日/韩/俄文，转义后体积翻倍（实测 103888 处转义序列，
	// main.js 多出约 336 KB）。Obsidian 以 UTF-8 读取 main.js，无兼容性问题。
	charset: "utf8",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	// Smaller production bundles reduce disk reads and V8 parsing on Windows cold starts.
	minify: prod,
	treeShaking: true,
	outfile: "main.js",
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
