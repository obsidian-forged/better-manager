/**
 * 插件冲突排查 - 结果显示模态框
 */

import { App, ButtonComponent, Modal, Notice, Setting, TFile, setIcon, normalizePath } from 'obsidian';
import Manager from 'main';
import { TroubleshootState, INITIAL_TROUBLESHOOT_STATE, cloneState } from './troubleshoot-state';
import { TroubleshootAlgorithm } from './troubleshoot-algorithm';
import { errorMessage } from '../network/http-error';

export class TroubleshootResultModal extends Modal {
    private manager: Manager;
    private algorithm: TroubleshootAlgorithm;
    private state: TroubleshootState;
    private t: (key: string) => string;

    constructor(app: App, manager: Manager, state: TroubleshootState) {
        super(app);
        this.manager = manager;
        this.algorithm = new TroubleshootAlgorithm(app, manager);
        this.state = state;
        this.t = (k: string) => manager.translator.t(k);
    }

    onOpen(): void {
        this.render();
    }

    onClose() {
        // 清理状态
    }

    private render(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        titleEl.empty();

        const modalEl = contentEl.parentElement;
        if (!modalEl) return;
        modalEl.addClass('troubleshoot-result-modal');

        // 移除默认的关闭按钮
        const defaultCloseBtn = modalEl.querySelector('.modal-close-button');
        if (defaultCloseBtn) {
            defaultCloseBtn.remove();
        }

        // 标题
        const titleSetting = new Setting(titleEl)
            .setClass('troubleshoot-title')
            .setName(this.t('排查_完成_标题'));
        setIcon(titleSetting.nameEl.createSpan('plugin-icon'), 'check-circle');

        // 关闭按钮
        const closeBtn = titleSetting.controlEl.createEl('button', { cls: 'clickable-icon' });
        setIcon(closeBtn, 'x');
        closeBtn.onclick = () => this.close();

        if (this.state.result) {
            const isSinglePlugin = !this.state.result.plugin2;

            if (isSinglePlugin) {
                // 单插件问题
                const resultContainer = contentEl.createDiv('troubleshoot-result-container');
                resultContainer.createEl('h3', { text: this.t('报告_发现问题插件') });

                const conflictBox = resultContainer.createDiv('troubleshoot-conflict-box');

                const plugin1Name = this.getPluginName(this.state.result.plugin1);
                const plugin1Version = this.getPluginVersion(this.state.result.plugin1);

                const plugin1Div = conflictBox.createDiv('troubleshoot-plugin');
                setIcon(plugin1Div.createSpan('plugin-icon'), 'plug');
                plugin1Div.createSpan({ text: plugin1Name, cls: 'plugin-name' });
                plugin1Div.createSpan({ text: `v${plugin1Version}`, cls: 'plugin-version' });

                // 单插件问题的建议
                const suggestionsDiv = contentEl.createDiv('troubleshoot-suggestions');
                suggestionsDiv.createEl('h4', { text: this.t('排查_建议_标题') });
                const suggestionList = suggestionsDiv.createEl('ul');
                suggestionList.createEl('li', { text: this.t('报告_单插件建议1') });
                suggestionList.createEl('li', { text: this.t('报告_单插件建议2') });
                suggestionList.createEl('li', { text: this.t('报告_单插件建议3') });
                suggestionList.createEl('li', { text: this.t('报告_单插件建议4') });
            } else {
                // 冲突对
                const resultContainer = contentEl.createDiv('troubleshoot-result-container');
                resultContainer.createEl('h3', { text: this.t('排查_发现冲突_文本') });

                const conflictBox = resultContainer.createDiv('troubleshoot-conflict-box');

                const plugin1Name = this.getPluginName(this.state.result.plugin1);
                const plugin1Version = this.getPluginVersion(this.state.result.plugin1);
                const plugin2Name = this.getPluginName(this.state.result.plugin2);
                const plugin2Version = this.getPluginVersion(this.state.result.plugin2);

                const plugin1Div = conflictBox.createDiv('troubleshoot-plugin');
                setIcon(plugin1Div.createSpan('plugin-icon'), 'plug');
                plugin1Div.createSpan({ text: plugin1Name, cls: 'plugin-name' });
                plugin1Div.createSpan({ text: `v${plugin1Version}`, cls: 'plugin-version' });

                setIcon(conflictBox.createSpan('conflict-arrow'), 'zap');

                const plugin2Div = conflictBox.createDiv('troubleshoot-plugin');
                setIcon(plugin2Div.createSpan('plugin-icon'), 'plug');
                plugin2Div.createSpan({ text: plugin2Name, cls: 'plugin-name' });
                plugin2Div.createSpan({ text: `v${plugin2Version}`, cls: 'plugin-version' });

                // 冲突对的建议
                const suggestionsDiv = contentEl.createDiv('troubleshoot-suggestions');
                suggestionsDiv.createEl('h4', { text: this.t('排查_建议_标题') });
                const suggestionList = suggestionsDiv.createEl('ul');
                suggestionList.createEl('li', { text: this.t('排查_建议1_文本') });
                suggestionList.createEl('li', { text: this.t('排查_建议2_文本') });
                suggestionList.createEl('li', { text: this.t('排查_建议3_文本') });
            }

            // 排查统计
            const statsDiv = contentEl.createDiv('troubleshoot-stats');
            statsDiv.createEl('p', {
                text: `${this.t('排查_总步骤_文本')}: ${this.state.currentStep}`,
                cls: 'troubleshoot-stat'
            });
        }

        // 操作按钮
        const actionContainer = contentEl.createDiv('troubleshoot-actions');

        const restoreBtn = new ButtonComponent(actionContainer);
        restoreBtn.setButtonText(this.t('排查_恢复原始_按钮'));
        restoreBtn.setCta();
        restoreBtn.onClick(() => {
            void this.restoreAndClose().catch(error => this.reportFailure(error));
        });

        const reportBtn = new ButtonComponent(actionContainer);
        reportBtn.setButtonText(this.t('排查_生成报告_按钮')).setIcon('bar-chart-3');
        reportBtn.onClick(() => {
            void this.generateReport().catch(error => this.reportFailure(error));
        });
    }

