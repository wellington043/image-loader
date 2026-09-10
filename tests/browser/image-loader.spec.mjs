import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const localFixtures = [
    fileURLToPath(new URL('../fixtures/icon-192.png', import.meta.url)),
    fileURLToPath(new URL('../fixtures/icon-512.png', import.meta.url)),
];

test.describe('ALT dismissal without Tab', () => {
    test.describe.configure({ timeout: 15000 });
    const check = expect.configure({ timeout: 2000 });

    for (const mode of ['native', 'absent', 'throws']) {
        for (const dismissal of ['Escape', 'outside click']) {
            test(`${mode}: ${dismissal} closes the edited panel and allows another edit`, async ({ page }) => {
                const pageErrors = [];
                page.on('pageerror', error => pageErrors.push(error.message));
                if (mode !== 'native') {
                    await page.addInitScript(mode => {
                        Object.defineProperty(HTMLElement.prototype, 'showPopover', {
                            configurable: true,
                            value: mode === 'throws'
                                ? function () { throw new Error('Popover unavailable'); }
                                : undefined,
                        });
                    }, mode);
                }
                await page.goto('/examples/basic.html');
                const card = page.locator('.il-card[data-il-uid="persisted:1"]');
                const summary = card.locator('summary');
                const panel = page.locator('.il-context-panel:visible');
                const alt = panel.locator('[data-il-action="update-alt"]');
                const outside = page.getByRole('textbox', { name: 'Product name' });
                let previousText = 'Persisted coffee grinder image';

                for (const text of ['Edited without Tab', 'Edited again without Tab']) {
                    await summary.focus();
                    await page.keyboard.press('Enter');
                    await check(panel).toHaveCount(1);
                    if (mode === 'native') {
                        await check(page.locator('.il-context-panel:popover-open')).toHaveCount(1);
                    } else {
                        await check(page.locator('.il-context-portal')).toHaveCount(1);
                    }
                    await check(alt).toHaveValue(previousText);
                    await alt.fill(text);
                    await check(alt).toBeFocused();

                    // Do not Tab or dispatch change: dismissal must commit the focused edit itself.
                    if (dismissal === 'Escape') await page.keyboard.press('Escape');
                    else {
                        // The native popover can cover the input's center, but not its far edge.
                        const box = await outside.boundingBox();
                        await outside.click({ position: { x: box.width - 8, y: 8 } });
                    }

                    check(pageErrors).toEqual([]);
                    await check(card.locator('.il-details')).not.toHaveAttribute('open');
                    await check(panel).toHaveCount(0);
                    await check(page.locator('.il-context-portal')).toHaveCount(0);
                    await check(dismissal === 'Escape' ? summary : outside).toBeFocused();
                    check(await page.evaluate(() => window.imageLoaderDemo.loader.getItems()[0].altText)).toBe(text);
                    await check(card.locator('.il-preview img')).toHaveAttribute('alt', text);
                    previousText = text;
                }

                await summary.focus();
                await page.keyboard.press('Enter');
                await check(alt).toHaveValue('Edited again without Tab');
                await page.keyboard.press('Escape');
                await check(summary).toBeFocused();
                await check(panel).toHaveCount(0);
                await check(page.locator('.il-context-portal')).toHaveCount(0);
                check(pageErrors).toEqual([]);
            });
        }
    }
});


