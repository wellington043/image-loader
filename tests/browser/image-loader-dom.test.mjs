import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { ImageLoader } from '../../src/image-loader.js';

const window = new Window();
const { document } = window;
globalThis.window = window;
globalThis.document = document;
globalThis.Element = window.Element;

const createRoot = () => {
    const root = document.createElement('div');
    document.body.append(root);
    return root;
};

const persistedImage = (id, position, overrides = {}) => ({
    id,
    url: `/${id}.webp`,
    primary: position === 0,
    position,
    ...overrides,
});

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const dragEvent = (type, dataTransfer) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    return event;
};

const eventWithFiles = (type, files) => dragEvent(type, { files, types: ['Files'] });

afterEach(() => {
    document.body.replaceChildren();
});

for (const metadata of [{ types: ['Files'], items: [] }, { types: [], items: [{ kind: 'file', type: 'image/jpeg' }] }]) {
    test(`accepts protected external dragover using ${metadata.types.length ? 'types' : 'items'} before reading files on drop`, () => {
        const root = createRoot();
        const loader = new ImageLoader(root);
        let fileReads = 0;
        const protectedTransfer = { ...metadata, get files() { fileReads++; return []; } };
        const dragover = dragEvent('dragover', protectedTransfer);
        const target = root.querySelector('.il-dropzone');
        target.dispatchEvent(dragover);
        assert.equal(dragover.defaultPrevented, true);
        assert.equal(fileReads, 0);
        assert.equal(loader.getItems().length, 0);

        const drop = eventWithFiles('drop', [new File(['image'], 'external.jpg', { type: 'image/jpeg' })]);
        target.dispatchEvent(drop);
        assert.equal(drop.defaultPrevented, true);
        assert.equal(loader.getItems().length, 1);
        assert.equal(loader.getItems()[0].source, 'local');
        loader.destroy();
    });
}

test('full gallery cancels external file navigation without adding another image', () => {
    const root = createRoot();
    const loader = new ImageLoader(root, { images: [persistedImage(1, 0)], maxFiles: 1 });
    const target = root.querySelector('.il-dropzone');
    const dragover = eventWithFiles('dragover', []);
    target.dispatchEvent(dragover);
    assert.equal(dragover.defaultPrevented, true);
    const drop = eventWithFiles('drop', [new File(['image'], 'external.jpg', { type: 'image/jpeg' })]);
    target.dispatchEvent(drop);
    assert.equal(drop.defaultPrevented, true);
    assert.deepEqual(loader.getItems().map(({ persistedId }) => persistedId), [1]);
    assert.equal(root.querySelector('.il-error-summary').hidden, true);
    loader.destroy();
});

test('non-file drags remain untouched while internal native reordering still works', () => {
    const root = createRoot();
    const loader = new ImageLoader(root, { images: [persistedImage(1, 0), persistedImage(2, 1)] });
    const transfer = { types: ['text/plain'], items: [{ kind: 'string', type: 'text/plain' }], files: [], setData() {} };
    for (const type of ['dragover', 'drop']) {
        const event = dragEvent(type, transfer);
        root.querySelector('.il-dropzone').dispatchEvent(event);
        assert.equal(event.defaultPrevented, false);
    }
    root.querySelector('[data-il-uid="persisted:1"] [data-il-reorder-handle]').dispatchEvent(dragEvent('dragstart', transfer));
    const destination = root.querySelector('.il-card[data-il-uid="persisted:2"]');
    const dragover = dragEvent('dragover', transfer);
    destination.dispatchEvent(dragover);
    assert.equal(dragover.defaultPrevented, true);
    const drop = dragEvent('drop', transfer);
    destination.dispatchEvent(drop);
    assert.equal(drop.defaultPrevented, true);
    assert.deepEqual(loader.getItems().map(({ persistedId }) => persistedId), [2, 1]);
    loader.destroy();
});

