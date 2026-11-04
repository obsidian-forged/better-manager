/**
 * 插件冲突排查 - 核心算法
 * 
 * 算法设计：
 * 1. 主循环二分缩小嫌疑集合
 * 2. 如果 Fail(C1) → 问题在左半
 * 3. 如果 Fail(C2) → 问题在右半
 * 4. 如果两半都 Pass → 跨分区冲突，调用 FindCrossPair
 * 5. FindCrossPair: 固定一侧全开，二分另一侧
 */

import { App, PluginManifest } from 'obsidian';
import Manager from 'main';
import { TroubleshootState, TroubleshootHistoryItem, CORE_PLUGINS_EXCLUDE } from './troubleshoot-state';

export type AlgorithmResult =
    | { type: 'single'; culprit: string }
    | { type: 'pair'; culpritA: string; culpritB: string }
    | { type: 'not-plugin-issue' }
    | { type: 'continue'; nextAction: NextAction }
    | { type: 'error'; message: string };

export type NextAction =
    | { action: 'test'; plugins: string[]; description: string }
    | { action: 'confirm-initial' }
    | { action: 'done' };

/**
 * 排查算法管理器
 */
export class TroubleshootAlgorithm {
    private app: App;
    private manager: Manager;
    private bpmId: string;

    constructor(app: App, manager: Manager) {
        this.app = app;
        this.manager = manager;
        this.bpmId = manager.manifest.id; 
    }

    /**
     * 获取当前启用的插件列表（排除核心插件）
     */
    getEnabledPlugins(): string[] {
        const enabled: string[] = [];
        const settings = this.manager.settings;

        const manifests = this.manager.appPlugins.manifests;

        if (settings.DELAY) {
            for (const mp of settings.Plugins) {
                if (!manifests[mp.id]) continue;
                if (mp.id === this.bpmId || CORE_PLUGINS_EXCLUDE.includes(mp.id)) continue;
                if (mp.enabled) {
                    enabled.push(mp.id);
                }
            }
        } else {
                const appPlugins = this.manager.appPlugins;
            for (const id of appPlugins.enabledPlugins) {
                if (!manifests[id]) continue;
                if (id === this.bpmId || CORE_PLUGINS_EXCLUDE.includes(id)) continue;
                enabled.push(id);
            }
        }

        return enabled;
    }

    /**
     * 获取所有插件的 manifest
     */
    getAllManifests(): Record<string, PluginManifest> {
        return this.manager.appPlugins.manifests;
    }

    /**
     * 启用指定插件集合（禁用其他所有插件）
     */
    async setEnabledPlugins(pluginsToEnable: string[]): Promise<void> {
        const settings = this.manager.settings;
        const appPlugins = this.manager.appPlugins;
        const manifests = this.manager.appPlugins.manifests;

        const enableSet = new Set(pluginsToEnable);

        // 遍历所有插件，启用/禁用
        for (const id of Object.keys(manifests)) {
            if (id === this.bpmId) continue; // 不动 BPM 自身

            const shouldEnable = enableSet.has(id);

            if (settings.DELAY) {
                const mp = settings.Plugins.find(p => p.id === id);
                if (mp) {
                    if (shouldEnable && !mp.enabled) {
                        mp.enabled = true;
                        await appPlugins.enablePlugin(id);
                    } else if (!shouldEnable && mp.enabled) {
                        mp.enabled = false;
                        await appPlugins.disablePlugin(id);
                    }
                }
            } else {
                const isCurrentlyEnabled = appPlugins.enabledPlugins.has(id);
                if (shouldEnable && !isCurrentlyEnabled) {
                    await appPlugins.enablePluginAndSave(id);
                    const mp = settings.Plugins.find(p => p.id === id);
                    if (mp) mp.enabled = true;
                } else if (!shouldEnable && isCurrentlyEnabled) {
                    await appPlugins.disablePluginAndSave(id);
                    const mp = settings.Plugins.find(p => p.id === id);
                    if (mp) mp.enabled = false;
                }
            }
        }

        await this.manager.saveSettings();
        // 全量启停后可能出现新 ribbon 图标，登记一次
        this.manager.applyRibbonSettings();
    }