for (const mode of ['absent', 'throws', 'modal']) {
    for (const width of [360, 1280]) {
        test(`fallback ${mode} escapes transformed clipping host at ${width}px and keeps editing lifecycle`, async ({ page }, testInfo) => {
            await page.setViewportSize({ width, height: 844 });
            await page.addInitScript(mode => {
                Object.defineProperty(HTMLElement.prototype, 'showPopover', {
                    configurable: true,
                    value: mode === 'throws' ? function () { throw new Error('Popover unavailable'); } : undefined,
                });
            }, mode);
            await page.goto('/examples/basic.html');
            await addTwoLocalImages(page);
            if (mode === 'modal') {
                await page.locator('[data-example-image-loader]').evaluate(host => {
                    const dialog = document.createElement('dialog');
                    Object.assign(dialog.style, { width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh', padding: '0', border: '0', margin: '0', overflow: 'hidden' });
                    document.body.append(dialog);
                    dialog.append(host);
                    dialog.showModal();
                });
            }
            await page.locator('[data-example-image-loader]').evaluate((host, width) => {
                Object.assign(host.style, { transform: 'translateZ(0)', overflow: 'hidden', position: 'absolute', top: '560px', left: `${width - 180}px`, width: '160px', height: '200px' });
                const root = host.querySelector('.il-root');
                root.style.setProperty('--il-color-surface', 'rgb(23, 45, 67)');
                root.style.setProperty('--il-color-text', 'rgb(240, 241, 242)');
                root.style.fontFamily = 'monospace';
            }, width);
            const card = page.locator('.il-card[data-il-uid="persisted:1"]');
            await card.locator('summary').focus();
            await page.keyboard.press('Enter');
            const panel = page.locator('.il-context-panel:visible');
            const box = await panel.boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(8);
            expect(box.y).toBeGreaterThanOrEqual(8);
            expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
            expect(box.y + box.height).toBeLessThanOrEqual(836);
            expect(await panel.evaluate(node => {
                const box = node.getBoundingClientRect();
                return node.contains(document.elementFromPoint(box.x + 20, box.y + 60));
            })).toBe(true);
            await expect(panel).toHaveCSS('background-color', 'rgb(23, 45, 67)');
            await expect(panel).toHaveCSS('font-family', 'monospace');
            await panel.locator('input').fill('Fallback description');
            await page.keyboard.press('Tab');
            await panel.locator('[data-il-action="move-right"]').click();
            await expect(page.locator('.il-context-portal')).toHaveCount(1);
            expect(await page.evaluate(() => window.imageLoaderDemo.loader.getItems().find(item => item.uid === 'persisted:1').position)).toBe(1);
            expect(await page.evaluate(() => window.imageLoaderDemo.loader.getItems().find(item => item.uid === 'persisted:1').altText)).toBe('Fallback description');
            await page.keyboard.press('Escape');
            await expect(card.locator('summary')).toBeFocused();
            await expect(page.locator('.il-context-portal')).toHaveCount(0);
            await page.keyboard.press('Enter');
            await page.screenshot({ path: testInfo.outputPath(`fallback-${mode}-${width}.png`) });
            await page.mouse.click(1, 1);
            await expect(page.locator('.il-context-portal')).toHaveCount(0);
            await card.locator('summary').focus();
            await page.keyboard.press('Enter');
            await page.evaluate(() => window.imageLoaderDemo.loader.destroy());
            await expect(page.locator('.il-context-portal')).toHaveCount(0);
            await expect(page.locator('.il-context-panel')).toHaveCount(0);
        });
    }
}

test('busy deletion skips details in real Tab navigation and ignores preview focus', async ({ page }) => {
    await page.goto('/examples/basic.html');
    await page.evaluate(() => {
        const loader = window.imageLoaderDemo.loader;
        loader.options.confirmDelete = async () => true;
        loader.options.deletePersistedImage = () => new Promise(resolve => { window.finishBusyDelete = resolve; });
        window.busyDelete = loader.remove('persisted:1');
    });
    const summary = page.locator('.il-details summary');
    await expect(summary).toHaveAttribute('aria-disabled', 'true');
    await expect(summary).toHaveAttribute('tabindex', '-1');
    await page.locator('input[name="name"]').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Save example' })).toBeFocused();
    await page.locator('.il-preview img').click();
    await expect(summary).not.toBeFocused();
    await expect(page.locator('.il-details')).not.toHaveAttribute('open');
    await page.evaluate(async () => { window.finishBusyDelete(); await window.busyDelete; });
});

test('compact gallery keeps square fixed cards and one trailing camera chooser without hover shifts', async ({ page }, testInfo) => {
    await page.goto('/examples/basic.html');
    const card = page.locator('.il-card').first();
    const before = await card.boundingBox();
    expect(before.width).toBeCloseTo(180, 0);
    expect(before.height).toBeCloseTo(180, 0);
    await expect(card.locator('summary')).toHaveCSS('opacity', '0');
    await expect(card.locator('summary')).toHaveCSS('pointer-events', 'none');
    await page.screenshot({ path: testInfo.outputPath('desktop-rest.png') });
    await card.hover();
    await expect(card.locator('summary')).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-il-action="rotate-right"]')).toBeVisible();
    expect(await card.boundingBox()).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath('desktop-hover.png') });
    await page.locator('[data-il-action="rotate-right"]').focus();
    await page.mouse.move(0, 0);
    await expect(card.locator('summary')).toHaveCSS('opacity', '1');
    expect(await card.boundingBox()).toEqual(before);
    await addTwoLocalImages(page);
    const boxes = await page.locator('.il-card').evaluateAll(cards => cards.map(card => {
        const { x, y, width, height } = card.getBoundingClientRect();
        return { x, y, width, height };
    }));
    expect(boxes.every(box => box.width === 180 && box.height === 180 && box.y === boxes[0].y)).toBe(true);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x + 180);
    expect(await page.locator('.il-grid').evaluate(grid => grid.lastElementChild.classList.contains('il-dropzone'))).toBe(true);
    await expect(page.locator('[data-il-action="choose-files"] svg')).toHaveCount(1);
    await page.evaluate(async () => {
        const loader = window.imageLoaderDemo.loader;
        loader.options.confirmDelete = async () => true;
        for (const item of loader.getItems()) await loader.remove(item.uid);
    });
    await expect(page.locator('.il-card')).toHaveCount(0);
    const tile = await page.locator('.il-dropzone').boundingBox();
    expect(tile.width).toBeCloseTo(180, 0);
    expect(tile.height).toBeCloseTo(180, 0);
    await expect(page.locator('.il-empty')).not.toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('desktop-empty-camera.png') });
});

