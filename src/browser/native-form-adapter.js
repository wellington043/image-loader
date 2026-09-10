const adapterError = (code, message) => Object.assign(new Error(message), { code });
const managedFileField = /^media_files\[[^\]]+\]$/;

const isSubmitControl = (control) => {
    const type = String(control?.type ?? '').toLowerCase();
    return type === 'submit' || type === 'image';
};

export class NativeFormAdapter {
    constructor(form, loader) {
        if (!form || typeof form.addEventListener !== 'function' || typeof form.requestSubmit !== 'function') {
            throw new TypeError('NativeFormAdapter requires a form with native event and requestSubmit support.');
        }
        if (!loader || typeof loader.serialize !== 'function' || typeof loader.isBusy !== 'function') {
            throw new TypeError('NativeFormAdapter requires an ImageLoader-compatible instance.');
        }

        this.form = form;
        this.loader = loader;
        this.destroyed = false;
        this.preparing = false;
        this.resume = null;
        this.prepared = null;
        this.selectionVersion = 0;
        this.disabledControls = null;
        this.lastError = null;
        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleFormData = this.handleFormData.bind(this);
        this.handleChange = this.handleChange.bind(this);
        this.unsubscribeChange = null;

        form.addEventListener('submit', this.handleSubmit, true);
        form.addEventListener('formdata', this.handleFormData);
        if (typeof loader.on === 'function') {
            this.unsubscribeChange = loader.on('change', this.handleChange);
        }
    }

    handleChange() {
        if (this.destroyed) {
            return;
        }
        this.selectionVersion += 1;
        if (this.resume) {
            this.resume.invalidated = true;
            this.resume.error = adapterError(
                'selection-changed',
                'The selected images changed while they were being prepared. Submit the form again.',
            );
            if (this.resume.event) {
                this.blockResumedEvent(this.resume.event, this.resume);
            }
        }
    }

    getAssociatedSubmitControls(submitter) {
        const controls = new Set(Array.from(this.form.elements ?? []).filter((control) => (
            control?.form === this.form && isSubmitControl(control)
        )));
        if (submitter?.form === this.form && isSubmitControl(submitter)) {
            controls.add(submitter);
        }
        return controls;
    }

    snapshotAndDisableSubmitControls(submitter) {
        if (this.disabledControls) {
            return;
        }
        this.disabledControls = new Map(
            Array.from(this.getAssociatedSubmitControls(submitter), (control) => [control, control.disabled]),
        );
        for (const control of this.disabledControls.keys()) {
            control.disabled = true;
        }
    }

    restoreSubmitControls() {
        if (!this.disabledControls) {
            return;
        }
        for (const [control, disabled] of this.disabledControls) {
            control.disabled = disabled;
        }
        this.disabledControls = null;
    }

    reportError(error) {
        this.lastError = error instanceof Error ? error : new Error(String(error));
        const CustomEventConstructor = this.form.ownerDocument?.defaultView?.CustomEvent ?? globalThis.CustomEvent;
        if (typeof this.form.dispatchEvent !== 'function' || typeof CustomEventConstructor !== 'function') {
            return;
        }
        try {
            this.form.dispatchEvent(new CustomEventConstructor('image-loader:submit-error', {
                detail: { error: this.lastError },
            }));
        } catch {
            // A consumer event listener must not leave the form disabled or partially prepared.
        }
    }

