# Vartex TeamDesk — Microsoft Store Onboarding & Submission Guide

This document provides the complete workflow for hosting your Privacy Policy, preparing an MSIX desktop package with a built-in native control agent (eliminating PowerShell scripts for remote users), opening your free Microsoft Store Developer Account, and publishing updates.

## Part 1: Host Your Privacy Policy on Render

1. Copy `public/privacy.html` from this kit into your GitHub repository's `public/` folder (or serve it at `/privacy.html`).
2. Push to GitHub so Render deploys the page.
3. Verify it opens cleanly in a browser at:
   `https://teamdesk.vartexengg.com/privacy.html`
4. Add a footer or menu link inside Vartex TeamDesk pointing to `/privacy.html`.

## Part 2: Open Your Free Microsoft Store Developer Account

1. Go to **https://storedeveloper.microsoft.com** and sign in with your personal Microsoft account (MSA).
2. Choose **Individual** developer account (**$0 registration fee**, no annual renewal fee).
3. Complete the **Identity Verification** step using a valid government-issued photo ID (Passport or National ID) and mobile selfie capture.
4. Once verified, open **Microsoft Partner Center** -> **Apps and games** -> **New product** -> **MSIX or PWA app**, and reserve the name **Vartex TeamDesk**.

## Part 3: Prepare & Package Your MSIX (Zero PowerShell for Remote Users)

To give remote users an AnyDesk/TeamViewer-style 1-click experience without PowerShell commands or Smart App Control blocks:

1. Bundle your Electron/Tauri desktop wrapper (`desktop-wrapper/main.js`) together with your local input agent so the agent starts automatically inside the app and shows a visible system tray icon + **Exit** button.
2. Ensure the app displays an explicit **Allow Control / Decline** dialog before enabling OS mouse & keyboard control (see `consent-prompt.js`).
3. Copy your **Package Family Name / Identity Name** and **Publisher CN** from Partner Center -> **Product management** -> **Product identity** into `AppxManifest.xml` (or your `electron-builder` `appx` configuration). Ensure `<DisplayName>` matches **Vartex TeamDesk**.
4. Build the unsigned `.msix` (or `.appx`) package (Partner Center signs it automatically during Store certification; do not embed an unsigned `.exe` downloader).
5. Test the package locally on Windows 11 before submitting using the **Windows App Certification Kit (WACK)**.

## Part 4: Submit to Microsoft Store & Manage Future Updates

1. In Partner Center -> **Submissions** -> **Start submission**:
   - **Pricing and availability**: Choose **Free** and select **Make this product available but not discoverable in the Store (Direct link only)**.
   - **Properties -> Privacy Policy URL**: Enter `https://teamdesk.vartexengg.com/privacy.html`.
   - **Packages**: Upload your `.msix` file.
   - **Store listings**: Add app description, screenshots, and your Vartex TeamDesk icon assets.
   - **Notes for certification**: Briefly explain that Vartex TeamDesk is a team remote support tool requiring explicit host user approval before remote mouse/keyboard control activates, and provide a test Workspace/Peer ID if needed for review.
2. Submit for certification (typically reviewed within 1–3 business days).
3. **Future Updates**:
   - Whenever you update the web UI on Render, users get web changes automatically without a Store resubmission.
   - Whenever you update the native desktop wrapper or agent, simply increment the `Version` number (e.g., `1.0.1.0`), upload the new `.msix` in Partner Center, and Microsoft Store automatically updates all installed PCs.
