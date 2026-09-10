import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
    build: {
        sourcemap: true,
        lib: {
            entry: resolve(import.meta.dirname, 'src/index.js'),
            name: 'ImageLoaderLibrary',
            formats: ['es', 'iife'],
            fileName: (format) => format === 'es' ? 'image-loader.js' : 'image-loader.global.js',
            cssFileName: 'image-loader',
        },
    },
});
