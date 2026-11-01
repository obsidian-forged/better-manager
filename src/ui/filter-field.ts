import { setIcon } from "obsidian";

export type BpmFilterFieldVariant = "select" | "search" | "compound";

/** BPM 共用筛选字段：图标、标签和控件 / Shared BPM field template for manager and catalog. */
export function createBpmFilterField(parent: HTMLElement, label: string, icon: string, variant: BpmFilterFieldVariant = "select"): HTMLElement {
    const field = parent.createDiv(`manager-filter-field manager-filter-field--${variant}`);
    const labelEl = field.createDiv("manager-filter-field__label");
    labelEl.setAttribute("title", label);
    setIcon(labelEl.createSpan({ cls: "manager-filter-field__icon" }), icon);
    labelEl.createSpan({ cls: "manager-filter-field__text", text: label });
    return field.createDiv("manager-filter-field__control");
}

export function createBpmFilterSelectField(parent: HTMLElement, label: string, icon: string, variant: BpmFilterFieldVariant = "select"): HTMLElement {
    return createBpmFilterField(parent, label, icon, variant).createDiv("manager-filter-select-group");
}
