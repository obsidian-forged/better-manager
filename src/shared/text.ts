/** Display primitives without converting unknown objects or credentials into UI text. */
export function toText(value: unknown, fallback = ''): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number' && Number.isFinite(value)) return `${value}`;
    return fallback;
}
