# Apex Explorer

Chrome extension that fixes QuickBooks Online PDF filenames. QBO defaults to names like "Estimate 87072" — Apex Explorer renames them to "87072 - Bison Pumps.pdf" (or any format you choose).

## Features

- Auto-renames downloaded PDFs with transaction number + customer name
- Auto-renames print preview tabs so Chrome's Save as PDF uses the right filename
- Works on Estimates, Invoices, Sales Receipts, Purchase Orders, Credit Memos, Bills, Refund Receipts
- Expanded support: Checks, Vendor Credits, Journal Entries, Deposits, Expenses, Transfers, Payments
- Vendor name support for Bills and Purchase Orders
- Configurable filename format with tokens (`{num}`, `{customer}`, `{type}`, `{date}`, `{txndate}`, `{amount}`, `{po}`, `{status}`)
- Configurable date format (YYYY-MM-DD, MM-DD-YYYY, MM/DD/YYYY, DD-MM-YYYY)
- Auto-folder routing with token patterns (`{type}`, `{customer}/{type}`, etc.)
- Notification options: badge only, badge + system toast, or off
- Live filename preview in the popup
- One-click copy of generated filename
- Download history page with search/sort/open/delete/CSV export
- Batch download queue from supported QBO list pages (2 concurrent tabs, cancel, progress)
- Light/dark mode support (follows system theme)
- Auto re-injects into open QBO tabs after extension update

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome or Comet
3. Enable **Developer Mode** (top right)
4. Click **Load unpacked** and select the project folder
5. Navigate to any QBO transaction and try printing or downloading

## Format Tokens

| Token | Output | Example |
|-------|--------|---------|
| `{num}` | Transaction number | 87072 |
| `{customer}` | Customer name | Bison Pumps |
| `{type}` | Transaction type | Estimate |
| `{date}` | Today's date | 2026-02-20 |
| `{txndate}` | Transaction date from QBO | 02/20/2026 |
| `{amount}` | Numeric amount (safe for filename) | 1234.56 |
| `{po}` | PO number (type-dependent) | PO44 |
| `{status}` | QBO status text (type-dependent) | Open |

**Default format:** `{num} - {customer}` → `87072 - Bison Pumps.pdf`

## Permissions

| Permission | Why |
|------------|-----|
| `downloads` | Rename PDF files when downloading |
| `downloads.open` | Open downloaded files from history page |
| `storage` | Save your settings and sync across devices |
| `scripting` | Set the print preview tab title for correct PDF filename |
| `tabs` | Detect QBO print preview tabs |
| `activeTab` | Read transaction info from the current QBO page |
| `notifications` | Show confirmation when a file is renamed |
| `webNavigation` | Detect when you navigate between QBO transactions |

## Development

```
apex-explorer/
├── manifest.json    — extension config
├── background.js    — service worker (rename, folders, history, batch queue)
├── content.js       — DOM reader (transaction data, click interception)
├── content-list.js  — list page extractor for batch download candidates
├── popup.html/js/css — settings UI
├── history.html/js/css — history viewer/export UI
├── shared/          — shared token/settings modules
└── icons/           — extension icons
```

After making changes, go to `chrome://extensions` and click the reload button on the Apex Explorer card.

## Privacy

This extension does not collect, transmit, or store any personal data. It runs entirely locally in your browser.

- **No analytics, tracking, or third-party services**
- **No network requests** — the extension never phones home
- **Settings sync** uses Chrome's built-in storage sync, tied to your Google account (same mechanism as bookmarks and extensions settings)
- **QuickBooks Online access** is limited to reading transaction information (number, customer name, type) from the active page for filename generation
- **No data leaves your browser** — all processing happens locally in the extension
