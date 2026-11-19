'use strict';

const copyButton = document.querySelector('[data-testid="copy-extensions"]');
const copyStatus = document.querySelector('[data-testid="copy-status"]');
if (copyButton && copyStatus) {
  copyButton.hidden = false;
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('chrome://extensions');
      copyStatus.textContent = 'Copied. Paste it into Chrome’s address bar.';
    } catch {
      copyStatus.textContent = 'Select and copy chrome://extensions, then paste it into Chrome’s address bar.';
    }
  });
}

// Chrome extensions do not run on phones or tablets: tell mobile visitors.
const isMobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
if (isMobile) for (const note of document.querySelectorAll('[data-testid="mobile-note"]')) note.hidden = false;

// Show which version the manual developer ZIP contains.
const zipVersion = document.querySelector('[data-testid="zip-version"]');
if (zipVersion) {
  fetch('/downloads/release.json').then(response => (response.ok ? response.json() : null)).then(release => {
    if (release?.version) zipVersion.textContent = release.version;
  }).catch(() => {});
}

