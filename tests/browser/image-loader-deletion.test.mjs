import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { ImageLoader } from '../../src/image-loader.js';

const window = new Window();
const { document } = window;
globalThis.window = window;
globalThis.document = document;
globalThis.Element = window.Element;

const loaders = [];

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

function fixtureLoader(options = {}) {
    const root = document.createElement('div');
    document.body.append(root);
    const loader = new ImageLoader(root, {
        images: [{ id: 1, url: '/1.webp', altText: 'Principal', primary: true, position: 0 }],
        locale: 'pt-BR',
        ...options,
    });
    loaders.push(loader);
    return { loader, root };
}

afterEach(() => {
    for (const loader of loaders.splice(0)) {
        loader.destroy();
    }
    document.body.replaceChildren();
});

test('opens the localized confirmation before deleting a persisted card', async () => {
    let deletes = 0;
    const { loader, root } = fixtureLoader({
        deletePersistedImage: async () => { deletes += 1; },
    });
    const trigger = root.querySelector('[data-il-action="remove"]');

    trigger.click();
    const dialog = document.querySelector('dialog');

    assert.equal(dialog.querySelector('h2').textContent, 'Excluir imagem?');
    assert.match(dialog.querySelector('p').textContent, /imediatamente/i);
    assert.equal(document.activeElement, dialog.querySelector('button'));
    assert.equal(deletes, 0);

    dialog.querySelector('button').click();
    await tick();
    assert.equal(deletes, 0);
    assert.equal(loader.getItems()[0].status, 'ready');
    assert.equal(document.activeElement, trigger);
});

test('keeps a persisted card until remote success, blocks repeats, and promotes the neighbour', async () => {
    const confirmation = deferred();
    const remote = deferred();
    const calls = [];
    const { loader, root } = fixtureLoader({
        images: [
            { id: 1, url: '/1.webp', altText: 'Principal', primary: true, position: 0 },
            { id: 2, url: '/2.webp', altText: 'Secundária', primary: false, position: 1 },
        ],
        confirmDelete: () => confirmation.promise,
        deletePersistedImage: (item, { signal }) => {
            calls.push({ item, signal });
            return remote.promise;
        },
    });
    const lifecycle = [];
    loader.on('delete:start', ({ item }) => lifecycle.push(['start', item.uid]));
    loader.on('delete:success', ({ item }) => lifecycle.push(['success', item.uid]));

    const first = loader.remove('persisted:1');
    const repeated = loader.remove('persisted:1');
    assert.equal(first, repeated);
    assert.equal(loader.getItems()[0].status, 'ready');

    confirmation.resolve(true);
    await tick();
    assert.equal(loader.getItems()[0].status, 'deleting');
    assert.equal(root.querySelector('[data-il-uid="persisted:1"]'), root.querySelector('.il-card'));
    assert.equal(root.querySelector('[data-il-action="remove"]').disabled, true);
    await assert.rejects(loader.serialize(), { code: 'image-busy' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].item.persistedId, 1);
    assert.equal(calls[0].signal.aborted, false);

    remote.resolve();
    await first;

    assert.deepEqual(loader.getItems().map(({ persistedId, position, primary }) => ({ persistedId, position, primary })), [
        { persistedId: 2, position: 0, primary: true },
    ]);
    assert.deepEqual(lifecycle, [['start', 'persisted:1'], ['success', 'persisted:1']]);
    assert.equal(document.activeElement.dataset.ilUid, 'persisted:2');
    assert.equal(document.activeElement.dataset.ilAction, 'reorder');
});

test('restores remote failures to an error card and retries only after an explicit request', async () => {
    let calls = 0;
    const { loader, root } = fixtureLoader({
        confirmDelete: async () => true,
        deletePersistedImage: async () => {
            calls += 1;
            if (calls === 1) {
                throw new Error('offline');
            }
        },
    });
    const errors = [];
    loader.on('delete:error', ({ error }) => errors.push(error.message));

    await assert.rejects(loader.remove('persisted:1'), /offline/);
    assert.equal(calls, 1);
    assert.equal(loader.getItems()[0].status, 'error');
    assert.match(root.querySelector('.il-error-summary').textContent, /offline/);
    assert.equal(root.querySelector('[data-il-action="remove"]').disabled, false);
    await tick();
    assert.equal(calls, 1);

    await loader.remove('persisted:1');
    assert.equal(calls, 2);
    assert.equal(loader.getItems().length, 0);
    assert.deepEqual(errors, ['offline']);
});

