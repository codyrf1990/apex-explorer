# Apex Explorer — Build Plan

Engineering plan for building Apex Explorer from its current v1.1 state through batch downloads.
This is the implementation reference. CLAUDE.md is the convention reference.

---

## Current State

~660 lines across 3 source files (`background.js`, `content.js`, `popup.js`).
Supports: download rename, print/blob tab rename, SPA navigation detection, popup settings with live preview.
Tooling: eslint, vitest, playwright (scaffolded), check scripts.
No build step — Chrome loads source files directly.
Working features ship as v1.1.0.

---

## Architecture Contract

1. **Shared token engine is mandatory.** Popup preview and background filename generation must use the same code path. No duplicated token/sanitize logic.
2. **Storage ownership.** `sync` = user settings. `session` = ephemeral state (pendingRename, currentTransaction, batchQueueState). `local` = history log.
3. **MV3 resilience.** Service worker is ephemeral. All event listeners registered at top level. All state in storage, never global variables.
4. **Security.** Least privilege permissions. No eval, no innerHTML with external data, no remote code. Validate message senders.
5. **No build step for development.** Chrome loads source files directly. Package with `npm run package:zip`.

---

## Phase 0 — Extract Shared Modules

**Goal:** Eliminate duplicated logic between background.js and popup.js. Validate tooling.

**Scope:**

1. Create `shared/tokens.js` — extract from background.js:
   - `buildFilename(format, data)` — token replacement + sanitization
   - `formatDate(fmt, date?)` — date formatting (accept optional Date for testability)
   - `parseQboFilename(filename)` — extract type/num from QBO default names
   - Sanitization logic (illegal chars, collapse spaces/dashes, trim)

2. Create `shared/settings.js` — extract from background.js and popup.js:
   - `DEFAULTS` object
   - `getSettings()` with `showNotification` → `notifyMode` migration

3. Update `background.js` to import from shared modules.
4. Update `popup.js` to import from shared modules, replacing its `buildPreview()` with the shared `buildFilename()`.
5. Update `manifest.json`: set `"type": "module"` on the service worker to support imports.

**Module format note:**
```json
"background": {
  "service_worker": "background.js",
  "type": "module"
}
```
In popup.html, change `<script src="popup.js">` to `<script type="module" src="popup.js">`.
Content scripts cannot use ES module imports directly — content.js stays self-contained (it doesn't share code with the other files yet).

**Also investigate:** Test `matchOriginAsFallback` (Chrome 119+) for blob URL content script auto-injection. If it works, a dedicated `content-blob.js` could replace the manual `chrome.scripting.executeScript()` in `handleBlobTab()`, simplifying background.js significantly. Document findings but don't change blob handling in this phase.

**Investigation status (2026-02-26):**
- Findings documented in `WorkBench/PHASE0_MATCH_ORIGIN_AS_FALLBACK_FINDINGS_2026-02-26.md`
- Decision: keep current blob handling in Phase 0; run controlled live-QBO validation before any replacement

**Validation:**
- Existing rename behavior unchanged (manual smoke test)
- `npm run doctor` passes
- Popup live preview matches background rename output for identical input

**What NOT to do:**
- No directory restructure beyond `shared/`
- No new product features
- No behavior changes visible to users

---

## Phase 1 — New Tokens + Expanded Transaction Types

**Goal:** Add `{txndate}`, `{amount}`, `{po}`, `{status}` tokens. Expand to more QBO transaction types.

**Prerequisite: Selector matrix.** Before coding, open each transaction type in QBO DevTools and document exact selectors. This is a research task, not a coding task. One session covering estimate, invoice, bill, PO, and sales receipt would unblock everything.

**Likely selector candidates** (need live verification):

| Field | Likely selectors | Element type |
|-------|-----------------|--------------|
| Date | `[data-automation-id="date_field"]`, `[data-automation-id="txn_date"]`, `input[aria-label="Date"]`, `input[aria-label="Bill date"]` | `<input>` — use `.value` |
| Amount | `[data-automation-id="total"]`, `[data-automation-id="balance_due"]`, `[data-automation-id="amount_due"]` | Display element — use `.textContent` |
| PO | `[data-automation-id="po_number"]`, `input[aria-label="P.O. number"]` | `<input>` — use `.value` |
| Status | `[data-automation-id="status"]`, header region badge/chip elements `[class*="Badge"]`, `[class*="Status"]` | Badge — use `.textContent` |

**New tokens:**

| Token | Gotchas |
|-------|---------|
| `{txndate}` | QBO renders dates in user's locale. **Phase 1 strategy: raw passthrough** — insert QBO's displayed date string directly into the filename without parsing. This avoids locale bugs entirely. Add smart parsed/reformatted dates in a future enhancement. User's `dateFormat` setting applies only to `{date}` (today's date), not `{txndate}`. |
| `{amount}` | DOM value includes currency symbol and commas (`$1,234.56`). Strip to numeric string (`1234.56`) for filename safety: `raw.replace(/[^0-9.,-]/g, '').replace(/,/g, '')`. |
| `{po}` | Only exists on some transaction types (invoices, bills). Returns empty string on types without it. Popup should indicate this is type-dependent. |
| `{status}` | Badge/chip element, not an input — use `textContent` not `.value`. Less stable selector than input fields. May be absent on new unsaved transactions. |

