chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ isEnabled: true, overlayHidden: false });
  checkForUpdates({ force: true });
});

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LATEST_RELEASE_API = 'https://api.github.com/repos/abishekraom/Step-Extension/releases/latest';
const RELEASES_URL = 'https://github.com/abishekraom/Step-Extension/releases';

function compareVersions(left, right) {
  const parse = value => String(value)
    .replace(/^v/i, '')
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index++) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

function extractReleaseVersion(release) {
  const candidates = [release?.name, release?.tag_name];

  for (const candidate of candidates) {
    const match = String(candidate || '').match(/\d+(?:\.\d+){0,3}/);
    if (match) return match[0];
  }

  return '';
}

async function updateBadge(updateAvailable) {
  await chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
  await chrome.action.setBadgeText({ text: updateAvailable ? 'UP' : '' });
}

async function checkForUpdates({ force = false } = {}) {
  const currentVersion = chrome.runtime.getManifest().version;
  const { updateStatus } = await chrome.storage.local.get('updateStatus');
  const cacheIsFresh = updateStatus?.checkedAt &&
    Date.now() - updateStatus.checkedAt < UPDATE_CHECK_INTERVAL_MS;

  if (!force && cacheIsFresh) {
    await updateBadge(!!updateStatus.updateAvailable);
    return updateStatus;
  }

  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (!response.ok) {
      throw new Error(`GitHub release check returned HTTP ${response.status}`);
    }

    const release = await response.json();
    const latestVersion = extractReleaseVersion(release);
    if (!latestVersion) throw new Error('Latest release did not include a version tag.');

    const status = {
      checkedAt: Date.now(),
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url || RELEASES_URL,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    };

    await chrome.storage.local.set({ updateStatus: status });
    await updateBadge(status.updateAvailable);
    console.log('[StepExt] Update check complete:', status);
    return status;
  } catch (error) {
    console.warn('[StepExt] Update check failed:', error);
    if (updateStatus) return updateStatus;

    return {
      checkedAt: null,
      currentVersion,
      latestVersion: null,
      releaseUrl: RELEASES_URL,
      updateAvailable: false,
      error: error.message,
    };
  }
}

chrome.runtime.onStartup.addListener(() => {
  checkForUpdates();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'CHECK_FOR_UPDATE') return;

  checkForUpdates({ force: !!message.force })
    .then(sendResponse)
    .catch(error => sendResponse({ error: error.message }));
  return true;
});

// overlay visibility toggle (Ctrl+Shift+X)
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-answer-popup') return;

  const [activeStepTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
    url: ['https://english.steptest.in/*'],
  });
  if (!activeStepTab) return;

  const { overlayHidden = false } = await chrome.storage.local.get('overlayHidden');
  const next = !overlayHidden;
  await chrome.storage.local.set({ overlayHidden: next });

  const tabs = await chrome.tabs.query({
    url: ['https://english.steptest.in/*'],
  });
  await Promise.all(tabs.map(t => chrome.tabs.sendMessage(t.id, {
    type: 'OVERLAY_VISIBILITY',
    hidden: next
  }).catch(() => {})));
});
