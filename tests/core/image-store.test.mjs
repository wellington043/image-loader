import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageStore } from '../../src/core/image-store.js';

test('normalizes positions and keeps exactly one primary', () => {
    const store = new ImageStore({ images: [
        { id: 20, url: '/b.webp', position: 8, primary: true },
        { id: 10, url: '/a.webp', position: 3, primary: true },
    ], maxFiles: 10 });

    assert.deepEqual(store.snapshot().map(({ persistedId, position, primary }) => (
        { persistedId, position, primary }
    )), [
        { persistedId: 10, position: 0, primary: true },
        { persistedId: 20, position: 1, primary: false },
    ]);
});

test('moves, rotates and promotes a fallback after removal', () => {
    const store = new ImageStore({ images: [
        { id: 1, url: '/1.webp', primary: true, position: 0 },
        { id: 2, url: '/2.webp', primary: false, position: 1 },
    ] });
    store.move('persisted:2', 0);
    store.rotate('persisted:2', -90);
    store.remove('persisted:1');

    assert.equal(store.snapshot()[0].rotation, 270);
    assert.equal(store.snapshot()[0].primary, true);
});

test('keeps snapshots detached and omits the mutable file', () => {
    const file = { name: 'photo.webp' };
    const store = new ImageStore({ images: [
        { id: 1, url: '/1.webp', file, altText: 'Front' },
    ] });

    const snapshot = store.snapshot()[0];
    assert.equal(snapshot.file, undefined);
    snapshot.altText = 'Changed outside the store';
    assert.equal(store.snapshot()[0].altText, 'Front');

    const entry = store.entries()[0];
    assert.equal(entry.file, file);
    entry.altText = 'Changed in a serializer copy';
    assert.equal(store.snapshot()[0].altText, 'Front');
});

test('adds local items, respects the file limit and keeps uids unique', () => {
    const store = new ImageStore({ maxFiles: 2 });
    const first = store.add({ uploadKey: 'upload-a', source: 'local', previewUrl: 'blob:a' });
    const second = store.add({ uploadKey: 'upload-b', source: 'local', previewUrl: 'blob:b' });

    assert.notEqual(first.uid, second.uid);
    assert.deepEqual(store.snapshot().map(({ position, primary }) => ({ position, primary })), [
        { position: 0, primary: true },
        { position: 1, primary: false },
    ]);
    assert.throws(() => store.add({ uploadKey: 'upload-c', source: 'local' }), {
        name: 'ImageLoaderError',
        code: 'max-files-exceeded',
    });
});

test('blocks edits while an item is processing or deleting', () => {
    const store = new ImageStore({ images: [{ id: 1, url: '/1.webp' }] });
    store.setStatus('persisted:1', 'processing');

    for (const command of [
        () => store.move('persisted:1', 0),
        () => store.rotate('persisted:1', 90),
        () => store.setPrimary('persisted:1'),
        () => store.updateAltText('persisted:1', 'new'),
    ]) {
        assert.throws(command, { code: 'image-busy' });
    }

    store.setStatus('persisted:1', 'deleting');
    assert.throws(() => store.rotate('persisted:1', 90), { code: 'image-busy' });
    assert.throws(() => store.remove('persisted:1'), { code: 'image-busy' });
    assert.equal(store.snapshotOf('persisted:1').status, 'deleting');
});

test('blocks sibling reordering and promotion while any item is busy', () => {
    const store = new ImageStore({ images: [
        { id: 1, url: '/1.webp', primary: true, position: 0 },
        { id: 2, url: '/2.webp', primary: false, position: 1 },
    ] });
    store.setStatus('persisted:2', 'deleting');

    assert.throws(() => store.move('persisted:1', 1), { code: 'image-busy' });
    assert.throws(() => store.remove('persisted:1'), { code: 'image-busy' });
    assert.throws(() => store.setPrimary('persisted:2'), { code: 'image-busy' });
    assert.deepEqual(store.snapshot().map(({ uid, position, primary }) => ({ uid, position, primary })), [
        { uid: 'persisted:1', position: 0, primary: true },
        { uid: 'persisted:2', position: 1, primary: false },
    ]);
});

test('removes a persisted image only through the confirmed deletion transition', () => {
    const store = new ImageStore({ images: [
        { id: 1, url: '/1.webp', primary: true, position: 0 },
        { id: 2, url: '/2.webp', primary: false, position: 1 },
    ] });

    assert.throws(() => store.removeAfterPersistedDeletion('persisted:1'), { code: 'invalid-deletion-state' });
    store.setStatus('persisted:1', 'deleting');
    store.setStatus('persisted:2', 'processing');
    assert.throws(() => store.removeAfterPersistedDeletion('persisted:1'), { code: 'image-busy' });
    store.setStatus('persisted:2', 'ready');
    const removed = store.removeAfterPersistedDeletion('persisted:1');

    assert.equal(removed.persistedId, 1);
    assert.deepEqual(store.snapshot().map(({ persistedId, primary, position }) => ({ persistedId, primary, position })), [
        { persistedId: 2, primary: true, position: 0 },
    ]);
});

test('copies errors defensively at input and snapshot boundaries', () => {
    const inputError = { code: 'offline', details: { retryable: true } };
    const store = new ImageStore({ images: [{ id: 1, url: '/1.webp', error: inputError, status: 'error' }] });
    inputError.details.retryable = false;
    assert.equal(store.snapshotOf('persisted:1').error.details.retryable, true);

    const snapshot = store.snapshotOf('persisted:1');
    snapshot.error.details.retryable = false;
    snapshot.error.code = 'changed';
    assert.deepEqual(store.snapshotOf('persisted:1').error, {
        code: 'offline',
        details: { retryable: true },
    });

    const statusError = { code: 'timeout', details: { attempt: 1 } };
    store.setStatus('persisted:1', 'error', statusError);
    statusError.details.attempt = 2;
    const statusSnapshot = store.snapshotOf('persisted:1');
    statusSnapshot.error.details.attempt = 3;
    assert.equal(store.snapshotOf('persisted:1').error.details.attempt, 1);
});

test('normalizes rotation deltas and reports missing images', () => {
    const store = new ImageStore({ images: [{ id: 1, url: '/1.webp', rotation: 270 }] });
    store.rotate('persisted:1', 180);
    assert.equal(store.snapshotOf('persisted:1').rotation, 90);

    assert.throws(() => store.snapshotOf('persisted:404'), {
        name: 'ImageLoaderError',
        code: 'image-not-found',
    });
});
