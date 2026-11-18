// Work tab: open, wait, run injected code, go to a calendar / program.
import { inj_findClick, inj_modal, inj_url } from "./injected.js";

export const DESIGN_HOST = "design.km.globalworldwide.com";

// ============ orchestration ============
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function exec(tabId, func, args) {
  const res = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [], world: "MAIN" });
  return res && res[0] ? res[0].result : undefined;
}

export async function injectFile(tabId, file) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [file], world: "MAIN" });
}

export function waitTabComplete(tabId, timeout) {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = async () => {
      try { const t = await chrome.tabs.get(tabId); if (t.status === "complete") return resolve(true); }
      catch (e) { return resolve(false); }
      if (Date.now() - start > timeout) return resolve(true);
      setTimeout(tick, 300);
    };
    tick();
  });
}

export async function ensureWorkTab(navUrl) {
  const stored = await chrome.storage.session.get("workTabId");
  let tabId = stored.workTabId;
  if (tabId != null) { try { await chrome.tabs.get(tabId); } catch (e) { tabId = null; } }
  if (tabId == null) {
    // its own small window, not focused: a tab hidden behind your other tabs is not painted, so a screenshot of
    // it fails. Capture size is forced by emulation (see dbgEarly), so the window itself can stay small.
    // 2+ displays: open it on a display other than the one you are using. 1 display: bottom-right corner.
    const W = 480, H = 320;
    let w = null; try { w = await chrome.windows.getLastFocused(); } catch (e) {}
    let b = null;   // target display work-area bounds
    try {
      const ds = await chrome.system.display.getInfo();
      const cx = w ? w.left + (w.width || 0) / 2 : 0, cy = w ? w.top + (w.height || 0) / 2 : 0;
      const inside = d => cx >= d.bounds.left && cx < d.bounds.left + d.bounds.width && cy >= d.bounds.top && cy < d.bounds.top + d.bounds.height;
      const cur = ds.find(inside) || ds[0];
      const other = ds.find(d => d !== cur);
      b = (other || cur || {}).workArea || null;
    } catch (e) {}
    const opts = { url: navUrl, type: "popup", focused: false, width: W, height: H };
    if (b) { opts.left = Math.round(b.left + b.width - W - 16); opts.top = Math.round(b.top + b.height - H - 16); }
    const win = await chrome.windows.create(opts);
    tabId = win.tabs[0].id;
  }
  else { await chrome.tabs.update(tabId, { url: navUrl }); }
  await chrome.storage.session.set({ workTabId: tabId });
  return tabId;
}

export async function openCalendar(tabId, calId, maxMs) {
  const start = Date.now(); let everFound = false, lastClick = 0;
  while (Date.now() - start < maxMs) {
    let url = ""; try { url = await exec(tabId, inj_url); } catch (e) {}
    if (url && url.indexOf("/design/calendar/") >= 0) return "OK";
    if (!lastClick || Date.now() - lastClick >= 5000) {
      const r = await exec(tabId, inj_findClick, [calId]);
      if (r === "CLICKED") { everFound = true; lastClick = Date.now(); }
    }
    await sleep(500);
  }
  return everFound ? "CLICK_NO_NAV" : "NOT_FOUND";
}

export async function openProgram(tabId, progId, maxMs) {
  const start = Date.now(); let everFound = false, lastClick = 0;
  while (Date.now() - start < maxMs) {
    let m = "NOMODAL"; try { m = await exec(tabId, inj_modal); } catch (e) {}
    if (m === "MODAL") return "OK";
    if (!lastClick || Date.now() - lastClick >= 2000) {
      const r = await exec(tabId, inj_findClick, [progId]);
      if (r === "CLICKED") { everFound = true; lastClick = Date.now(); }
    }
    await sleep(500);
  }
  return everFound ? "CLICK_NO_MODAL" : "NOT_FOUND";
}
