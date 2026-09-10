import { ConfirmationDialog } from './browser/confirmation-dialog.js';
import { PreviewManager } from './browser/preview-manager.js';
import { Renderer } from './browser/renderer.js';
import { ReorderController } from './browser/reorder-controller.js';
import { ImageLoaderError } from './core/image-loader-error.js';
import { ImageSerializer } from './core/image-serializer.js';
import { ImageStore } from './core/image-store.js';
import { validateFiles } from './core/image-validation.js';
import { en } from './locales/en.js';
import { ptBR } from './locales/pt-BR.js';

const DEFAULT_ACCEPT = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
let uploadCounter = 0;

const isDictionary = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const clone = (value) => {
    if (Array.isArray(value)) {
        return value.map(clone);
    }
    if (isDictionary(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
    }
    return value;
};

const invalidOption = (code, message) => {
    throw new ImageLoaderError(code, message);
};

const normalizeAccept = (accept) => {
    if (!Array.isArray(accept) || accept.length === 0 || accept.some((type) => typeof type !== 'string' || !type.trim())) {
        invalidOption('invalid-accept', 'ImageLoader accept must be a non-empty array of MIME types.');
    }
    return accept.map((type) => type.trim());
};

const normalizeMaxFiles = (maxFiles) => {
    if (maxFiles === Infinity) {
        return maxFiles;
    }
    if (!Number.isInteger(maxFiles) || maxFiles < 1) {
        invalidOption('invalid-max-files', 'ImageLoader maxFiles must be a positive integer.');
    }
    return maxFiles;
};

const normalizeLimit = (value, code, label) => {
    if (value === Infinity) {
        return value;
    }
    if (!Number.isFinite(value) || value <= 0) {
        invalidOption(code, `ImageLoader ${label} must be a positive number.`);
    }
    return value;
};

const normalizeDimension = (value) => {
    if (value === Infinity) {
        return value;
    }
    if (!Number.isInteger(value) || value < 1) {
        invalidOption('invalid-max-dimension', 'ImageLoader maxDimension must be a positive integer.');
    }
    return value;
};

const invalidLocale = (message) => invalidOption('invalid-locale', message);

const validateLocaleShape = (dictionary, schema, path = 'locale') => {
    for (const [key, schemaValue] of Object.entries(schema)) {
        const value = dictionary[key];
        const keyPath = `${path}.${key}`;
        if (isDictionary(schemaValue)) {
            if (!isDictionary(value)) {
                invalidLocale(`ImageLoader locale key ${keyPath} must be an object.`);
            }
            validateLocaleShape(value, schemaValue, keyPath);
            continue;
        }
        if (typeof value !== 'string') {
            invalidLocale(`ImageLoader locale key ${keyPath} must be a string.`);
        }
    }
};

const mergeLocale = (base, override, path = 'locale') => {
    const merged = clone(base);
    for (const [key, value] of Object.entries(override)) {
        const keyPath = `${path}.${key}`;
        if (!Object.prototype.hasOwnProperty.call(base, key)) {
            invalidLocale(`ImageLoader locale key ${keyPath} is not supported.`);
        }
        if (isDictionary(base[key])) {
            if (!isDictionary(value)) {
                invalidLocale(`ImageLoader locale key ${keyPath} must be an object.`);
            }
            merged[key] = mergeLocale(base[key], value, keyPath);
            continue;
        }
        if (typeof value !== 'string') {
            invalidLocale(`ImageLoader locale key ${keyPath} must be a string.`);
        }
        merged[key] = value;
    }
    return merged;
};

const createUploadKey = () => {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    uploadCounter += 1;
    return `${Date.now().toString(36)}-${uploadCounter.toString(36)}`;
};

const localeFor = (locale) => {
    let dictionary;
    if (locale === undefined || locale === 'en') {
        dictionary = clone(en);
    } else if (locale === 'pt-BR') {
        dictionary = clone(ptBR);
    } else if (isDictionary(locale)) {
        dictionary = mergeLocale(en, locale);
    } else {
        invalidLocale('The image loader locale must be a supported key or dictionary.');
    }
    validateLocaleShape(dictionary, en);
    return dictionary;
};

const elementConstructorFor = (target) => target?.ownerDocument?.defaultView?.Element ?? globalThis.Element;

const format = (template, values) => template.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ''));

