// Drop-in vanilla JS installer for a button with id="install-app-btn"
// Example HTML: <button id="install-app-btn" hidden>Install TeamDesk</button>

(function () {
  let deferredPrompt = null;
  const installBtn = document.getElementById('install-app-btn');
  if (!installBtn) return;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (isStandalone) {
    installBtn.hidden = true;
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installBtn.hidden = true;
    }
    deferredPrompt = null;
  });

  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
    deferredPrompt = null;
  });
})();