test('removes local images synchronously without a callback and releases their object URLs', () => {
    let persistedDeletes = 0;
    const { loader } = fixtureLoader({
        images: [],
        deletePersistedImage: () => { persistedDeletes += 1; },
    });
    loader.addFiles([new File(['local'], 'local.jpg', { type: 'image/jpeg', lastModified: 1 })]);
    const [local] = loader.getItems();

    assert.equal(loader.previews.ownedUrls.has(local.previewUrl), true);
    const removed = loader.remove(local.uid);

    assert.equal(removed.uid, local.uid);
    assert.equal(loader.getItems().length, 0);
    assert.equal(loader.previews.ownedUrls.has(local.previewUrl), false);
    assert.equal(persistedDeletes, 0);
});

test('rejects missing or invalid persisted deletion contracts without changing the card', async () => {
    const missing = fixtureLoader();
    await assert.rejects(missing.loader.remove('persisted:1'), { code: 'missing-delete-handler' });
    assert.equal(missing.loader.getItems()[0].status, 'ready');

    const invalidResult = fixtureLoader({
        confirmDelete: async () => 'confirmed',
        deletePersistedImage: async () => assert.fail('must not delete'),
    });
    await assert.rejects(invalidResult.loader.remove('persisted:1'), { code: 'invalid-confirm-result' });
    assert.equal(invalidResult.loader.getItems()[0].status, 'ready');

    assert.throws(() => fixtureLoader({ confirmDelete: 'yes' }), { code: 'invalid-confirm-handler' });
});

test('aborts a pending remote delete during destroy without emitting a later update', async () => {
    const remote = deferred();
    let signal;
    const { loader } = fixtureLoader({
        confirmDelete: async () => true,
        deletePersistedImage: (_item, options) => {
            signal = options.signal;
            return remote.promise;
        },
    });
    const lifecycle = [];
    loader.on('delete:success', () => lifecycle.push('success'));
    loader.on('delete:error', () => lifecycle.push('error'));
    const pending = loader.remove('persisted:1');
    await tick();
    assert.equal(loader.getItems()[0].status, 'deleting');

    loader.destroy();
    assert.equal(signal.aborted, true);
    remote.resolve();

    await assert.rejects(pending, { code: 'instance-destroyed' });
    assert.equal(loader.getItems()[0].status, 'deleting');
    assert.deepEqual(lifecycle, []);
});

test('recovers from a delete:start listener failure without calling the remote handler', async () => {
    let deletes = 0;
    const { loader, root } = fixtureLoader({
        confirmDelete: async () => true,
        deletePersistedImage: async () => { deletes += 1; },
    });
    const unsubscribe = loader.on('delete:start', () => {
        throw new Error('start listener failed');
    });

    await assert.rejects(loader.remove('persisted:1'), /start listener failed/);
    assert.equal(deletes, 0);
    assert.equal(loader.getItems()[0].status, 'error');
    assert.equal(root.querySelector('[data-il-action="remove"]').disabled, false);

    unsubscribe();
    await loader.remove('persisted:1');
    assert.equal(deletes, 1);
    assert.equal(loader.getItems().length, 0);
});

test('does not call the remote handler when a delete:start listener destroys the loader', async () => {
    let deletes = 0;
    const { loader } = fixtureLoader({
        confirmDelete: async () => true,
        deletePersistedImage: async () => { deletes += 1; },
    });
    loader.on('delete:start', () => loader.destroy());

    await assert.rejects(loader.remove('persisted:1'), { code: 'instance-destroyed' });
    assert.equal(deletes, 0);
    assert.equal(loader.getItems()[0].status, 'deleting');
});

test('closes and removes a pending default confirmation during destroy', async () => {
    let deletes = 0;
    const { loader, root } = fixtureLoader({
        deletePersistedImage: async () => { deletes += 1; },
    });

    root.querySelector('[data-il-action="remove"]').click();
    const dialog = document.querySelector('dialog');
    assert.equal(dialog.open, true);

    loader.destroy();
    await tick();

    assert.equal(dialog.isConnected, false);
    assert.equal(deletes, 0);
});
