import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { ImageLoader } from '../../src/image-loader.js';

const instances = [];
const windows = [];
function fixture(images = []) {
    const window = new Window();
    const { document } = window;
    const style = document.createElement('style');
    style.textContent = readFileSync(new URL('../../src/styles/image-loader.css', import.meta.url), 'utf8');
    document.head.append(style);
    const root = document.createElement('div');
    document.body.append(root);
    const loader = new ImageLoader(root, { images, maxFiles: 2, locale: 'pt-BR' });
    windows.push(window);
    instances.push(loader);
    return { window, document, root, loader };
}
const images = [1, 2].map((id, position) => ({ id, position, primary: position === 0, url: `/${id}.webp` }));
afterEach(() => {
    instances.splice(0).forEach((loader) => loader.destroy());
    windows.splice(0).forEach((window) => window.happyDOM.abort());
});

test('compact empty gallery uses one trailing camera tile and restores it after capacity opens', () => {
    const { root, loader, window } = fixture();
    const grid = root.querySelector('.il-grid');
    const tile = root.querySelector('.il-dropzone');
    const chooser = root.querySelector('[data-il-action="choose-files"]');
    assert.equal(grid.lastElementChild === tile, true);
    assert.ok(chooser.querySelector('svg'));
    assert.equal(chooser.getAttribute('capture'), null);
    assert.ok(chooser.getAttribute('aria-describedby'));
    const instructions = root.querySelector('.il-dropzone-copy');
    assert.equal(window.getComputedStyle(instructions).position, 'absolute');
    assert.equal(window.getComputedStyle(instructions).clipPath, 'inset(50%)');
    assert.ok(instructions.textContent.length > 0);
    const result = loader.addFiles([
        new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
        new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]);
    assert.equal(result.accepted.length, 2);
    assert.equal(tile.hidden, true);
    loader.remove(loader.getItems()[0].uid);
    assert.equal(tile.hidden, false);
    assert.equal(grid.lastElementChild === tile, true);
    assert.equal(grid.querySelectorAll('.il-card').length, 1);
});

test('compact actions use distinct titled icons on a fixed overlay and secondary actions stay contextual', () => {
    const { root, window } = fixture(images.slice(0, 1));
    assert.equal(window.getComputedStyle(root.querySelector('.il-grid')).display, 'flex');
    assert.equal(window.getComputedStyle(root.querySelector('.il-controls')).position, 'absolute');
    const paths = ['rotate-right', 'remove', 'reorder'].map((action) => {
        const button = root.querySelector(`[data-il-action="${action}"]`);
        assert.equal(button.title, button.getAttribute('aria-label'));
        assert.equal(button.textContent, '');
        return button.querySelector('path').getAttribute('d');
    });
    assert.equal(new Set(paths).size, 3);
    const panel = root.querySelector('.il-context-panel');
    assert.ok(panel);
    assert.equal(window.getComputedStyle(panel).position, 'fixed');
    for (const action of ['set-primary', 'rotate-left', 'move-left', 'move-right', 'update-alt']) {
        assert.ok(panel.querySelector(`[data-il-action="${action}"]`));
    }
});

test('compact context Escape restores summary focus while outside interaction keeps its destination', () => {
    const { root, document, window } = fixture(images);
    let details = root.querySelector('.il-details');
    details.querySelector('summary').click();
    assert.equal(details.open, true);
    const input = document.querySelector('.il-context-portal [data-il-action="update-alt"]');
    input.focus();
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(details.open, false);
    assert.equal(document.activeElement === details.querySelector('summary'), true);
    details.querySelector('summary').click();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    outside.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.equal(details.open, false);
    assert.equal(document.activeElement === outside, true);
});

test('compact context preserves edited alt text and focused action across reorder', () => {
    const { root, loader, document, window } = fixture(images);
    root.querySelector('.il-details summary').click();
    const input = document.querySelector('.il-context-portal [data-il-action="update-alt"]');
    input.focus();
    input.value = 'Frente do produto';
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(document.activeElement.value, 'Frente do produto');
    const move = document.querySelector('.il-context-portal [data-il-action="move-right"]');
    move.focus();
    move.click();
    assert.deepEqual(loader.getItems().map(({ persistedId }) => persistedId), [2, 1]);
    assert.equal(root.querySelector('.il-card[data-il-uid="persisted:1"] .il-details').open, true);
    // Moving to the edge disables this action: focus must remain in the same item's context.
    assert.equal(document.activeElement.closest('[data-il-uid]')?.dataset.ilUid ?? document.activeElement.closest('.il-card')?.dataset.ilUid, 'persisted:1');
});