for (const theme of ['light', 'dark']) {
    test(`glass ${theme} overlay controls occupy four corners without a center hit layer`, async ({ page }, testInfo) => {
        await page.goto('/examples/basic.html');
        if (theme === 'dark') await page.addStyleTag({ content: '.il-root { --il-color-surface:#1e293b; --il-color-surface-muted:#172234; --il-color-text:#e2e8f0; --il-color-muted:#94a3b8; --il-color-border:#475569; --il-color-interactive:#7dd3fc; } body { background:#0f172a; color:#e2e8f0; }' });
        if (theme === 'dark') {
            await expect(page.locator('.il-counter')).toHaveCSS('color', 'rgb(148, 163, 184)');
            await expect(page.locator('[data-il-action="choose-files"]')).toHaveCSS('color', 'rgb(148, 163, 184)');
        }
        const card = page.locator('.il-card');
        await card.hover();
        const box = await card.boundingBox();
        for (const [selector, right, bottom] of [
            ['[data-il-reorder-handle]', false, false], ['summary', true, false],
            ['[data-il-action="rotate-right"]', false, true], ['[data-il-action="remove"]', true, true],
        ]) {
            const control = card.locator(selector);
            const rect = await control.boundingBox();
            expect(rect.width, JSON.stringify(await control.evaluate(node => ({ selector: node.className, boxSizing: getComputedStyle(node).boxSizing, parentBoxSizing: getComputedStyle(node.parentElement).boxSizing })))).toBe(44);
            expect(rect.height).toBe(44);
            expect(rect.x).toBeCloseTo(right ? box.x + box.width - 49 : box.x + 5, 0);
            expect(rect.y).toBeCloseTo(bottom ? box.y + box.height - 49 : box.y + 5, 0);
            await expect(control).toHaveCSS('backdrop-filter', 'blur(8px)');
            await expect(control.locator('svg')).toHaveCSS('opacity', '1');
            expect(await control.evaluate(node => getComputedStyle(node).backgroundColor)).toMatch(/0\.86\)/);
        }
        expect(await card.evaluate(node => {
            const box = node.getBoundingClientRect();
            return document.elementFromPoint(box.x + box.width / 2, box.y + box.height - 20)?.tagName;
        })).toBe('IMG');
        await page.screenshot({ path: testInfo.outputPath(`glass-${theme}-corners.png`) });
        const originalSource = await card.locator('img').getAttribute('src');
        const contrastMeasurements = [];
        for (const photo of ['white', 'black']) {
            await card.locator('img').evaluate(async (img, color) => { img.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="${color}"/></svg>`)}`; await img.decode(); }, photo);
            for (const selector of ['[data-il-reorder-handle]', 'summary', '[data-il-action="rotate-right"]', '[data-il-action="remove"]']) {
                const control = card.locator(selector);
                for (const state of ['hover', 'focus']) {
                    if (state === 'hover') await control.hover();
                    else { await page.mouse.move(0, 0); await page.keyboard.press('Tab'); await control.focus(); }
                    const contrast = await control.evaluate((node, photo) => {
                        const context = document.createElement('canvas').getContext('2d');
                        const rgb = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
                        const luminance = color => color.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
                        const style = getComputedStyle(node);
                        const bg = rgb(style.backgroundColor);
                        const composite = bg.slice(0, 3).map(value => value * bg[3] / 255 + (photo === 'white' ? 255 : 0) * (1 - bg[3] / 255));
                        const values = [luminance(rgb(style.color)), luminance(composite)].sort((a, b) => b - a);
                        return (values[0] + .05) / (values[1] + .05);
                    }, photo);
                    expect(contrast, `${theme}/${photo}/${selector}/${state} icon contrast`).toBeGreaterThanOrEqual(3);
                    contrastMeasurements.push({ photo, control: selector, state, ratio: contrast });
                }
            }
        }
        console.log(`GLASS_CONTRAST ${theme} ${JSON.stringify(contrastMeasurements)}`);
        await card.locator('img').evaluate(async (img, src) => { img.src = src; await img.decode(); }, originalSource);
        await card.hover();
        await card.locator('summary').click();
        await expect(card.locator('.il-context-panel')).toHaveCSS('backdrop-filter', 'none');
        await expect(card.locator('.il-context-panel')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(30, 41, 59)' : 'rgb(255, 255, 255)');
});
}

for (const preference of ['reduced-transparency', 'forced-colors', 'unsupported-filter']) {
    test(`glass has opaque overlay fallback for ${preference}`, async ({ page }) => {
        await page.goto('/examples/basic.html');
        if (preference === 'forced-colors') await page.emulateMedia({ forcedColors: 'active' });
        else if (preference === 'reduced-transparency') {
            const client = await page.context().newCDPSession(page);
            await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
            expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true);
        } else {
            // Exercise the base cascade as an engine that rejects the enhancement condition.
            await page.evaluate(() => {
                for (const sheet of document.styleSheets) {
                    for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
                        const rule = sheet.cssRules[index];
                        if (rule instanceof CSSSupportsRule && rule.conditionText.includes('backdrop-filter')) sheet.deleteRule(index);
                    }
                }
            });
        }
        const card = page.locator('.il-card');
        await card.hover();
        for (const selector of ['[data-il-reorder-handle]', 'summary', '[data-il-action="rotate-right"]', '[data-il-action="remove"]']) {
            await expect(card.locator(selector)).toHaveCSS('backdrop-filter', 'none');
            await expect(card.locator(selector)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        }
    });
}

test('native desktop drag hands the cropped rotated preview to setDragImage and still reorders', async ({ page }) => {
    await page.goto('/examples/basic.html');
    await addTwoLocalImages(page);
    await page.evaluate(() => {
        window.imageLoaderDemo.loader.rotate('persisted:1', 90);
        const original = DataTransfer.prototype.setDragImage;
        window.dragPreviewProof = [];
        DataTransfer.prototype.setDragImage = function (node, x, y) {
            const img = node.querySelector('img');
            window.dragPreviewProof.push({ preview: node.classList.contains('il-preview'), connected: node.isConnected, controls: node.querySelectorAll('button,summary').length, crop: getComputedStyle(img).objectFit, rotation: img.style.transform, x, y, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height });
            return original.call(this, node, x, y);
        };
    });
    const source = page.locator('.il-card[data-il-uid="persisted:1"]');
    await source.hover();
    await source.locator('[data-il-reorder-handle]').dragTo(page.locator('.il-card').nth(2));
    expect(await page.evaluate(() => window.imageLoaderDemo.loader.getItems().find(item => item.uid === 'persisted:1').position)).toBe(2);
    const proof = await page.evaluate(() => window.dragPreviewProof);
    expect(proof.length).toBeGreaterThan(0);
    expect(proof[0]).toMatchObject({ preview: true, connected: true, controls: 0, crop: 'cover', rotation: 'rotate(90deg)' });
    expect(proof[0].x).toBeGreaterThanOrEqual(0);
    expect(proof[0].y).toBeGreaterThanOrEqual(0);
    expect(proof[0].x).toBeLessThanOrEqual(proof[0].width);
    expect(proof[0].y).toBeLessThanOrEqual(proof[0].height);
    await expect(page.locator('.il-preview')).toHaveCount(3);
    await page.evaluate(() => window.imageLoaderDemo.loader.destroy());
    await expect(page.locator('.il-preview')).toHaveCount(0);
});

