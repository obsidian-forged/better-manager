import { setIcon } from 'obsidian';

/** 选项旁的独立操作，不改变当前选项；An option's independent action never selects it. */
export interface FilterOptionAction {
    label: string;
    icon?: string;
    onClick: () => void;
    closeOnClick?: boolean;
}

export function createFilterOptionAction(parent: HTMLElement, action: FilterOptionAction,
    close: () => void, canClick: (event: MouseEvent) => boolean): HTMLButtonElement {
    const button = parent.createEl('button', {
        cls: 'manager-multiselect-filter__option-action clickable-icon',
        attr: { type: 'button', 'aria-label': action.label, title: action.label },
    });
    setIcon(button, action.icon ?? 'settings-2');
    const invoke = () => {
        if (action.closeOnClick !== false) close();
        action.onClick();
    };
    button.addEventListener('click', event => {
        event.stopPropagation();
        if (canClick(event)) invoke();
    });
    button.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        // 阻止浏览器合成第二次点击；Prevent a second, browser-synthesized activation.
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) invoke();
    });
    return button;
}
