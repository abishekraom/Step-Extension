const toggleButton = document.getElementById('toggleButton');
const versionText = document.getElementById('versionText');
const updateNotice = document.getElementById('updateNotice');
const updateMessage = document.getElementById('updateMessage');
const updateLink = document.getElementById('updateLink');

const currentVersion = chrome.runtime.getManifest().version;
versionText.textContent = `Installed version: V${currentVersion}`;

function renderToggle(isEnabled) {
  toggleButton.textContent = isEnabled ? 'Turn Extension OFF' : 'Turn Extension ON';
}

chrome.storage.local.get({ isEnabled: true }, ({ isEnabled }) => {
  renderToggle(isEnabled);
});

toggleButton.addEventListener('click', async () => {
  const { isEnabled = true } = await chrome.storage.local.get('isEnabled');
  const nextEnabled = !isEnabled;
  await chrome.storage.local.set({ isEnabled: nextEnabled });
  renderToggle(nextEnabled);
  alert(`Extension is now ${nextEnabled ? 'ON' : 'OFF'}`);
});

function renderUpdateStatus(status) {
  if (!status?.updateAvailable) {
    updateNotice.style.display = 'none';
    return;
  }

  updateMessage.textContent =
    `Version V${status.latestVersion} is available. Download it and replace your current extension files.`;
  updateLink.href = status.releaseUrl || updateLink.href;
  updateNotice.style.display = 'block';
}

chrome.runtime.sendMessage({ type: 'CHECK_FOR_UPDATE' }, response => {
  if (chrome.runtime.lastError) {
    console.warn('[StepExt] Could not request update status:', chrome.runtime.lastError.message);
    return;
  }

  renderUpdateStatus(response);
});
