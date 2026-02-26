# Phase 0 Investigation — `match_origin_as_fallback` for QBO Blob Tabs

Date: 2026-02-26
Scope: Phase 0 research only. No runtime behavior change.

## Question

Can `match_origin_as_fallback` replace manual `chrome.scripting.executeScript()` blob-tab handling for print/download filename flow?

## Findings

1. Chrome supports `match_origin_as_fallback` for `about:`, `data:`, `blob:`, and `filesystem:` related frames.
2. For this mode, Chrome compares the initiating frame origin instead of the target frame URL.
3. Chrome requires a wildcard path (`*`) in match patterns when `match_origin_as_fallback` is enabled.
4. `chrome.scripting` also exposes the same concept for dynamically registered content scripts (`matchOriginAsFallback`).
5. `injectImmediately` is available for `chrome.scripting.executeScript` and can reduce timing issues, but it does not guarantee pre-load injection.

## Implications for Apex Explorer

1. Our current content-script matches are narrowly scoped to `/app/...` paths. Enabling `match_origin_as_fallback` requires broadening to `https://qbo.intuit.com/*`.
2. Broadening match scope would over-inject the main `content.js` logic across many QBO pages unless split.
3. A safe architecture is:
   - Keep current `content.js` scoped to transaction pages.
   - Add a dedicated lightweight `content-blob.js` entry with `match_origin_as_fallback: true`.
4. This can simplify `background.js` blob-title path if live reliability is confirmed.

## Decision (Phase 0)

Keep current production blob flow (`handleBlobTab()` + `chrome.scripting.executeScript()` + `blobRenameData`) unchanged in Phase 0.

Reason:
- Current behavior is working and validated.
- `match_origin_as_fallback` rollout requires manifest scope changes and live QBO reliability testing before replacing production logic.

## Proposed Validation Protocol (next step)

1. Add experimental `content-blob.js` behind a temporary dev branch.
2. Set `match_origin_as_fallback: true` on the blob-targeting content script declaration.
3. Use broad match pattern `https://qbo.intuit.com/*` only for that blob script.
4. Verify on real QBO:
   - Print opens blob tab and script executes consistently.
   - Tab title set timing is reliable.
   - PDF viewer download still uses correct rename data.
5. Test across at least 3 transaction types and repeated rapid print actions.

## Sources

- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
- https://developer.chrome.com/docs/extensions/reference/api/scripting
