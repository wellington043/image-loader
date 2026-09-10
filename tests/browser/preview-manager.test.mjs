import assert from 'node:assert/strict';
import test from 'node:test';
import { PreviewManager } from '../../src/browser/preview-manager.js';

test('revokes only URLs owned by the preview manager', () => {
    const revoked = [];
    const manager = new PreviewManager({
        createObjectURL: () => 'blob:owned',
        revokeObjectURL: (url) => revoked.push(url),
    });
    const url = manager.create(new File(['a'], 'a.jpg'));
    manager.release(url);
    manager.release('/persisted.webp');
    assert.deepEqual(revoked, ['blob:owned']);
});

test('revokes remaining URLs on destroy and does not revoke any URL twice', () => {
    const revoked = [];
    let nextUrl = 0;
    const manager = new PreviewManager({
        createObjectURL: () => `blob:${++nextUrl}`,
        revokeObjectURL: (url) => revoked.push(url),
    });
    const first = manager.create(new File(['a'], 'a.jpg'));
    const second = manager.create(new File(['b'], 'b.jpg'));

    manager.release(first);
    manager.release(first);
    manager.destroy();
    manager.destroy();

    assert.deepEqual(revoked, [first, second]);
});