test('compact Escape recovers body focus only for the last focused gallery', () => {
    const { root, document, window } = fixture(images);
    const secondRoot = document.createElement('div');
    document.body.append(secondRoot);
    instances.push(new ImageLoader(secondRoot, { images, locale: 'pt-BR' }));
    root.querySelector('summary').click();
    secondRoot.querySelector('summary').click();
    const secondInput = [...document.querySelectorAll('.il-context-portal [data-il-action="update-alt"]')].at(-1);
    secondInput.focus();
    secondInput.blur();
    assert.equal(document.activeElement === document.body, true);
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(secondRoot.querySelector('.il-details').open, false);
    assert.equal(root.querySelector('.il-details').open, true);
    assert.equal(document.activeElement === secondRoot.querySelector('summary'), true);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    outside.blur();
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(root.querySelector('.il-details').open, true);
    assert.equal(document.activeElement === document.body, true);
});

test('compact context opens only one panel per instance and destroy removes global dismissal listeners', () => {
    const { root, loader, document, window } = fixture(images);
    root.querySelectorAll('.il-details summary')[0].click();
    root.querySelectorAll('.il-details summary')[1].click();
    assert.equal(root.querySelectorAll('.il-details[open]').length, 1);
    const detached = root.querySelector('.il-details[open]');
    loader.destroy();
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.equal(detached.open, false);
    assert.equal(root.children.length, 0);
});

test('compact removal of the last local card returns focus to the remaining card grip', () => {
    const { root, loader, document } = fixture();
    loader.addFiles([
        new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
        new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]);
    const lastRemove = root.querySelectorAll('[data-il-action="remove"]')[1];
    lastRemove.focus();
    lastRemove.click();
    assert.equal(loader.getItems().length, 1);
    assert.equal(document.activeElement === root.querySelector('[data-il-reorder-handle]'), true);
});

test('compact preview tap reveals its card through native summary focus without opening details', () => {
    const { root, document } = fixture(images);
    root.querySelector('.il-preview img').click();
    assert.equal(document.activeElement === root.querySelector('summary'), true);
    assert.equal(root.querySelector('.il-details').open, false);
});

for (const status of ['processing', 'deleting']) {
    test(`busy ${status} details leave sequential focus and preview does not force disabled focus`, () => {
        const { root, document } = fixture([{ ...images[0], status }]);
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();
        const summary = root.querySelector('summary');
        assert.equal(summary.getAttribute('tabindex'), '-1');
        root.querySelector('.il-preview img').click();
        assert.equal(document.activeElement === outside, true);
        summary.click();
        assert.equal(document.activeElement === outside, true);
        assert.equal(root.querySelector('.il-details').open, false);
    });
}

test('fallback portal keeps its trigger relationship and leaves no detached editor across rerender and destroy', () => {
    const { root, loader, document, window } = fixture(images);
    root.querySelector('summary').click();
    const oldPortal = document.querySelector('.il-context-portal');
    assert.ok(oldPortal);
    assert.equal(document.getElementById(root.querySelector('summary').getAttribute('aria-controls')) === oldPortal.firstElementChild, true);
    const input = oldPortal.querySelector('input');
    input.focus();
    input.value = 'Portal alt';
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(loader.getItems()[0].altText, 'Portal alt');
    assert.equal(oldPortal.isConnected, false);
    assert.equal(document.querySelectorAll('.il-context-portal').length, 1);
    assert.equal(document.activeElement.value, 'Portal alt');
    const detached = document.querySelector('.il-context-portal');
    loader.destroy();
    assert.equal(document.querySelectorAll('.il-context-portal').length, 0);
    assert.equal(detached.children.length, 0);
    assert.doesNotThrow(() => input.dispatchEvent(new window.Event('change', { bubbles: true })));
});
