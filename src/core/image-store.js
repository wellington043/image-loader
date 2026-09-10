import { ImageLoaderError } from './image-loader-error.js';

const STATUSES = new Set(['ready', 'processing', 'deleting', 'error']);
let generatedUid = 0;

const cloneMutable = (value, seen = new WeakMap()) => {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (seen.has(value)) {
        return seen.get(value);
    }

    const copy = value instanceof Error
        ? new Error(value.message)
        : Array.isArray(value) ? [] : {};
    seen.set(value, copy);

    if (value instanceof Error) {
        copy.name = value.name;
    }
    for (const key of Reflect.ownKeys(value)) {
        if (value instanceof Error && (key === 'message' || key === 'stack')) {
            continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if ('value' in descriptor) {
            descriptor.value = cloneMutable(descriptor.value, seen);
        }
        Object.defineProperty(copy, key, descriptor);
    }

    return copy;
};

const createLocalUid = () => {
    if (globalThis.crypto?.randomUUID) {
        return `local:${globalThis.crypto.randomUUID()}`;
    }

    generatedUid += 1;
    return `local:${Date.now().toString(36)}-${generatedUid.toString(36)}`;
};

const normalizeRotation = (value, uid = null) => {
    const degrees = Number(value ?? 0);
    if (!Number.isInteger(degrees) || degrees % 90 !== 0) {
        throw new ImageLoaderError(
            'invalid-rotation',
            'Image rotation must be a multiple of 90 degrees.',
            { uid },
        );
    }

    return ((degrees % 360) + 360) % 360;
};

const normalizeStatus = (status, uid = null) => {
    if (!STATUSES.has(status)) {
        throw new ImageLoaderError(
            'invalid-status',
            `Unknown image status: ${String(status)}.`,
            { uid },
        );
    }

    return status;
};

const publicCopy = ({ file: _file, error, ...item }) => ({
    ...item,
    error: cloneMutable(error),
});

export class ImageStore {
    constructor({ images = [], maxFiles = Infinity } = {}) {
        if (!Number.isInteger(maxFiles) && maxFiles !== Infinity) {
            throw new ImageLoaderError('invalid-max-files', 'maxFiles must be a non-negative integer.');
        }
        if (maxFiles < 0) {
            throw new ImageLoaderError('invalid-max-files', 'maxFiles must be a non-negative integer.');
        }
        if (!Array.isArray(images)) {
            throw new ImageLoaderError('invalid-images', 'images must be an array.');
        }
        if (images.length > maxFiles) {
            throw new ImageLoaderError('max-files-exceeded', 'The image limit has been exceeded.');
        }

        this.maxFiles = maxFiles;
        this.items = images.map((item, index) => this.normalizeItem(item, index));
        if (new Set(this.items.map((item) => item.uid)).size !== this.items.length) {
            throw new ImageLoaderError('duplicate-uid', 'Image uids must be unique.');
        }
        this.normalize();
    }

    normalizeItem(item, fallbackPosition = this.items?.length ?? 0) {
        if (!item || typeof item !== 'object') {
            throw new ImageLoaderError('invalid-image', 'Each image must be an object.');
        }

        const explicitSource = item.source === 'local' || item.source === 'persisted'
            ? item.source
            : null;
        const hasPersistedId = (item.persistedId !== undefined && item.persistedId !== null)
            || (item.id !== undefined && item.id !== null);
        const source = explicitSource ?? (hasPersistedId ? 'persisted' : 'local');
        const persistedId = source === 'persisted'
            ? (item.persistedId ?? item.id ?? null)
            : null;
        const uploadKey = source === 'local' ? (item.uploadKey ?? null) : null;
        const uid = String(item.uid ?? (
            source === 'persisted' && persistedId !== null
                ? `persisted:${persistedId}`
                : uploadKey
                    ? `local:${uploadKey}`
                    : createLocalUid()
        ));
        const position = Number.isFinite(item.position) ? item.position : fallbackPosition;

        return {
            uid,
            persistedId,
            uploadKey,
            source,
            file: item.file ?? null,
            previewUrl: item.previewUrl ?? item.url ?? null,
            altText: item.altText ?? '',
            rotation: normalizeRotation(item.rotation, uid),
            primary: Boolean(item.primary ?? item.isPrimary),
            position,
            status: normalizeStatus(item.status ?? 'ready', uid),
            error: cloneMutable(item.error ?? null),
        };
    }

    normalize() {
        this.items.sort((a, b) => a.position - b.position || a.uid.localeCompare(b.uid));
        this.items.forEach((item, position) => { item.position = position; });
        const selected = this.items.find((item) => item.primary) ?? this.items[0] ?? null;
        this.items.forEach((item) => { item.primary = item === selected; });
    }

    find(uid) {
        const item = this.items.find((candidate) => candidate.uid === uid);
        if (!item) {
            throw new ImageLoaderError('image-not-found', `Image not found: ${String(uid)}.`, { uid });
        }

        return item;
    }

    assertEditable(item) {
        if (item.status === 'processing' || item.status === 'deleting') {
            throw new ImageLoaderError(
                'image-busy',
                'This image cannot be changed while it is busy.',
                { uid: item.uid },
            );
        }
    }

    assertNoBusy() {
        const busy = this.items.find((item) => item.status === 'processing' || item.status === 'deleting');
        if (busy) {
            throw new ImageLoaderError(
                'image-busy',
                'Images cannot be changed while one of them is busy.',
                { uid: busy.uid },
            );
        }
    }

    snapshot() {
        return this.items.map(publicCopy);
    }

    snapshotOf(uid) {
        return publicCopy(this.find(uid));
    }

    entries() {
        return this.items.map((item) => ({ ...item }));
    }

    add(item) {
        this.assertNoBusy();
        if (this.items.length >= this.maxFiles) {
            throw new ImageLoaderError('max-files-exceeded', 'The image limit has been exceeded.');
        }

        const normalized = this.normalizeItem(item);
        if (this.items.some((candidate) => candidate.uid === normalized.uid)) {
            throw new ImageLoaderError('duplicate-uid', `Image uid already exists: ${normalized.uid}.`, {
                uid: normalized.uid,
            });
        }

        normalized.position = this.items.length;
        this.items.push(normalized);
        this.normalize();
        return this.snapshotOf(normalized.uid);
    }

    remove(uid) {
        const item = this.find(uid);
        this.assertNoBusy();

        this.items = this.items.filter((candidate) => candidate !== item);
        this.normalize();
        return publicCopy(item);
    }

    removeAfterPersistedDeletion(uid) {
        const item = this.find(uid);
        if (item.source !== 'persisted' || item.status !== 'deleting') {
            throw new ImageLoaderError(
                'invalid-deletion-state',
                'Only a deleting persisted image can complete deletion.',
                { uid },
            );
        }
        const otherBusy = this.items.find((candidate) => (
            candidate !== item && (candidate.status === 'processing' || candidate.status === 'deleting')
        ));
        if (otherBusy) {
            throw new ImageLoaderError(
                'image-busy',
                'Images cannot be changed while one of them is busy.',
                { uid: otherBusy.uid },
            );
        }

        this.items = this.items.filter((candidate) => candidate !== item);
        this.normalize();
        return publicCopy(item);
    }

    move(uid, position) {
        const item = this.find(uid);
        this.assertEditable(item);
        this.assertNoBusy();
        if (!Number.isInteger(position)) {
            throw new ImageLoaderError('invalid-position', 'Image position must be an integer.', { uid });
        }

        const currentIndex = this.items.indexOf(item);
        this.items.splice(currentIndex, 1);
        const destination = Math.max(0, Math.min(position, this.items.length));
        this.items.splice(destination, 0, item);
        this.items.forEach((candidate, index) => { candidate.position = index; });
        this.normalize();
        return this.snapshotOf(uid);
    }

    rotate(uid, deltaDegrees) {
        const item = this.find(uid);
        this.assertEditable(item);
        const delta = normalizeRotation(deltaDegrees, uid);
        item.rotation = normalizeRotation(item.rotation + delta, uid);
        return this.snapshotOf(uid);
    }

    setPrimary(uid) {
        const item = this.find(uid);
        this.assertEditable(item);
        this.assertNoBusy();
        this.items.forEach((candidate) => { candidate.primary = candidate === item; });
        this.normalize();
        return this.snapshotOf(uid);
    }

    updateAltText(uid, value) {
        const item = this.find(uid);
        this.assertEditable(item);
        item.altText = value ?? '';
        return this.snapshotOf(uid);
    }

    setStatus(uid, status, error = null) {
        const item = this.find(uid);
        item.status = normalizeStatus(status, uid);
        item.error = status === 'error' ? cloneMutable(error) : null;
        return this.snapshotOf(uid);
    }
}
