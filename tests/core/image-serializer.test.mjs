import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageSerializer } from '../../src/core/image-serializer.js';

const localEntry = (file, overrides = {}) => ({
    uid: 'local:key',
    uploadKey: 'key',
    source: 'local',
    file,
    position: 1,
    primary: false,
    altText: 'B',
    rotation: 270,
    ...overrides,
});

test('keeps persisted rotation in the manifest and bakes local rotation into the file', async () => {
    const local = new File(['local'], 'local.jpg', { type: 'image/jpeg' });
    const serializer = new ImageSerializer({
        transform: async () => new File(['webp'], 'local.webp', { type: 'image/webp' }),
    });

    const result = await serializer.serialize([
        { uid: 'persisted:8', persistedId: 8, source: 'persisted', position: 0, primary: true, altText: 'A', rotation: 90 },
        localEntry(local),
    ]);

    assert.deepEqual(result.manifest, [
        { key: 'persisted:8', id: 8, source: 'persisted', position: 0, primary: true, altText: 'A', rotation: 90 },
        { key: 'local:key', uploadKey: 'key', source: 'local', position: 1, primary: false, altText: 'B', rotation: 0 },
    ]);
    assert.equal(result.files.get('key').name, 'local.webp');
    assert.equal(result.files.size, 1);
});

test('reuses only an unchanged local transform across serializations', async () => {
    const local = new File(['local'], 'local.jpg', { type: 'image/jpeg' });
    let transforms = 0;
    const serializer = new ImageSerializer({
        maxDimension: 1800,
        maxOutputFileSize: 2 * 1024 * 1024,
        quality: 0.86,
        transform: async () => {
            transforms += 1;
            return new File(['webp'], `local-${transforms}.webp`, { type: 'image/webp' });
        },
    });

    const entry = localEntry(local);
    const first = await serializer.serialize([entry]);
    const second = await serializer.serialize([{ ...entry }]);
    const changed = await serializer.serialize([{ ...entry, rotation: 0 }]);

    assert.equal(transforms, 2);
    assert.equal(first.files.get('key'), second.files.get('key'));
    assert.notEqual(second.files.get('key'), changed.files.get('key'));
});

test('uses unlimited default serializer options for its transform', async () => {
    const local = new File(['local'], 'local.jpg', { type: 'image/jpeg' });
    let receivedOptions = null;
    const serializer = new ImageSerializer({
        transform: async (_file, options) => {
            receivedOptions = options;
            return new File(['webp'], 'local.webp', { type: 'image/webp' });
        },
    });

    await serializer.serialize([localEntry(local)]);

    assert.deepEqual(receivedOptions, {
        rotation: 270,
        maxDimension: Infinity,
        maxOutputFileSize: Infinity,
        quality: 0.86,
    });
});

test('rejects duplicate local upload keys before any image transform starts', async () => {
    const first = new File(['first'], 'first.jpg', { type: 'image/jpeg' });
    const second = new File(['second'], 'second.jpg', { type: 'image/jpeg' });
    let transforms = 0;
    const serializer = new ImageSerializer({
        transform: async () => {
            transforms += 1;
            return new File(['webp'], 'local.webp', { type: 'image/webp' });
        },
    });

    await assert.rejects(
        serializer.serialize([
            localEntry(first, { uid: 'local:first', uploadKey: 'duplicate' }),
            localEntry(second, { uid: 'local:second', uploadKey: 'duplicate' }),
        ]),
        (error) => error.name === 'ImageLoaderError'
            && error.code === 'duplicate-upload-key'
            && error.uid === 'local:second',
    );
    assert.equal(transforms, 0);
});

test('returns a typed failure for the individual local image that cannot be transformed', async () => {
    const local = new File(['local'], 'local.jpg', { type: 'image/jpeg' });
    const serializer = new ImageSerializer({
        transform: async () => { throw new Error('decoder stopped'); },
    });

    await assert.rejects(
        serializer.serialize([localEntry(local)]),
        (error) => error.name === 'ImageLoaderError'
            && error.code === 'image-transform-failed'
            && error.uid === 'local:key'
            && error.cause?.message === 'decoder stopped',
    );
});
