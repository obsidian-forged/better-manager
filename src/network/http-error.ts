import type { RequestUrlResponse } from 'obsidian';
import { toText } from '../shared/text';

type HttpResponse = Pick<RequestUrlResponse, 'status' | 'headers' | 'text'>;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const header = (response: HttpResponse, name: string): string | undefined =>
    Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];

/** Keep server explanations useful without displaying credentials or HTML error pages. */
function safeMessage(text: string): string {
    let value: unknown;
    try { value = JSON.parse(text) as unknown; } catch { return ''; }
    const message = record(value) ? value.message : undefined;
    return typeof message === 'string' ? [...message.replace(/<[^>]*>/g, '')].map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char).join('')
        .replace(/\b(?:gh[pousr]_[\w]+|github_pat_[\w]+)\b/g, '[redacted]')
        .replace(/https?:\/\/\S+/g, '[URL]').slice(0, 300).trim() : '';
}

export class HttpRequestError extends Error {
    readonly status: number;
    readonly rateRemaining?: string;
    readonly rateReset?: string;
    readonly retryAt?: number;
    readonly rateLimited: boolean;
    constructor(response: HttpResponse, now = Date.now()) {
        const reason = safeMessage(response.text || '');
        const remaining = header(response, 'x-ratelimit-remaining');
        const reset = header(response, 'x-ratelimit-reset');
        const retry = header(response, 'retry-after');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : NaN;
        const retryTime = Number.isFinite(seconds) ? now + seconds * 1000 : retry ? Date.parse(retry) : NaN;
        const resetTime = reset && /^\d+$/.test(reset) ? Number(reset) * 1000 : NaN;
        const rateLimited = response.status === 429 || response.status === 403 && (remaining === '0' || Boolean(retry) || /rate limit|abuse detection/i.test(reason));
        const retryAt = Number.isFinite(retryTime) ? retryTime : rateLimited && Number.isFinite(resetTime) ? resetTime : undefined;
        const fallback = rateLimited ? 'Request rate limit reached' : response.status === 403 ? 'Access denied' : response.status === 404 ? 'Resource not found' : 'Request failed';
        super(`HTTP ${response.status}: ${reason || fallback}${retryAt && retryAt > now && retryAt < 8640000000000000 ? ` · Retry after ${new Date(retryAt).toLocaleString()}` : ''}`);
        this.name = 'HttpRequestError'; this.status = response.status; this.rateRemaining = remaining; this.rateReset = reset;
        this.rateLimited = rateLimited; this.retryAt = retryAt;
    }
}

export function assertHttpSuccess(response: HttpResponse): void {
    if (response.status >= 400) throw new HttpRequestError(response);
}
export const resourceMissing = (error: unknown): boolean => error instanceof HttpRequestError && error.status === 404;
/** Normalize unknown failures once while preserving HTTP errors and their diagnostic fields. */
export const errorObject = (error: unknown): Error => error instanceof Error ? error : new Error(toText(error, 'Unknown error') || 'Unknown error');
export const errorMessage = (error: unknown): string => errorObject(error).message;