    /**
     * 将列表二分
     */
    splitHalf<T>(arr: T[]): [T[], T[]] {
        const mid = Math.ceil(arr.length / 2);
        return [arr.slice(0, mid), arr.slice(mid)];
    }

    /**
     * 初始化排查状态
     */
    initState(): TroubleshootState {
        const enabled = this.getEnabledPlugins();
        return {
            status: 'running',
            originalEnabledPlugins: [...enabled],
            phase: 'confirm',
            suspectPool: [...enabled],
            clearedPlugins: [],
            currentStep: 1,
            history: [],
            // 新增字段用于新算法
            algorithmState: {
                stage: 'initial-confirm',
                currentSet: [...enabled],
                fixedSet: [],
                searchSet: [],
                foundFirst: null,
            },
        };
    }

    /**
     * 记录历史
     */
    recordHistory(
        state: TroubleshootState,
        action: TroubleshootHistoryItem['action'],
        enabledPlugins: string[]
    ): void {
        state.history.push({
            action,
            previousEnabledPlugins: [...enabledPlugins],
            suspectPoolSnapshot: [...state.suspectPool],
        });
    }

    /**
     * 撤销上一步
     */
    async undo(state: TroubleshootState): Promise<boolean> {
        if (state.history.length === 0) return false;

        const lastStep = state.history.pop()!;
        await this.setEnabledPlugins(lastStep.previousEnabledPlugins);
        state.suspectPool = lastStep.suspectPoolSnapshot;
        state.currentStep = Math.max(1, state.currentStep - 1);

        return true;
    }

    /**
     * 恢复原始状态
     */
    async restoreOriginal(state: TroubleshootState): Promise<void> {
        await this.setEnabledPlugins(state.originalEnabledPlugins);
    }

    // ========================================
    // 新算法实现
    // ========================================

    /**
     * 执行下一步排查
     * 根据用户反馈（问题是否存在）推进算法
     */
    async executeNextStep(
        state: TroubleshootState,
        problemExists: boolean
    ): Promise<AlgorithmResult> {
        const algo = state.algorithmState!;

        // 记录用户反馈
        if (state.history.length > 0) {
            state.history[state.history.length - 1].userFeedback =
                problemExists ? 'problem-exists' : 'problem-gone';
        }

        switch (algo.stage) {
            case 'initial-confirm':
                return this.handleInitialConfirm(state, problemExists);

            case 'bisect-main':
                return this.handleBisectMain(state, problemExists);

            case 'cross-pair-bisect-b':
                return this.handleCrossPairBisectB(state, problemExists);

            case 'cross-pair-bisect-a':
                return this.handleCrossPairBisectA(state, problemExists);

            case 'verify-single':
                return this.handleVerifySingle(state, problemExists);

            case 'verify-pair':
                return this.handleVerifyPair(state, problemExists);

            default:
                return { type: 'error', message: this.manager.translator.t('排查_错误_未知阶段') };
        }
    }

    /**
     * 阶段：初始确认（禁用全部插件）
     */
    private async handleInitialConfirm(
        state: TroubleshootState,
        problemExists: boolean
    ): Promise<AlgorithmResult> {
        if (problemExists) {
            // 禁用所有插件后问题还在 → 不是插件问题
            return { type: 'not-plugin-issue' };
        }

        // 问题消失，是插件问题，开始主循环
        const algo = state.algorithmState!;
        algo.stage = 'bisect-main';
        algo.currentSet = [...state.originalEnabledPlugins];
        state.currentStep++;

        // 启用前半测试
        const [c1] = this.splitHalf(algo.currentSet);
        algo.testingHalf = 'first';
        algo.c1 = c1;
        algo.c2 = algo.currentSet.filter(id => !c1.includes(id));

        this.recordHistory(state, 'enable-half', []);
        await this.setEnabledPlugins(c1);

        return {
            type: 'continue',
            nextAction: {
                action: 'test',
                plugins: c1,
                description: this.manager.translator.t('排查_描述_测试前半').replace('{count}', c1.length.toString())
            }
        };
    }

