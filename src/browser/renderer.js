const appendText = (parent, tagName, className, value) => {
    const element = parent.ownerDocument.createElement(tagName);
    element.className = className;
    element.textContent = value;
    parent.append(element);
    return element;
};

const iconPaths = {
    'choose-files': 'M3 7h4l2-3h6l2 3h4v13H3Z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    'rotate-right': 'M20 4v6h-6 M20 10a8 8 0 1 0-1 8',
    'rotate-left': 'M4 4v6h6 M4 10a8 8 0 1 1 1 8',
    remove: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
    reorder: 'M8 5h.01 M16 5h.01 M8 12h.01 M16 12h.01 M8 19h.01 M16 19h.01',
    details: 'M5 12h.01 M12 12h.01 M19 12h.01',
};

const createIcon = (document, action) => {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', iconPaths[action]);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', ['reorder', 'details'].includes(action) ? '3' : '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    icon.append(path);
    return icon;
};

const createButton = (document, { action, uid, label, text = '', disabled = false, handle = false }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = handle ? 'il-reorder-handle' : 'il-button';
    button.dataset.ilAction = action;
    if (uid) {
        button.dataset.ilUid = uid;
    }
    if (handle) {
        button.dataset.ilReorderHandle = '';
        button.draggable = true;
    }
    button.setAttribute('aria-label', label);
    button.title = label;
    button.disabled = disabled;
    if (text) {
        button.textContent = text;
    } else {
        button.append(createIcon(document, action));
    }
    return button;
};

const errorMessage = (error, fallback) => {
    if (typeof error?.message === 'string' && error.message) {
        return error.message;
    }
    if (typeof error === 'string' && error) {
        return error;
    }
    return fallback;
};

const format = (template, values) => template.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ''));

let rendererCount = 0;

export class Renderer {
    constructor({ target, labels, accept, onAction, onFiles }) {
        this.target = target;
        this.labels = labels;
        this.accept = accept;
        this.onAction = onAction;
        this.onFiles = onFiles;
        this.document = target.ownerDocument;
        this.fallbackPanels = new Map();
        rendererCount += 1;
        this.idPrefix = `il-${rendererCount}`;
        this.root = this.document.createElement('section');
        this.root.className = 'il-root';
        this.root.setAttribute('aria-label', labels.image);

        this.header = this.document.createElement('div');
        this.header.className = 'il-header';
        this.counter = appendText(this.header, 'p', 'il-counter', '');
        this.root.append(this.header);

        this.errorSummary = this.document.createElement('div');
        this.errorSummary.className = 'il-error-summary';
        this.errorSummary.setAttribute('role', 'alert');
        this.errorSummary.hidden = true;
        this.root.append(this.errorSummary);

        this.liveRegion = this.document.createElement('p');
        this.liveRegion.className = 'il-live';
        this.liveRegion.dataset.ilLive = '';
        this.liveRegion.setAttribute('aria-live', 'polite');
        this.liveRegion.setAttribute('aria-atomic', 'true');
        this.root.append(this.liveRegion);

        this.empty = this.document.createElement('div');
        this.empty.className = 'il-empty';
        appendText(this.empty, 'p', 'il-empty-copy', labels.empty);
        this.root.append(this.empty);

        this.dropzone = this.document.createElement('div');
        this.dropzone.className = 'il-dropzone';
        this.dropzone.setAttribute('role', 'group');
        this.dropzone.setAttribute('aria-label', labels.addImages);
        const instructions = appendText(this.dropzone, 'p', 'il-dropzone-copy', labels.dropzone);
        instructions.id = `${this.idPrefix}-instructions`;
        this.input = this.document.createElement('input');
        this.input.className = 'il-file-input';
        this.input.dataset.ilInput = '';
        this.input.type = 'file';
        this.input.multiple = true;
        this.input.accept = accept.join(',');
        this.input.setAttribute('aria-label', labels.addImages);
        this.dropzone.append(this.input);
        this.chooseButton = createButton(this.document, {
            action: 'choose-files',
            label: labels.chooseFiles,
        });
        this.chooseButton.setAttribute('aria-describedby', instructions.id);
        appendText(this.chooseButton, 'span', 'il-chooser-label', labels.chooseFiles);
        this.dropzone.append(this.chooseButton);

        this.grid = this.document.createElement('div');
        this.grid.className = 'il-grid';
        this.grid.setAttribute('role', 'list');
        this.root.append(this.grid);
        target.replaceChildren(this.root);

        this.handleClick = this.handleClick.bind(this);
        this.handleInput = this.handleInput.bind(this);
        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleFocusIn = this.handleFocusIn.bind(this);
        this.handleOutsidePointer = this.handleOutsidePointer.bind(this);
        this.positionPanels = this.positionPanels.bind(this);
        this.root.addEventListener('click', this.handleClick, true);
        this.root.addEventListener('change', this.handleInput);
        this.root.addEventListener('dragover', this.handleDragOver);
        this.root.addEventListener('drop', this.handleDrop);
        this.document.addEventListener('keydown', this.handleKeyDown);
        this.document.addEventListener('focusin', this.handleFocusIn);
        this.document.addEventListener('pointerdown', this.handleOutsidePointer);
        this.document.defaultView.addEventListener('resize', this.positionPanels);
        this.document.addEventListener('scroll', this.positionPanels, true);
    }