test.describe('compact touch and dark snapshots', () => {
    test.use({ hasTouch: true });
    for (const [width, height] of [[360, 800], [390, 844]]) {
        for (const theme of ['light', 'dark']) {
            test(`${theme} touch ${width} keeps badge actions and contextual editing usable`, async ({ page }, testInfo) => {
                await page.setViewportSize({ width, height });
                await page.goto('/examples/basic.html');
                await addTwoLocalImages(page);
                if (theme === 'dark') {
                    await page.addStyleTag({ content: `body { background:#0f172a; color:#e2e8f0; }
                        .il-root,.il-confirmation-dialog { --il-color-surface:#1e293b; --il-color-surface-muted:#172234;
                        --il-color-text:#e2e8f0; --il-color-muted:#94a3b8; --il-color-border:#475569; --il-color-interactive:#7dd3fc; }` });
                }
                const card = page.locator('.il-card').first();
                await expect(card.locator('summary')).toHaveCSS('opacity', '1');
                await expect(card.locator('summary')).toHaveCSS('pointer-events', 'auto');
                await expect(card.locator('.il-controls')).toHaveCSS('opacity', '0');
                await expect(card.locator('[data-il-reorder-handle]')).toHaveCSS('opacity', '0');
                const badge = await card.locator('.il-badge--primary').boundingBox();
                const grip = await card.locator('[data-il-reorder-handle]').boundingBox();
                const overlaps = badge.x < grip.x + grip.width && badge.x + badge.width > grip.x
                    && badge.y < grip.y + grip.height && badge.y + badge.height > grip.y;
                expect(overlaps, 'primary badge must remain visible beside touch controls').toBe(false);
                // Full-page capture changes hover emulation in this Chromium runtime.
                await page.screenshot({ path: testInfo.outputPath(`${theme}-touch-${width}-gallery.png`) });
                expect(await page.evaluate(() => matchMedia('(hover: none)').matches), 'capture must preserve touch media for the interactions under test').toBe(true);
                expect(await card.locator('summary').evaluate(node => {
                    const box = node.getBoundingClientRect();
                    return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
                })).toBe(true);
                const cardBeforeTap = await card.boundingBox();
                await card.locator('img').tap();
                await expect(card.locator('summary')).toBeFocused();
                await expect(card.locator('.il-context-panel')).toBeHidden();
                await expect(card.locator('.il-controls')).toHaveCSS('opacity', '1');
                await expect(page.locator('.il-card').nth(1).locator('.il-controls')).toHaveCSS('opacity', '0');
                expect(await card.boundingBox()).toEqual(cardBeforeTap);
                for (const action of ['rotate-right', 'remove']) {
                    const control = card.locator(`[data-il-action="${action}"]`);
                    await expect(control).toHaveCSS('pointer-events', 'auto');
                    const box = await control.boundingBox();
                    expect(box.width).toBeGreaterThanOrEqual(44);
                    expect(box.height).toBeGreaterThanOrEqual(44);
                }
                await page.screenshot({ path: testInfo.outputPath(`${theme}-touch-${width}-revealed.png`) });
                expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
                await card.locator('[data-il-action="rotate-right"]').tap();
                await expect(card.locator('img')).toHaveAttribute('style', /rotate\(90deg\)/);
                // A clipped host must not clip the top-layer contextual editor.
                await page.locator('[data-example-image-loader]').evaluate(root => { root.style.overflow = 'hidden'; });
                await card.locator('summary').tap();
                const panel = card.locator('.il-context-panel');
                await expect(panel).toBeVisible();
                const box = await panel.boundingBox();
                expect(box.x).toBeGreaterThanOrEqual(8);
                expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
                expect(box.y + box.height).toBeLessThanOrEqual(height - 8);
                const input = panel.locator('input');
                await input.fill('Descrição touch');
                await page.keyboard.press('Tab');
                await testInfo.attach('focus-after-alt-tab', { body: JSON.stringify(await page.evaluate(() => ({ tag: document.activeElement.tagName, action: document.activeElement.dataset.ilAction ?? null }))), contentType: 'application/json' });
                await page.screenshot({ path: testInfo.outputPath(`${theme}-touch-${width}-context.png`) });
                await page.keyboard.press('Escape');
                await expect(card.locator('summary')).toBeFocused();
                await card.locator('[data-il-action="remove"]').tap();
                await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
                await expect(card).toHaveAttribute('data-il-uid', 'persisted:1');
                await page.evaluate(() => { window.imageLoaderDemo.loader.options.deletePersistedImage = async () => { throw new Error('Simulated deletion failure'); }; });
                await card.locator('[data-il-action="remove"]').tap();
                await page.locator('dialog').getByRole('button', { name: 'Remove image', exact: true }).tap();
                await expect(page.locator('.il-error-summary')).toContainText('Simulated deletion failure');
                await expect(page.locator('.il-card[data-il-uid="persisted:1"]')).toBeVisible();
                expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            });
        }
    }
});

