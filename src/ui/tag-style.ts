/** 用户配色只能提供颜色值，不能扩展成任意样式 / User colors never become CSS declarations. */
export function tagStyleProperties(color: unknown, type: string): Record<string, string> {
    const match = typeof color === 'string' ? /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim()) : null;
    const digits = match?.[1];
    const hex = digits?.length === 3 ? [...digits].map(c => c + c).join('') : digits;
    const accent = hex ? `#${hex.toUpperCase()}` : 'var(--text-accent)';
    const rgb = hex ? [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16)) : null;
    const light = rgb ? `#${rgb.map(value => Math.min(255, value + 50).toString(16).padStart(2, '0')).join('').toUpperCase()}` : 'var(--background-modifier-hover)';
    const props = {
        '--bpm-tag-fg': 'var(--text-normal)',
        '--bpm-tag-bg': 'transparent',
        '--bpm-tag-border': 'var(--background-modifier-border)',
        '--bpm-tag-border-style': 'solid',
    };
    switch (type) {
        case 'a':
            props['--bpm-tag-fg'] = 'var(--text-on-accent)';
            props['--bpm-tag-bg'] = accent;
            props['--bpm-tag-border'] = accent;
            break;
        case 'b':
            props['--bpm-tag-fg'] = accent;
            props['--bpm-tag-border'] = accent;
            break;
        case 'c':
            props['--bpm-tag-fg'] = accent;
            props['--bpm-tag-bg'] = rgb ? `rgba(${rgb.join(', ')}, 0.3)` : 'var(--background-modifier-hover)';
            props['--bpm-tag-border'] = accent;
            break;
        case 'd':
            props['--bpm-tag-fg'] = accent;
            props['--bpm-tag-bg'] = light;
            props['--bpm-tag-border'] = light;
            break;
        default:
            props['--bpm-tag-border-style'] = 'dashed';
    }
    return props;
}

export function applyTagStyle(element: HTMLElement, color: unknown, type: string): void {
    element.addClass('manager-tag--styled');
    element.setCssProps(tagStyleProperties(color, type));
}