    /**
     * 阶段：主循环二分
     */
    private async handleBisectMain(
        state: TroubleshootState,
        problemExists: boolean
    ): Promise<AlgorithmResult> {
        const algo = state.algorithmState!;
        state.currentStep++;

        if (algo.testingHalf === 'first') {
            // 刚测试了 C1
            if (problemExists) {
                // 问题在 C1，缩小范围
                algo.currentSet = algo.c1!;
                return this.continueOrFinishBisect(state);
            } else {
                // C1 没问题，测试 C2
                algo.testingHalf = 'second';
                this.recordHistory(state, 'enable-half', algo.c1!);
                await this.setEnabledPlugins(algo.c2!);

                return {
                    type: 'continue',
                    nextAction: {
                        action: 'test',
                        plugins: algo.c2!,
                        description: this.manager.translator.t('排查_描述_测试后半').replace('{count}', algo.c2!.length.toString())
                    }
                };
            }
        } else {
            // 刚测试了 C2
            if (problemExists) {
                // 问题在 C2，缩小范围
                algo.currentSet = algo.c2!;
                return this.continueOrFinishBisect(state);
            } else {
                // C1 和 C2 都没问题 → 跨分区冲突！
                return this.startCrossPair(state, algo.c1!, algo.c2!);
            }
        }
    }

    /**
     * 继续二分或完成
     */
    private async continueOrFinishBisect(state: TroubleshootState): Promise<AlgorithmResult> {
        const algo = state.algorithmState!;

        if (algo.currentSet.length === 1) {
            // 只剩一个，验证是否是单插件问题
            algo.stage = 'verify-single';
            algo.foundFirst = algo.currentSet[0];

            this.recordHistory(state, 'isolate', algo.currentSet);
            await this.setEnabledPlugins([algo.foundFirst]);

            return {
                type: 'continue',
                nextAction: {
                    action: 'test',
                    plugins: [algo.foundFirst],
                    description: this.manager.translator.t('排查_描述_验证单插件').replace('{name}', this.getPluginName(algo.foundFirst))
                }
            };
        }

        if (algo.currentSet.length === 2) {
            // 剩两个，需要判断是单个问题还是组合冲突
            // 先测试第一个
            algo.stage = 'verify-pair';
            algo.pairToVerify = [...algo.currentSet];
            algo.verifyStep = 'test-first';

            this.recordHistory(state, 'isolate', algo.currentSet);
            await this.setEnabledPlugins([algo.currentSet[0]]);

            return {
                type: 'continue',
                nextAction: {
                    action: 'test',
                    plugins: [algo.currentSet[0]],
                    description: this.manager.translator.t('排查_描述_验证').replace('{name}', this.getPluginName(algo.currentSet[0]))
                }
            };
        }

        // 继续二分
        const [c1, c2] = this.splitHalf(algo.currentSet);
        algo.testingHalf = 'first';
        algo.c1 = c1;
        algo.c2 = c2;

        this.recordHistory(state, 'enable-half', algo.currentSet);
        await this.setEnabledPlugins(c1);

        return {
            type: 'continue',
            nextAction: {
                action: 'test',
                plugins: c1,
                description: this.manager.translator.t('排查_描述_测试前半').replace('{count}', c1.length.toString())
            }
        };
    }

