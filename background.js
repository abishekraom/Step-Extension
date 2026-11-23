const DEFAULT_STATE = { isEnabled: true, overlayHidden: false };
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_ALARM_NAME = 'stepExtUpdateCheck';
const UPDATE_ALARM_PERIOD_MINUTES = 6 * 60;
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

function extractReleaseName(release) {
  return String(release?.name || release?.tag_name || '').trim();
}

function getReleasePublishedAt(release) {
  const parsed = Date.parse(release?.published_at || release?.created_at || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

// A release counts as an update when either:
// 1. Its version is greater than the installed manifest version, or
// 2. It was published after this build was installed. The second rule is what
//    makes every release notify, including tags like "V4" against a manifest
//    version of "4.0" (equal semver) and re-releases that reuse a version.
function analyzeRelease(release, currentVersion, installedAt) {
  const latestVersion = extractReleaseVersion(release);
  const versionIsNewer = !!latestVersion && compareVersions(latestVersion, currentVersion) > 0;
  const publishedAt = getReleasePublishedAt(release);
  const publishedAfterInstall = installedAt > 0 && publishedAt > 0 && publishedAt > installedAt;

  return {
    latestVersion,
    publishedAt,
    updateAvailable: versionIsNewer || publishedAfterInstall,
  };
}

async function getInstalledAt() {
  const { installedAt } = await chrome.storage.local.get('installedAt');
  if (Number.isFinite(installedAt) && installedAt > 0) return installedAt;

  // Existing installs from before this field existed get a baseline of "now" so
  // only releases published after this point count as new.
  const now = Date.now();
  await chrome.storage.local.set({ installedAt: now });
  return now;
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

  const installedAt = await getInstalledAt();

  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (!response.ok) {
      throw new Error(`GitHub release check returned HTTP ${response.status}`);
    }

    const release = await response.json();
    if (!release?.tag_name && !release?.name) {
      throw new Error('Latest release did not include a tag or name.');
    }

    const releaseCheck = analyzeRelease(release, currentVersion, installedAt);
    const status = {
      checkedAt: Date.now(),
      currentVersion,
      installedAt,
      latestVersion: releaseCheck.latestVersion,
      latestReleaseName: extractReleaseName(release),
      publishedAt: releaseCheck.publishedAt,
      releaseUrl: release.html_url || RELEASES_URL,
      updateAvailable: releaseCheck.updateAvailable,
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
      installedAt,
      latestVersion: null,
      latestReleaseName: '',
      publishedAt: null,
      releaseUrl: RELEASES_URL,
      updateAvailable: false,
      error: error.message,
    };
  }
}

function scheduleUpdateChecks() {
  chrome.alarms?.create?.(UPDATE_ALARM_NAME, {
    delayInMinutes: UPDATE_ALARM_PERIOD_MINUTES,
    periodInMinutes: UPDATE_ALARM_PERIOD_MINUTES,
  });
}

chrome.runtime.onInstalled.addListener(details => {
  chrome.storage.local.set(DEFAULT_STATE);
  if (details?.reason === 'install' || details?.reason === 'update') {
    chrome.storage.local.set({ installedAt: Date.now() });
  }
  scheduleUpdateChecks();
  checkForUpdates({ force: true });
});

chrome.runtime.onStartup.addListener(() => {
  scheduleUpdateChecks();
  checkForUpdates({ force: true });
});

chrome.alarms?.onAlarm?.addListener(alarm => {
  if (alarm?.name === UPDATE_ALARM_NAME) checkForUpdates({ force: true });
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