    private reportFailure(error: unknown): void {
        if (this.manager.settings.DEBUG) console.error('[BPM] Troubleshooting action failed', error);
        new Notice(errorMessage(error));
    }

    private getPluginName(id: string): string {
        const manifests = this.algorithm.getAllManifests();
        return manifests[id]?.name || id;
    }

    private getPluginVersion(id: string): string {
        const manifests = this.algorithm.getAllManifests();
        return manifests[id]?.version || 'unknown';
    }

    private async restoreAndClose() {
        await this.algorithm.restoreOriginal(this.state);
        await this.clearStateAndClose();
        new Notice(this.t('排查_已恢复_通知'));
    }

    private async clearStateAndClose() {
        this.manager.settings.TROUBLESHOOT_STATE = cloneState(INITIAL_TROUBLESHOOT_STATE);
        await this.manager.saveSettings();
        this.close();
    }

    /**
     * 生成 Markdown 报告
     */
    private async generateReport() {
        if (!this.state.result) {
            new Notice(this.t('排查_无结果_通知'));
            return;
        }

        const isSinglePlugin = !this.state.result.plugin2;
        const plugin1Name = this.getPluginName(this.state.result.plugin1);
        const plugin1Version = this.getPluginVersion(this.state.result.plugin1);

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
        const fileName = `plugin-conflict-report-${dateStr}-${timeStr}.md`;
        const filePath = normalizePath(fileName);

        let content: string;

        if (isSinglePlugin) {
            content = `# ${this.t('报告_单插件_标题')}

${this.t('报告_生成说明')} ${now.toLocaleString()}

---

## ${this.t('报告_发现问题插件')}

| ${this.t('报告_插件')} |
|--------|
| **${plugin1Name}** (v${plugin1Version}) |
| ID: \`${this.state.result.plugin1}\` |

---

## ${this.t('报告_排查摘要')}

- **${this.t('报告_总步骤')}**: ${this.state.currentStep}
- **${this.t('报告_结果类型')}**: ${this.t('报告_单插件问题')}
- **${this.t('报告_原始启用数')}**: ${this.state.originalEnabledPlugins.length}

---

## ${this.t('报告_建议操作')}

1. ${this.t('报告_单插件建议1')}
2. ${this.t('报告_单插件建议2')}
3. ${this.t('报告_单插件建议3')}
4. ${this.t('报告_单插件建议4')}

---

## ${this.t('报告_备注')}

${this.t('报告_备注提示')}
`;
        } else {
            const plugin2Name = this.getPluginName(this.state.result.plugin2);
            const plugin2Version = this.getPluginVersion(this.state.result.plugin2);

            content = `# ${this.t('报告_冲突_标题')}

${this.t('报告_生成说明')} ${now.toLocaleString()}

---

## ${this.t('报告_发现冲突')}

| ${this.t('报告_插件1')} | ${this.t('报告_插件2')} |
|----------|----------|
| **${plugin1Name}** (v${plugin1Version}) | **${plugin2Name}** (v${plugin2Version}) |
| ID: \`${this.state.result.plugin1}\` | ID: \`${this.state.result.plugin2}\` |

---

## ${this.t('报告_排查摘要')}

- **${this.t('报告_总步骤')}**: ${this.state.currentStep}
- **${this.t('报告_结果类型')}**: ${this.t('报告_冲突对')}
- **${this.t('报告_原始启用数')}**: ${this.state.originalEnabledPlugins.length}

---

## ${this.t('报告_建议操作')}

1. ${this.t('报告_冲突建议1')}
2. ${this.t('报告_冲突建议2')}
3. ${this.t('报告_冲突建议3')}
4. ${this.t('报告_冲突建议4')}

---

## ${this.t('报告_备注')}

${this.t('报告_备注提示')}

---

## ${this.t('报告_技术详情')}

### ${this.t('报告_插件1')}: ${plugin1Name}
- ID: \`${this.state.result.plugin1}\`
- Version: ${plugin1Version}

### ${this.t('报告_插件2')}: ${plugin2Name}
- ID: \`${this.state.result.plugin2}\`
- Version: ${plugin2Version}

### ${this.t('报告_原始启用列表')}
${this.state.originalEnabledPlugins.map(id => `- ${this.getPluginName(id)} (\`${id}\`)`).join('\n')}
`;
        }

        try {
            await this.app.vault.create(filePath, content);
            new Notice(`${this.t('排查_报告已生成_通知')}: ${fileName}`);

            // 打开报告文件
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.app.workspace.getLeaf().openFile(file);
            }
        } catch (e) {
            if (this.manager.settings.DEBUG) console.error('[BPM] Failed to create report:', e);
            new Notice(this.t('排查_报告失败_通知'));
        }
    }
}
