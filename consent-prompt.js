// Drop-in explicit user consent dialog before activating Host OS Control
// Ensures compliance with Microsoft Store remote desktop consent policies.

export function requestHostControlConsent({ requesterId, onAllow, onDecline }) {
  const existing = document.getElementById('teamdesk-consent-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'teamdesk-consent-modal';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(9,18,42,0.65);padding:16px;font-family:system-ui,sans-serif;';

  overlay.innerHTML = `
    <div style="max-width:420px;width:100%;background:#fff;border-radius:12px;padding:24px;box-shadow:0 20px 40px rgba(0,0,0,0.2);">
      <h3 style="margin:0 0 8px;font-size:17px;color:#0f172a;">Allow Remote Control?</h3>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#475569;">
        Peer <strong>${String(requesterId || 'Team Member')}</strong> is requesting permission to
        view your screen and control your mouse and keyboard via Vartex TeamDesk.
      </p>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="td-decline-btn" style="padding:9px 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-weight:600;cursor:pointer;">
          Decline
        </button>
        <button id="td-allow-btn" style="padding:9px 16px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:600;cursor:pointer;">
          Allow Control
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('td-decline-btn').onclick = () => {
    overlay.remove();
    if (typeof onDecline === 'function') onDecline();
  };

  document.getElementById('td-allow-btn').onclick = () => {
    overlay.remove();
    if (typeof onAllow === 'function') onAllow();
  };
}
