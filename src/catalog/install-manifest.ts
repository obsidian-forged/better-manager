import { record } from './catalog';

export interface InstallManifest {
    id: string;
    name?: string;
    description?: string;
    version: string;
    minAppVersion: string;
    isDesktopOnly?: boolean;
}

/** 下载内容始终不可信，在任何写盘前校验身份与运行环境 / Validate downloaded identity and runtime before writing files. */
export function parseInstallManifest(value: unknown, expectedId?: string): InstallManifest {
    if (!record(value) || typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.id)
        || ['constructor', 'prototype', '__proto__'].includes(value.id) || typeof value.version !== 'string' || !value.version.trim()) throw new Error('Invalid plugin manifest');
    if (expectedId && value.id !== expectedId) throw new Error(`Plugin ID mismatch: expected ${expectedId}, received ${value.id}`);
    if (typeof value.minAppVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.minAppVersion)) throw new Error('Missing or invalid minimum Obsidian version');
    if (value.isDesktopOnly !== undefined && typeof value.isDesktopOnly !== 'boolean') throw new Error('Invalid platform declaration');
    return {
        id: value.id, version: value.version,
        name: typeof value.name === 'string' ? value.name : undefined,
        description: typeof value.description === 'string' ? value.description : undefined,
        minAppVersion: value.minAppVersion,
        isDesktopOnly: value.isDesktopOnly,
    };
}
