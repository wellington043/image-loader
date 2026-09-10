import assert from 'node:assert/strict';
import test from 'node:test';
import { fileSignature, validateFiles } from '../../src/core/image-validation.js';

test('accepts valid files and reports each rejected reason without dropping the batch', () => {
    const duplicate = new File(['a'], 'a.jpg', { type: 'image/jpeg', lastModified: 10 });
    const result = validateFiles([
        duplicate,
        new File(['x'], 'x.svg', { type: 'image/svg+xml' }),
        new File([new Uint8Array(12)], 'large.png', { type: 'image/png' }),
    ], {
        accept: ['image/jpeg', 'image/png', 'image/webp'],
        maxSourceFileSize: 10,
        maxFiles: 3,
        currentItems: [{ file: duplicate }],
    });

    assert.equal(result.accepted.length, 0);
    assert.deepEqual(result.rejected.map((item) => item.code), [
        'duplicate-file', 'invalid-type', 'source-too-large',
    ]);
    assert.deepEqual(result.rejected.map((item) => item.messageKey), [
        'errors.duplicateFile', 'errors.invalidType', 'errors.sourceTooLarge',
    ]);
});

test('preserves input order and counts accepted files against available slots', () => {
    const files = [
        new File(['a'], 'a.jpg', { type: 'image/jpeg', lastModified: 1 }),
        new File(['b'], 'b.png', { type: 'image/png', lastModified: 2 }),
        new File(['c'], 'c.webp', { type: 'image/webp', lastModified: 3 }),
    ];

    const result = validateFiles(files, {
        accept: ['image/jpeg', 'image/png', 'image/webp'],
        maxFiles: 2,
        currentItems: [{ file: new File(['existing'], 'existing.jpg', { type: 'image/jpeg' }) }],
    });

    assert.deepEqual(result.accepted, files.slice(0, 1));
    assert.deepEqual(result.rejected.map(({ file, code }) => ({ file, code })), [
        { file: files[1], code: 'max-files-exceeded' },
        { file: files[2], code: 'max-files-exceeded' },
    ]);
});

test('rejects duplicate signatures within the same batch and compares all signature parts', () => {
    const first = new File(['a'], 'same.jpg', { type: 'image/jpeg', lastModified: 7 });
    const same = new File(['b'], 'same.jpg', { type: 'image/jpeg', lastModified: 7 });
    const differentSize = new File(['bb'], 'same.jpg', { type: 'image/jpeg', lastModified: 7 });
    const differentTime = new File(['a'], 'same.jpg', { type: 'image/jpeg', lastModified: 8 });

    assert.equal(fileSignature(first), 'same.jpg\u00001\u00007');
    const result = validateFiles([first, same, differentSize, differentTime], {
        accept: ['image/jpeg'],
        maxFiles: 10,
    });

    assert.deepEqual(result.accepted, [first, differentSize, differentTime]);
    assert.deepEqual(result.rejected.map(({ file, code }) => ({ file, code })), [
        { file: same, code: 'duplicate-file' },
    ]);
});

test('rejects a duplicate after the first occurrence fails MIME validation', () => {
    const first = new File(['svg'], 'same.svg', { type: 'image/svg+xml', lastModified: 1 });
    const second = new File(['svg'], 'same.svg', { type: 'image/svg+xml', lastModified: 1 });

    const result = validateFiles([first, second], { accept: ['image/jpeg'] });

    assert.deepEqual(result.rejected.map(({ file, code }) => ({ file, code })), [
        { file: first, code: 'invalid-type' },
        { file: second, code: 'duplicate-file' },
    ]);
});

test('rejects a duplicate after the first occurrence fails source-size validation', () => {
    const first = new File([new Uint8Array(11)], 'same.png', { type: 'image/png', lastModified: 1 });
    const second = new File([new Uint8Array(11)], 'same.png', { type: 'image/png', lastModified: 1 });

    const result = validateFiles([first, second], {
        accept: ['image/png'],
        maxSourceFileSize: 10,
    });

    assert.deepEqual(result.rejected.map(({ file, code }) => ({ file, code })), [
        { file: first, code: 'source-too-large' },
        { file: second, code: 'duplicate-file' },
    ]);
});

test('rejects a duplicate after the first occurrence fails the file-count limit', () => {
    const first = new File(['a'], 'same.jpg', { type: 'image/jpeg', lastModified: 1 });
    const second = new File(['a'], 'same.jpg', { type: 'image/jpeg', lastModified: 1 });

    const result = validateFiles([first, second], {
        accept: ['image/jpeg'],
        maxFiles: 0,
    });

    assert.deepEqual(result.rejected.map(({ file, code }) => ({ file, code })), [
        { file: first, code: 'max-files-exceeded' },
        { file: second, code: 'duplicate-file' },
    ]);
});
