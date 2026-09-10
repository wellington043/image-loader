import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { ReorderController } from '../../src/browser/reorder-controller.js';

const window = new Window();
const { document } = window;
globalThis.window = window;
globalThis.document = document;

const fixture = () => {
    const root = document.createElement('div');
    const liveRegion = document.createElement('p');
    const items = [
        { uid: 'persisted:1', position: 0 },
        { uid: 'persisted:2', position: 1 },
        { uid: 'persisted:3', position: 2 },
    ];
    for (const item of items) {
        const card = document.createElement('article');
        card.dataset.ilUid = item.uid;
        const handle = document.createElement('button');
        handle.dataset.ilReorderHandle = '';
        card.append(handle);
        root.append(card);
    }
    document.body.append(root, liveRegion);
    const moves = [];
    const controller = new ReorderController({
        root,
        liveRegion,
        getItems: () => items,
        move: ({ uid, position }) => moves.push({ uid, position }),
        announce: (position) => `Imagem movida para a posição ${position}.`,
    });

    return { root, liveRegion, controller, moves };
};

const dispatch = (element, type, properties = {}) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, properties);
    element.dispatchEvent(event);
    return event;
};

afterEach(() => {
    document.body.replaceChildren();
    delete document.elementFromPoint;
});

test('moves by an accessible button using a destination position and announces it', () => {
    const { controller, liveRegion, moves } = fixture();

    controller.moveByButton('persisted:2', -1);

    assert.deepEqual(moves, [{ uid: 'persisted:2', position: 0 }]);
    assert.equal(liveRegion.textContent, 'Imagem movida para a posição 1.');
    controller.destroy();
});

test('converts a drag and drop target into a store move destination', () => {
    const { root, controller, moves } = fixture();
    const sourceHandle = root.querySelector('[data-il-uid="persisted:3"] [data-il-reorder-handle]');
    const targetCard = root.querySelector('[data-il-uid="persisted:1"]');

    dispatch(sourceHandle, 'dragstart', { dataTransfer: { effectAllowed: '', setData() {} } });
    dispatch(targetCard, 'dragover', { dataTransfer: { dropEffect: '' } });
    dispatch(targetCard, 'drop', { dataTransfer: { getData: () => '' } });

    assert.deepEqual(moves, [{ uid: 'persisted:3', position: 0 }]);
    controller.destroy();
});

test('uses pointer capture and the element under the pointer for a touch reorder destination', () => {
    const { root, controller, moves } = fixture();
    const sourceHandle = root.querySelector('[data-il-uid="persisted:1"] [data-il-reorder-handle]');
    const targetCard = root.querySelector('[data-il-uid="persisted:3"]');
    const captures = [];
    const releases = [];
    sourceHandle.setPointerCapture = (pointerId) => captures.push(pointerId);
    sourceHandle.releasePointerCapture = (pointerId) => releases.push(pointerId);
    document.elementFromPoint = () => targetCard;

    dispatch(sourceHandle, 'pointerdown', { pointerId: 4, clientX: 10, clientY: 10 });
    dispatch(sourceHandle, 'pointermove', { pointerId: 4, clientX: 100, clientY: 20 });
    dispatch(sourceHandle, 'pointerup', { pointerId: 4, clientX: 100, clientY: 20 });

    assert.deepEqual(moves, [{ uid: 'persisted:1', position: 2 }]);
    assert.deepEqual(captures, [4]);
    assert.deepEqual(releases, [4]);
    controller.destroy();
});

test('native drag uses the rendered preview with an offset instead of the nested UID grip', () => {
    const { root, controller } = fixture();
    const card = root.querySelector('article');
    card.className = 'il-card';
    const handle = card.querySelector('button');
    handle.dataset.ilUid = card.dataset.ilUid;
    const preview = document.createElement('div');
    preview.className = 'il-preview';
    preview.getBoundingClientRect = () => ({ left: 20, top: 30, width: 178, height: 178 });
    card.prepend(preview);
    const calls = [];
    const before = document.querySelectorAll('*').length;
    dispatch(handle, 'dragstart', { clientX: 31, clientY: 42, dataTransfer: { setData() {}, setDragImage: (...args) => calls.push(args) } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0] === preview, true);
    assert.deepEqual(calls[0].slice(1), [11, 12]);
    dispatch(handle, 'dragstart', { clientX: 1000, clientY: -10, dataTransfer: { setData() {}, setDragImage: (...args) => calls.push(args) } });
    assert.deepEqual(calls[1].slice(1), [178, 0]);
    dispatch(handle, 'dragend');
    assert.equal(document.querySelectorAll('*').length, before);
    controller.destroy();
});

for (const support of ['absent', 'throws']) {
    test(`native reorder remains effective when setDragImage ${support}`, () => {
        const { root, controller, moves } = fixture();
        const card = root.querySelector('article');
        card.className = 'il-card';
        const preview = document.createElement('div');
        preview.className = 'il-preview';
        card.prepend(preview);
        const transfer = { setData() {} };
        if (support === 'throws') transfer.setDragImage = () => { throw new Error('Unsupported feedback'); };
        assert.doesNotThrow(() => dispatch(card.querySelector('button'), 'dragstart', { dataTransfer: transfer }));
        dispatch(root.querySelectorAll('article')[2], 'drop', { dataTransfer: transfer });
        assert.deepEqual(moves, [{ uid: 'persisted:1', position: 2 }]);
        controller.destroy();
    });
}
