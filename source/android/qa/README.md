# Android integration verification

Run `npm install` and `npm test` from this directory with Node.js 18 or newer.
The development workspace uses a dependency symlink; no dependency files are
required in the APK.

The DOM checks load the shipped files in `../www`, including the production
`android-bridge.js`. Only the Java `KarevoAndroid.request` / callback boundary is
mocked. Real Napi Canvas renders and encodes PNG/JPEG; fake-indexeddb exercises
actual project autosave and restore. Mock native picker results exercise success,
cancel, and errors. The workflow checks cover brands, saved templates, CSV
preview/import, post metadata, clipboard and local plan export, feed preview,
and video capability/error/cancel wiring.

Mobile checks exercise tab/drawer/menu/back events and inspect the responsive
CSS, viewport and touch control rules. jsdom does not perform actual CSS layout.

Security checks generate a valid compressed 16,384 × 16,384 PNG under 40 KB and
verify rejection before image decoding, including native project opening and
photo import through the FileReader fallback. The open project is preserved.
Shared core checks cover PNG/JPEG/WebP compatibility, disguised SVG rejection,
48-million-pixel image/board/cache limits, the 512-million-pixel project budget,
deduplication, serialized decoding, and cache eviction by decoded pixel budget.
These checks never decode the oversized test raster.

These checks are not Android-device, WebView, share-sheet, file-picker, keyboard,
or codec validation. The video recording path is mocked. APK assembly/signature
checks are separate from these JavaScript tests; an Android device is still
needed to assess visual layout, performance, gallery access and codec support.

`npm run test:close` runs the production native close-request guard on a JVM, then a DOM regression with failing storage. It verifies refusal to close, continued editing/manual project-file backup, and successful retry. The Java host and Android dialog UI are not executed by the DOM check. An existing JDK selected by `BULTEN_JAVA_HOME` or `JAVA_HOME` is needed.

`npm run test:clip-engine` runs the shared local-clip engine against bounded real MP4/WebM fixture bytes with controlled media, recorder and audio APIs. It covers malformed containers, dimension/resource limits, untrusted sessions/URLs, nonfinite options, cancellation, repeat exports and resource cleanup. It is an engine/security test, not Android codec execution.

`npm run test:clip-ui` loads the production phone menu, Android adapter and shared video UI while controlling the media engine and SAF replies. It covers Back/background cancellation, the final native-save phase, failed autosave close tokens, safe filenames/plain text, unchanged news projects and disposal. The release still needs Android device validation for codecs, audio sync, file providers and layout.