test('renders one scoped instance with accessible controls and no consumer HTML injection', () => {
    const root = createRoot();
    const loader = new ImageLoader(root, {
        images: [persistedImage(7, 0, { altText: '<img src=x>' })],
        locale: 'pt-BR',
    });

    assert.equal(root.querySelectorAll('.il-root').length, 1);
    assert.equal(root.querySelectorAll('.il-card').length, 1);
    assert.equal(root.querySelector('.il-card img').alt, '<img src=x>');
    assert.equal(root.querySelector('.il-card img img'), null);
    assert.match(root.querySelector('[data-il-action="rotate-right"]').getAttribute('aria-label'), /girar/i);
    assert.equal(root.querySelector('[data-il-action="move-left"]').disabled, true);
    loader.destroy();
});

test('renders an empty dropzone and disables additions at the configured limit', () => {
    const emptyRoot = createRoot();
    const empty = new ImageLoader(emptyRoot, { locale: 'en', maxFiles: 1 });

    assert.equal(emptyRoot.querySelector('.il-empty').hidden, false);
    assert.equal(emptyRoot.querySelector('.il-dropzone').getAttribute('aria-disabled'), 'false');

    const fullRoot = createRoot();
    const full = new ImageLoader(fullRoot, {
        images: [persistedImage(1, 0)],
        maxFiles: 1,
    });

    assert.equal(fullRoot.querySelector('.il-empty').hidden, true);
    assert.equal(fullRoot.querySelector('.il-dropzone').getAttribute('aria-disabled'), 'true');
    assert.equal(fullRoot.querySelector('[data-il-input]').disabled, true);
    empty.destroy();
    full.destroy();
});

test('adds valid files while reporting invalid selections locally and emits public events', () => {
    const root = createRoot();
    const loader = new ImageLoader(root, {
        locale: 'en',
        maxFiles: 2,
        maxSourceFileSize: 8,
    });
    const events = [];
    loader.on('change', ({ items }) => events.push(['change', items.length]));
    loader.on('image:added', ({ item }) => events.push(['added', item.source]));
    loader.on('validation:error', ({ rejection }) => events.push(['invalid', rejection.code]));

    const result = loader.addFiles([
        new File(['ok'], 'ok.jpg', { type: 'image/jpeg', lastModified: 1 }),
        new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml', lastModified: 2 }),
    ]);

    assert.equal(result.accepted.length, 1);
    assert.deepEqual(result.rejected.map(({ code }) => code), ['invalid-type']);
    assert.equal(loader.getItems().length, 1);
    assert.equal(root.querySelector('.il-error-summary').hidden, false);
    assert.match(root.querySelector('.il-error-summary').textContent, /not supported/i);
    assert.deepEqual(events, [
        ['added', 'local'],
        ['invalid', 'invalid-type'],
        ['change', 1],
    ]);
    loader.destroy();
});

test('keeps two instances isolated while routing a delegated reorder action', () => {
    const firstRoot = createRoot();
    const secondRoot = createRoot();
    const first = new ImageLoader(firstRoot, {
        images: [persistedImage(1, 0), persistedImage(2, 1)],
        locale: 'pt-BR',
    });
    const second = new ImageLoader(secondRoot, {
        images: [persistedImage(3, 0), persistedImage(4, 1)],
        locale: 'pt-BR',
    });

    firstRoot.querySelector('[data-il-action="move-left"][data-il-uid="persisted:2"]').click();

    assert.deepEqual(first.getItems().map(({ persistedId }) => persistedId), [2, 1]);
    assert.deepEqual(second.getItems().map(({ persistedId }) => persistedId), [3, 4]);
    assert.equal(firstRoot.querySelector('[data-il-live]').textContent, 'Imagem movida para a posição 1.');
    assert.equal(secondRoot.querySelector('[data-il-live]').textContent, '');
    first.destroy();
    second.destroy();
});