const normalizeOptions = (options) => {
    const configured = {
        images: [],
        accept: DEFAULT_ACCEPT,
        maxFiles: Infinity,
        maxSourceFileSize: Infinity,
        maxOutputFileSize: Infinity,
        maxDimension: Infinity,
        quality: 0.86,
        ...options,
    };
    configured.accept = normalizeAccept(configured.accept);
    configured.maxFiles = normalizeMaxFiles(configured.maxFiles);
    configured.maxSourceFileSize = normalizeLimit(
        configured.maxSourceFileSize,
        'invalid-max-source-file-size',
        'maxSourceFileSize',
    );
    configured.maxOutputFileSize = normalizeLimit(
        configured.maxOutputFileSize,
        'invalid-max-output-file-size',
        'maxOutputFileSize',
    );
    configured.maxDimension = normalizeDimension(configured.maxDimension);
    if (!Number.isFinite(configured.quality) || configured.quality <= 0 || configured.quality > 1) {
        invalidOption('invalid-quality', 'ImageLoader quality must be a number greater than 0 and no greater than 1.');
    }
    if (configured.deletePersistedImage !== undefined && typeof configured.deletePersistedImage !== 'function') {
        invalidOption('invalid-delete-handler', 'ImageLoader deletePersistedImage must be a function.');
    }
    if (configured.confirmDelete !== undefined && typeof configured.confirmDelete !== 'function') {
        invalidOption('invalid-confirm-handler', 'ImageLoader confirmDelete must be a function.');
    }
    return configured;
};

export class ImageLoader {
    constructor(target, options = {}) {
        const ElementConstructor = elementConstructorFor(target);
        if (typeof ElementConstructor !== 'function' || !(target instanceof ElementConstructor)) {
            throw new ImageLoaderError('invalid-target', 'ImageLoader requires a DOM Element target.');
        }
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new ImageLoaderError('invalid-options', 'ImageLoader options must be an object.');
        }

