(() => {
  'use strict';

  const SCAN_MS = 500;
  const REMOVAL_TIMEOUT_MS = 3000;
  const TRIM_BUTTON_SELECTOR = 'div.ajR';
  const QUOTE_SELECTOR = '.gmail_quote_container, .gmail_quote';

  // In-memory cache of the exception list, kept in sync with chrome.storage.
  let exceptions = new Set();

  function normalizeEmail(value) {
    return (value || '').trim().toLowerCase();
  }

  function loadExceptions() {
    chrome.storage.sync.get({ exceptions: [] }, (data) => {
      exceptions = new Set((data.exceptions || []).map(normalizeEmail).filter(Boolean));
    });
  }
  loadExceptions();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.exceptions) {
      exceptions = new Set((changes.exceptions.newValue || []).map(normalizeEmail).filter(Boolean));
    }
  });

  // The reading pane / main conversation area — scoping to this (instead of
  // the whole page) avoids picking up unrelated threads from the inbox list.
  function getScopeContainer(trimButton) {
    return trimButton.closest('div[role="main"]') || document.body;
  }

  // Does any address on the exception list show up ANYWHERE in this
  // conversation — as a sender, a recipient, a cc, on any message in the
  // thread? This matters because the *last* message in a thread might be one
  // you sent yourself (e.g. a follow-up you added), so checking only "who
  // sent the most recent message" misses the case where the other side's
  // address only appears earlier in the thread, or only in a "to" line.
  function threadMatchesException(trimButton) {
    const scope = getScopeContainer(trimButton);

    const taggedEmails = scope.querySelectorAll('[email]');
    for (const el of taggedEmails) {
      const addr = normalizeEmail(el.getAttribute('email'));
      if (addr && exceptions.has(addr)) return true;
    }

    // Fallback: some recipient/sender chips don't carry an `email` attribute
    // in every Gmail layout, so also do a plain substring check over the
    // visible text of the conversation.
    const scopeText = (scope.textContent || '').toLowerCase();
    for (const address of exceptions) {
      if (address && scopeText.includes(address)) return true;
    }

    return false;
  }

  function removeQuotesNear(trimButton) {
    const scope = trimButton.closest('div.gA, div.aeH') || trimButton.parentElement || document;
    let removedAny = false;

    scope.querySelectorAll(QUOTE_SELECTOR).forEach((el) => {
      el.remove();
      removedAny = true;
    });

    return removedAny;
  }

  // Clicking a trim button (or removing DOM around it) can shift Gmail's
  // own focus — e.g. into the message body it just expanded — even if that
  // trim button belongs to a completely different draft/thread than the one
  // you're actively typing in. Restoring focus to wherever it was right
  // before we touched anything keeps our background cleanup from hijacking
  // your keystrokes.
  function restoreFocusIfNeeded(target) {
    if (
      target &&
      target !== document.activeElement &&
      document.body.contains(target) &&
      typeof target.focus === 'function'
    ) {
      target.focus();
    }
  }

  function expandAndRemove(trimButton) {
    const focusBeforeClick = document.activeElement;

    trimButton.click();
    restoreFocusIfNeeded(focusBeforeClick);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      restoreFocusIfNeeded(focusBeforeClick);
    };

    const observer = new MutationObserver(() => {
      if (removeQuotesNear(trimButton)) {
        finish();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(finish, REMOVAL_TIMEOUT_MS);
  }

  function scan() {
    document.querySelectorAll(`${TRIM_BUTTON_SELECTOR}:not([data-gqc-handled])`).forEach((trimButton) => {
      // Skip trim buttons that aren't actually visible right now (e.g. a
      // minimized/background compose window) — no need to touch them yet,
      // and it avoids needless focus disruption. They'll be picked up once
      // they become visible.
      if (trimButton.offsetParent === null) {
        return;
      }

      trimButton.setAttribute('data-gqc-handled', 'true');

      if (threadMatchesException(trimButton)) {
        return; // Excluded correspondent: leave the "..." collapsed, untouched.
      }

      expandAndRemove(trimButton);
    });
  }

  setInterval(scan, SCAN_MS);
})();