test('updates alternative text through the delegated details field', () => {
    const root = createRoot();
    const loader = new ImageLoader(root, {
        images: [persistedImage(1, 0, { altText: 'Before' })],
        locale: 'en',
    });
    const input = root.querySelector('[data-il-action="update-alt"]');

    input.value = 'After';
    input.dispatchEvent(new window.Event('change', { bubbles: true }));

    assert.equal(loader.getItems()[0].altText, 'After');
    assert.equal(root.querySelector('.il-card img').alt, 'After');
    loader.destroy();
});

test('surfaces item errors, exposes dirty and busy states, and serializes persisted entries', async () => {
    const root = createRoot();
    const loader = new ImageLoader(root, {
        images: [persistedImage(1, 0), persistedImage(2, 1, {
            status: 'error',
            error: new Error('offline'),
        })],
        locale: 'en',
    });

    assert.match(root.querySelector('.il-error-summary').textContent, /offline/i);
    assert.equal(loader.isDirty(), false);
    assert.equal(loader.isBusy(), false);
    loader.rotate('persisted:1', 90);
    assert.equal(loader.isDirty(), true);
    assert.equal((await loader.serialize()).manifest[0].rotation, 90);

    const busyRoot = createRoot();
    const busy = new ImageLoader(busyRoot, {
        images: [persistedImage(3, 0, { status: 'processing' })],
    });
    assert.equal(busy.isBusy(), true);
    assert.equal(busyRoot.querySelector('[data-il-action="rotate-left"]').disabled, true);
    loader.destroy();
    busy.destroy();
});

test('removes local images without invoking the persisted deletion callback', () => {
    const root = createRoot();
    let persistedDeletes = 0;
    const loader = new ImageLoader(root, {
        locale: 'en',
        deletePersistedImage: () => { persistedDeletes += 1; },
    });
    const [local] = loader.addFiles([
        new File(['ok'], 'ok.jpg', { type: 'image/jpeg', lastModified: 1 }),
    ]).accepted;
    const uid = loader.getItems()[0].uid;

    loader.remove(uid);

    assert.equal(local.name, 'ok.jpg');
    assert.equal(loader.getItems().length, 0);
    assert.equal(persistedDeletes, 0);
    loader.destroy();
});

test('blocks every mutator and ignores selection events while serialization is busy', async () => {
    const root = createRoot();
    const loader = new ImageLoader(root, { images: [persistedImage(1, 0)] });
    const localFile = new File(['local'], 'local.jpg', { type: 'image/jpeg', lastModified: 1 });
    loader.addFiles([localFile]);
    const localUid = loader.getItems().find((item) => item.source === 'local').uid;
    const pending = deferred();
    loader.serializer.serialize = () => pending.promise;
    const serializing = loader.serialize();

    assert.equal(loader.isBusy(), true);
    assert.equal(root.querySelector('[data-il-action="update-alt"][data-il-uid="persisted:1"]').disabled, true);
    assert.throws(() => loader.rotate('persisted:1', 90), { code: 'image-busy' });
    assert.throws(() => loader.move('persisted:1', 1), { code: 'image-busy' });
    assert.throws(() => loader.setPrimary('persisted:1'), { code: 'image-busy' });
    assert.throws(() => loader.updateAltText('persisted:1', 'Changed'), { code: 'image-busy' });
    assert.throws(() => loader.remove(localUid), { code: 'image-busy' });
    assert.throws(() => loader.addFiles([new File(['second'], 'second.jpg', { type: 'image/jpeg', lastModified: 2 })]), {
        code: 'image-busy',
    });
    const previewsBeforeDrop = loader.previews.ownedUrls.size;
    const busyDragover = eventWithFiles('dragover', []);
    root.querySelector('.il-dropzone').dispatchEvent(busyDragover);
    assert.equal(busyDragover.defaultPrevented, true);
    const busyDrop = eventWithFiles('drop', [
        new File(['third'], 'third.jpg', { type: 'image/jpeg', lastModified: 3 }),
    ]);
    root.querySelector('.il-dropzone').dispatchEvent(busyDrop);
    assert.equal(busyDrop.defaultPrevented, true);
    assert.equal(loader.getItems().length, 2);
    assert.equal(loader.previews.ownedUrls.size, previewsBeforeDrop);
    assert.equal(root.querySelector('.il-error-summary').hidden, true);

    pending.resolve({ manifest: [], files: new Map() });
    await serializing;
    loader.destroy();
});

