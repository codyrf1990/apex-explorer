# Apex Explorer — Chrome Extension

## What This Is

A Chrome Extension (Manifest V3) that fixes QuickBooks Online PDF print/download filenames. QBO defaults to names like "Estimate 87072" — this extension renames them to user-configurable formats like "87072 - Bison Pumps.pdf".

## Architecture

```
apex-explorer/
├── manifest.json          # MV3 manifest — permissions, host patterns, content scripts
├── background.js          # Service worker — rename, folder routing, history, batch queue
├── content.js             # Injected into QBO pages — reads DOM, intercepts clicks
├── content-list.js        # Injected into QBO list pages — batch candidate extraction
├── popup.html             # Settings popup shell
├── popup.js               # Settings logic, live preview, storage
├── popup.css              # Vanilla CSS, modern features (nesting, color-mix, light-dark)
├── history.html           # Download history page shell
├── history.js             # History UI logic (search/sort/open/delete/export)
├── history.css            # History page styling
├── shared/                # Shared modules (tokens + settings)
├── icons/                 # PNG icons: 16, 48, 128
├── AGENTS.md              # Agent operating rules (scope, reporting, references)
├── WorkBench/             # Planning docs (BUILD_PLAN.md, original spec)
├── CLAUDE.md              # This file
└── README.md              # User/developer-facing docs
```

No build step. No bundler. No framework. Plain JS + CSS loaded directly by Chrome.

## Code Style Rules

### Write Human Code, Not AI Code

- **Short variable names in small scopes.** `tab` not `currentlyActiveTab`. `url` not `parsedTabUrl`. Loop vars can be `i`.
- **No narrating comments.** Comments explain WHY, never WHAT. If the code is clear, no comment needed.
- **No JSDoc on obvious functions.** Only document non-obvious behavior or public APIs.
- **No unnecessary abstractions.** Don't extract a 3-line block into a named function called once. Three similar lines beats a premature helper.
- **No defensive coding for impossible cases.** If you control the call site, trust it. Only validate at boundaries (user input, storage reads, DOM queries).
- **No over-engineering.** No `ConfigManager` class when a plain object works. No `utils.js` with one function.
- **Consistent but not rigid.** Pick a style and stick with it. Semicolons: yes. Quotes: single. Indent: 2 spaces.
- **Function length is flexible.** A coherent 50-line function is fine. Don't split it into 5 tiny ones for aesthetics.
- **Error handling at boundaries only.** Check `chrome.runtime.lastError` in callbacks. Let actual bugs crash loudly. Don't catch-and-swallow.

### JavaScript Conventions

- ES2022+ features — optional chaining (`?.`), nullish coalescing (`??`), destructuring, `const`/`let` (never `var`)
- `async`/`await` for Chrome APIs that return promises (MV3 style)
- Callback style only where Chrome API requires it (e.g., `onDeterminingFilename`)
- No classes unless genuinely needed — plain functions and objects preferred
- No external dependencies — everything is vanilla JS
- Prefix all console.log with `[Apex]` for filtering in noisy DevTools

### CSS Conventions

- Vanilla CSS only — no preprocessors, no frameworks
- CSS custom properties for design tokens (colors, spacing, radii)
- CSS nesting (Chrome 120+) — no need for BEM or other naming hacks
- `color-mix()`, `light-dark()`, `:has()` — all safe in Chrome extension popups
- `13px` base font size to match Chrome's own UI
- 360px popup width
- No `!important` unless overriding third-party styles in content scripts

## QBO DOM Selectors (verified live — DO NOT GUESS)

```js
// Transaction number — PRIMARY (most stable)
'[data-automation-id="reference_number"]'      // INPUT .value = "87072"

// Transaction number — FALLBACKS (in priority order)
'[data-automation-id="RethinkLayout_header"]'  // HEADER innerText = "Estimate 87072"
'[class*="txp-capability-formTitle"]'           // DIV innerText = "Estimate 87072"
'[class*="TrowserHeader-headerTitleText"]'      // H2 innerText = "Estimate 87072"

// Customer name (fallback chain — Bills/POs use Vendor)
'[data-automation-id="customer_name"]'         // INPUT .value — some QBO views
'input[aria-label="Customer"]'                 // INPUT .value = "Bison Pumps"
'[data-automation-id="vendor_name"]'           // INPUT .value — for Bills/POs
'input[aria-label="Vendor"]'                   // INPUT .value — Bills/POs fallback

// Print/Download popup menu items
'[class*="Menu-menu-list-wrapper"] li[role="menuitem"]'
// Matched by text content ("print" / "download"), NOT positional index

// Print button (header variant)
'[data-automation-id="print-button"]'

// Footer "Print or download" button (opens menu)
'[data-automation-id="RethinkLayout_footer"] button:first-of-type'

// NEVER target full class names — hashes change on every QBO deploy
// ALWAYS use [class*="partial-match"] for QBO CSS classes
```

