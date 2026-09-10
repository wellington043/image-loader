import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import test from 'node:test';
import { NativeFormAdapter } from '../../src/browser/native-form-adapter.js';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const tick = () => new Promise((resolve) => queueMicrotask(resolve));

async function waitFor(predicate, message = 'Timed out waiting for the expected form state.') {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.fail(message);
}

function fakeLoader(serialized) {
    const listeners = new Map();
    let busy = false;
    let serializeCalls = 0;
    let serializeResult = serialized;

    return {
        async serialize() {
            serializeCalls += 1;
            return typeof serializeResult === 'function' ? serializeResult() : serializeResult;
        },
        isBusy: () => busy,
        on(event, listener) {
            const eventListeners = listeners.get(event) ?? new Set();
            eventListeners.add(listener);
            listeners.set(event, eventListeners);
            return () => this.off(event, listener);
        },
        off(event, listener) {
            listeners.get(event)?.delete(listener);
        },
        emit(event, payload) {
            for (const listener of listeners.get(event) ?? []) {
                listener(payload);
            }
        },
        setBusy(value) {
            busy = value;
        },
        setSerialized(value) {
            serializeResult = value;
        },
        get serializeCalls() {
            return serializeCalls;
        },
    };
}

function formFixture({ initialEntries = [] } = {}) {
    const listeners = new Map();
    const submissions = [];
    const emittedEvents = [];
    const submitter = {
        disabled: false,
        form: null,
        formAction: '/save-default',
        formMethod: 'post',
        name: 'intent',
        type: 'submit',
        value: 'save',
    };
    const initiallyDisabledSubmitter = {
        disabled: true,
        form: null,
        type: 'submit',
    };
    const customEvent = class {
        constructor(type, init = {}) {
            this.type = type;
            Object.assign(this, init);
        }
    };
    const form = {
        attributes: new Map(),
        controls: [submitter, initiallyDisabledSubmitter],
        elements: [submitter, initiallyDisabledSubmitter],
        ownerDocument: { defaultView: { CustomEvent: customEvent } },
        addEventListener(name, listener, capture = false) {
            const eventListeners = listeners.get(name) ?? [];
            eventListeners.push({ listener, capture: Boolean(capture) });
            listeners.set(name, eventListeners);
        },
        removeEventListener(name, listener, capture = false) {
            const eventListeners = listeners.get(name) ?? [];
            listeners.set(name, eventListeners.filter((entry) => (
                entry.listener !== listener || entry.capture !== Boolean(capture)
            )));
        },
        listenerCount(name, capture = false) {
            return (listeners.get(name) ?? []).filter((entry) => entry.capture === Boolean(capture)).length;
        },
        querySelectorAll() {
            return this.controls;
        },
        getAttribute(name) {
            return this.attributes.get(name) ?? null;
        },
        setAttribute(name, value) {
            this.attributes.set(name, value);
        },
        removeAttribute(name) {
            this.attributes.delete(name);
        },
        checkValidity() {
            return true;
        },
        dispatchEvent(event) {
            emittedEvents.push(event);
            return true;
        },
        emitFormData(data) {
            for (const entry of listeners.get('formdata') ?? []) {
                entry.listener({ formData: data });
            }
        },
        createFormData() {
            const data = new FormData();
            for (const [name, value] of initialEntries) {
                data.append(name, value);
            }
            this.emitFormData(data);
            return data;
        },
        requestSubmit(button) {
            const event = {
                submitter: button ?? null,
                defaultPrevented: false,
                immediateStopped: false,
                preventDefault() {
                    this.defaultPrevented = true;
                },
                stopImmediatePropagation() {
                    this.immediateStopped = true;
                },
            };
            const submitListeners = listeners.get('submit') ?? [];
            for (const capture of [true, false]) {
                for (const entry of submitListeners) {
                    if (entry.capture !== capture) {
                        continue;
                    }
                    entry.listener(event);
                    if (event.immediateStopped) {
                        break;
                    }
                }
                if (event.immediateStopped) {
                    break;
                }
            }
            if (!event.defaultPrevented) {
                const data = this.createFormData();
                submissions.push({ submitter: button ?? null, data });
            }
        },
    };
    submitter.form = form;
    initiallyDisabledSubmitter.form = form;
    return { form, submitter, initiallyDisabledSubmitter, submissions, emittedEvents };
}

