(() => {
  'use strict';

  const REMOVAL_TIMEOUT_MS = 3000;
  const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const MESSAGE_ROOT_SELECTOR = "div.adn, div[role='listitem']";
  const TRIM_BUTTON_SELECTOR = 'div.ajR';
  const UNHANDLED_TRIM_BUTTON_SELECTOR = `${TRIM_BUTTON_SELECTOR}:not([data-gqc-handled])`;
  const QUOTE_SELECTOR = '.gmail_quote_container, .gmail_quote';

  // In-memory cache of the exception list, kept in sync with chrome.storage.
  let exceptions = new Set();

  function normalizeEmail(value) {
    return (value || '').trim().toLowerCase();
  }

  function toSet(list) {
    return new Set((list || []).map(normalizeEmail).filter(Boolean));
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.exceptions) {
      exceptions = toSet(changes.exceptions.newValue);
    }
  });

  // Walk up from the trim button to find the message block it belongs to
  // (the rendered original email sitting above the compose box), *without*
  // needing to expand the "..." first — the sender is already in the DOM.
  function findMessageRootFor(el) {
    const closest = el.closest(MESSAGE_ROOT_SELECTOR);
    if (closest) return closest;

    let node = el.closest('div.gA, div.aeH, div[role="dialog"]') || el.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1) {
      const nested = node.querySelector && node.querySelector(MESSAGE_ROOT_SELECTOR);
      if (nested) return nested;
      node = node.previousElementSibling || node.parentElement;
    }
    return null;
  }

  // Try a couple of known-stable ways of reading the sender's address out of
  // the already-rendered message, with no click required.
  function getSenderEmail(trimButton) {
    const root = findMessageRootFor(trimButton);
    if (!root) return '';

    const senderSpan = root.querySelector('span.gD[email]');
    if (senderSpan) {
      return normalizeEmail(senderSpan.getAttribute('email'));
    }

    const anyMailbox = root.querySelector('[email]');
    if (anyMailbox) {
      return normalizeEmail(anyMailbox.getAttribute('email'));
    }

    const match = (root.textContent || '').match(EMAIL_PATTERN);
    return match ? normalizeEmail(match[0]) : '';
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

  function expandAndRemove(trimButton) {
    trimButton.click();

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
    };

    const observer = new MutationObserver(() => {
      if (removeQuotesNear(trimButton)) {
        finish();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(finish, REMOVAL_TIMEOUT_MS);
  }

  function handleTrimButton(trimButton) {
    if (trimButton.hasAttribute('data-gqc-handled')) return;
    trimButton.setAttribute('data-gqc-handled', 'true');

    const senderEmail = getSenderEmail(trimButton);
    if (senderEmail && exceptions.has(senderEmail)) {
      return; // Sender is excluded: leave the "..." collapsed, untouched.
    }

    expandAndRemove(trimButton);
  }

  // Inspect a single node that Gmail just added to the DOM. This only looks
  // inside the new subtree, so the cost is proportional to what changed,
  // not to the size of the whole page.
  function inspectAddedNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return; // skip text nodes (e.g. typing)

    if (node.matches(TRIM_BUTTON_SELECTOR)) {
      handleTrimButton(node);
    }
    if (node.firstElementChild) {
      node.querySelectorAll(UNHANDLED_TRIM_BUTTON_SELECTOR).forEach(handleTrimButton);
    }
  }

  function start() {
    // Catch any trim buttons that already exist when the script starts.
    document.querySelectorAll(UNHANDLED_TRIM_BUTTON_SELECTOR).forEach(handleTrimButton);

    // From now on, react only when new nodes are added — no polling.
    const pageObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(inspectAddedNode);
      }
    });
    pageObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Load the exception list first, then start observing, so an excluded
  // sender can never be processed before the list is available.
  chrome.storage.sync.get({ exceptions: [] }, (data) => {
    exceptions = toSet(data.exceptions);
    start();
  });
})();