# Apex Explorer — Chrome Extension

## What This Is

A Chrome Extension (Manifest V3) that fixes QuickBooks Online PDF print/download filenames. QBO defaults to names like "Estimate 87072" — this extension renames them to user-configurable formats like "87072 - Bison Pumps.pdf".

## Architecture

```
apex-explorer/
├── manifest.json          # MV3 manifest — permissions, content scripts, commands
├── background.js          # Service worker — download renaming, print tab detection, hotkeys
├── content.js             # Injected into QBO pages — reads DOM, intercepts clicks
├── popup.html             # Settings popup shell
├── popup.js               # Settings logic, live preview, storage
├── popup.css              # Vanilla CSS, modern features (nesting, color-mix, light-dark)
├── icons/                 # PNG icons: 16, 48, 128
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

## Critical Technical Details

### QBO DOM Selectors (verified live — DO NOT GUESS)

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
// [0] = Print, [1] = Download

// NEVER target full class names — hashes change on every QBO deploy
// ALWAYS use [class*="partial-match"] for QBO CSS classes
```

### Chrome API Gotchas

1. **`onDeterminingFilename` MUST return `true`** if calling `suggest()` async. No exceptions.
2. **`suggest()` must be called exactly once.** Zero = download hangs. Multiple = error.
3. **Service worker dies after ~30 seconds.** All state goes through `chrome.storage.session`, never global variables.
4. **Register all event listeners at top level** of background.js. Conditional registration = missed events after SW restart.
5. **`chrome.storage.session`** needs `setAccessLevel('TRUSTED_AND_UNTRUSTED_CONTEXTS')` for content script access.
6. **Content scripts don't run on `blob:` URLs.** Use `chrome.scripting.executeScript()` from background.js.
7. **Capture phase for click listeners** in content.js — `addEventListener('click', handler, true)` — fires before React.
8. **`return true` in `onMessage` listeners** when using async `sendResponse`. Forgetting this is the #1 messaging bug.

### SPA Navigation Detection

QBO is a React SPA — no full page reloads. Use hybrid approach:
- `chrome.webNavigation.onHistoryStateUpdated` from background.js (primary)
- `MutationObserver` on document.body in content.js (fallback)
- Debounce mutations — 100ms batching minimum
- Always disconnect observers when no longer needed

### Storage Strategy

```
chrome.storage.sync    → user settings — syncs across devices
  { enabled, format, dateFormat, notifyMode }
  notifyMode: 'off' | 'badge' | 'toast' (default 'toast')
  NOTE: v1.0 used boolean showNotification — migrated to notifyMode on first read

chrome.storage.session → ephemeral data — survives SW restart, not browser restart
  pendingRename: { action, num, customer, type, timestamp }
  currentTransaction: { num, customer, type }

chrome.storage.local   → not used in v1 (reserved for future: history log, large data)
```

### Filename Building

Tokens: `{num}`, `{customer}`, `{date}`, `{type}`
Default format: `{num} - {customer}`
Sanitize: strip `<>:"/\|?*` and control chars. Collapse multiple spaces/dashes.
Fallback: `QBO_Document_{timestamp}` if everything else fails.

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
6. Test hotkeys — Ctrl+Shift+P (print), Ctrl+Shift+D (download)
7. Test popup — click extension icon, verify live preview shows current doc info
8. Test SPA navigation — switch between transactions without full page reload
9. Test edge cases — new blank doc (no customer), missing fields, rapid navigation

## File Ownership

- `manifest.json` — touched rarely, only for permission/version changes
- `background.js` — service worker logic, download/print interception, commands
- `content.js` — DOM reading, click interception, message passing to background
- `popup.html/js/css` — settings UI, live preview, format builder
- `icons/` — placeholder PNGs, replace with real branding later

## What NOT To Do

- Don't add a build step unless the project genuinely outgrows plain files
- Don't create `utils.js`, `constants.js`, `types.js` for a handful of shared values
- Don't add TypeScript — this is a small extension, the overhead isn't worth it
- Don't add a linter config file — keep conventions in this doc and enforce by review
- Don't commit `.env` files or API keys (there are none, but don't start)
- Don't use `<all_urls>` in host_permissions — list QBO URLs explicitly
- Don't add features not in the current spec — scope creep kills shipping