    block(event, error) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.reportError(error);
    }

    blockResumedEvent(event, resume) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!resume.errorReported) {
            resume.errorReported = true;
            this.reportError(resume.error);
        }
    }

    getResumeError(resume) {
        if (this.destroyed || this.resume !== resume) {
            return adapterError('prepared-payload-invalid', 'Prepared images are no longer available. Submit the form again.');
        }
        if (resume.invalidated || resume.selectionVersion !== this.selectionVersion) {
            return resume.error ?? adapterError(
                'selection-changed',
                'The selected images changed while they were being prepared. Submit the form again.',
            );
        }
        if (this.loader.isBusy()) {
            return adapterError('image-busy', 'Images cannot be submitted while one is busy.');
        }
        if (this.prepared !== resume.prepared) {
            return adapterError('prepared-payload-invalid', 'Prepared images are no longer available. Submit the form again.');
        }
        return null;
    }

    removeResumeFinalizer(resume) {
        if (!resume?.finalizer) {
            return;
        }
        this.form.removeEventListener('submit', resume.finalizer);
        resume.finalizer = null;
    }

    finishResume(resume) {
        this.removeResumeFinalizer(resume);
        if (this.resume === resume) {
            this.resume = null;
        }
        if (this.prepared === resume?.prepared) {
            this.prepared = null;
        }
        this.restoreSubmitControls();
    }

    installResumeFinalizer(resume) {
        const finalizer = (event) => {
            if (event !== resume.event) {
                return;
            }
            this.removeResumeFinalizer(resume);
            const resumeError = this.getResumeError(resume);
            if (resumeError) {
                resume.error = resumeError;
                this.blockResumedEvent(event, resume);
                this.finishResume(resume);
                return;
            }
            if (!this.isEligibleSubmitter(resume.submitter)) {
                resume.error = adapterError(
                    'submitter-ineligible',
                    'The original submitter is no longer eligible to submit this form.',
                );
                this.blockResumedEvent(event, resume);
                this.finishResume(resume);
            }
        };
        resume.finalizer = finalizer;
        this.form.addEventListener('submit', finalizer);
    }

    isEligibleSubmitter(submitter) {
        return submitter == null || (
            submitter.form === this.form
            && !submitter.disabled
            && isSubmitControl(submitter)
        );
    }

    async handleSubmit(event) {
        if (this.destroyed) {
            return;
        }

        if (this.resume) {
            const resumeError = this.getResumeError(this.resume);
            if (resumeError) {
                this.resume.error = resumeError;
                this.blockResumedEvent(event, this.resume);
                return;
            }
            if (!this.isEligibleSubmitter(this.resume.submitter)) {
                this.resume.error = adapterError(
                    'submitter-ineligible',
                    'The original submitter is no longer eligible to submit this form.',
                );
                this.blockResumedEvent(event, this.resume);
                return;
            }
            this.resume.event = event;
            return;
        }

        if (event.defaultPrevented || (typeof this.form.checkValidity === 'function' && !this.form.checkValidity())) {
            return;
        }

        if (this.preparing) {
            this.block(event, adapterError('submit-preparing', 'Image preparation is already in progress.'));
            return;
        }

        if (this.loader.isBusy()) {
            this.block(event, adapterError('image-busy', 'Images cannot be submitted while one is busy.'));
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        this.preparing = true;
        this.lastError = null;
        const selectionVersion = this.selectionVersion;
        this.snapshotAndDisableSubmitControls(event.submitter ?? null);

        try {
            // A native click can flush microtasks before its submit event finishes.
            // requestSubmit then silently refuses reentry; resume in the next task.
            const submissionEventFinished = new Promise((resolve) => setTimeout(resolve, 0));
            const payload = await this.loader.serialize();
            await submissionEventFinished;
            if (this.destroyed) {
                return;
            }
            if (selectionVersion !== this.selectionVersion) {
                throw adapterError('selection-changed', 'The selected images changed while they were being prepared. Submit the form again.');
            }

            const prepared = { formDataInstances: new WeakSet(), payload };
            this.prepared = prepared;
            this.restoreSubmitControls();
            this.preparing = false;
            if (!this.isEligibleSubmitter(event.submitter ?? null)) {
                throw adapterError('submitter-ineligible', 'The original submitter is no longer eligible to submit this form.');
            }
            const resume = {
                error: null,
                errorReported: false,
                event: null,
                invalidated: false,
                prepared,
                selectionVersion,
                submitter: event.submitter ?? null,
            };
            this.resume = resume;
            try {
                this.installResumeFinalizer(resume);
                this.form.requestSubmit(resume.submitter ?? undefined);
            } finally {
                this.finishResume(resume);
            }
        } catch (error) {
            if (!this.destroyed) {
                this.prepared = null;
                this.reportError(error);
            }
        } finally {
            if (!this.destroyed) {
                this.preparing = false;
                this.restoreSubmitControls();
            }
        }
    }

    handleFormData(event) {
        const resume = this.resume;
        if (this.destroyed || !resume || this.getResumeError(resume) || resume.prepared.formDataInstances.has(event.formData)) {
            return;
        }

        resume.prepared.formDataInstances.add(event.formData);
        const { formData } = event;
        const managedNames = new Set(Array.from(formData.keys()).filter((name) => managedFileField.test(name)));
        formData.set('media_manifest', JSON.stringify(resume.prepared.payload.manifest));
        for (const name of managedNames) {
            formData.delete(name);
        }
        for (const [uploadKey, file] of resume.prepared.payload.files) {
            formData.set(`media_files[${uploadKey}]`, file);
        }
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.form.removeEventListener('submit', this.handleSubmit, true);
        this.form.removeEventListener('formdata', this.handleFormData);
        if (typeof this.unsubscribeChange === 'function') {
            try {
                this.unsubscribeChange();
            } catch {
                // Loader teardown can already have removed its listeners.
            }
        } else if (typeof this.loader.off === 'function') {
            try {
                this.loader.off('change', this.handleChange);
            } catch {
                // A destroyed loader intentionally rejects further listener changes.
            }
        }
        this.unsubscribeChange = null;
        this.removeResumeFinalizer(this.resume);
        this.prepared = null;
        this.preparing = false;
        this.resume = null;
        this.restoreSubmitControls();
    }
}