**Implementation scope:**
1. Add selectors for new fields in `readTransactionData()` (content.js).
2. Extend shared token engine to handle new tokens.
3. Thread new fields through `pendingRename`, `currentTransaction`, `blobRenameData`.
4. Add token chips and presets in popup. Indicate which tokens are type-dependent.
5. Expand `content_scripts.matches` in manifest.json:
   ```
   "https://qbo.intuit.com/app/check*",
   "https://qbo.intuit.com/app/vendorcredit*",
   "https://qbo.intuit.com/app/journalentry*",
   "https://qbo.intuit.com/app/deposit*",
   "https://qbo.intuit.com/app/expense*",
   "https://qbo.intuit.com/app/transfer*",
   "https://qbo.intuit.com/app/payment*"
   ```
   Update `TXN_LABELS` in content.js to match.
6. Add quick-copy button in popup — `navigator.clipboard.writeText()`.

**Validation:**
- Token extraction verified on estimate, invoice, bill, PO, sales receipt minimum
- Missing-field fallback: absent tokens collapse to empty string, no crash
- Preview/rename parity: popup output equals background output for identical input
- Quick-copy writes correct string to clipboard

---

## Phase 2 — Auto-Folder Routing

**Goal:** Route downloads into subfolders by customer, type, or custom pattern.

**How it works:** `suggest()` in `onDeterminingFilename` accepts subdirectory paths. Passing `"Invoices/87072 - Bison.pdf"` creates the `Invoices` subfolder under the downloads directory automatically. Forward slashes only (even on Windows). `../` is stripped — cannot escape downloads root.

**New settings:**
- `folderEnabled` (boolean, default false)
- `folderPattern` (string, default `{type}`)
- Stored in `chrome.storage.sync`

**Implementation scope:**
1. Add `folderEnabled` and `folderPattern` to settings defaults and popup UI.
2. Build folder path in `renameDownload()` using shared token engine.
3. Prepend folder path to filename in `suggest()` call.
4. Add folder path preview in popup (shows full path: `Invoices/87072 - Bison Pumps.pdf`).
5. Sanitize each folder segment independently: strip illegal chars, collapse separators, reject empty segments.

**Validation:**
- Customer-based routing creates correct subfolder
- Type-based routing creates correct subfolder
- Custom pattern with multiple levels (`{customer}/{type}/`) works
- `../` and empty segments are stripped
- Filename itself is unaffected by folder feature

---

## Phase 3 — Download History Log

**Goal:** Persist renamed downloads and provide searchable, exportable history.

**Storage:** `chrome.storage.local` — 5,000 entry cap (~2MB, within 5MB default quota).

**History entry shape:**
```js
{
  originalName: 'Estimate 87072.pdf',
  renamedTo: '87072 - Bison Pumps.pdf',
  folder: 'Estimates/',
  downloadId: 12345,
  timestamp: 1708531200000,
  txnType: 'Estimate',
  txnNum: '87072',
  customer: 'Bison Pumps'
}
```

**Implementation scope:**
1. Append history entry after successful rename in `renameDownload()`.
2. Hard-prune to 5,000 newest entries on every write.
3. History UI — consider `chrome.sidePanel` API (Chrome 114+). Side panel stays open alongside QBO, better UX than popup or new tab. If side panel UX is poor, fall back to standalone page.
4. UI features: search, sort by date/name/customer, open file, delete entry, CSV export.
5. Add `downloads.open` permission to manifest.json.

**Race condition:** Concurrent renames both doing read-modify-write on history array. Mitigate with a write queue in background.js, or accept rare duplicates as harmless.

**Rename-failure notification:** When `renameDownload()` can't extract transaction data and falls through to the original filename, show brief red "!" badge so users know rename didn't happen.

**Validation:**
- Create/search/delete/open/export workflows
- 5,100-entry stress test prunes to 5,000 newest
- `downloads.open` permission declared and functional
- CSV export contains expected columns
- History UI responsive at 5,000 entries

---

## Phase 4 — Batch Download

**Goal:** Download multiple transactions from QBO list pages as individually renamed PDFs.

