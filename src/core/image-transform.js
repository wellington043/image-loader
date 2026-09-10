import { ImageLoaderError } from './image-loader-error.js';

const normalizeRotation = (value) => {
    const rotation = Number(value ?? 0);
    if (!Number.isInteger(rotation) || rotation % 90 !== 0) {
        throw new ImageLoaderError('invalid-rotation', 'Image rotation must be a multiple of 90 degrees.');
    }

    return ((rotation % 360) + 360) % 360;
};

const scaledDimensions = (width, height, maxDimension) => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new ImageLoaderError('invalid-image-dimensions', 'The image dimensions are invalid.');
    }
    if (maxDimension !== Infinity && (!Number.isFinite(maxDimension) || maxDimension <= 0)) {
        throw new ImageLoaderError('invalid-max-dimension', 'The maximum image dimension must be positive.');
    }

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
};

const outputName = (file) => {
    const sourceName = typeof file?.name === 'string' && file.name.length > 0 ? file.name : 'image';
    const stem = sourceName.replace(/\.[^./\\]+$/, '');
    return `${stem || 'image'}.webp`;
};

const encodeWebp = (canvas, quality) => new Promise((resolve, reject) => {
    if (typeof canvas?.toBlob !== 'function') {
        reject(new ImageLoaderError('canvas-unavailable', 'Canvas WebP encoding is unavailable.'));
        return;
    }

    try {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new ImageLoaderError('output-encoding-failed', 'The image could not be encoded as WebP.'));
                return;
            }
            if (!(blob instanceof Blob) || blob.type !== 'image/webp' || !Number.isFinite(blob.size)) {
                reject(new ImageLoaderError('invalid-output-blob', 'The encoder did not produce a valid WebP Blob.'));
                return;
            }
            resolve(blob);
        }, 'image/webp', quality);
    } catch (error) {
        reject(error instanceof ImageLoaderError
            ? error
            : new ImageLoaderError('output-encoding-failed', 'The image could not be encoded as WebP.', { cause: error }));
    }
});

const defaultImageEnvironment = {
    async load(file) {
        if (typeof globalThis.createImageBitmap === 'function') {
            const image = await globalThis.createImageBitmap(file, { imageOrientation: 'from-image' });
            return {
                image,
                width: image.width,
                height: image.height,
                release() { image.close?.(); },
            };
        }

        if (typeof globalThis.document?.createElement !== 'function' || typeof globalThis.URL?.createObjectURL !== 'function') {
            throw new ImageLoaderError('image-decoding-unavailable', 'Image decoding is unavailable in this environment.');
        }

        const url = globalThis.URL.createObjectURL(file);
        const image = globalThis.document.createElement('img');
        try {
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new ImageLoaderError('image-decode-failed', 'The image could not be decoded.'));
                image.src = url;
            });
        } catch (error) {
            globalThis.URL.revokeObjectURL(url);
            throw error;
        }

        return {
            image,
            width: image.naturalWidth || image.width,
            height: image.naturalHeight || image.height,
            release() {
                image.removeAttribute?.('src');
                globalThis.URL.revokeObjectURL(url);
            },
        };
    },
    createCanvas() {
        if (typeof globalThis.document?.createElement !== 'function') {
            throw new ImageLoaderError('canvas-unavailable', 'Canvas rendering is unavailable in this environment.');
        }
        return globalThis.document.createElement('canvas');
    },
};

export async function transformImageFile(file, {
    rotation = 0,
    maxDimension = Infinity,
    maxOutputFileSize = Infinity,
    quality = 0.86,
} = {}, environment = defaultImageEnvironment) {
    const normalizedRotation = normalizeRotation(rotation);
    let decoded = null;

    try {
        decoded = await environment.load(file);
        const draw = scaledDimensions(decoded.width, decoded.height, maxDimension);
        const swapped = normalizedRotation === 90 || normalizedRotation === 270;
        const canvas = environment.createCanvas();
        canvas.width = swapped ? draw.height : draw.width;
        canvas.height = swapped ? draw.width : draw.height;
        const context = canvas.getContext?.('2d');

        if (!context) {
            throw new ImageLoaderError('canvas-unavailable', 'Canvas rendering is unavailable in this environment.');
        }

        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(normalizedRotation * Math.PI / 180);
        context.drawImage(decoded.image, -draw.width / 2, -draw.height / 2, draw.width, draw.height);

        const blob = await encodeWebp(canvas, quality);
        if (blob.size > maxOutputFileSize) {
            throw new ImageLoaderError('output-too-large', 'The processed image exceeds the configured output limit.');
        }

        return new File([blob], outputName(file), {
            type: 'image/webp',
            lastModified: file?.lastModified ?? Date.now(),
        });
    } catch (error) {
        if (error instanceof ImageLoaderError) {
            throw error;
        }

        throw new ImageLoaderError('image-transform-failed', 'The image could not be processed.', { cause: error });
    } finally {
        try {
            decoded?.release?.();
        } catch {
            // Releasing decoder resources must not hide the original processing result.
        }
    }
}
