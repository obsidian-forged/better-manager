import { ButtonComponent, Modal, setIcon } from 'obsidian';

/** Reuse the host title slot so workflow dialogs have one compact, accessible header. */
export function renderWorkflowModalHeader(modal: Modal, title: string, icon: string, closeLabel: string): void {
    modal.modalEl.addClass('manager-workflow-modal');
    modal.titleEl.parentElement?.addClass('manager-workflow-modal__header');
    modal.titleEl.addClass('manager-workflow-modal__title');
    modal.titleEl.empty();
    setIcon(modal.titleEl.createSpan('manager-workflow-modal__icon'), icon);
    modal.titleEl.createSpan({ cls: 'manager-workflow-modal__heading', text: title });
    const close = new ButtonComponent(modal.titleEl).setIcon('x').setTooltip(closeLabel).onClick(() => modal.close());
    close.buttonEl.addClass('clickable-icon', 'manager-modal-close', 'manager-workflow-modal__close');
    close.buttonEl.setAttribute('aria-label', closeLabel);
    close.buttonEl.setAttribute('type', 'button');
}
