import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    testMatch: ['image-loader.spec.mjs', 'native-form-click.spec.mjs'],
    outputDir: './node_modules/.playwright-test-results',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        browserName: 'chromium',
    },
    webServer: {
        command: 'npx vite --host 127.0.0.1 --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173/examples/basic.html',
        reuseExistingServer: !process.env.CI,
    },
});
