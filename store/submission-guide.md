# Publish a webTopdf update

webTopdf is live on the Chrome Web Store: https://chromewebstore.google.com/detail/webtopdf/mjaclamnjdmipobljileifmgkppiaeeb

This folder contains the listing text and graphics. Each release also produces `webtopdf-extension-v<version>.zip` (included in the store kit and built into `.artifacts/`). Upload that extension ZIP, not the outer kit ZIP. Its `manifest.json` is at the archive root.

1. Open https://chrome.google.com/webstore/devconsole/ in Chrome and sign in to the publisher account.
2. Open the existing webTopdf item, choose **Package**, then **Upload new package**, and select `webtopdf-extension-v<version>.zip`.
3. Check the **Store listing** tab against `listing.txt` (English and Arabic). Add or refresh screenshots (`screenshot-capture.png`, 1280×800; up to five are allowed), `promo-small.png` (440×280) and `promo-marquee.png` (1400×560) if they changed. `fields.txt` maps each field.
4. Check the **Privacy** tab against `privacy-and-permissions.txt` and `privacy-form.txt`. The data categories declared there (website content, web history, user activity) must match the "Data the extension handles" table on https://webtopdf.mulhamkassab.dev/privacy.
5. On **Account**, make sure the public developer contact email is set. The privacy policy and Help page point visitors to it, so no address is written in this repository.
6. Save the draft and use **Submit for review**. Choose automatic publication after approval if you want the update released as soon as Google approves it.

Official publishing instructions: https://developer.chrome.com/docs/webstore/publish.