const serializedMedia = (uploadKey = 'abc') => ({
    manifest: [{ source: 'local', uploadKey, position: 0, primary: true, rotation: 0 }],
    files: new Map([[uploadKey, new File(['webp'], `${uploadKey}.webp`, { type: 'image/webp' })]]),
});

test('prepares once, preserves submitter and appends keyed files through formdata', async () => {
    const loader = fakeLoader(serializedMedia());
    const { form, submitter, submissions } = formFixture();
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await waitFor(() => submissions.length === 1);

    assert.equal(loader.serializeCalls, 1);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].submitter, submitter);
    assert.equal(JSON.parse(submissions[0].data.get('media_manifest'))[0].uploadKey, 'abc');
    assert.equal(submissions[0].data.get('media_files[abc]').name, 'abc.webp');
    adapter.destroy();
});

test('blocks duplicate submissions while preparing and restores every submit control state', async () => {
    const serialization = deferred();
    const loader = fakeLoader(() => serialization.promise);
    const { form, submitter, initiallyDisabledSubmitter, submissions } = formFixture();
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await tick();
    assert.equal(submitter.disabled, true);
    assert.equal(initiallyDisabledSubmitter.disabled, true);

    form.requestSubmit(submitter);
    assert.equal(loader.serializeCalls, 1);
    assert.equal(submissions.length, 0);

    serialization.resolve(serializedMedia());
    await waitFor(() => submissions.length === 1);

    assert.equal(submissions.length, 1);
    assert.equal(submitter.disabled, false);
    assert.equal(initiallyDisabledSubmitter.disabled, true);
    adapter.destroy();
});

test('blocks a busy loader without serializing or partially submitting', async () => {
    const loader = fakeLoader(serializedMedia());
    loader.setBusy(true);
    const { form, submitter, submissions, emittedEvents } = formFixture();
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await waitFor(() => adapter.lastError);

    assert.equal(loader.serializeCalls, 0);
    assert.equal(submissions.length, 0);
    assert.equal(adapter.lastError.code, 'image-busy');
    assert.equal(emittedEvents.at(-1).type, 'image-loader:submit-error');
    adapter.destroy();
});

test('keeps the form editable and exposes the serializer failure without a partial submit', async () => {
    const failure = new Error('The selected image cannot be transformed.');
    const loader = fakeLoader(() => Promise.reject(failure));
    const { form, submitter, submissions, emittedEvents } = formFixture();
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await waitFor(() => adapter.lastError);

    assert.equal(submissions.length, 0);
    assert.equal(submitter.disabled, false);
    assert.equal(adapter.lastError, failure);
    assert.equal(emittedEvents.at(-1).detail.error, failure);
    adapter.destroy();
});

test('rejects a prepared payload when the selection changes before serialization resolves', async () => {
    const serialization = deferred();
    const loader = fakeLoader(() => serialization.promise);
    const { form, submitter, submissions } = formFixture();
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await tick();
    loader.emit('change', { items: [] });
    serialization.resolve(serializedMedia('stale'));
    await waitFor(() => adapter.lastError);

    assert.equal(submissions.length, 0);
    assert.equal(adapter.lastError.code, 'selection-changed');
    loader.setSerialized(serializedMedia('fresh'));
    form.requestSubmit(submitter);
    await waitFor(() => submissions.length === 1);
    assert.equal(submissions.length, 1);
    assert.equal(JSON.parse(submissions[0].data.get('media_manifest'))[0].uploadKey, 'fresh');
    adapter.destroy();
});