    /**
     * 开始跨分区冲突排查
     */
    private async startCrossPair(
        state: TroubleshootState,
        setA: string[],
        setB: string[]
    ): Promise<AlgorithmResult> {
        const algo = state.algorithmState!;

        algo.stage = 'cross-pair-bisect-b';
        algo.fixedSet = setA;  // 固定 A 全开
        algo.searchSet = setB; // 在 B 中搜索

        // 固定 A，二分 B
        const [b1] = this.splitHalf(algo.searchSet);
        algo.searchHalf = b1;
        algo.searchOtherHalf = algo.searchSet.filter(id => !b1.includes(id));

        const testSet = [...algo.fixedSet, ...b1];
        this.recordHistory(state, 'test-pair', algo.c2!);
        await this.setEnabledPlugins(testSet);

        state.currentStep++;

        return {
            type: 'continue',
            nextAction: {
                action: 'test',
                plugins: testSet,
                description: this.manager.translator.t('排查_描述_固定A测试B前').replace('{countA}', algo.fixedSet.length.toString()).replace('{countB}', b1.length.toString())
            }
        };
    }

    /**
     * 阶段：跨分区二分 B
     */
    private async handleCrossPairBisectB(
        state: TroubleshootState,
        problemExists: boolean
    ): Promise<AlgorithmResult> {
        const algo = state.algorithmState!;
        state.currentStep++;

        if (problemExists) {
            // 问题在当前测试的半边
            algo.searchSet = algo.searchHalf!;
        } else {
            // 问题在另一半
            algo.searchSet = algo.searchOtherHalf!;
        }

        if (algo.searchSet.length === 1) {
            // 找到 b*
            algo.foundSecond = algo.searchSet[0];

            // 开始在 A 中搜索 a*
            algo.stage = 'cross-pair-bisect-a';
            algo.searchSet = algo.fixedSet;
            algo.fixedSet = [algo.foundSecond];

            const [a1] = this.splitHalf(algo.searchSet);
            algo.searchHalf = a1;
            algo.searchOtherHalf = algo.searchSet.filter(id => !a1.includes(id));

            const testSet = [...algo.fixedSet, ...a1];
            this.recordHistory(state, 'test-pair', algo.searchSet);
            await this.setEnabledPlugins(testSet);

            return {
                type: 'continue',
                nextAction: {
                    action: 'test',
                    plugins: testSet,
                    description: this.manager.translator.t('排查_描述_固定B测试A前').replace('{countB}', algo.fixedSet.length.toString()).replace('{countA}', a1.length.toString())
                }
            };
        }

        // 继续二分 B
        const [b1] = this.splitHalf(algo.searchSet);
        algo.searchHalf = b1;
        algo.searchOtherHalf = algo.searchSet.filter(id => !b1.includes(id));

        const testSet = [...algo.fixedSet, ...b1];
        this.recordHistory(state, 'test-pair', algo.searchSet);
        await this.setEnabledPlugins(testSet);

        return {
            type: 'continue',
            nextAction: {
                action: 'test',
                plugins: testSet,
                description: this.manager.translator.t('排查_描述_固定A测试B前').replace('{countA}', algo.fixedSet.length.toString()).replace('{countB}', b1.length.toString())
            }
        };
    }

    /**
     * 阶段：跨分区二分 A
     */
    private async handleCrossPairBisectA(
        state: TroubleshootState,
        problemExists: boolean
    ): Promise<AlgorithmResult> {
        const algo = state.algorithmState!;
        state.currentStep++;

        if (problemExists) {
            algo.searchSet = algo.searchHalf!;
        } else {
            algo.searchSet = algo.searchOtherHalf!;
        }

        if (algo.searchSet.length === 1) {
            // 找到 a*
            algo.foundFirst = algo.searchSet[0];

            // 完成！返回冲突对
            state.result = {
                plugin1: algo.foundFirst,
                plugin2: algo.foundSecond!,
            };
            state.status = 'completed';
            state.phase = 'done';

            return {
                type: 'pair',
                culpritA: algo.foundFirst,
                culpritB: algo.foundSecond!
            };
        }

        // 继续二分 A
        const [a1] = this.splitHalf(algo.searchSet);
        algo.searchHalf = a1;
        algo.searchOtherHalf = algo.searchSet.filter(id => !a1.includes(id));

        const testSet = [...algo.fixedSet, ...a1];
        this.recordHistory(state, 'test-pair', algo.searchSet);
        await this.setEnabledPlugins(testSet);

        return {
            type: 'continue',
            nextAction: {
                action: 'test',
                plugins: testSet,
                description: this.manager.translator.t('排查_描述_固定B测试A前').replace('{countB}', algo.fixedSet.length.toString()).replace('{countA}', a1.length.toString())
            }
        };
    }

