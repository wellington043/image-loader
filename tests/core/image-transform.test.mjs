import assert from 'node:assert/strict';
import test from 'node:test';
import { transformImageFile } from '../../src/core/image-transform.js';

function fakeImageEnvironment({ width, height, calls, blob = new Blob(['webp'], { type: 'image/webp' }) }) {
    return {
        async load() {
            return {
                image: { width, height },
                width,
                height,
                release() { calls.released = (calls.released ?? 0) + 1; },
            };
        },
        createCanvas() {
            const context = {
                translate(...args) { calls.translate = args; },
                rotate(value) { calls.rotation = value; },
                drawImage(...args) { calls.draw = args; },
            };
            const canvas = {
                width: 0,
                height: 0,
                getContext: () => context,
                toBlob: (callback, type, quality) => {
                    calls.encoding = { type, quality };
                    callback(blob);
                },
            };
            calls.canvas = canvas;
            return canvas;
        },
    };
}

const options = { maxDimension: 1800, maxOutputFileSize: 2 * 1024 * 1024, quality: 0.86 };

test('uses unlimited default options without enlarging the source image', async () => {
    const calls = {};
    const source = new File(['source'], 'produto.jpg', { type: 'image/jpeg' });

    await transformImageFile(source, undefined, fakeImageEnvironment({ width: 2400, height: 1200, calls }));

    assert.deepEqual([calls.canvas.width, calls.canvas.height], [2400, 1200]);
    assert.deepEqual(calls.encoding, { type: 'image/webp', quality: 0.86 });
    assert.equal(calls.released, 1);
});

test('rotates 90 degrees, limits dimensions and returns a coherent webp file', async () => {
    const calls = {};
    const source = new File(['source'], 'produto.jpg', { type: 'image/jpeg', lastModified: 42 });

    const result = await transformImageFile(source, { ...options, rotation: 90 }, fakeImageEnvironment({
        width: 2400, height: 1200, calls,
    }));

    assert.equal(calls.canvas.width, 900);
    assert.equal(calls.canvas.height, 1800);
    assert.deepEqual(calls.translate, [450, 900]);
    assert.equal(calls.rotation, Math.PI / 2);
    assert.deepEqual(calls.draw.slice(1), [-900, -450, 1800, 900]);
    assert.deepEqual(calls.encoding, { type: 'image/webp', quality: 0.86 });
    assert.equal(result.name, 'produto.webp');
    assert.equal(result.type, 'image/webp');
    assert.equal(result.lastModified, 42);
    assert.equal(calls.released, 1);
});

test('preserves the geometry for 180 degrees and swaps it for 270 degrees', async () => {
    const source = new File(['source'], 'produto.png', { type: 'image/png' });
    const calls180 = {};
    const calls270 = {};

    await transformImageFile(source, { ...options, rotation: 180 }, fakeImageEnvironment({
        width: 300, height: 200, calls: calls180,
    }));
    await transformImageFile(source, { ...options, rotation: 270 }, fakeImageEnvironment({
        width: 300, height: 200, calls: calls270,
    }));

    assert.deepEqual([calls180.canvas.width, calls180.canvas.height], [300, 200]);
    assert.equal(calls180.rotation, Math.PI);
    assert.deepEqual([calls270.canvas.width, calls270.canvas.height], [200, 300]);
    assert.equal(calls270.rotation, Math.PI * 1.5);
});

test('releases decoded image resources when canvas encoding cannot start', async () => {
    const calls = {};
    const environment = fakeImageEnvironment({ width: 100, height: 50, calls });
    environment.createCanvas = () => ({ getContext: () => null });

    await assert.rejects(
        transformImageFile(new File(['source'], 'produto.jpg'), { ...options, rotation: 0 }, environment),
        { name: 'ImageLoaderError', code: 'canvas-unavailable' },
    );
    assert.equal(calls.released, 1);
});

test('rejects a missing encoded blob and releases decoded image resources', async () => {
    const calls = {};

    await assert.rejects(
        transformImageFile(new File(['source'], 'produto.jpg'), { ...options, rotation: 0 }, fakeImageEnvironment({
            width: 100, height: 50, calls, blob: null,
        })),
        { name: 'ImageLoaderError', code: 'output-encoding-failed' },
    );
    assert.equal(calls.released, 1);
});

test('rejects an encoder fallback that did not produce a WebP Blob', async () => {
    const calls = {};

    await assert.rejects(
        transformImageFile(new File(['source'], 'produto.jpg'), { ...options, rotation: 0 }, fakeImageEnvironment({
            width: 100, height: 50, calls, blob: new Blob(['png'], { type: 'image/png' }),
        })),
        { name: 'ImageLoaderError', code: 'invalid-output-blob' },
    );
    assert.equal(calls.released, 1);
});

test('rejects an encoder callback value that is not a Blob', async () => {
    const calls = {};

    await assert.rejects(
        transformImageFile(new File(['source'], 'produto.jpg'), { ...options, rotation: 0 }, fakeImageEnvironment({
            width: 100, height: 50, calls, blob: { type: 'image/webp', size: 12 },
        })),
        { name: 'ImageLoaderError', code: 'invalid-output-blob' },
    );
    assert.equal(calls.released, 1);
});

test('rejects a WebP Blob whose size is not finite', async () => {
    const calls = {};
    const blob = new Blob(['webp'], { type: 'image/webp' });
    Object.defineProperty(blob, 'size', { value: Infinity });

    await assert.rejects(
        transformImageFile(new File(['source'], 'produto.jpg'), { ...options, rotation: 0 }, fakeImageEnvironment({
            width: 100, height: 50, calls, blob,
        })),
        { name: 'ImageLoaderError', code: 'invalid-output-blob' },
    );
    assert.equal(calls.released, 1);
});

test('rejects an encoded file above the configured output limit', async () => {
    const calls = {};
    const oversized = new Blob([new Uint8Array((2 * 1024 * 1024) + 1)], { type: 'image/webp' });

    await assert.rejects(
        transformImageFile(new File(['source'], 'produto.jpg'), { ...options, rotation: 0 }, fakeImageEnvironment({
            width: 100, height: 50, calls, blob: oversized,
        })),
        { name: 'ImageLoaderError', code: 'output-too-large' },
    );
    assert.equal(calls.released, 1);
});

test('wraps unexpected processing failures in a typed error and releases resources', async () => {
    const calls = {};
    const environment = fakeImageEnvironment({ width: 100, height: 50, calls });
    environment.createCanvas = () => { throw new Error('graphics device stopped'); };

    await assert.rejects(
        transformImageFile(new File(['source'], 'produto.jpg'), { ...options, rotation: 0 }, environment),
        (error) => error.name === 'ImageLoaderError'
            && error.code === 'image-transform-failed'
            && error.cause?.message === 'graphics device stopped',
    );
    assert.equal(calls.released, 1);
});
