# Dynamic Team Sync Setup Guide

Your `public/team.html` page automatically fetches live team member cards from `https://www.vartexengg.com/team.html` so any edits made on your main company website appear on `https://teamdesk.vartexengg.com/team.html` automatically.

Because browsers block cross-domain HTML requests without permission (CORS), choose **either Method A or Method B** below:

---

## Method A (Recommended): Add the 2-line Express route in your TeamDesk GitHub repo

1. Copy `server-routes/vartex-team-sync.js` into your `teamdesk` GitHub repository.
2. In your Express server entry file (`server.js` / `index.js`), before your catch-all/404 handler, add:
   ```js
   const { registerVartexTeamRoute } = require('./server-routes/vartex-team-sync');
   registerVartexTeamRoute(app);
   ```
3. Commit & push to GitHub (Render auto-deploys in ~1 minute).
4. Test `https://teamdesk.vartexengg.com/api/vartex-team` — it returns live JSON parsed directly from `https://www.vartexengg.com/team.html` (5-minute cache).

---

## Method B (No Express changes needed): Allow CORS in cPanel for `team.html`

If you prefer not to modify your Render Express server, open cPanel File Manager on `vartexengg.com` -> `public_html/.htaccess` and append:

```apache
<Files "team.html">
  <IfModule mod_headers.c>
    Header set Access-Control-Allow-Origin "https://teamdesk.vartexengg.com"
  </IfModule>
</Files>
```

`public/team.html` automatically checks `/api/vartex-team` first and falls back to direct CORS fetch if `/api/vartex-team` is not present. If neither is available, it displays its built-in synced fallback snapshot so visitors never see an empty section.