## Chrome API Gotchas

1. **`onDeterminingFilename` MUST return `true`** if calling `suggest()` async. No exceptions.
2. **`suggest()` must be called exactly once.** Zero = download hangs. Multiple = error.
3. **Service worker dies after ~30 seconds.** All state goes through `chrome.storage.session`, never global variables.
4. **Register all event listeners at top level** of background.js. Conditional registration = missed events after SW restart.
5. **`chrome.storage.session`** stays `TRUSTED_CONTEXTS`; content scripts send validated messages and the service worker owns ephemeral state.
6. **Content scripts don't run on `blob:` URLs.** Use `chrome.scripting.executeScript()` from background.js.
7. **Capture phase for click listeners** in content.js — `addEventListener('click', handler, true)` — fires before React.
8. **`return true` in `onMessage` listeners** when using async `sendResponse`. Forgetting this is the #1 messaging bug.

## SPA Navigation Detection

QBO is a React SPA — no full page reloads. Use hybrid approach:
- `chrome.webNavigation.onHistoryStateUpdated` from background.js (primary)
- `MutationObserver` on document.body in content.js (fallback)
- Debounce mutations — 100ms batching minimum
- Always disconnect observers when no longer needed

## Storage Strategy

```
chrome.storage.sync    → user settings — syncs across devices
  { enabled, format, dateFormat, notifyMode, folderEnabled, folderPattern }
  notifyMode: 'off' | 'badge' | 'toast' (default 'toast')
  NOTE: v1.0 used boolean showNotification — migrated to notifyMode on first read

chrome.storage.session → ephemeral data — survives SW restart, not browser restart
  renameContexts: {
    transactions: { [tabId]: { sourceTabId, sourceUrl, data, missingTokens, observedAt } },
    pending: { [id]: { sourceTabId, sourceUrl, action, batchItemId, data, createdAt } },
    blobs: { [blobTabId]: { sourceTabId, sourceUrl, blobUrl, data, createdAt } },
    history: { [downloadId]: { ...pendingHistoryEntry } }
  }
  batchQueueState: { items, startedAt, sourceTabId, concurrency, cancelled }

chrome.storage.local   → persistent data
  renameHistory: [ { id, originalName, renamedTo, folder, downloadId, timestamp, txnType, txnNum, customer } ]
```

## Filename Building

Tokens: `{num}`, `{customer}`, `{date}`, `{type}`, `{txndate}`, `{amount}`, `{po}`, `{status}`
Default format: `{num} - {customer}`
Sanitize: strip `<>:"/\|?*` and control chars. Collapse multiple spaces/dashes. Remove leading/trailing spaces/dots.
Fallback: identified transactions use a trusted `{type} {num}` partial name when configured tokens are missing. `QBO_Document_{timestamp}` is reserved for previews or calls with no transaction identity; live QBO renames keep the original filename instead.

## Data Resolution Order

When renaming a download or blob tab, data sources are tried in this order:

1. **Exact blob context** — blob URL mapped to its opener tab (5min TTL)
2. **Correlated pending context** — matching referrer and parsed transaction identity (30s TTL)
3. **Per-tab transaction context** — only when the download referrer matches that tab URL
4. **QBO filename parse** — partial type/number data only; never borrow a customer from another tab

## Security Rules

- No `innerHTML` with external data. Use `textContent` and DOM creation.
- No `eval()`, `new Function()`, `setTimeout('string')`.
- No inline event handlers in HTML. All handlers in separate .js files.
- Validate message senders in `onMessage` listeners.
- Request minimum permissions only.

## Testing Workflow

1. Load unpacked at `chrome://extensions` with Developer Mode on
2. Open any QBO transaction (estimate, invoice, etc.)
3. Verify content script loads — check for `[Apex]` logs in page DevTools console
4. Test download rename — click Print or Download > Download
5. Test print rename — click Print or Download > Print — check blob tab title
6. Test popup — click extension icon, verify live preview shows current doc info
7. Test SPA navigation — switch between transactions without full page reload
8. Test history page — search, sort, open, delete, CSV export
9. Test batch queue from a supported list page — start, progress, cancel, failures
10. Test edge cases — new blank doc (no customer), missing fields, rapid navigation

## Build Plan Reference

See `WorkBench/BUILD_PLAN.md` for the multi-phase roadmap.
See `AGENTS.md` for execution scope and reporting expectations.

## What NOT To Do

- Don't add a build step unless the project genuinely outgrows plain files
- Don't create `utils.js`, `constants.js`, `types.js` for a handful of shared values
- Don't add TypeScript — this is a small extension, the overhead isn't worth it
- Don't add extra linter configs unless replacing the existing project ESLint setup intentionally
- Don't commit `.env` files or API keys (there are none, but don't start)
- Don't use `<all_urls>` in host_permissions — list QBO URLs explicitly
- Don't add features not in the current spec — scope creep kills shipping