test('keeps queries and destroy idempotent while rejecting operations after destroy', async () => {
    const root = createRoot();
    const loader = new ImageLoader(root);
    loader.addFiles([new File(['local'], 'local.jpg', { type: 'image/jpeg', lastModified: 1 })]);
    const localUid = loader.getItems()[0].uid;
    const pending = deferred();
    loader.serializer.serialize = () => pending.promise;
    const serializing = loader.serialize();

    loader.destroy();
    loader.destroy();
    assert.equal(loader.getItems().length, 1);
    assert.equal(loader.isBusy(), true);
    assert.throws(() => loader.addFiles([]), { code: 'instance-destroyed' });
    assert.throws(() => loader.rotate(localUid, 90), { code: 'instance-destroyed' });
    assert.throws(() => loader.on('change', () => {}), { code: 'instance-destroyed' });
    assert.throws(() => loader.off('change', () => {}), { code: 'instance-destroyed' });

    pending.resolve({ manifest: [], files: new Map() });
    await assert.rejects(serializing, { code: 'instance-destroyed' });
    assert.equal(loader.getItems()[0].status, 'processing');
});

test('validates loader options and isolates default arrays and dictionaries', () => {
    for (const [options, code] of [
        [{ accept: [] }, 'invalid-accept'],
        [{ accept: ['image/jpeg', 7] }, 'invalid-accept'],
        [{ maxFiles: 0 }, 'invalid-max-files'],
        [{ maxSourceFileSize: 0 }, 'invalid-max-source-file-size'],
        [{ maxOutputFileSize: -1 }, 'invalid-max-output-file-size'],
        [{ maxDimension: Number.NaN }, 'invalid-max-dimension'],
        [{ quality: 1.1 }, 'invalid-quality'],
        [{ locale: { actions: { rotateRight: 7 } } }, 'invalid-locale'],
        [{ locale: { messages: 'invalid' } }, 'invalid-locale'],
        [{ locale: { messages: { imageMoved: { template: 'invalid' } } } }, 'invalid-locale'],
        [{ deletePersistedImage: 'not-a-function' }, 'invalid-delete-handler'],
    ]) {
        assert.throws(() => new ImageLoader(createRoot(), options), { code });
    }

    const first = new ImageLoader(createRoot(), {
        locale: { actions: { rotateRight: 'Turn right' }, messages: { imageMoved: 'Moved to {position}.' } },
    });
    const second = new ImageLoader(createRoot());
    first.options.accept.push('image/avif');
    first.labels.actions.rotateRight = 'Changed locally';
    first.labels.messages.imageMoved = 'Changed locally too';

    assert.equal(second.options.accept.includes('image/avif'), false);
    assert.equal(second.labels.actions.rotateRight, 'Rotate right');
    assert.equal(second.labels.messages.imageMoved, 'Image moved to position {position}.');
    assert.equal(first.labels.actions.rotateRight, 'Changed locally');
    assert.equal(first.labels.messages.imageMoved, 'Changed locally too');
    const localeHasOnlyStringLeaves = (dictionary) => Object.values(dictionary).every((value) => (
        value && typeof value === 'object' ? localeHasOnlyStringLeaves(value) : typeof value === 'string'
    ));
    assert.equal(localeHasOnlyStringLeaves(first.labels), true);
    assert.equal(localeHasOnlyStringLeaves(second.labels), true);
    first.destroy();
    second.destroy();
});

