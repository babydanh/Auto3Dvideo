const GROUP_TITLE = "Auto3Dvideo · GOOGLE FLOW · AUTO";
const GROUP_COLOR = "cyan";
const FLOW_HOSTS = new Set([
  "flow.google.com",
  "labs.google",
]);

let organizeTimer = null;

function scheduleOrganize() {
  if (organizeTimer !== null) clearTimeout(organizeTimer);
  organizeTimer = setTimeout(() => {
    organizeTimer = null;
    void organizeFlowTabs();
  }, 250);
}

function isFlowTab(tab) {
  try {
    const url = new URL(tab.url || "");
    return url.protocol === "https:" && FLOW_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function isProjectTab(tab) {
  return isFlowTab(tab) && /\/project\//i.test(tab.url || "");
}

async function storedTarget() {
  const state = await chrome.storage.local.get(["autoTargetTabId"]);
  if (typeof state.autoTargetTabId !== "number") return null;
  try {
    const tab = await chrome.tabs.get(state.autoTargetTabId);
    return isProjectTab(tab) ? tab : null;
  } catch {
    return null;
  }
}

async function chooseTarget(flowTabs) {
  const saved = await storedTarget();
  if (saved) return saved;
  return [...flowTabs]
    .filter(isProjectTab)
    .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0]
    || [...flowTabs].sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0]
    || null;
}

async function focusTarget(tab) {
  if (!tab) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

async function organizeFlowTabs() {
  const tabs = await chrome.tabs.query({
    url: ["https://flow.google.com/*", "https://labs.google/*"],
  });
  const flowTabs = tabs.filter(isFlowTab);
  if (!flowTabs.length) return { status: "idle", tabCount: 0, targetTabId: null };

  const target = await chooseTarget(flowTabs);
  const tabCount = flowTabs.length;
  const groupIdsByWindow = new Map();
  for (const tab of flowTabs) {
    if (!Number.isInteger(tab.windowId)) continue;
    const list = groupIdsByWindow.get(tab.windowId) || [];
    if (Number.isInteger(tab.id)) list.push(tab.id);
    groupIdsByWindow.set(tab.windowId, list);
  }
  for (const [windowId, tabIds] of groupIdsByWindow) {
    if (!tabIds.length) continue;
    const existingGroup = flowTabs.find((tab) => tab.windowId === windowId && Number.isInteger(tab.groupId) && tab.groupId >= 0)?.groupId;
    const groupId = Number.isInteger(existingGroup)
      ? await chrome.tabs.group({ tabIds, groupId: existingGroup })
      : await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: GROUP_TITLE,
      color: GROUP_COLOR,
      collapsed: false,
    });
  }

  if (target?.id) {
    await chrome.storage.local.set({ autoTargetTabId: target.id, autoGroupId: target.groupId ?? null });
    await focusTarget(target);
  }
  return { status: "ready", tabCount, targetTabId: target?.id ?? null, groupId: target?.groupId ?? null };
}

chrome.runtime.onInstalled.addListener(() => void organizeFlowTabs());
chrome.runtime.onStartup.addListener(() => void organizeFlowTabs());
chrome.tabs.onCreated.addListener(scheduleOrganize);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") scheduleOrganize();
});
chrome.tabs.onActivated.addListener(scheduleOrganize);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "organize-auto-flow") return false;
  organizeFlowTabs()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ status: "blocked", message: String(error).slice(0, 240) }));
  return true;
});
