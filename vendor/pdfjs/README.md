# pdf.js (vendored, unmodified)

- Package: `pdfjs-dist` 4.10.38, modern ES-module build (`build/pdf.min.mjs`, `build/pdf.worker.min.mjs`), from the npm registry.
- Licence: Apache License 2.0, see `LICENSE` (copied from the package).
- Why vendored: the extractor page must make no third-party network request; both files are served from this site.
- Why 4.10.38: the current pdfjs-dist release needs Node 22+ for the test runner here (Node 20); 4.10.38 runs in current browsers and in Node 20 for the tests (with a `Promise.withResolvers` polyfill).
- SHA-256 (checked by tests/extract-site.test.mjs):
  - pdf.min.mjs `27fc2a057a00f92a4334ad06e17dbd7259912954e9fb7f76400bcca5fd190a9c`
  - pdf.worker.min.mjs `1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36`
- Not included: cmaps and standard font data (not needed for the bundled samples; text extraction does not use them).