test('does not make the gallery dirty or emit change for no-op commands', () => {
    const root = createRoot();
    const loader = new ImageLoader(root, {
        images: [persistedImage(1, 0, { altText: 'Unchanged' })],
    });
    const changes = [];
    loader.on('change', (event) => changes.push(event));

    loader.rotate('persisted:1', 0);
    loader.move('persisted:1', 0);
    loader.setPrimary('persisted:1');
    loader.updateAltText('persisted:1', 'Unchanged');

    assert.equal(loader.isDirty(), false);
    assert.deepEqual(changes, []);
    loader.destroy();
});

test('preserves expanded alt text focus and gives local removal a predictable fallback focus', () => {
    const root = createRoot();
    const loader = new ImageLoader(root, {
        images: [persistedImage(1, 0, { altText: 'Before' })],
    });
    const details = root.querySelector('.il-details');
    const altInput = root.querySelector('[data-il-action="update-alt"]');
    details.open = true;
    altInput.focus();
    altInput.value = 'After';
    altInput.dispatchEvent(new window.Event('change', { bubbles: true }));

    const updatedInput = document.querySelector('.il-context-portal [data-il-action="update-alt"]');
    assert.equal(root.querySelector('.il-details').open, true);
    assert.equal(document.activeElement === updatedInput, true);
    loader.destroy();

    const removalRoot = createRoot();
    const removable = new ImageLoader(removalRoot);
    removable.addFiles([
        new File(['first'], 'first.jpg', { type: 'image/jpeg', lastModified: 1 }),
        new File(['second'], 'second.jpg', { type: 'image/jpeg', lastModified: 2 }),
    ]);
    const firstUid = removable.getItems()[0].uid;
    removalRoot.querySelector(`[data-il-action="remove"][data-il-uid="${firstUid}"]`).click();
    assert.equal(document.activeElement.dataset.ilAction, 'reorder');
    removalRoot.querySelector('[data-il-action="remove"]').click();
    assert.equal(document.activeElement, removalRoot.querySelector('[data-il-action="choose-files"]'));
    removable.destroy();
});

test('preserves expanded native summary focus across a card rerender', () => {
    const root = createRoot();
    const loader = new ImageLoader(root, { images: [persistedImage(1, 0)] });
    const details = root.querySelector('.il-details');
    const summary = details.querySelector('summary');
    details.open = true;
    summary.focus();

    loader.rotate('persisted:1', 90);

    const rerenderedDetails = root.querySelector('.il-details');
    assert.equal(rerenderedDetails.open, true);
    assert.equal(document.activeElement === rerenderedDetails.querySelector('summary'), true);
    loader.destroy();
});

test('generates unique alt hint IDs for separate loaders', () => {
    const firstRoot = createRoot();
    const secondRoot = createRoot();
    const first = new ImageLoader(firstRoot, { images: [persistedImage(1, 0)], locale: 'en' });
    const second = new ImageLoader(secondRoot, { images: [persistedImage(2, 0)], locale: 'pt-BR' });
    const firstHint = firstRoot.querySelector('.il-alt-hint');
    const secondHint = secondRoot.querySelector('.il-alt-hint');

    assert.notEqual(firstHint.id, secondHint.id);
    assert.equal(firstRoot.querySelector('[data-il-action="update-alt"]').getAttribute('aria-describedby'), firstHint.id);
    assert.equal(secondRoot.querySelector('[data-il-action="update-alt"]').getAttribute('aria-describedby'), secondHint.id);
    first.destroy();
    second.destroy();
});

test('uses a string locale override for the movement announcement', () => {
    const root = createRoot();
    const loader = new ImageLoader(root, {
        images: [persistedImage(1, 0), persistedImage(2, 1)],
        locale: { messages: { imageMoved: 'Moved to slot {position}.' } },
    });

    root.querySelector('[data-il-action="move-left"][data-il-uid="persisted:2"]').click();

    assert.equal(root.querySelector('[data-il-live]').textContent, 'Moved to slot 1.');
    loader.destroy();
});
