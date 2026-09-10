import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { ConfirmationDialog } from '../../src/browser/confirmation-dialog.js';
import { ptBR } from '../../src/locales/pt-BR.js';

const window = new Window();
const { document } = window;
globalThis.window = window;
globalThis.document = document;

const dialogs = [];

afterEach(() => {
    for (const dialog of dialogs.splice(0)) {
        dialog.destroy();
    }
    document.body.replaceChildren();
});

const createDialog = () => {
    const dialog = new ConfirmationDialog({ document, labels: ptBR.dialog });
    dialogs.push(dialog);
    return dialog;
};

test('focuses cancel, closes on Escape and returns focus to the trigger', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const dialog = createDialog();

    const decision = dialog.confirm({ altText: 'Foto principal' }, trigger);

    assert.equal(document.activeElement, dialog.cancelButton);
    dialog.element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    assert.equal(await decision, false);
    assert.equal(document.activeElement, trigger);
});

test('uses the localized destructive labels and keeps one decision pending at a time', async () => {
    const dialog = createDialog();
    const trigger = document.createElement('button');
    document.body.append(trigger);

    const first = dialog.confirm({ altText: '<img src=x>' }, trigger);
    const second = dialog.confirm({ altText: 'Outra foto' }, trigger);

    assert.equal(first, second);
    assert.equal(dialog.element.tagName, 'DIALOG');
    assert.equal(dialog.element.getAttribute('aria-labelledby'), dialog.title.id);
    assert.equal(dialog.element.getAttribute('aria-describedby'), dialog.description.id);
    assert.equal(dialog.title.textContent, ptBR.dialog.title);
    assert.equal(dialog.description.textContent, ptBR.dialog.description);
    assert.equal(dialog.description.textContent.includes('imediatamente'), true);
    assert.equal(dialog.confirmButton.textContent, ptBR.dialog.confirm);
    assert.equal(dialog.cancelButton.textContent, ptBR.dialog.cancel);

    dialog.confirmButton.click();
    assert.equal(await first, true);
});

test('settles and clears the fallback dialog when native dialog methods throw', async () => {
    const dialog = createDialog();
    dialog.element.showModal = () => {
        dialog.element.setAttribute('open', '');
        throw new Error('native dialog unavailable');
    };
    dialog.element.close = () => {
        throw new Error('native close unavailable');
    };

    const decision = dialog.confirm({}, document.createElement('button'));

    assert.equal(dialog.element.open, true);
    assert.doesNotThrow(() => dialog.cancelButton.click());
    assert.equal(await decision, false);
    assert.equal(dialog.element.open, false);
});

test('ignores a delayed programmatic close from a completed session', async () => {
    const dialog = createDialog();
    dialog.element.close = () => {
        dialog.element.removeAttribute('open');
        queueMicrotask(() => dialog.element.dispatchEvent(new window.Event('close')));
    };

    const first = dialog.confirm({}, document.createElement('button'));
    dialog.confirmButton.click();
    const second = dialog.confirm({}, document.createElement('button'));
    let secondSettled = false;
    second.then(() => { secondSettled = true; });

    await new Promise((resolve) => queueMicrotask(resolve));

    assert.equal(await first, true);
    assert.equal(secondSettled, false);
    dialog.cancelButton.click();
    assert.equal(await second, false);
});

test('does not consume a current native close as an older delayed close', async () => {
    const dialog = createDialog();
    let emitDelayedClose;
    dialog.element.close = () => {
        dialog.element.removeAttribute('open');
        emitDelayedClose = () => dialog.element.dispatchEvent(new window.Event('close'));
    };

    const first = dialog.confirm({}, document.createElement('button'));
    dialog.confirmButton.click();
    const second = dialog.confirm({}, document.createElement('button'));

    dialog.element.removeAttribute('open');
    dialog.element.dispatchEvent(new window.Event('close'));

    assert.equal(await first, true);
    const secondOutcome = await Promise.race([
        second.then(() => 'settled'),
        new Promise((resolve) => setTimeout(() => resolve('pending'), 0)),
    ]);
    assert.equal(secondOutcome, 'settled');
    emitDelayedClose();
});
