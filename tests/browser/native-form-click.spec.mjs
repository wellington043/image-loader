import { expect, test } from '@playwright/test';

for (const mode of ['native', 'absent', 'throws']) {
    test(`${mode} panel commits the focused ALT when Save is clicked without Tab`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        if (mode !== 'native') await page.addInitScript(mode => {
            Object.defineProperty(HTMLElement.prototype, 'showPopover', {
                configurable: true,
                value: mode === 'throws' ? function () { throw new Error('Unavailable'); } : undefined,
            });
        }, mode);
        await page.goto('/examples/basic.html');
        const summary = page.locator('.il-card[data-il-uid="persisted:1"] summary');
        await summary.focus();
        await page.keyboard.press('Enter');
        const alt = page.locator('.il-context-panel:visible [data-il-action="update-alt"]');
        await alt.fill('Saved directly from ALT');
        await expect(alt).toBeFocused();
        await page.getByRole('button', { name: 'Save example' }).click();
        await expect(page.locator('[data-example-status]')).toHaveText('Native form data prepared below.');
        const { manifest } = JSON.parse(await page.locator('[data-example-output]').textContent());
        expect(manifest).toHaveLength(1);
        expect(manifest[0]).toMatchObject({ id: 1, source: 'persisted', altText: 'Saved directly from ALT' });
        expect(errors).toEqual([]);
    });
}

for (const images of ['empty', 'persisted']) {
    for (const activation of ['click', 'keyboard']) {
        test(`${images} gallery resumes a real ${activation} submission exactly once`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto('/examples/basic.html');
            await page.evaluate(async images => {
                const { ImageLoader, NativeFormAdapter } = await import('/src/index.js');
                const form = document.createElement('form');
                form.id = 'native-click-form';
                form.innerHTML = '<label>Name<input name="name" required value="Coffee"></label><div data-gallery></div><button type="submit" name="intent" value="save">Submit gallery</button><output></output>';
                document.body.append(form);
                const loader = new ImageLoader(form.querySelector('[data-gallery]'), {
                    images: images === 'empty' ? [] : [{ id: 1, url: '/tests/fixtures/icon-192.png', altText: 'Coffee', primary: true }],
                });
                const observed = { submitEvents: 0, resumed: 0, errors: [], manifest: null, name: null, intent: null };
                window.nativeClickResult = observed;
                form.addEventListener('submit', () => { observed.submitEvents++; }, true);
                new NativeFormAdapter(form, loader);
                form.addEventListener('image-loader:submit-error', event => observed.errors.push(event.detail.error.code));
                form.addEventListener('submit', event => {
                    event.preventDefault();
                    observed.resumed++;
                    const data = new FormData(form, event.submitter);
                    observed.manifest = JSON.parse(data.get('media_manifest'));
                    observed.name = data.get('name');
                    observed.intent = data.get('intent');
                    form.querySelector('output').textContent = 'Prepared';
                });
            }, images);
            const form = page.locator('#native-click-form');
            const submit = form.getByRole('button', { name: 'Submit gallery' });
            if (activation === 'click') await submit.click();
            else {
                await submit.focus();
                await page.keyboard.press('Enter');
            }
            await expect(form.locator('output')).toHaveText('Prepared', { timeout: 2000 });
            expect(await page.evaluate(() => window.nativeClickResult)).toEqual({
                submitEvents: 2, resumed: 1, errors: [], name: 'Coffee', intent: 'save',
                manifest: images === 'empty' ? [] : [{
                    key: 'persisted:1', id: 1, source: 'persisted', position: 0,
                    primary: true, altText: 'Coffee', rotation: 0,
                }],
            });
            await expect(submit).toBeEnabled();
            expect(errors).toEqual([]);
        });
    }
}
