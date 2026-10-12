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
