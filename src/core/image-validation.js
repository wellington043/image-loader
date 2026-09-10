const DEFAULT_ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

const REJECTION_MESSAGE_KEYS = {
    'duplicate-file': 'errors.duplicateFile',
    'invalid-type': 'errors.invalidType',
    'source-too-large': 'errors.sourceTooLarge',
    'max-files-exceeded': 'errors.maxFiles',
};

export const fileSignature = (file) => `${file.name}\u0000${file.size}\u0000${file.lastModified}`;

const normalizeAccept = (accept) => {
    const values = Array.isArray(accept) ? accept : [accept];

    return values
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
};

const acceptsType = (file, acceptedTypes) => acceptedTypes.some((acceptedType) => (
    acceptedType === file.type.toLowerCase()
    || (acceptedType.endsWith('/*') && file.type.toLowerCase().startsWith(`${acceptedType.slice(0, -1)}`))
));

const rejection = (file, code) => ({
    file,
    code,
    messageKey: REJECTION_MESSAGE_KEYS[code],
});

export function validateFiles(files, {
    accept = DEFAULT_ACCEPT,
    currentItems = [],
    maxFiles = Infinity,
    maxSourceFileSize = Infinity,
} = {}) {
    const accepted = [];
    const rejected = [];
    const acceptedTypes = normalizeAccept(accept);
    const signatures = new Set(
        currentItems
            .map((item) => item?.file)
            .filter(Boolean)
            .map(fileSignature),
    );
    const availableSlots = Math.max(0, maxFiles - currentItems.length);

    for (const file of files) {
        const signature = fileSignature(file);
        if (signatures.has(signature)) {
            rejected.push(rejection(file, 'duplicate-file'));
            continue;
        }
        signatures.add(signature);

        if (!acceptsType(file, acceptedTypes)) {
            rejected.push(rejection(file, 'invalid-type'));
            continue;
        }

        if (file.size > maxSourceFileSize) {
            rejected.push(rejection(file, 'source-too-large'));
            continue;
        }

        if (accepted.length >= availableSlots) {
            rejected.push(rejection(file, 'max-files-exceeded'));
            continue;
        }

        accepted.push(file);
    }

    return { accepted, rejected };
}