test('resumes a native submit after an earlier capture listener has prepared variation files', async () => {
    const loader = fakeLoader(serializedMedia());
    const { form, submitter, submissions } = formFixture();
    let variationPrepared = false;
    let variationCaptureCount = 0;
    const variationFile = new File(['variation'], 'variation.webp', { type: 'image/webp' });
    form.addEventListener('submit', () => {
        variationCaptureCount += 1;
        variationPrepared = true;
    }, true);
    form.addEventListener('formdata', ({ formData }) => {
        if (variationPrepared) {
            formData.append('variation_files[blue]', variationFile);
        }
    });
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await waitFor(() => submissions.length === 1);

    assert.equal(variationCaptureCount, 2);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].data.get('variation_files[blue]').name, 'variation.webp');
    assert.equal(submissions[0].data.get('media_files[abc]').name, 'abc.webp');
    adapter.destroy();
});

test('blocks a resumed native submit when an earlier capture listener changes the selection', async () => {
    const loader = fakeLoader(serializedMedia());
    const { form, submitter, submissions } = formFixture();
    let captureCount = 0;
    form.addEventListener('submit', () => {
        captureCount += 1;
        if (captureCount === 2) {
            loader.emit('change', { items: [] });
        }
    }, true);
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await waitFor(() => adapter.lastError);

    assert.equal(captureCount, 2);
    assert.equal(submissions.length, 0);
    assert.equal(adapter.lastError.code, 'selection-changed');
    adapter.destroy();
});

test('blocks a resumed native submit when the loader becomes busy', async () => {
    const loader = fakeLoader(serializedMedia());
    const { form, submitter, submissions } = formFixture();
    let captureCount = 0;
    form.addEventListener('submit', () => {
        captureCount += 1;
        if (captureCount === 2) {
            loader.setBusy(true);
        }
    }, true);
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await waitFor(() => adapter.lastError);

    assert.equal(submissions.length, 0);
    assert.equal(adapter.lastError.code, 'image-busy');
    adapter.destroy();
});

test('keeps media attached to inspected and native FormData while replacing only managed fields', async () => {
    const oldFile = new File(['old'], 'old.webp', { type: 'image/webp' });
    const staleFile = new File(['stale'], 'stale.webp', { type: 'image/webp' });
    const loader = fakeLoader(serializedMedia());
    const { form, submitter, submissions } = formFixture({
        initialEntries: [
            ['title', 'Coffee grinder'],
            ['media_manifest', 'old manifest'],
            ['media_files[abc]', oldFile],
            ['media_files[stale]', staleFile],
        ],
    });
    let inspectedData;
    form.addEventListener('submit', () => {
        inspectedData = form.createFormData();
        form.emitFormData(inspectedData);
    });
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await waitFor(() => submissions.length === 1);

    for (const data of [inspectedData, submissions[0].data]) {
        assert.equal(data.get('title'), 'Coffee grinder');
        assert.equal(data.getAll('media_manifest').length, 1);
        assert.equal(JSON.parse(data.get('media_manifest'))[0].uploadKey, 'abc');
        assert.equal(data.getAll('media_files[abc]').length, 1);
        assert.equal(data.get('media_files[abc]').name, 'abc.webp');
        assert.equal(data.get('media_files[stale]'), null);
    }
    adapter.destroy();
});

test('disables an associated external submitter without disabling another form control', async () => {
    const serialization = deferred();
    const loader = fakeLoader(() => serialization.promise);
    const { form, submissions } = formFixture();
    const externalSubmitter = {
        disabled: false,
        form,
        formAction: '/save-draft',
        formMethod: 'post',
        name: 'intent',
        type: 'submit',
        value: 'draft',
    };
    const foreignControl = { disabled: false, form: {}, type: 'submit' };
    form.elements.push(externalSubmitter, foreignControl);
    form.controls.push(foreignControl);
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(externalSubmitter);
    await tick();

    assert.equal(externalSubmitter.disabled, true);
    assert.equal(foreignControl.disabled, false);
    serialization.resolve(serializedMedia());
    await waitFor(() => submissions.length === 1);

    assert.equal(externalSubmitter.disabled, false);
    assert.equal(submissions[0].submitter, externalSubmitter);
    assert.equal(submissions[0].submitter.formAction, '/save-draft');
    assert.equal(submissions[0].submitter.value, 'draft');
    adapter.destroy();
});

