const defaultCreateObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL);
const defaultRevokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL);

export class PreviewManager {
    constructor({
        createObjectURL = defaultCreateObjectURL,
        revokeObjectURL = defaultRevokeObjectURL,
    } = {}) {
        this.createObjectURL = createObjectURL;
        this.revokeObjectURL = revokeObjectURL;
        this.ownedUrls = new Set();
    }

    create(file) {
        if (typeof this.createObjectURL !== 'function') {
            throw new Error('URL.createObjectURL is not available.');
        }

        const url = this.createObjectURL(file);
        this.ownedUrls.add(url);
        return url;
    }

    release(url) {
        if (!this.ownedUrls.has(url)) {
            return false;
        }

        this.ownedUrls.delete(url);
        if (typeof this.revokeObjectURL === 'function') {
            this.revokeObjectURL(url);
        }

        return true;
    }

    destroy() {
        for (const url of this.ownedUrls) {
            this.release(url);
        }
    }
}
