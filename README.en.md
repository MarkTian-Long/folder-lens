[简体中文](README.md) | English

# FolderLens

Explore folder sizes, directory depth and space distribution in your browser. Open one HTML file; no installation, local server or network connection is required.

Current version: **1.2.0**.

## Get started

1. Download and extract this project, or save `FolderLens.html` on its own.
2. Open `FolderLens.html` in desktop **Chrome or Edge**.
3. Select a folder and grant read access. Use the compatibility picker if the standard interface is unavailable.

The built-in example uses synthetic metadata and does not scan your computer.

## Features

- Total logical size, file and subfolder counts, and maximum directory depth.
- An expandable directory tree, space distribution, largest files and extension summaries.
- Directory counts by depth, with filters for individual levels and deep directories.
- Name search, current-folder or recursive browsing, and path copying.
- CSV exports for current results, the full file list, depth statistics and cleanup candidates.

The selected root directory is at depth **0**; its direct subdirectories are at depth **1**. Maximum directory depth counts directories without adding a level for files. Depth statistics group entries by their relative path depth: root-level files and direct subdirectories are both at depth **1**, and each level's size counts only files at that level, without descendant totals. After cancellation, read errors or a scan limit, depth and size reflect only discovered and readable items.

Cleanup candidates are a list of suggestions. FolderLens does not delete, recycle, rename or write to selected files. A selected parent and its descendants are merged for candidate totals; those totals do not represent reclaimable disk space.

## Scope and limitations

| Item | Meaning |
| --- | --- |
| Size | Sum of logical file lengths; 1 KiB = 1,024 B. This is not allocated disk space, and hard links are not deduplicated. |
| Standard picker | Traverses directory entries returned under browser-granted access, including returned empty directories. |
| Compatibility picker | Infers directories from the browser-provided file list. Empty directories and omitted items cannot be verified. |
| Scan limits | Up to 300,000 entries per scan; a directory depth limit of 128; a 20-second timeout per metadata wait. |
| Results | Scans can be stopped to inspect partial results. Results are not an atomic snapshot; rescan after files change. |
| Paths | Browsers do not expose an absolute drive path. A manually supplied root path is used only for copying and export and is not verified against the file system. |

Coverage and response times for system folders, restricted folders, symbolic links, network drives and cloud storage depend on the browser, operating system and storage service. The page cannot show progress while the compatibility picker prepares its file list. Cloud clients may also perform additional actions in response to metadata requests.

## Privacy

- Reads names, relative paths, file lengths and modification times without calling file-content reading APIs.
- Contains no uploads, telemetry, remote scripts or remote fonts. Its content security policy blocks network connections.
- Scan results, directory handles, cleanup candidates and manually supplied paths stay in page memory and are not restored after a refresh or close. Browser storage saves only the theme preference.
- Exported CSV files may contain sensitive names and paths. Do not commit real scan exports, real directory screenshots, credentials or `.env` files to GitHub.

## Development and checks

Using the page requires only a browser. Development checks require **Node.js 20 or later**, with no npm dependencies to install:

```sh
npm test
npm run check
```

Tests use synthetic directories and mock interfaces to exercise statistics, depth, partial results and export behavior. Static checks verify the single-file structure and content security policy. These checks do not establish real browser folder-permission behavior, Windows file-system compatibility or acceptance by security software.

After editing inline JavaScript, run `npm run update:csp` to update the script hash in the HTML content security policy, then rerun the checks above. Keep the single HTML entry point and its offline, read-only behavior.

See the [validation notes](VALIDATION.md) for this version's fixes, actual fixture results, performance comparison and unverified areas, and the [changelog](CHANGELOG.md) for version history.

## License

Project code is available under the [MIT License](LICENSE), Copyright (c) 2026 MarkTian-Long.

Inline interface icons come from **Feather Icons 4.29.2**, licensed under MIT and copyrighted by Cole Bemis. See [third-party notices](THIRD_PARTY_NOTICES.md) for the pinned source and full license. The page does not load Feather JavaScript or its npm dependencies.