        this.options = normalizeOptions(options);
        this.labels = localeFor(this.options.locale);
        this.events = new Map();
        this.validationMessages = [];
        this.destroyed = false;
        this.generation = 0;
        this.dirty = false;
        this.deleteControllers = new Map();
        this.deleteOperations = new Map();
        this.store = new ImageStore({
            images: this.options.images,
            maxFiles: this.options.maxFiles,
        });
        this.previews = new PreviewManager();
        this.serializer = new ImageSerializer({
            maxDimension: this.options.maxDimension,
            maxOutputFileSize: this.options.maxOutputFileSize,
            quality: this.options.quality,
        });
        this.renderer = new Renderer({
            target,
            labels: this.labels,
            accept: this.options.accept,
            onAction: (action, uid, control) => this.handleAction(action, uid, control),
            onFiles: (files) => this.handleFiles(files),
        });
        this.confirmationDialog = new ConfirmationDialog({
            document: target.ownerDocument,
            labels: this.labels.dialog,
        });
        this.reorder = new ReorderController({
            root: this.renderer.root,
            liveRegion: this.renderer.liveRegion,
            getItems: () => this.getItems(),
            move: ({ uid, position }) => this.move(uid, position),
            announce: (position) => format(this.labels.messages.imageMoved, { position }),
        });
        this.render();
    }

    on(event, listener) {
        this.assertAlive();
        if (typeof listener !== 'function') {
            throw new ImageLoaderError('invalid-listener', 'ImageLoader listeners must be functions.');
        }
        const listeners = this.events.get(event) ?? new Set();
        listeners.add(listener);
        this.events.set(event, listeners);
        return () => this.off(event, listener);
    }

    off(event, listener) {
        this.assertAlive();
        const listeners = this.events.get(event);
        if (!listeners) {
            return false;
        }
        const removed = listeners.delete(listener);
        if (listeners.size === 0) {
            this.events.delete(event);
        }
        return removed;
    }

    emit(event, payload) {
        for (const listener of this.events.get(event) ?? []) {
            listener(payload);
        }
    }

    getItems() {
        return this.store.snapshot();
    }

    isDirty() {
        return this.dirty;
    }

    isBusy() {
        return this.getItems().some((item) => item.status === 'processing' || item.status === 'deleting');
    }

    assertAlive() {
        if (this.destroyed) {
            throw new ImageLoaderError('instance-destroyed', 'This ImageLoader instance has been destroyed.');
        }
    }

    assertMutable() {
        this.assertAlive();
        if (this.isBusy()) {
            throw new ImageLoaderError('image-busy', 'Images cannot be changed while one is busy.');
        }
    }

    assertCurrentGeneration(generation) {
        if (this.destroyed || generation !== this.generation) {
            throw new ImageLoaderError('instance-destroyed', 'This ImageLoader instance has been destroyed.');
        }
    }

    render() {
        if (this.destroyed) {
            return;
        }
        this.renderer.render({
            items: this.getItems(),
            maxFiles: this.options.maxFiles,
            busy: this.isBusy(),
            messages: this.validationMessages,
        });
    }

    emitChange() {
        this.emit('change', { items: this.getItems() });
    }

    markChanged(event, item) {
        this.dirty = true;
        this.render();
        if (event) {
            this.emit(event, { item });
        }
        this.emitChange();
    }

    addFiles(files) {
        this.assertMutable();
        const result = validateFiles(Array.from(files ?? []), {
            accept: this.options.accept,
            currentItems: this.store.entries(),
            maxFiles: this.options.maxFiles,
            maxSourceFileSize: this.options.maxSourceFileSize,
        });
        const added = [];
        for (const file of result.accepted) {
            let previewUrl = null;
            try {
                previewUrl = this.previews.create(file);
                const item = this.store.add({
                    source: 'local',
                    file,
                    uploadKey: createUploadKey(),
                    previewUrl,
                });
                added.push(item);
            } catch (error) {
                this.previews.release(previewUrl);
                throw error;
            }
        }
        this.validationMessages = result.rejected.map((rejection) => (
            this.labels.errors[rejection.messageKey?.split('.').at(-1)] ?? this.labels.errors.unknown
        ));
        this.render();
        for (const item of added) {
            this.emit('image:added', { item });
        }
        for (const rejection of result.rejected) {
            this.emit('validation:error', { rejection });
        }
        if (added.length) {
            this.dirty = true;
            this.emitChange();
        }
        return result;
    }

    remove(uid, trigger = null) {
        this.assertAlive();
        const pending = this.deleteOperations.get(uid);
        if (pending) {
            return pending;
        }
        this.assertMutable();
        const item = this.store.snapshotOf(uid);
        if (item.source === 'persisted') {
            if (!this.options.deletePersistedImage) {
                return Promise.reject(new ImageLoaderError(
                    'missing-delete-handler',
                    'Persisted images require a deletion handler.',
                    { uid },
                ));
            }
            const operation = this.removePersisted(item, trigger);
            this.deleteOperations.set(uid, operation);
            void operation.then(
                () => this.clearDeleteOperation(uid, operation),
                () => this.clearDeleteOperation(uid, operation),
            );
            return operation;
        }
        const removed = this.store.remove(uid);
        this.previews.release(removed.previewUrl);
        this.markChanged();
        this.renderer.focusAfterRemoval(removed.position);
        return removed;
    }

    clearDeleteOperation(uid, operation) {
        if (this.deleteOperations.get(uid) === operation) {
            this.deleteOperations.delete(uid);
        }
    }

    async confirmPersistedDeletion(item, trigger) {
        const decision = this.options.confirmDelete
            ? await this.options.confirmDelete(item)
            : await this.confirmationDialog.confirm(item, trigger);
        if (typeof decision !== 'boolean') {
            throw new ImageLoaderError(
                'invalid-confirm-result',
                'ImageLoader confirmDelete must resolve to a boolean.',
                { uid: item.uid },
            );
        }
        return decision;
    }

    async removePersisted(item, trigger) {
        const confirmed = await this.confirmPersistedDeletion(item, trigger);
        if (!confirmed) {
            return false;
        }
        this.assertMutable();
        const current = this.store.snapshotOf(item.uid);
        const generation = this.generation;
        const controller = new AbortController();
        this.deleteControllers.set(item.uid, controller);
        this.store.setStatus(item.uid, 'deleting');
        this.render();
        try {
            this.emit('delete:start', { item: this.store.snapshotOf(item.uid) });
            this.assertCurrentGeneration(generation);
            if (controller.signal.aborted) {
                throw new ImageLoaderError('instance-destroyed', 'This ImageLoader instance has been destroyed.');
            }
            await this.options.deletePersistedImage(current, { signal: controller.signal });
            this.assertCurrentGeneration(generation);
        } catch (cause) {
            if (!this.destroyed && generation === this.generation) {
                this.store.setStatus(item.uid, 'error', cause);
                this.render();
                this.emit('delete:error', { item: current, error: cause });
                this.renderer.focusControl(item.uid, 'remove');
            }
            throw cause;
        } finally {
            if (this.deleteControllers.get(item.uid) === controller) {
                this.deleteControllers.delete(item.uid);
            }
        }
        const removed = this.store.removeAfterPersistedDeletion(item.uid);
        this.dirty = true;
        this.render();
        this.emit('delete:success', { item: current });
        this.emitChange();
        this.renderer.focusAfterRemoval(removed.position);
        return removed;
    }

    rotate(uid, degrees) {
        this.assertMutable();
        const before = this.store.snapshotOf(uid);
        const item = this.store.rotate(uid, degrees);
        if (item.rotation !== before.rotation) {
            this.markChanged('image:updated', item);
        }
        return item;
    }

    move(uid, position) {
        this.assertMutable();
        const before = this.store.snapshotOf(uid);
        const item = this.store.move(uid, position);
        if (item.position !== before.position) {
            this.markChanged('image:updated', item);
            this.renderer.focusControl(uid, 'reorder');
        }
        return item;
    }

    setPrimary(uid) {
        this.assertMutable();
        const before = this.store.snapshotOf(uid);
        const item = this.store.setPrimary(uid);
        if (item.primary !== before.primary) {
            this.markChanged('image:updated', item);
            this.renderer.focusControl(uid, 'rotate-left');
        }
        return item;
    }

    updateAltText(uid, value) {
        this.assertMutable();
        const before = this.store.snapshotOf(uid);
        const item = this.store.updateAltText(uid, value);
        if (item.altText !== before.altText) {
            this.markChanged('image:updated', item);
        }
        return item;
    }

    handleAction(action, uid, control) {
        if (action === 'set-primary') {
            this.setPrimary(uid);
            return;
        }
        if (action === 'rotate-left') {
            this.rotate(uid, -90);
            this.renderer.focusControl(uid, action);
            return;
        }
        if (action === 'rotate-right') {
            this.rotate(uid, 90);
            this.renderer.focusControl(uid, action);
            return;
        }
        if (action === 'move-left' || action === 'move-right') {
            if (this.reorder.moveByButton(uid, action === 'move-left' ? -1 : 1)) {
                this.renderer.focusControl(uid, action);
            }
            return;
        }
        if (action === 'remove') {
            const result = this.remove(uid, control);
            if (typeof result?.then === 'function') {
                void result.catch(() => {});
            }
            return;
        }
        if (action === 'update-alt') {
            this.updateAltText(uid, control.value);
        }
    }

    handleFiles(files) {
        try {
            this.addFiles(files);
        } catch (error) {
            this.validationMessages = [error.message];
            this.render();
        }
    }

    async serialize() {
        this.assertAlive();
        if (this.isBusy()) {
            const error = new ImageLoaderError('image-busy', 'Images cannot be serialized while one is busy.');
            this.emit('submit:blocked', { error });
            throw error;
        }
        const localItems = this.store.entries().filter((item) => item.source === 'local');
        const generation = this.generation;
        for (const item of localItems) {
            this.store.setStatus(item.uid, 'processing');
        }
        this.render();
        try {
            const serialized = await this.serializer.serialize(this.store.entries());
            this.assertCurrentGeneration(generation);
            for (const item of localItems) {
                this.store.setStatus(item.uid, 'ready');
            }
            this.render();
            return serialized;
        } catch (error) {
            this.assertCurrentGeneration(generation);
            for (const item of localItems) {
                this.store.setStatus(item.uid, item.uid === error.uid ? 'error' : 'ready', item.uid === error.uid ? error : null);
            }
            this.render();
            throw error;
        }
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.generation += 1;
        for (const controller of this.deleteControllers.values()) {
            controller.abort();
        }
        this.deleteControllers.clear();
        this.deleteOperations.clear();
        this.confirmationDialog.destroy();
        this.reorder.destroy();
        this.renderer.destroy();
        this.previews.destroy();
        this.serializer.cache.clear();
        this.events.clear();
    }
}
