import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('publishes a versioned API and build contract without runtime dependencies', async () => {
    const entrypoint = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
    assert.match(entrypoint, /^import '\.\/styles\/image-loader\.css';$/m);
    assert.match(entrypoint, /export \{ NativeFormAdapter \} from '\.\/browser\/native-form-adapter\.js';/);

    const manifest = await import('../package.json', { with: { type: 'json' } });
    const exportedVersion = entrypoint.match(/export const VERSION = '([^']+)';/)?.[1];

    assert.equal(exportedVersion, manifest.default.version);
    assert.deepEqual(manifest.default.dependencies ?? {}, {});
    assert.deepEqual(manifest.default.exports, {
        '.': { import: './dist/image-loader.js' },
        './global': './dist/image-loader.global.js',
        './styles.css': './dist/image-loader.css',
    });
});
