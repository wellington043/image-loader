let dialogCount = 0;

const focusIfAvailable = (element) => {
    if (element?.isConnected && !element.disabled) {
        element.focus();
        return true;
    }
    return false;
};

export class ConfirmationDialog {
    constructor({ document, labels }) {
        this.document = document;
        this.labels = labels;
        this.destroyed = false;
        this.pending = null;
        this.closingSession = null;
        this.ignoredCloseTokens = [];
        this.sessionCount = 0;

        dialogCount += 1;
        const idPrefix = `il-confirmation-${dialogCount}`;
        this.element = document.createElement('dialog');
        this.element.className = 'il-confirmation-dialog';
        this.element.setAttribute('role', 'dialog');
        this.element.setAttribute('aria-modal', 'true');

        const content = document.createElement('div');
        content.className = 'il-confirmation-dialog__content';
        this.title = document.createElement('h2');
        this.title.id = `${idPrefix}-title`;
        this.title.textContent = labels.title;
        content.append(this.title);
        this.description = document.createElement('p');
        this.description.id = `${idPrefix}-description`;
        this.description.textContent = labels.description;
        content.append(this.description);
        this.element.setAttribute('aria-labelledby', this.title.id);
        this.element.setAttribute('aria-describedby', this.description.id);

        const actions = document.createElement('div');
        actions.className = 'il-confirmation-dialog__actions';
        this.cancelButton = document.createElement('button');
        this.cancelButton.type = 'button';
        this.cancelButton.textContent = labels.cancel;
        actions.append(this.cancelButton);
        this.confirmButton = document.createElement('button');
        this.confirmButton.type = 'button';
        this.confirmButton.textContent = labels.confirm;
        actions.append(this.confirmButton);
        content.append(actions);
        this.element.append(content);
        document.body.append(this.element);

        this.handleCancel = this.handleCancel.bind(this);
        this.handleConfirm = this.handleConfirm.bind(this);
        this.handleNativeCancel = this.handleNativeCancel.bind(this);
        this.handleClose = this.handleClose.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
        this.cancelButton.addEventListener('click', this.handleCancel);
        this.confirmButton.addEventListener('click', this.handleConfirm);
        this.element.addEventListener('cancel', this.handleNativeCancel);
        this.element.addEventListener('close', this.handleClose);
        this.element.addEventListener('keydown', this.handleKeydown);
    }

    confirm(_item, trigger) {
        if (this.destroyed) {
            return Promise.resolve(false);
        }
        if (this.pending) {
            return this.pending.promise;
        }

        let resolve;
        const promise = new Promise((resolvePromise) => {
            resolve = resolvePromise;
        });
        const session = {
            token: ++this.sessionCount,
            promise,
            resolve,
            trigger: trigger ?? this.document.activeElement,
            mode: 'fallback',
            closeObserved: false,
            settled: false,
        };
        this.pending = session;
        this.open(session);
        focusIfAvailable(this.cancelButton);
        return promise;
    }

    open(session) {
        if (typeof this.element.showModal === 'function') {
            try {
                this.element.showModal();
                session.mode = 'native';
                return;
            } catch {
                // Fall through to the ARIA dialog fallback used by DOM test environments.
            }
        }
        session.mode = 'fallback';
        this.element.setAttribute('open', '');
    }

    close(session) {
        let scheduleIgnoredClose = false;
        this.closingSession = session;
        try {
            if (session.mode === 'native' && typeof this.element.close === 'function' && this.element.open) {
                this.element.close();
                scheduleIgnoredClose = !session.closeObserved;
            }
        } catch {
            // The fallback below still closes and settles a dialog with broken native methods.
        } finally {
            this.closingSession = null;
            this.element.removeAttribute('open');
            if (scheduleIgnoredClose) {
                this.ignoredCloseTokens.push(session.token);
            }
        }
    }

    settle(decision, { returnFocus = true } = {}) {
        const session = this.pending;
        if (!session || session.settled) {
            return;
        }
        session.settled = true;
        this.pending = null;
        try {
            this.close(session);
        } finally {
            try {
                if (returnFocus) {
                    focusIfAvailable(session.trigger);
                }
            } finally {
                session.resolve(decision);
            }
        }
    }

    handleCancel() {
        this.settle(false);
    }

    handleConfirm() {
        this.settle(true);
    }

    handleNativeCancel(event) {
        event.preventDefault();
        this.settle(false);
    }

    handleClose() {
        if (this.closingSession) {
            this.closingSession.closeObserved = true;
            return;
        }
        const ignoredToken = this.ignoredCloseTokens[0];
        if (ignoredToken && (!this.pending || (this.pending.token !== ignoredToken && this.element.open))) {
            this.ignoredCloseTokens.shift();
            return;
        }
        this.settle(false);
    }

    handleKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.settle(false);
        }
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.settle(false, { returnFocus: false });
        this.cancelButton.removeEventListener('click', this.handleCancel);
        this.confirmButton.removeEventListener('click', this.handleConfirm);
        this.element.removeEventListener('cancel', this.handleNativeCancel);
        this.element.removeEventListener('close', this.handleClose);
        this.element.removeEventListener('keydown', this.handleKeydown);
        this.element.remove();
    }
}
