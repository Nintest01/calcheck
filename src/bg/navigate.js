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
    // 2+ displays: its own window on a display other than the one you are using (always painted, nothing covers it).
    // 1 display: a background tab in your window (a small window gets covered by your apps and the capture fails).
    let w = null; try { w = await chrome.windows.getLastFocused(); } catch (e) {}
    let b = null;   // work area of the other display, if any
    try {
      const ds = await chrome.system.display.getInfo();
      const cx = w ? w.left + (w.width || 0) / 2 : 0, cy = w ? w.top + (w.height || 0) / 2 : 0;
      const inside = d => cx >= d.bounds.left && cx < d.bounds.left + d.bounds.width && cy >= d.bounds.top && cy < d.bounds.top + d.bounds.height;
      const cur = ds.find(inside) || ds[0];
      const other = ds.find(d => d !== cur);
      b = other ? other.workArea : null;
    } catch (e) {}
    if (b) {
      const W = Math.min(1366, b.width), H = Math.min(900, b.height);
      const win = await chrome.windows.create({ url: navUrl, type: "popup", focused: false, left: Math.round(b.left), top: Math.round(b.top), width: W, height: H });
      tabId = win.tabs[0].id;
      try { await chrome.windows.update(win.id, { state: "normal", left: Math.round(b.left), top: Math.round(b.top), width: W, height: H }); } catch (e) {}
      if (w && w.id != null) { try { await chrome.windows.update(w.id, { focused: true }); } catch (e) {} }
    } else {
      tabId = (await chrome.tabs.create({ url: navUrl, active: false })).id;
    }
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
