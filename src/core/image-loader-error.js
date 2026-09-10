export class ImageLoaderError extends Error {
    constructor(code, message, { uid = null, cause = null } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = 'ImageLoaderError';
        this.code = code;
        this.uid = uid;
    }
}
