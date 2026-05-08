// Runs at document_start in MAIN world on all qbo.intuit.com/app/* pages.
// Suppresses Intuit's Zoom Cobrowse / Smartlook screen-share feature, which
// hijacks Shift+Enter on estimates and also auto-prompts on homepage.
// Layered defense applied across all of /app/*:
//   1. Override SDK session-start methods so triggers do nothing
//   2. Capture-phase keydown blocker swallows Shift+Enter
//   3. MutationObserver auto-clicks Deny on #consent, Dismiss on #cobrowse-draggable
(function () {
  if (window.__apexKeyblocker) return;
  window.__apexKeyblocker = true;

  let sdkNeutralized = false;

  function block(e) {
    if (e.key !== 'Enter' || !e.shiftKey) return;
    let t = e.target;
    if (t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    console.log('[Apex] blocked Shift+' + e.type);
  }

  window.addEventListener('keydown', block, true);
  window.addEventListener('keypress', block, true);
  window.addEventListener('keyup', block, true);

  function neutralizeSDK() {
    if (sdkNeutralized) return;
    let inst = window.__smlk__zoom?.__sessionInstance;
    if (!inst) return;
    let noop = function () {};
    for (let m of ['start', 'initSession', 'join', 'autoJoin', 'startRemoteAssist', 'requestBrowserControl', 'sendMediaRequest']) {
      if (typeof inst[m] === 'function') inst[m] = noop;
    }
    sdkNeutralized = true;
    try { inst.cleanPersistentToast?.(); } catch {}
    console.log('[Apex] Zoom Cobrowse SDK neutralized');
  }

  function dismissPopups() {
    let consent = document.getElementById('consent');
    if (consent) {
      for (let btn of consent.querySelectorAll('button')) {
        if (btn.textContent?.trim().toLowerCase() === 'deny') {
          btn.click();
          console.log('[Apex] auto-denied screen share consent');
          break;
        }
      }
    }
    let toast = document.getElementById('cobrowse-draggable');
    if (toast) {
      for (let btn of toast.querySelectorAll('button')) {
        if (btn.textContent?.trim().toLowerCase() === 'dismiss') {
          btn.click();
          console.log('[Apex] auto-dismissed cobrowse toast');
          break;
        }
      }
    }
  }

  let attempts = 0;
  let poll = setInterval(() => {
    neutralizeSDK();
    if (sdkNeutralized || ++attempts > 120) clearInterval(poll);
  }, 500);

  function startObserver() {
    if (!document.body) {
      requestAnimationFrame(startObserver);
      return;
    }
    let observer = new MutationObserver(() => {
      neutralizeSDK();
      dismissPopups();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    dismissPopups();
  }
  startObserver();
}());