    handleClick(event) {
        const preview = event.target?.closest?.('.il-preview');
        if (preview && this.root.contains(preview)) {
            // Native focus reveals this card's actions without another UI state.
            this.focusSummary(preview.closest('.il-card').dataset.ilUid);
            return;
        }
        const summary = event.target?.closest?.('.il-details > summary');
        if (summary && this.root.contains(summary)) {
            event.preventDefault();
            if (summary.getAttribute('aria-disabled') === 'true') return;
            const details = summary.parentElement;
            const wasOpen = details.open;
            this.closeDetails();
            summary.focus();
            if (!wasOpen && summary.getAttribute('aria-disabled') !== 'true') {
                details.open = true;
                this.showPanel(details);
            }
            return;
        }
        const button = event.target?.closest?.('[data-il-action]');
        if (!button || !this.ownsTarget(button) || button.disabled) {
            return;
        }
        if (button.dataset.ilAction === 'choose-files') {
            this.input.click();
            return;
        }
        this.onAction(button.dataset.ilAction, button.dataset.ilUid, button);
    }

    closeDetails(restoreFocus = false) {
        for (const details of this.grid.querySelectorAll('.il-details[open]')) {
            const uid = details.closest('.il-card').dataset.ilUid;
            const panel = this.panelFor(details);
            // Committing a focused alt field can synchronously replace this card.
            // Mark it closed before blur, and finish blur before moving the panel.
            details.open = false;
            const active = this.document.activeElement;
            if (panel.contains(active)) active.blur();
            try { panel.hidePopover?.(); } catch { /* Already closed or unsupported. */ }
            panel.hidden = true;
            this.releaseFallback(details);
            if (restoreFocus) this.focusSummary(uid);
        }
    }

    panelFor(details) {
        return this.fallbackPanels.get(details)?.firstElementChild ?? details.querySelector('.il-context-panel');
    }

    ownsTarget(target) {
        return this.root.contains(target) || [...this.fallbackPanels.values()].some(portal => portal.contains(target));
    }

