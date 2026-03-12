chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ isEnabled: true, overlayHidden: false });
});

// overlay visibility toggle (Ctrl+Shift+X)
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-answer-popup') return;

  const { overlayHidden = false } = await chrome.storage.local.get('overlayHidden');
  const next = !overlayHidden;
  await chrome.storage.local.set({ overlayHidden: next });

  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(t => chrome.tabs.sendMessage(t.id, {
    type: 'OVERLAY_VISIBILITY',
    hidden: next
  }).catch(() => {})));
});
