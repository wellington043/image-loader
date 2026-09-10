import { ImageLoaderError } from './image-loader-error.js';
import { transformImageFile } from './image-transform.js';

const transformFailure = (error, uid) => {
    if (error instanceof ImageLoaderError) {
        return new ImageLoaderError(error.code, error.message, { uid, cause: error });
    }

    return new ImageLoaderError('image-transform-failed', 'The image could not be processed.', { uid, cause: error });
};

export class ImageSerializer {
    constructor({
        maxDimension = Infinity,
        maxOutputFileSize = Infinity,
        quality = 0.86,
        transform = transformImageFile,
        environment = undefined,
    } = {}) {
        this.maxDimension = maxDimension;
        this.maxOutputFileSize = maxOutputFileSize;
        this.quality = quality;
        this.transform = transform;
        this.environment = environment;
        this.cache = new Map();
    }

    transformOptions(entry) {
        return {
            rotation: entry.rotation,
            maxDimension: this.maxDimension,
            maxOutputFileSize: this.maxOutputFileSize,
            quality: this.quality,
        };
    }

    cacheMatches(cached, entry) {
        return cached.file === entry.file
            && cached.rotation === entry.rotation
            && cached.maxDimension === this.maxDimension
            && cached.maxOutputFileSize === this.maxOutputFileSize
            && cached.quality === this.quality;
    }

    async transformedFile(entry) {
        if (!entry.file) {
            throw new ImageLoaderError('missing-local-file', 'A local image file is required.', { uid: entry.uid });
        }
        if (!entry.uploadKey) {
            throw new ImageLoaderError('missing-upload-key', 'A local image upload key is required.', { uid: entry.uid });
        }

        const cached = this.cache.get(entry.uid);
        if (cached && this.cacheMatches(cached, entry)) {
            return cached.promise;
        }

        const record = {
            file: entry.file,
            rotation: entry.rotation,
            maxDimension: this.maxDimension,
            maxOutputFileSize: this.maxOutputFileSize,
            quality: this.quality,
            promise: null,
        };
        record.promise = Promise.resolve().then(() => this.transform(entry.file, this.transformOptions(entry), this.environment));
        this.cache.set(entry.uid, record);

        try {
            return await record.promise;
        } catch (error) {
            if (this.cache.get(entry.uid) === record) {
                this.cache.delete(entry.uid);
            }
            throw transformFailure(error, entry.uid);
        }
    }

    async serialize(entries) {
        const normalizedEntries = [...entries];
        const uploadKeys = new Set();
        for (const entry of normalizedEntries) {
            if (entry.source !== 'local' || !entry.uploadKey) {
                continue;
            }
            if (uploadKeys.has(entry.uploadKey)) {
                throw new ImageLoaderError('duplicate-upload-key', 'Local image upload keys must be unique.', {
                    uid: entry.uid,
                });
            }
            uploadKeys.add(entry.uploadKey);
        }

        const manifest = [];
        const files = new Map();

        for (const entry of normalizedEntries) {
            if (entry.source === 'local') {
                const file = await this.transformedFile(entry);
                files.set(entry.uploadKey, file);
                manifest.push({
                    key: entry.uid,
                    uploadKey: entry.uploadKey,
                    source: 'local',
                    position: entry.position,
                    primary: entry.primary,
                    altText: entry.altText,
                    rotation: 0,
                });
                continue;
            }

            manifest.push({
                key: entry.uid,
                id: entry.persistedId,
                source: 'persisted',
                position: entry.position,
                primary: entry.primary,
                altText: entry.altText,
                rotation: entry.rotation,
            });
        }

        return { manifest, files };
    }
}
