const launch = document.getElementById('launch-settings') as HTMLButtonElement;
const status = document.getElementById('settings-status') as HTMLParagraphElement;
launch.addEventListener('click', () => {
  void chrome.tabs
    .getCurrent()
    .then(async (tab) => {
      if (tab?.id === undefined) throw new Error();
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel.html?view=settings',
        enabled: true,
      });
      await chrome.sidePanel.open({ tabId: tab.id });
    })
    .catch(() => {
      status.textContent =
        'Select LCTrack’s toolbar icon, then Settings. Credentials are entered only in the side panel.';
    });
});
