const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');

let statusTimer = null;

// --- Part 1: Localization and text direction ---
function localizeHtmlPage() {
  // Set page direction (RTL/LTR) automatically based on the UI language
  document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir');
  document.documentElement.lang = chrome.i18n.getUILanguage();

  // Replace the text of every element that has a data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const message = chrome.i18n.getMessage(element.getAttribute('data-i18n'));
    if (message) {
      element.innerHTML = message;
    }
  });
}
// Apply localization as soon as the popup loads
localizeHtmlPage();

// --- Part 2: Exception list logic ---

// Turn the textarea content into a clean list:
// trimmed, lowercased, no empty lines, no duplicates.
function parseList(text) {
  const items = text
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(items)];
}

function updateCount() {
  const count = parseList(listEl.value).length;

  // Use the localized word for "address" / "addresses"
  const word = count === 1
    ? chrome.i18n.getMessage('addressSingular')
    : chrome.i18n.getMessage('addressPlural');

  countEl.textContent = `${count} ${word}`;
}

// Load the saved exception list
chrome.storage.sync.get({ exceptions: [] }, (data) => {
  listEl.value = (data.exceptions || []).join('\n');
  updateCount();
});

// Update the counter while typing
listEl.addEventListener('input', updateCount);

// Save
document.getElementById('save').addEventListener('click', () => {
  const exceptions = parseList(listEl.value);

  chrome.storage.sync.set({ exceptions }, () => {
    // Storage can fail (e.g. sync quota of ~8KB per item exceeded)
    if (chrome.runtime.lastError) {
      console.error('Failed to save exceptions:', chrome.runtime.lastError.message);
      return;
    }

    // Show the cleaned-up (deduplicated) list back to the user
    listEl.value = exceptions.join('\n');
    updateCount();

    statusEl.style.display = 'flex';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.style.display = 'none';
    }, 2000);
  });
});