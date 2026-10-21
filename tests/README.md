# Regression tests

Run the complete suite from the project directory with Node.js 20 or later. No npm dependencies are required:

```sh
npm test
npm run check
```

After changing inline JavaScript, run `npm run update:csp` before repeating the checks. `npm run release:check` checks the exact release members and writes a local plan under the ignored `.local/` directory.

## Coverage

| File | What it checks |
| --- | --- |
| `filesystem-accuracy.test.cjs` | Real generated files and empty directories, an independent filesystem oracle, per-directory totals and four fixed random seeds in standard and compatibility modes. |
| `core-edgecases.test.cjs` | Empty results, aborts, timeouts, late responses, read failures, limits, invalid sizes and paths, selection merging, CSV escaping and date normalization. |
| `depth-summary.test.cjs` | Directory depth, inferred compatibility depth, blocked descendants, empty roots and non-overlapping per-level byte totals. |
| `ui-behavior.test.cjs` | The complete shipped UI script running with minimal DOM stand-ins: ordering, bounded caching, search, filters, drill-down, operation locks, candidate changes and CSV output. |
| `release-boundaries.test.cjs` | Platform-independent release-path checks for `.env` variants, private directories, exports, path traversal, and permitted source and metadata files. |

The core loader extracts the browser-independent code from the distributed `FolderLens.html`. The UI loader executes its complete inline script in a VM with small element stand-ins. Neither starts a browser, local server or network connection; the UI harness is a logic test, not a rendering engine.

Filesystem tests create known synthetic files in a uniquely named `folderlens-test-*` child of the OS temporary directory and remove that exact directory after each test. They never select or scan personal folders. A separate filesystem walk provides the expected bytes, file counts, descendant-directory counts and depths. Compatibility results are compared only with directories inferable from file paths; empty directories remain outside that mode's observable scope.

Date regressions retain epoch and pre-epoch timestamps, normalize invalid or out-of-range values to unknown, and verify that invalid dates cannot abort a CSV download. CSV regressions also cover formula prefixes, quotes, multiline values, unknown sizes, discovered versus readable file counts, layer summaries and rows beyond the visible page.

Static checks verify script syntax and CSP hash, local runtime resources, read-only APIs, version agreement and both complete MIT licenses in the standalone HTML. Release-path tests do not replace reviewing the actual release allowlist and file contents.

## Recorded result and limits

The 2026-10-21 local run passed 44 tests, including fixed-seed subtests, with no failures or skips on Windows and Node.js v24.19.0. Details and the reviewed HTML fingerprint are in [VALIDATION.md](../VALIDATION.md).

These tests do not establish real browser folder-permission behavior, GUI rendering, cloud-drive behavior, physical disk allocation, antivirus acceptance or completeness of browser-delivered data. The repository includes a Windows/Linux and Node 20/22 CI matrix; configuration alone does not establish that those jobs have run or passed.
