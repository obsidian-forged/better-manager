import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
    stdin: { contents: `export { protectionField } from './src/settings/protection-text';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(() => ({}), module, module.exports);
const { protectionField } = module.exports;

function manager(language = 'zh') {
    return {
        settings: {
            LANGUAGE: language,
            TAGS: [{ id: 'tools', name: '工具' }],
            GROUPS: [{ id: 'startup', name: '启动' }],
            PLUGIN_LAYOUT: [{ id: 'tasks', type: 'plugin' }],
            Plugins: [{ id: 'tasks', name: 'Tasks' }],
            FEATURES: { appearance: true },
        },
        translator: { t: key => key === '功能开关_appearance' ? '外观总览' : key },
        appPlugins: { manifests: { tasks: { name: 'Tasks' } } },
    };
}

test('conflict differences use readable setting labels instead of raw keys', () => {
    const zh = manager();
    assert.equal(protectionField(zh, ['RECENT_INSTALL_DAYS']), '最近安装天数');
    assert.equal(protectionField(zh, ['TAGS']), '标签');
    assert.equal(protectionField(zh, ['PLUGIN_LAYOUT']), '自定义布局');
    assert.equal(protectionField(zh, ['MANUAL_CONFIG_SAVE']), '仅手动保存配置');
    assert.equal(protectionField(zh, ['SYNC_CHANGE_WARNINGS']), '频繁外部修改提醒');
});

test('nested paths resolve setting names, list items and plugin names', () => {
    const zh = manager();
    assert.equal(protectionField(zh, ['TAGS', '0', 'name']), '标签 › 工具 › 名称');
    assert.equal(protectionField(zh, ['Groups'.toUpperCase(), '0', 'color']), '分组 › 启动 › 颜色');
    assert.equal(protectionField(zh, ['Plugins', '0', 'enabled']), '插件配置 › Tasks › 启用');
    assert.equal(protectionField(zh, ['PLUGIN_LAYOUT', '0', 'type']), '自定义布局 › Tasks › 类型');
    assert.equal(protectionField(zh, ['FEATURES', 'appearance']), '功能开关 › 外观总览');
    assert.equal(protectionField(zh, ['DEVICE_MANAGEMENT', 'presets', 'computer', '0', 'name']), '设备管理 › 预设 › 电脑 › 第 1 项 › 名称');
});

test('unknown keys are humanized and English uses the same map', () => {
    assert.equal(protectionField(manager(), ['SOME_NEW_KEY']), 'Some new key');
    assert.equal(protectionField(manager('en'), ['RECENT_INSTALL_DAYS']), 'Recently installed window');
    assert.equal(protectionField(manager('en'), ['TAGS', '0', 'name']), 'Tags › 工具 › Name');
});