for (const width of [360, 390, 1280]) {
    test(`compact contextual panel stays in viewport and restores keyboard focus at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/examples/basic.html');
        await addTwoLocalImages(page);
        const card = page.locator('.il-card').last();
        const uid = await card.getAttribute('data-il-uid');
        const summary = card.locator('summary');
        const before = await card.boundingBox();
        await summary.focus();
        await page.keyboard.press('Enter');
        const panel = card.locator('.il-context-panel');
        await expect(panel).toBeVisible();
        const panelBox = await panel.boundingBox();
        expect(panelBox.x).toBeGreaterThanOrEqual(8);
        expect(panelBox.y).toBeGreaterThanOrEqual(8);
        expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width - 8);
        expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(836);
        expect(await card.boundingBox()).toEqual(before);
        await card.locator('[data-il-action="update-alt"]').fill('Lateral revisada');
        await page.keyboard.press('Tab');
        expect(await page.evaluate(uid => window.imageLoaderDemo.loader.getItems().find(item => item.uid === uid).altText, uid)).toBe('Lateral revisada');
        await page.keyboard.press('Escape');
        await expect(summary).toBeFocused();
        await expect(panel).toBeHidden();
        await summary.click();
        // The panel is inset at least 8px; the viewport corner is genuinely outside it.
        await page.mouse.click(width - 1, 1);
        await expect(panel).toBeHidden();
        await page.locator('input[name="name"]').click();
        await expect(page.locator('input[name="name"]')).toBeFocused();
    });
}

async function addTwoLocalImages(page) {
    await page.locator('[data-il-input]').setInputFiles(localFixtures);
    await expect(page.locator('.il-card')).toHaveCount(3);
}

async function dropCopyOfSelectedFile(page) {
    const sourceBytes = await readFile(localFixtures[0]);
    const transfer = await page.evaluateHandle((bytes) => {
        const copy = new File([new Uint8Array(bytes)], 'dropped-copy.png', {
            type: 'image/png',
            lastModified: 1,
        });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(copy);
        return dataTransfer;
    }, [...sourceBytes]);
    try {
        const accepted = await page.locator('.il-root').evaluate((root) => {
            const dragover = new Event('dragover', { bubbles: true, cancelable: true });
            Object.defineProperty(dragover, 'dataTransfer', {
                value: { files: [], types: ['Files'], items: [{ kind: 'file', type: 'image/png' }] },
            });
            root.dispatchEvent(dragover);
            return dragover.defaultPrevented;
        });
        expect(accepted, 'protected external dragover must be accepted before dispatching drop').toBe(true);
        await page.locator('.il-root').dispatchEvent('drop', { dataTransfer: transfer });
    } finally {
        await transfer.dispose();
    }
}

async function dragByRealTouch(page, sourceBox, destinationBox) {
    const client = await page.context().newCDPSession(page);
    const touchPoint = (box) => ({
        id: 1,
        radiusX: 1,
        radiusY: 1,
        x: Math.round(box.x + 6),
        y: Math.round(box.y + 6),
    });
    try {
        await client.send('Input.dispatchTouchEvent', {
            touchPoints: [touchPoint(sourceBox)],
            type: 'touchStart',
        });
        await client.send('Input.dispatchTouchEvent', {
            touchPoints: [touchPoint(destinationBox)],
            type: 'touchMove',
        });
        await client.send('Input.dispatchTouchEvent', {
            touchPoints: [],
            type: 'touchEnd',
        });
    } finally {
        await client.detach();
    }
}

async function runLateResubmitMutation(page, mutation) {
    return page.evaluate(async (kind) => {
        const { NativeFormAdapter } = await import('/src/browser/native-form-adapter.js');
        const form = document.createElement('form');
        form.action = `/examples/basic.html?late-resubmit=${kind}`;
        form.method = 'post';
        const target = document.createElement('iframe');
        target.name = `late-resubmit-${kind}`;
        form.target = target.name;
        const submitter = document.createElement('button');
        submitter.name = 'intent';
        submitter.type = 'submit';
        submitter.value = 'save';
        form.append(submitter);
        document.body.append(form, target);
        let busy = false;
        const loaderListeners = new Set();
        const loader = {
            isBusy: () => busy,
            off: (_event, listener) => loaderListeners.delete(listener),
            on: (_event, listener) => {
                loaderListeners.add(listener);
                return () => loaderListeners.delete(listener);
            },
            serialize: async () => ({
                files: new Map([['abc', new File(['webp'], 'abc.webp', { type: 'image/webp' })]]),
                manifest: [{ primary: true, position: 0, rotation: 0, source: 'local', uploadKey: 'abc' }],
            }),
        };
        const adapter = new NativeFormAdapter(form, loader);
        form.addEventListener('submit', () => {
            if (kind === 'busy') {
                busy = true;
            } else {
                submitter.disabled = true;
            }
        });
        let formDataCount = 0;
        const outcome = await new Promise((resolve) => {
            form.addEventListener('formdata', () => {
                formDataCount += 1;
                resolve({ type: 'formdata' });
            }, { once: true });
            form.addEventListener('image-loader:submit-error', ({ detail }) => {
                resolve({ code: detail.error.code, type: 'error' });
            }, { once: true });
            form.requestSubmit(submitter);
        });
        adapter.destroy();
        form.remove();
        target.remove();
        return { ...outcome, formDataCount };
    }, mutation);
}

test('runs the ESM example with selection, every reorder path, confirmation and native form data', async ({ page }) => {
    await page.goto('/examples/basic.html');
    await addTwoLocalImages(page);
    await dropCopyOfSelectedFile(page);
    await expect(page.locator('.il-card')).toHaveCount(4);

    const cards = page.locator('.il-card');
    await cards.nth(2).hover();
    await cards.nth(2).locator('[data-il-reorder-handle]').dragTo(cards.nth(0));
    await expect(page.locator('[data-il-live]')).toHaveText('Image moved to position 1.');

    const pointerHandle = cards.nth(0).locator('[data-il-reorder-handle]');
    const pointerTarget = cards.nth(2);
    const sourceBox = await pointerHandle.boundingBox();
    const targetBox = await pointerTarget.boundingBox();
    await page.mouse.move(sourceBox.x + 5, sourceBox.y + 5);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + 10, targetBox.y + 10);
    await page.mouse.up();
    await expect(page.locator('[data-il-live]')).toHaveText('Image moved to position 3.');

    await cards.nth(0).hover();
    await cards.nth(0).locator('summary').click();
    await cards.nth(0).locator('[data-il-action="move-right"]').click();
    await expect(page.locator('[data-il-live]')).toHaveText('Image moved to position 2.');
    const keyboardMove = cards.nth(1).locator('[data-il-action="move-right"]');
    await keyboardMove.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-il-live]')).toHaveText('Image moved to position 3.');

    await cards.nth(0).hover();
    await cards.nth(0).locator('[data-il-action="rotate-right"]').click();
    await expect(cards.nth(0).locator('img')).toHaveAttribute('style', /rotate\(90deg\)/);
    await cards.nth(1).hover();
    await cards.nth(1).locator('summary').click();
    await cards.nth(1).locator('[data-il-action="set-primary"]').click();
    await page.keyboard.press('Escape');
    await expect(cards.nth(1).locator('.il-badge--primary')).toHaveText('Primary');

    const persistedRemove = page.locator('[data-il-uid="persisted:1"] [data-il-action="remove"]');
    await persistedRemove.focus();
    await persistedRemove.click();
    const dialog = page.locator('dialog.il-confirmation-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(persistedRemove).toBeFocused();

    await persistedRemove.click();
    await dialog.getByRole('button', { name: 'Remove image' }).click();
    await expect(page.locator('article[data-il-uid="persisted:1"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Save example' }).click();
    await expect(page.locator('[data-example-output]')).toContainText('"source": "local"');
    await expect(page.locator('[data-example-output]')).toContainText('"files"');
});

test('serializes a local browser file into a webp payload', async ({ page }) => {
    await page.goto('/examples/basic.html');
    await page.locator('[data-il-input]').setInputFiles(localFixtures[0]);

    const result = await page.evaluate(async () => Promise.race([
        window.imageLoaderDemo.loader.serialize().then(({ files }) => ({
            state: 'resolved',
            type: files.values().next().value.type,
        }), (error) => ({ state: 'rejected', message: error.message })),
        new Promise((resolve) => setTimeout(() => resolve({ state: 'timeout' }), 1000)),
    ]));

    expect(result).toEqual({ state: 'resolved', type: 'image/webp' });
});

test('blocks native submission while persisted deletion is busy', async ({ page }) => {
    await page.goto('/examples/basic.html');
    await page.locator('.il-card').hover();
    const persistedRemove = page.locator('[data-il-uid="persisted:1"] [data-il-action="remove"]');
    await persistedRemove.click();
    await page.locator('dialog.il-confirmation-dialog').getByRole('button', { name: 'Remove image' }).click();
    await expect(page.locator('article[data-il-uid="persisted:1"]')).toContainText('Deleting');

    await page.getByRole('button', { name: 'Save example' }).click();
    await expect(page.locator('[data-example-status]')).toContainText('busy');
    await expect(page.locator('[data-example-output]')).toHaveText('No submission yet.');
    await expect(page.locator('article[data-il-uid="persisted:1"]')).toHaveCount(0);
});

test('keeps media on inspected and native FormData while preserving an external submitter', async ({ page }) => {
    await page.goto('/examples/basic.html');

    const result = await page.evaluate(async () => {
        const { NativeFormAdapter } = await import('/src/browser/native-form-adapter.js');
        const form = document.createElement('form');
        form.id = 'native-formdata-race';
        form.action = '/examples/basic.html?native-formdata-race=1';
        form.method = 'post';
        const title = document.createElement('input');
        title.name = 'title';
        title.value = 'Coffee grinder';
        form.append(title);
        const target = document.createElement('iframe');
        target.name = 'native-formdata-target';
        form.target = target.name;
        const externalSubmitter = document.createElement('button');
        externalSubmitter.type = 'submit';
        externalSubmitter.name = 'intent';
        externalSubmitter.value = 'draft';
        externalSubmitter.formAction = '/examples/basic.html?external-intent=draft';
        document.body.append(form, target, externalSubmitter);
        externalSubmitter.setAttribute('form', form.id);

        const loaderListeners = new Set();
        const loader = {
            isBusy: () => false,
            off: (_event, listener) => loaderListeners.delete(listener),
            on: (_event, listener) => {
                loaderListeners.add(listener);
                return () => loaderListeners.delete(listener);
            },
            serialize: async () => ({
                files: new Map([['abc', new File(['webp'], 'abc.webp', { type: 'image/webp' })]]),
                manifest: [{ primary: true, position: 0, rotation: 0, source: 'local', uploadKey: 'abc' }],
            }),
        };
        form.addEventListener('formdata', ({ formData }) => {
            formData.append('media_manifest', 'stale');
            formData.append('media_files[stale]', new File(['stale'], 'stale.webp', { type: 'image/webp' }));
        });
        const adapter = new NativeFormAdapter(form, loader);
        const formDataSnapshots = [];
        let inspectedSnapshot;
        let submitterPreserved = false;
        const nativeFormData = new Promise((resolve) => {
            form.addEventListener('formdata', ({ formData }) => {
                const snapshot = {
                    manifestCount: formData.getAll('media_manifest').length,
                    manifestUploadKey: JSON.parse(formData.get('media_manifest')).at(0)?.uploadKey,
                    staleFile: formData.get('media_files[stale]'),
                    title: formData.get('title'),
                    uploadFile: formData.get('media_files[abc]')?.name,
                };
                formDataSnapshots.push(snapshot);
                if (formDataSnapshots.length === 2) {
                    resolve();
                }
            });
        });
        form.addEventListener('submit', (event) => {
            submitterPreserved = event.submitter === externalSubmitter
                && event.submitter.formAction.endsWith('external-intent=draft');
            const inspected = new FormData(form);
            inspectedSnapshot = {
                manifestCount: inspected.getAll('media_manifest').length,
                manifestUploadKey: JSON.parse(inspected.get('media_manifest')).at(0)?.uploadKey,
                staleFile: inspected.get('media_files[stale]'),
                title: inspected.get('title'),
                uploadFile: inspected.get('media_files[abc]')?.name,
            };
        });

        form.requestSubmit(externalSubmitter);
        await nativeFormData;
        adapter.destroy();
        form.remove();
        target.remove();
        externalSubmitter.remove();
        return { formDataSnapshots, inspectedSnapshot, submitterPreserved };
    });

    expect(result.submitterPreserved).toBe(true);
    expect(result.formDataSnapshots).toEqual([{
        manifestCount: 1,
        manifestUploadKey: 'abc',
        staleFile: null,
        title: 'Coffee grinder',
        uploadFile: 'abc.webp',
    }, {
        manifestCount: 1,
        manifestUploadKey: 'abc',
        staleFile: null,
        title: 'Coffee grinder',
        uploadFile: 'abc.webp',
    }]);
    expect(result.inspectedSnapshot).toEqual(result.formDataSnapshots[0]);
});

test('blocks a real native resubmit race when earlier capture changes the loader', async ({ page }) => {
    await page.goto('/examples/basic.html');

    const result = await page.evaluate(async () => {
        const { NativeFormAdapter } = await import('/src/browser/native-form-adapter.js');
        const form = document.createElement('form');
        const submitter = document.createElement('button');
        submitter.type = 'submit';
        form.append(submitter);
        document.body.append(form);
        const loaderListeners = new Set();
        const loader = {
            emitChange() {
                for (const listener of loaderListeners) {
                    listener({ items: [] });
                }
            },
            isBusy: () => false,
            off: (_event, listener) => loaderListeners.delete(listener),
            on: (_event, listener) => {
                loaderListeners.add(listener);
                return () => loaderListeners.delete(listener);
            },
            serialize: async () => ({ files: new Map(), manifest: [] }),
        };
        let captureCount = 0;
        let bubbled = false;
        let formDataCount = 0;
        form.addEventListener('submit', () => {
            captureCount += 1;
            if (captureCount === 2) {
                loader.emitChange();
            }
        }, true);
        const adapter = new NativeFormAdapter(form, loader);
        form.addEventListener('submit', () => {
            bubbled = true;
        });
        form.addEventListener('formdata', () => {
            formDataCount += 1;
        });
        const error = await new Promise((resolve) => {
            form.addEventListener('image-loader:submit-error', ({ detail }) => resolve(detail.error.code), { once: true });
            form.requestSubmit(submitter);
        });
        adapter.destroy();
        form.remove();
        return { bubbled, captureCount, error, formDataCount };
    });

    expect(result).toEqual({
        bubbled: false,
        captureCount: 2,
        error: 'selection-changed',
        formDataCount: 0,
    });
});

test('blocks a real native default when a later listener makes the loader busy', async ({ page }) => {
    await page.goto('/examples/basic.html');

    await expect(runLateResubmitMutation(page, 'busy')).resolves.toEqual({
        code: 'image-busy',
        formDataCount: 0,
        type: 'error',
    });
});

test('blocks a real native default when a later listener disables the submitter', async ({ page }) => {
    await page.goto('/examples/basic.html');

    await expect(runLateResubmitMutation(page, 'submitter')).resolves.toEqual({
        code: 'submitter-ineligible',
        formDataCount: 0,
        type: 'error',
    });
});

test.describe('mobile touch use', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('keeps the mobile layout usable and reorders through touch pointer events', async ({ page }) => {
        await page.goto('/examples/basic.html');
        await addTwoLocalImages(page);
        const cards = page.locator('.il-card');
        await cards.nth(0).locator('img').tap();
        const source = cards.nth(0).locator('[data-il-reorder-handle]');
        const destination = cards.nth(1);
        const sourceBox = await source.boundingBox();
        const destinationBox = await destination.boundingBox();
        const destinationUid = await destination.getAttribute('data-il-uid');
        const destinationHitUid = await page.evaluate(({ x, y }) => (
            document.elementFromPoint(x, y)?.closest('[data-il-uid]')?.dataset.ilUid ?? null
        ), { x: destinationBox.x + 6, y: destinationBox.y + 6 });
        expect(destinationHitUid).toBe(destinationUid);
        await page.evaluate(() => {
            const handle = document.querySelector('[data-il-reorder-handle]');
            window.touchPointerProof = [];
            for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
                handle.addEventListener(type, (event) => {
                    window.touchPointerProof.push({
                        captured: handle.hasPointerCapture(event.pointerId),
                        pointerType: event.pointerType,
                        type,
                    });
                });
            }
        });
        await dragByRealTouch(page, sourceBox, destinationBox);

        const touchProof = await page.evaluate(() => window.touchPointerProof);
        expect(touchProof).not.toEqual([]);
        expect(touchProof).toContainEqual(expect.objectContaining({ pointerType: 'touch', type: 'pointerdown' }));
        expect(touchProof).toContainEqual(expect.objectContaining({ captured: true, type: 'gotpointercapture' }));
        expect(touchProof).toContainEqual(expect.objectContaining({ pointerType: 'touch', type: 'pointermove' }));
        expect(touchProof).toContainEqual(expect.objectContaining({ pointerType: 'touch', type: 'pointerup' }));
        await expect(page.locator('[data-il-live]')).toHaveText('Image moved to position 2.');
        const mainBox = await page.locator('main').boundingBox();
        expect(mainBox.width).toBeLessThanOrEqual(390);
    });
});

// These regressions intentionally load only the package example, without Bootstrap/Tenant CSS.
test('standalone hidden empty and error states occupy no space', async ({ page }) => {
    await page.goto('/examples/basic.html');
    await expect(page.locator('.il-empty')).toHaveCSS('display', 'none');
    await expect(page.locator('.il-error-summary')).toHaveCSS('display', 'none');
    await page.locator('[data-il-input]').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
    await expect(page.locator('.il-error-summary')).toBeVisible();
    await page.evaluate(async () => {
        const loader = window.imageLoaderDemo.loader;
        loader.options.confirmDelete = async () => true;
        await loader.remove('persisted:1');
    });
    await expect(page.locator('.il-empty')).toBeHidden();
    await expect(page.locator('.il-grid > .il-dropzone')).toBeVisible();
});

test('standalone exposes one chooser and its keyboard button opens the native picker', async ({ page }) => {
    await page.goto('/examples/basic.html');
    await expect(page.locator('[data-il-input]')).toBeHidden();
    const choose = page.locator('[data-il-action="choose-files"]');
    await expect(choose).toBeVisible();
    await choose.focus();
    const picker = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await picker).setFiles(localFixtures[0]);
    await expect(page.locator('.il-card')).toHaveCount(2);
});

test('standalone reduced motion removes rotation animation without blocking rotation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/examples/basic.html');
    await page.locator('.il-card').hover();
    await page.locator('[data-il-action="rotate-right"]').click();
    await expect(page.locator('.il-preview img')).toHaveCSS('transition-duration', '0s');
    await expect(page.locator('.il-preview img')).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
});

test('standalone interactive color can provide dark-surface contrast without changing primary badges', async ({ page }) => {
    await page.goto('/examples/basic.html');
    await page.locator('.il-root').evaluate(root => {
        root.style.setProperty('--il-color-interactive', '#7dd3fc');
        root.style.setProperty('--il-color-surface', '#1e293b');
    });
    const choose = page.locator('[data-il-action="choose-files"]');
    await choose.hover();
    await expect(choose).toHaveCSS('color', 'rgb(125, 211, 252)');
    await expect(page.locator('.il-badge--primary')).toHaveCSS('background-color', 'rgb(37, 99, 235)');
    await choose.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(choose).toHaveCSS('outline-color', 'rgb(125, 211, 252)');
});

test('standalone confirmation has separated touch targets and preserves cancel focus', async ({ page }) => {
    await page.goto('/examples/basic.html');
    await page.locator('.il-card').hover();
    const remove = page.locator('[data-il-action="remove"]');
    await remove.click();
    const dialog = page.locator('.il-confirmation-dialog');
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    const confirm = dialog.getByRole('button', { name: 'Remove image' });
    await expect(cancel).toBeFocused();
    const cancelBox = await cancel.boundingBox();
    const confirmBox = await confirm.boundingBox();
    expect(cancelBox.height).toBeGreaterThanOrEqual(44);
    expect(confirmBox.height).toBeGreaterThanOrEqual(44);
    expect(confirmBox.x - cancelBox.x - cancelBox.width).toBeGreaterThanOrEqual(8);
    await page.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(remove).toBeFocused();
});

test('local IIFE demo opens from file and prepares native media without backend requests', async ({ page }) => {
    const externalRequests = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
    await page.goto(new URL('../../examples/standalone.html', import.meta.url).href);
    await expect(page.locator('.il-card')).toHaveCount(1);
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Selecionar imagens' }).click();
    await (await picker).setFiles(localFixtures[0]);
    await expect(page.locator('.il-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Preparar formulário' }).click();
    await expect(page.locator('[data-example-output]')).toContainText('image/webp');
    expect(externalRequests).toEqual([]);
});

for (const width of [360, 390, 1280]) {
    test(`standalone Portuguese controls fit their cards at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/examples/basic.html');
        await page.evaluate(async () => {
            const { ImageLoader } = await import('/src/index.js');
            const images = window.imageLoaderDemo.loader.getItems();
            window.imageLoaderDemo.adapter.destroy();
            window.imageLoaderDemo.loader.destroy();
            window.imageLoaderDemo.loader = new ImageLoader(document.querySelector('[data-example-image-loader]'), { images, locale: 'pt-BR' });
        });
        const overflow = await page.locator('.il-controls button').evaluateAll((buttons) => buttons
            .filter((button) => button.scrollWidth > button.clientWidth + 1)
            .map((button) => ({ label: button.getAttribute('aria-label'), width: button.clientWidth, content: button.scrollWidth })));
        expect(overflow).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
}