    mountFallback(details, panel) {
        panel.removeAttribute('popover');
        const portal = this.document.createElement('div');
        portal.className = 'il-root il-context-portal';
        const computed = this.document.defaultView.getComputedStyle(this.root);
        for (let index = 0; index < computed.length; index++) {
            const property = computed[index];
            if (property.startsWith('--il-')) portal.style.setProperty(property, computed.getPropertyValue(property));
        }
        for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'direction']) {
            portal.style.setProperty(property, computed.getPropertyValue(property));
        }
        portal.addEventListener('click', this.handleClick, true);
        portal.addEventListener('change', this.handleInput);
        portal.append(panel);
        // A body sibling of a modal dialog is inert; stay in its active layer.
        (this.root.closest('dialog[open]') ?? this.document.body).append(portal);
        this.fallbackPanels.set(details, portal);
    }

    releaseFallback(details) {
        const portal = this.fallbackPanels.get(details);
        if (!portal) return;
        details.append(portal.firstElementChild);
        portal.removeEventListener('click', this.handleClick, true);
        portal.removeEventListener('change', this.handleInput);
        portal.remove();
        this.fallbackPanels.delete(details);
    }

    handleKeyDown(event) {
        // Blurring an alt field can rerender its card and leave focus on body.
        // Only the most recently focused gallery may recover that lost focus.
        const ownsFocus = this.ownsTarget(event.target)
            || (event.target === this.document.body && this.contextFocusOwned);
        if (event.key === 'Escape' && !event.defaultPrevented && ownsFocus && this.grid.querySelector('.il-details[open]')
            && !this.document.querySelector('.il-confirmation-dialog[open]')) {
            event.preventDefault();
            this.closeDetails(true);
        }
    }

    handleFocusIn(event) {
        this.contextFocusOwned = this.ownsTarget(event.target);
    }

    handleOutsidePointer(event) {
        const open = this.grid.querySelector('.il-details[open]');
        if (open && !open.contains(event.target) && !this.panelFor(open).contains(event.target)) this.closeDetails();
    }

    showPanel(details) {
        const panel = details.querySelector('.il-context-panel');
        panel.hidden = false;
        try {
            if (typeof panel.showPopover !== 'function') throw new Error('Popover unavailable');
            panel.showPopover();
        } catch {
            this.mountFallback(details, panel);
        }
        this.positionPanels();
    }

    positionPanels() {
        const view = this.document.defaultView;
        const viewport = view.visualViewport;
        const width = viewport?.width ?? view.innerWidth;
        const height = viewport?.height ?? view.innerHeight;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        for (const details of this.grid.querySelectorAll('.il-details[open]')) {
            const panel = this.panelFor(details);
            panel.style.maxHeight = `${Math.max(44, height - 16)}px`;
            const anchor = details.querySelector('summary').getBoundingClientRect();
            const box = panel.getBoundingClientRect();
            panel.style.left = `${Math.max(left + 8, Math.min(anchor.right - box.width, left + width - box.width - 8))}px`;
            const below = anchor.bottom + 6;
            panel.style.top = `${Math.max(top + 8, Math.min(below + box.height <= top + height - 8 ? below : anchor.top - box.height - 6, top + height - box.height - 8))}px`;
        }
    }

    handleInput(event) {
        const altInput = event.target?.closest?.('[data-il-action="update-alt"]');
        if (altInput && this.ownsTarget(altInput) && !altInput.disabled) {
            this.onAction('update-alt', altInput.dataset.ilUid, altInput);
            return;
        }
        if (this.additionsDisabled || event.target !== this.input || !this.input.files?.length) {
            return;
        }
        this.onFiles(this.input.files);
        this.input.value = '';
    }

    handleDragOver(event) {
        const transfer = event.dataTransfer;
        if (Array.from(transfer?.types ?? []).includes('Files')
            || Array.from(transfer?.items ?? []).some((item) => item.kind === 'file')) {
            event.preventDefault();
        }
    }

    handleDrop(event) {
        const files = event.dataTransfer?.files;
        if (!files?.length) {
            return;
        }
        event.preventDefault();
        if (!this.additionsDisabled) {
            this.onFiles(files);
        }
    }

    render({ items, maxFiles, busy, messages = [] }) {
        const previous = this.captureRenderState();
        this.closeDetails();
        const full = items.length >= maxFiles;
        const additionsDisabled = full || busy;
        this.additionsDisabled = additionsDisabled;
        this.counter.textContent = format(this.labels.count, {
            count: items.length,
            maxFiles: maxFiles === Infinity ? '∞' : maxFiles,
        });
        this.empty.hidden = items.length !== 0;
        this.dropzone.hidden = full;
        this.dropzone.setAttribute('aria-disabled', String(additionsDisabled));
        this.input.disabled = additionsDisabled;
        this.chooseButton.disabled = additionsDisabled;

        const allMessages = [
            ...messages,
            ...items.filter((item) => item.status === 'error').map((item) => errorMessage(item.error, this.labels.status.error)),
        ];
        this.errorSummary.hidden = allMessages.length === 0;
        this.errorSummary.replaceChildren();
        for (const message of allMessages) {
            appendText(this.errorSummary, 'p', 'il-error-message', message);
        }

        this.grid.replaceChildren();
        items.forEach((item) => this.grid.append(this.renderCard(item, items.length, busy, previous.openDetails)));
        this.grid.append(this.dropzone);
        for (const details of this.grid.querySelectorAll('.il-details[open]')) this.showPanel(details);
        if (previous.focus) {
            this.restoreFocus(previous.focus);
        }
    }

    captureRenderState() {
        const openDetails = new Set(
            [...this.grid.querySelectorAll('.il-details[open]')]
                .map((details) => details.closest('[data-il-uid]')?.dataset.ilUid)
                .filter(Boolean),
        );
        const active = this.document.activeElement;
        const control = active?.closest?.('[data-il-action]');
        const summary = active?.tagName === 'SUMMARY' && active.parentElement?.classList.contains('il-details')
            ? active
            : null;
        const focusedElement = control ?? summary;
        const card = focusedElement?.closest?.('[data-il-uid]');
        const focus = focusedElement && card && this.ownsTarget(focusedElement)
            ? {
                uid: card.dataset.ilUid,
                type: summary ? 'summary' : 'control',
                action: control?.dataset.ilAction,
            }
            : null;
        return { openDetails, focus };
    }

    hintId(uid) {
        return `${this.idPrefix}-alt-hint-${encodeURIComponent(uid)}`;
    }

    renderCard(item, total, busy, openDetails) {
        const card = this.document.createElement('article');
        card.className = 'il-card';
        card.dataset.ilUid = item.uid;
        card.setAttribute('role', 'listitem');

        const preview = this.document.createElement('div');
        preview.className = 'il-preview';
        const image = this.document.createElement('img');
        image.src = item.previewUrl ?? '';
        image.alt = item.altText;
        image.style.transform = `rotate(${item.rotation}deg)`;
        preview.append(image);
        const badges = this.document.createElement('div');
        badges.className = 'il-badges';
        if (item.primary) {
            appendText(badges, 'span', 'il-badge il-badge--primary', this.labels.status.primary);
        }
        if (item.source === 'local') {
            appendText(badges, 'span', 'il-badge il-badge--local', this.labels.status.local);
        }
        if (item.status !== 'ready') {
            appendText(badges, 'span', `il-badge il-badge--${item.status}`, this.labels.status[item.status]);
        }
        preview.append(badges);
        card.append(preview);

        const controls = this.document.createElement('div');
        controls.className = 'il-controls';
        const blocked = busy || item.status === 'processing' || item.status === 'deleting';
        card.append(createButton(this.document, {
            action: 'reorder', uid: item.uid, label: this.labels.actions.reorder, handle: true, disabled: blocked,
        }));
        controls.append(createButton(this.document, {
            action: 'rotate-right', uid: item.uid, label: this.labels.actions.rotateRight, disabled: blocked,
        }));
        controls.append(createButton(this.document, {
            action: 'remove', uid: item.uid, label: this.labels.actions.remove,
            disabled: blocked,
        }));
        card.append(controls);

        const details = this.document.createElement('details');
        details.className = 'il-details';
        details.open = openDetails.has(item.uid) && !blocked;
        const summary = this.document.createElement('summary');
        summary.setAttribute('aria-label', this.labels.actions.editDetails);
        const panelId = `${this.idPrefix}-context-${encodeURIComponent(item.uid)}`;
        summary.setAttribute('aria-controls', panelId);
        summary.setAttribute('aria-disabled', String(blocked));
        summary.tabIndex = blocked ? -1 : 0;
        summary.title = this.labels.actions.editDetails;
        summary.append(createIcon(this.document, 'details'));
        details.append(summary);
        const panel = this.document.createElement('div');
        panel.id = panelId;
        panel.className = 'il-context-panel';
        panel.setAttribute('role', 'group');
        panel.setAttribute('aria-label', this.labels.actions.editDetails);
        panel.hidden = !details.open;
        if (typeof panel.showPopover === 'function') panel.setAttribute('popover', 'manual');
        for (const [action, label, disabled] of [
            ['set-primary', this.labels.actions.setPrimary, blocked || item.primary],
            ['rotate-left', this.labels.actions.rotateLeft, blocked],
            ['move-left', this.labels.actions.moveLeft, blocked || item.position === 0],
            ['move-right', this.labels.actions.moveRight, blocked || item.position === total - 1],
        ]) {
            panel.append(createButton(this.document, { action, uid: item.uid, label, text: label, disabled }));
        }
        const field = this.document.createElement('label');
        field.className = 'il-alt-field';
        appendText(field, 'span', 'il-alt-label', this.labels.fields.altText);
        const input = this.document.createElement('input');
        input.type = 'text';
        input.dataset.ilAction = 'update-alt';
        input.dataset.ilUid = item.uid;
        input.value = item.altText;
        input.disabled = blocked;
        input.setAttribute('aria-describedby', this.hintId(item.uid));
        field.append(input);
        const hint = appendText(field, 'span', 'il-alt-hint', this.labels.fields.altTextHint);
        hint.id = this.hintId(item.uid);
        panel.append(field);
        details.append(panel);
        card.append(details);
        return card;
    }

    focusControl(uid, action) {
        const card = [...this.grid.querySelectorAll('[data-il-uid]')]
            .find((candidate) => candidate.dataset.ilUid === uid);
        if (!card) {
            return false;
        }
        const panel = this.panelFor(card.querySelector('.il-details'));
        const control = [...card.querySelectorAll('[data-il-action]'), ...panel.querySelectorAll('[data-il-action]')]
            .find((candidate) => candidate.dataset.ilAction === action && !candidate.disabled);
        control?.focus();
        return Boolean(control);
    }

    focusSummary(uid) {
        const card = [...this.grid.querySelectorAll('[data-il-uid]')]
            .find((candidate) => candidate.dataset.ilUid === uid);
        const summary = card?.querySelector('.il-details > summary');
        if (summary?.getAttribute('aria-disabled') === 'true') return false;
        summary?.focus();
        return Boolean(summary);
    }

    restoreFocus(focus) {
        if (focus.type === 'summary') {
            return this.focusSummary(focus.uid);
        }
        return this.focusControl(focus.uid, focus.action) || this.focusSummary(focus.uid);
    }

    focusChooser() {
        if (this.chooseButton.disabled) {
            return false;
        }
        this.chooseButton.focus();
        return true;
    }

    focusAfterRemoval(position) {
        const cards = [...this.grid.querySelectorAll('.il-card')];
        const next = cards[Math.min(position, cards.length - 1)];
        if (next) {
            const reorder = next.querySelector('[data-il-action="reorder"]');
            reorder?.focus();
            return Boolean(reorder);
        }
        return this.focusChooser();
    }

    destroy() {
        this.closeDetails();
        this.root.removeEventListener('click', this.handleClick, true);
        this.root.removeEventListener('change', this.handleInput);
        this.root.removeEventListener('dragover', this.handleDragOver);
        this.root.removeEventListener('drop', this.handleDrop);
        this.document.removeEventListener('keydown', this.handleKeyDown);
        this.document.removeEventListener('focusin', this.handleFocusIn);
        this.document.removeEventListener('pointerdown', this.handleOutsidePointer);
        this.document.defaultView.removeEventListener('resize', this.positionPanels);
        this.document.removeEventListener('scroll', this.positionPanels, true);
        if (this.target.firstChild === this.root) {
            this.target.replaceChildren();
        }
    }
}