    /**
     * 阶段：验证单插件
     */
    private async handleVerifySingle(
        state: TroubleshootState,
        problemExists: boolean
    ): Promise<AlgorithmResult> {
        const algo = state.algorithmState!;

        if (problemExists) {
            // 确认是单插件问题
            state.result = {
                plugin1: algo.foundFirst!,
                plugin2: '', // 单插件没有第二个
            };
            state.status = 'completed';
            state.phase = 'done';

            return {
                type: 'single',
                culprit: algo.foundFirst!
            };
        } else {
            // 单个插件没问题，可能是更复杂的情况
            return {
                type: 'error',
                message: this.manager.translator.t('排查_无法定位_通知')
            };
        }
    }

    /**
     * 阶段：验证冲突对（剩两个插件时）
     */
    private async handleVerifyPair(
        state: TroubleshootState,
        problemExists: boolean
    ): Promise<AlgorithmResult> {
        const algo = state.algorithmState!;
        const pair = algo.pairToVerify!;
        state.currentStep++;

        if (algo.verifyStep === 'test-first') {
            if (problemExists) {
                // 第一个单独就有问题
                state.result = { plugin1: pair[0], plugin2: '' };
                state.status = 'completed';
                state.phase = 'done';
                return { type: 'single', culprit: pair[0] };
            }

            // 第一个没问题，测试第二个
            algo.verifyStep = 'test-second';
            this.recordHistory(state, 'isolate', [pair[0]]);
            await this.setEnabledPlugins([pair[1]]);

            return {
                type: 'continue',
                nextAction: {
                    action: 'test',
                    plugins: [pair[1]],
                    description: this.manager.translator.t('排查_描述_验证', { name: this.getPluginName(pair[1]) })
                }
            };
        }

        if (algo.verifyStep === 'test-second') {
            if (problemExists) {
                // 第二个单独就有问题
                state.result = { plugin1: pair[1], plugin2: '' };
                state.status = 'completed';
                state.phase = 'done';
                return { type: 'single', culprit: pair[1] };
            }

            // 两个单独都没问题，确认是冲突对
            state.result = { plugin1: pair[0], plugin2: pair[1] };
            state.status = 'completed';
            state.phase = 'done';
            return { type: 'pair', culpritA: pair[0], culpritB: pair[1] };
        }

        return { type: 'error', message: this.manager.translator.t('排查_错误_状态异常') };
    }

    /**
     * 开始排查（第一步：禁用全部）
     */
    async startTroubleshoot(state: TroubleshootState): Promise<void> {
        const algo = state.algorithmState!;
        algo.stage = 'initial-confirm';

        this.recordHistory(state, 'disable-all', state.originalEnabledPlugins);
        await this.setEnabledPlugins([]);
    }

    /**
     * 获取插件显示名称
     */
    getPluginName(id: string): string {
        const manifests = this.getAllManifests();
        return manifests[id]?.name || id;
    }

    /**
     * 计算预计剩余步骤数
     */
    estimateRemainingSteps(state: TroubleshootState): number {
        const poolSize = state.algorithmState?.currentSet?.length || state.suspectPool.length;
        if (poolSize <= 1) return 1;
        // 最坏情况：2 * log2(n)
        return Math.ceil(Math.log2(poolSize)) * 2;
    }

    /**
     * 重启 Obsidian
     */
    restartObsidian(): void {
        const commands: unknown = Reflect.get(this.app, 'commands');
        if (!commands || typeof commands !== 'object' || !('executeCommandById' in commands)
            || typeof commands.executeCommandById !== 'function') throw new Error('The Obsidian restart command is unavailable');
        Reflect.apply(commands.executeCommandById, commands, ['app:reload']);
    }
}
