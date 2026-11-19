# TeamDesk — Installable Web App (PWA) Deployment Guide

This package converts **TeamDesk** into an installable Progressive Web App (PWA) hosted on Render over HTTPS. Users on Windows 11 can install TeamDesk directly from Microsoft Edge or Google Chrome with a Desktop icon, Start Menu entry, and standalone app window—without distributing an unsigned `.exe` or triggering Windows Smart App Control.

## 1. Included Files

- `public/manifest.json` — Web App Manifest declaring app name, display mode (`standalone`), colors, and icon set.
- `public/sw.js` — Service Worker handling offline app-shell caching and network-first HTML updates.
- `public/pwa-192x192.png` — Standard 192x192 launcher icon (`purpose: "any"`).
- `public/pwa-512x512.png` — High-resolution 512x512 store/splash icon (`purpose: "any"`).
- `public/pwa-maskable-512x512.png` — Adaptive icon with safe-zone margin (`purpose: "maskable"`).
- `public/apple-touch-icon.png` — 180x180 iOS Safari home screen icon.
- `index-head-snippet.html` — Meta tags, manifest link, favicon, and Service Worker registration script.
- `pwa-install-button.*` — Optional in-app "Install TeamDesk" button component/script.

## 2. Upload to GitHub & Deploy on Render

1. Copy the contents of `public/` from this bundle into your repository's static/public directory.
   For Express/Node.js, ensure `app.use(express.static("public"))` is enabled and that `/sw.js` is served from the root URL.
2. Add the tags from `index-head-snippet.html` inside your HTML `<head>` and the Service Worker registration right before `</body>`.
3. Commit and push your changes to GitHub:
   ```bash
   git add .
   git commit -m "Add TeamDesk PWA manifest and icons"
   git push origin main
   ```
4. Wait for Render to automatically build and deploy the updated commit to `https://teamdesk.onrender.com`.

## 3. Install TeamDesk on Windows 11 (No Smart App Control Block)

1. Open `https://teamdesk.onrender.com` in **Microsoft Edge** or **Google Chrome**.
2. Click the **Install TeamDesk** icon in the right side of the address bar (or open browser menu -> **Apps** -> **Install this site as an app**).
3. Confirm the prompt and enable **Create Desktop shortcut**, **Pin to Start**, and **Pin to Taskbar** if desired.
4. TeamDesk now launches in its own dedicated app window with its desktop icon and Start Menu entry—zero `.exe` file and zero Windows Smart App Control warnings.