**Mechanism: Tab-based sequential download**
1. On a QBO list page (`/app/estimates`, `/app/invoices`, etc.), content script extracts transaction URLs from selected/checked rows.
2. Background SW opens each transaction in a background tab (`chrome.tabs.create({ active: false })`).
3. Content script in the new tab reads transaction data, triggers download.
4. Background SW renames via existing `onDeterminingFilename` flow.
5. Tab closed after download completes (`chrome.downloads.onChanged` for `state: 'complete'`).
6. Next queue item processed.

**Constraints:**
- Max 2 concurrent background tabs.
- Per-item timeout: 30 seconds. Log failure and move on.
- QBO list pages use virtualized scrolling — not all rows are in DOM. Strategy: read only currently-selected/visible rows. User must scroll to select more before triggering batch.
- Queue state persisted in `chrome.storage.session` as `batchQueueState` for SW restart recovery.

**Queue state shape:**
```js
{
  items: [
    { url: '...', status: 'pending' | 'downloading' | 'done' | 'failed', error?: '...' }
  ],
  startedAt: 1708531200000,
  concurrency: 2
}
```

**New content script:** `content-list.js` — separate content script for list pages. Reads selected row data (transaction URL, type, number). Matched to list page URL patterns.

**UI:** Progress indicator in popup or side panel — completed/total/failed counts. Cancel button.

**Validation:**
- 5, 25, 50-item batch runs
- SW restart mid-batch recovers or reports deterministic failure
- Cancellation stops remaining, completed items kept
- Failed items logged with reason
- Progress UI matches queue state

---

## Phase 5 — PDF Signatures (Exploratory / Deferred)

**Status: HIGH RISK — defer until core product is stable.**

**Feasibility:**
- PDF modification is feasible with `pdf-lib` (JS library, no native deps).
- Reading downloaded files in MV3: Use `showOpenFilePicker()` or `<input type="file">` in the history UI. User selects file, extension reads it in-memory with `FileReader`/`arrayBuffer()`, applies signature, saves as new download. Zero additional permissions needed.
- CWS single-purpose policy risk. A "PDF renaming" extension that also modifies PDFs may get flagged. Consider a separate companion extension.

**If pursued:**
- Manual-sign flow only (from history UI)
- Original file never modified — signed version saved as new file (`_signed.pdf`)
- Signature image stored in `chrome.storage.local`

**Recommendation:** Do not commit. Revisit after Phase 4 ships and CWS listing is stable.

---

## Quick Wins (No Phase Dependency)

Small, self-contained improvements. Ship anytime.

- **More transaction types in manifest** — check, vendorcredit, journalentry, deposit, expense, transfer, payment. One manifest line each, zero code changes.
- **Quick-copy to clipboard** — popup button, `navigator.clipboard.writeText()`.
- **Rename-failure notification** — badge "!" when rename fell back to original filename.
- **Settings export/import** — JSON download/upload in popup for sharing configs.

---

## Chrome API Modernization Notes

Available in Chrome 123+ (our minimum version):

| API | Use Case |
|-----|----------|
| `matchOriginAsFallback` (119+) | Auto-inject content script on `blob:` tabs from QBO, replacing manual `executeScript` |
| `injectImmediately` (117+) | Improve blob tab title timing |
| `chrome.sidePanel` (114+) | History UI that stays open alongside QBO |
| Download bubble (130+) | Test toast notification overlap with Chrome's own download UI |

---

## Open Questions

- Exact selectors for `{txndate}`, `{amount}`, `{po}`, `{status}` on each transaction type? (Live QBO testing required before Phase 1)
- Does `matchOriginAsFallback` work reliably for QBO blob tabs? (Test in Phase 0)
- QBO list page scrolling behavior — infinite scroll, paginated, or virtual? (Research before Phase 4)
- Side panel vs standalone page for history UI? (Prototype in Phase 3)

---

## File Map

**Existing:**
- `manifest.json`, `background.js`, `content.js`
- `popup.html`, `popup.js`, `popup.css`
- `icons/` (16, 48, 128)

**Phase 0 adds:**
- `shared/tokens.js`, `shared/settings.js`

**Phase 3 adds:**
- `history.html` / `history.js` / `history.css` (or side panel equivalent)

**Phase 4 adds:**
- `content-list.js` (list page row extraction)

---

## Assumptions

1. Node LTS >= 20 for tooling.
2. ES2022+ JavaScript. No TypeScript.
3. Incremental modularization — no big-bang rewrite.
4. CLAUDE.md is the convention reference. This file is the implementation plan.
5. Phases ship independently. One phase per release so regressions are attributable.
6. Version numbers assigned at ship time, not pre-planned.
