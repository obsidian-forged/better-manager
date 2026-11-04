/**
 * 插件冲突排查 - 状态管理
 */

export interface TroubleshootState {
    /** 排查状态 */
    status: 'idle' | 'running' | 'completed' | 'aborted';

    /** 原始启用的插件列表（用于最后恢复） */
    originalEnabledPlugins: string[];

    /** 当前阶段 */
    phase: 'confirm' | 'find-first' | 'find-second' | 'done';

    /** 嫌疑池（待测试的插件） */
    suspectPool: string[];

    /** 已排除的插件 */
    clearedPlugins: string[];

    /** 第一个确认的冲突插件（Phase 3 使用） */
    firstConflictPlugin?: string;

    /** 当前步骤 */
    currentStep: number;

    /** 操作历史（支持撤销） */
    history: TroubleshootHistoryItem[];

    /** 最终结果 */
    result?: {
        plugin1: string;
        plugin2: string;
    };

    /** 新算法状态 */
    algorithmState?: AlgorithmState;
}

export interface AlgorithmState {
    /** 当前算法阶段 */
    stage: 'initial-confirm' | 'bisect-main' | 'cross-pair-bisect-b' | 'cross-pair-bisect-a' | 'verify-single' | 'verify-pair';

    /** 当前嫌疑集合 */
    currentSet: string[];

    /** 固定启用的集合（跨分区排查时） */
    fixedSet: string[];

    /** 被搜索的集合（跨分区排查时） */
    searchSet: string[];

    /** 找到的第一个冲突插件 */
    foundFirst: string | null;

    /** 找到的第二个冲突插件 */
    foundSecond?: string;

    /** 当前测试的是哪一半 */
    testingHalf?: 'first' | 'second';

    /** C1 集合 */
    c1?: string[];

    /** C2 集合 */
    c2?: string[];

    /** 当前搜索的半边 */
    searchHalf?: string[];

    /** 另一半 */
    searchOtherHalf?: string[];

    /** 待验证的对 */
    pairToVerify?: string[];

    /** 验证步骤 */
    verifyStep?: 'test-first' | 'test-second';
}

export interface TroubleshootHistoryItem {
    action: 'disable-all' | 'enable-half' | 'disable-half' | 'isolate' | 'test-pair';
    /** 操作前的插件状态快照 */
    previousEnabledPlugins: string[];
    /** 用户反馈 */
    userFeedback?: 'problem-exists' | 'problem-gone';
    /** 当时的嫌疑池 */
    suspectPoolSnapshot: string[];
}

/** 默认排除的核心插件（不参与排查） */
export const CORE_PLUGINS_EXCLUDE = [
    'better-plugins-manager',  // BPM 自身
];

/** 初始状态 */
export const INITIAL_TROUBLESHOOT_STATE: TroubleshootState = {
    status: 'idle',
    originalEnabledPlugins: [],
    phase: 'confirm',
    suspectPool: [],
    clearedPlugins: [],
    currentStep: 0,
    history: [],
};

/**
 * 深拷贝状态
 */
export function cloneState(state: TroubleshootState): TroubleshootState {
    const algorithm = state.algorithmState;
    return {
        ...state,
        originalEnabledPlugins: [...state.originalEnabledPlugins],
        suspectPool: [...state.suspectPool],
        clearedPlugins: [...state.clearedPlugins],
        history: state.history.map(item => ({ ...item,
            previousEnabledPlugins: [...item.previousEnabledPlugins], suspectPoolSnapshot: [...item.suspectPoolSnapshot] })),
        result: state.result ? { ...state.result } : undefined,
        algorithmState: algorithm ? { ...algorithm,
            currentSet: [...algorithm.currentSet], fixedSet: [...algorithm.fixedSet], searchSet: [...algorithm.searchSet],
            c1: algorithm.c1 ? [...algorithm.c1] : undefined, c2: algorithm.c2 ? [...algorithm.c2] : undefined,
            searchHalf: algorithm.searchHalf ? [...algorithm.searchHalf] : undefined,
            searchOtherHalf: algorithm.searchOtherHalf ? [...algorithm.searchOtherHalf] : undefined,
            pairToVerify: algorithm.pairToVerify ? [...algorithm.pairToVerify] : undefined } : undefined,
    };
}