test('blocks the resumed request when the original submitter becomes ineligible', async () => {
    const loader = fakeLoader(serializedMedia());
    const { form, submitter, submissions } = formFixture();
    let captureCount = 0;
    form.addEventListener('submit', () => {
        captureCount += 1;
        if (captureCount === 2) {
            submitter.disabled = true;
        }
    }, true);
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await waitFor(() => adapter.lastError);

    assert.equal(submissions.length, 0);
    assert.equal(adapter.lastError.code, 'submitter-ineligible');
    adapter.destroy();
});

test('blocks before reentry when the original submitter is reassociated', async () => {
    const serialization = deferred();
    const loader = fakeLoader(() => serialization.promise);
    const { form, submitter, submissions } = formFixture();
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await tick();
    submitter.form = null;
    serialization.resolve(serializedMedia());
    await waitFor(() => adapter.lastError);

    assert.equal(submissions.length, 0);
    assert.equal(adapter.lastError.code, 'submitter-ineligible');
    adapter.destroy();
});

test('blocks the native default when a later resumed listener makes the loader busy', async () => {
    const loader = fakeLoader(serializedMedia());
    const { form, submitter, submissions } = formFixture();
    const adapter = new NativeFormAdapter(form, loader);
    form.addEventListener('submit', () => {
        loader.setBusy(true);
    });

    form.requestSubmit(submitter);
    await waitFor(() => adapter.lastError);

    assert.equal(submissions.length, 0);
    assert.equal(adapter.lastError.code, 'image-busy');
    adapter.destroy();
});

test('blocks the native default when a later resumed listener disables the submitter', async () => {
    const loader = fakeLoader(serializedMedia());
    const { form, submitter, submissions } = formFixture();
    const adapter = new NativeFormAdapter(form, loader);
    form.addEventListener('submit', () => {
        submitter.disabled = true;
    });

    form.requestSubmit(submitter);
    await waitFor(() => adapter.lastError);

    assert.equal(submissions.length, 0);
    assert.equal(adapter.lastError.code, 'submitter-ineligible');
    adapter.destroy();
});

test('blocks the native default when a later resumed listener removes the submitter association', async () => {
    const loader = fakeLoader(serializedMedia());
    const { form, submitter, submissions } = formFixture();
    const adapter = new NativeFormAdapter(form, loader);
    form.addEventListener('submit', () => {
        submitter.form = null;
    });

    form.requestSubmit(submitter);
    await waitFor(() => adapter.lastError);

    assert.equal(submissions.length, 0);
    assert.equal(adapter.lastError.code, 'submitter-ineligible');
    adapter.destroy();
});

test('removes the valid resumed finalizer before the next submission', async () => {
    const loader = fakeLoader(serializedMedia());
    const { form, submitter, submissions } = formFixture();
    const observedBubbleFinalizers = [];
    const adapter = new NativeFormAdapter(form, loader);
    form.addEventListener('submit', () => {
        observedBubbleFinalizers.push(form.listenerCount('submit'));
    });

    form.requestSubmit(submitter);
    await waitFor(() => submissions.length === 1);
    assert.equal(form.listenerCount('submit'), 1);

    form.requestSubmit(submitter);
    await waitFor(() => submissions.length === 2);

    assert.equal(loader.serializeCalls, 2);
    assert.deepEqual(observedBubbleFinalizers, [2, 2]);
    assert.equal(form.listenerCount('submit'), 1);
    adapter.destroy();
});

test('removes listeners, restores controls and never resumes a submission after destroy', async () => {
    const serialization = deferred();
    const loader = fakeLoader(() => serialization.promise);
    const { form, submitter, submissions } = formFixture();
    const adapter = new NativeFormAdapter(form, loader);

    form.requestSubmit(submitter);
    await tick();
    assert.equal(submitter.disabled, true);

    adapter.destroy();
    adapter.destroy();
    assert.equal(submitter.disabled, false);
    serialization.resolve(serializedMedia());
    await tick();
    assert.equal(submissions.length, 0);

    form.requestSubmit(submitter);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].data.get('media_manifest'), null);
});
