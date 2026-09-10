# Image Loader

![CI](https://github.com/wellington043/image-loader/actions/workflows/ci.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

`@wellington043/image-loader` is a framework-free browser gallery for persisted and local images. It validates selection, keeps one ordered primary image, supports accessible reordering and confirmation, converts local files to WebP on serialization, and can add that result to a native form submission.

Version `0.1.0` is the first public preview. Pin a tag or commit when using it in production.

## Installation

Until the package is published to npm, install it directly from GitHub:

```sh
npm install github:wellington043/image-loader#main
```

After the first release is tagged, pin that version instead of following `main`:

```sh
npm install github:wellington043/image-loader#v0.1.0
```

The repository's `prepare` script builds `dist/` during a Git dependency installation. After a future npm publication, the equivalent command will be:

```sh
npm install @wellington043/image-loader
```

For local development, clone the repository and install its independent toolchain:

```sh
git clone https://github.com/wellington043/image-loader.git
cd image-loader
npm ci
npm test
npm run test:browser
npm run build
npm pack --dry-run
```

The build writes ESM, global IIFE, CSS and source maps to `dist/`. The package has no runtime npm dependencies.

`examples/basic.html` is the source ESM demo and must be served by Vite:

```sh
npm exec vite -- --host 127.0.0.1
```

After building, `examples/standalone.html` can also be opened directly as a local file. It uses the generated IIFE and CSS without imports or a backend. Its saved-image deletion is deliberately a local mock.

## Bundler usage

Import the ESM entry and CSS in a browser bundle:

```js
import { ImageLoader, NativeFormAdapter } from '@wellington043/image-loader';
import '@wellington043/image-loader/styles.css';

const form = document.querySelector('#product-form');
const loader = new ImageLoader(document.querySelector('#product-images'), {
    locale: 'en',
    maxFiles: 6,
    images: [{
        id: 12,
        url: '/media/12.webp',
        altText: 'Front of the grinder',
        position: 0,
        primary: true,
    }],
    deletePersistedImage: async (item, { signal }) => {
        const response = await fetch(`/media/${item.persistedId}`, {
            method: 'DELETE',
            signal,
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
            throw new Error('The persisted image could not be removed.');
        }
    },
});

const formAdapter = new NativeFormAdapter(form, loader);
form.addEventListener('image-loader:submit-error', ({ detail }) => {
    document.querySelector('#form-error').textContent = detail.error.message;
});

form.addEventListener('submit', (event) => {
    // This listener runs after local images were prepared on the resumed native submit.
    // Remove this line in an application that should navigate to its form action.
    event.preventDefault();
    console.log(new FormData(form));
});

window.addEventListener('pagehide', () => {
    formAdapter.destroy();
    loader.destroy();
}, { once: true });
```

`examples/basic.html` is a complete runnable variant of this setup. Run `npm exec vite -- --host 127.0.0.1` and open the example through that server.

## Direct `<script>` usage

Build first, then serve the generated files with your site. The IIFE exposes `ImageLoaderLibrary`:

```html
<link rel="stylesheet" href="./dist/image-loader.css">
<script src="./dist/image-loader.global.js"></script>
<script>
    const { ImageLoader, NativeFormAdapter } = window.ImageLoaderLibrary;
    const loader = new ImageLoader(document.querySelector('#images'));
    const adapter = new NativeFormAdapter(document.querySelector('form'), loader);
</script>
```

The ESM build is `dist/image-loader.js`; the global build is `dist/image-loader.global.js`.

## Options

Pass an options object as the second argument to `new ImageLoader(target, options)`.

| Option | Default | Purpose |
| --- | --- | --- |
| `images` | `[]` | Initial persisted or local item data. |
| `accept` | JPEG, PNG and WebP MIME types | MIME types accepted by the file chooser and validator. |
| `maxFiles` | `Infinity` | Positive maximum number of images. |
| `maxSourceFileSize` | `Infinity` | Maximum original file size in bytes. |
| `maxOutputFileSize` | `Infinity` | Maximum processed WebP size in bytes. |
| `maxDimension` | `Infinity` | Longest output-side length in pixels. |
| `quality` | `0.86` | WebP encoder quality from greater than `0` through `1`. |
| `locale` | `en` | `'en'`, `'pt-BR'`, or a supported partial locale dictionary. |
| `deletePersistedImage` | none | Required async callback before a persisted image can be removed. |
| `confirmDelete` | built-in dialog | Async callback that resolves to `true` or `false` before persisted deletion. |

## Item shape

Persisted images can use `id` or `persistedId`; their `url` becomes the preview URL:

```js
{
    id: 12,
    url: '/media/12.webp',
    altText: 'Front of the grinder',
    position: 0,
    primary: true,
    rotation: 0,
}
```

Local items are normally created through `loader.addFiles(files)`. A serialized item is one of:

```js
// persisted
{ key: 'persisted:12', id: 12, source: 'persisted', position: 0, primary: true, altText: '', rotation: 90 }

// local
{ key: 'local:...', uploadKey: '...', source: 'local', position: 1, primary: false, altText: '', rotation: 0 }
```

`serialize()` returns `{ manifest, files }`. `files` is a `Map` keyed by the local item `uploadKey`; local rotation is already baked into its WebP file.

## Methods

| Method | Result |
| --- | --- |
| `addFiles(files)` | Validates and adds a `FileList` or iterable of files. |
| `remove(uid, trigger?)` | Removes a local item immediately, or confirms and removes a persisted item asynchronously. |
| `move(uid, position)` | Moves an item to its zero-based position. |
| `rotate(uid, degrees)` | Rotates by a multiple of 90 degrees. |
| `setPrimary(uid)` | Makes one item primary. |
| `updateAltText(uid, value)` | Updates alternative text. |
| `getItems()` | Returns detached item snapshots. |
| `isDirty()` / `isBusy()` | Report local edits and processing/deletion state. |
| `serialize()` | Produces the manifest and keyed processed files. |
| `on(event, listener)` / `off(event, listener)` | Register or remove an event listener. `on` returns an unsubscribe function. |
| `destroy()` | Releases object URLs, listeners and dialog resources. It is idempotent. |

## Events

`ImageLoader` emits these events through `on`:

| Event | Payload |
| --- | --- |
| `change` | `{ items }` after an effective gallery change. |
| `image:added` | `{ item }` for each accepted local file. |
| `image:updated` | `{ item }` after rotation, movement, primary or alt-text changes. |
| `validation:error` | `{ rejection }` for each rejected input file. |
| `delete:start` | `{ item }` before the persisted delete callback. |
| `delete:success` | `{ item }` after a persisted delete succeeds. |
| `delete:error` | `{ item, error }` if it fails. |
| `submit:blocked` | `{ error }` when `serialize()` is called while the loader is busy. |

## Native forms

`NativeFormAdapter` preserves the original browser submit path. On the first valid submit it prevents the event, disables submit controls, awaits `loader.serialize()`, then invokes `form.requestSubmit(originalSubmitter)`. The resumed submit uses ordinary browser validation and listeners.

During the resumed submission, its synchronous `formdata` listener appends:

```text
media_manifest              JSON array from serialize().manifest
media_files[<uploadKey>]    File from serialize().files
```

These field names are fixed. The adapter never fetches the form, and it does not submit partial media when preparation fails or the loader is busy. In either case it restores the original disabled state of each submit control, exposes the error as `adapter.lastError`, and dispatches `image-loader:submit-error` on the form with `{ detail: { error } }`.

Destroy the adapter before the loader. After `destroy()`, its form listeners are removed and it will not resume a pending preparation.

## Custom deletion

Persisted deletion is deliberately non-optimistic. Supply an async `deletePersistedImage(item, { signal })` callback; the card stays visible until that callback resolves. A rejected callback leaves the card editable with its error state. The built-in accessible confirmation dialog is used unless `confirmDelete(item)` resolves to an explicit boolean.

Use the supplied `AbortSignal` in network requests. `loader.destroy()` aborts outstanding persisted deletions.

## Compact gallery controls

The gallery wraps fixed 180px square cards and a trailing camera tile; one image does not expand to fill the form. Tiles remain bounded by the container, so narrow screens wrap without horizontal overflow. The camera opens the regular file chooser, not a webcam. It disappears at the file limit and returns when a slot opens. Selection instructions remain available to assistive technology and validation errors remain visible above the gallery.

Rotate/remove controls and the drag grip overlay the preview without moving neighboring cards. Desktop hover or keyboard focus reveals the controls, including the details icon. Touch/no-hover devices show only the details affordance at rest; tapping the preview focuses that card and reveals its actions without opening a panel. The details icon opens a small contextual panel for primary selection, opposite rotation, keyboard ordering and alternative text. Escape returns focus to its trigger; an outside pointer interaction closes it without stealing focus. Busy operations disable mutation controls and remove the details trigger from sequential keyboard navigation.

The editor uses the native popover top layer when available. If that API is absent or fails, it mounts a temporary scoped portal outside the gallery's clipping/transform host, under `document.body` or the enclosing open native dialog (so a modal does not make it inert). It copies the gallery's computed `--il-*` tokens and inherited font/direction when opening and clamps the panel to the viewport. Closing, rerendering or destroying the loader removes the portal and its delegated listeners. In either branch the trigger references its editor through `aria-controls`.

The four 44px overlay controls sit in separate corners: grip top-left, options top-right, clockwise rotation bottom-left and remove bottom-right. Only these controls use a modest glass surface (86% inherited surface tint and 8px backdrop blur); icons stay opaque, and text panels/dialogs remain solid. Without backdrop-filter support, or with reduced transparency/forced colors, the controls use solid backgrounds. No new animation is introduced.

Desktop native dragging still begins on the grip, but `setDragImage` receives the already-rendered preview, including its crop/rotation and badge, with a bounded cursor offset. No temporary ghost nodes are created. Missing or failing drag-image support falls back to native feedback without changing reorder behavior; touch/pointer and keyboard ordering are unchanged.

## CSS variables

Override these custom properties on `.il-root` with a more specific selector or inline style. The built-in dialog is appended to `document.body`, so also target `.il-confirmation-dialog` when theming it; root-only overrides do not reach the dialog.

| Variable | Default |
| --- | --- |
| `--il-color-primary` | `#2563eb` |
| `--il-color-interactive` | `var(--il-color-primary)` (hover and focus, independently of primary badges) |
| `--il-color-primary-contrast` | `#ffffff` |
| `--il-color-danger` | `#dc2626` |
| `--il-color-surface` | `#ffffff` |
| `--il-color-surface-muted` | `#e2e8f0` |
| `--il-color-text` | `#0f172a` |
| `--il-color-border` | `#cbd5e1` |
| `--il-color-muted` | `#475569` |
| `--il-color-error-surface` | `#fef2f2` |
| `--il-color-error-text` | `#991b1b` |
| `--il-radius-card` | `0.75rem` |
| `--il-card-min-width` | `180px` (retained token name; fixed square size, bounded by container width) |
| `--il-shadow-card` | `0 0.5rem 1.5rem rgb(15 23 42 / 12%)` |

The fixed-size tiles wrap naturally on narrow screens. The reorder handle uses `touch-action: none` for pointer-based touch reordering. Rotation respects `prefers-reduced-motion`. The visible selection button opens the hidden native file input by mouse or keyboard; no second chooser is displayed. The stylesheet preserves `[hidden]` states without requiring a framework reset.

## Locales

Use the included keys with `locale: 'en'` or `locale: 'pt-BR'`. A partial dictionary can override existing string leaves, for example:

```js
new ImageLoader(target, {
    locale: { actions: { rotateRight: 'Turn clockwise' } },
});
```

Unknown keys and non-string text values are rejected so an incomplete translation cannot silently change the UI contract.

## Lifecycle

One loader owns one target element. It replaces that target's contents and owns object URLs it creates for local previews. Always call `destroy()` before removing the target or replacing the page. `getItems()` remains available after destruction for inspection, while mutating methods and event registration reject predictable `instance-destroyed` errors.

## Browser support

Use current browsers that support ES modules, `File`, `Blob`, `FormData`/`formdata`, `requestSubmit`, `AbortController`, canvas WebP encoding and pointer events. The built-in confirmation component falls back to an ARIA dialog when native `<dialog>` methods are unavailable. Test your own target browsers with genuine JPEG, PNG and WebP files, especially if storage or upload limits differ from the defaults.

## Security

The gallery is a client-side convenience, not an authorization boundary. Treat the JSON manifest, persisted IDs, alt text and local files as untrusted server input. On the server, authorize every persisted deletion, verify that IDs belong to the edited resource, validate every manifest/file relationship and MIME/size/dimensions, and generate storage paths independently. Do not interpolate consumer values as HTML; the renderer uses text nodes, but application code still owns its surrounding page and server validation.

## Framework integration

The library does not depend on Laravel, Blade, React, Vue, jQuery or a particular HTTP client. The consuming application owns:

- mounting the component and providing persisted image data;
- authentication, CSRF handling and the deletion endpoint;
- server-side authorization and validation;
- mapping `media_manifest` and `media_files[...]` into its own storage model;
- applying application-specific light and dark theme tokens.

Keep framework adapters in the consuming project. This prevents backend routes, templates and design-system assumptions from becoming part of the library's public API.

## Contributing and verification

Pull requests should keep the public API framework-free and include focused regression coverage for behavior changes. Before opening one, run:

```sh
npm ci
npm test
npm run test:browser
npm run build
npm pack --dry-run
```

Package tests prove the standalone browser contract. Every consuming application remains responsible for testing its own authenticated endpoints, forms and server-side media processing.

## License

Released under the [MIT License](LICENSE).
