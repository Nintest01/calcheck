// Per-ticket / per-row extras: Global, Repeat, label|value scan (pure).
import { adfCellLines } from "../adf.js";

// "x = 1 - 12" or "x = 1, 3, 5, 7,\u202623" (an ellipsis continues the step of the first two values)
// -> { l: "x", vals: [...] } or null
export function eventValues(line) {
  const m = String(line).match(/(?<![a-z0-9])([a-z])\s*=\s*(\d[\d\s,.\u2026\u2013-]*\d)/i);
  if (!m) return null;
  const txt = m[2], nums = (txt.match(/\d+/g) || []).map(Number), dots = /\u2026|\.\.\./.test(txt);
  let vals = nums;
  if (!dots && nums.length === 2 && !/,/.test(txt) && /[-\u2013]/.test(txt) && nums[1] >= nums[0]) { vals = []; for (let n = nums[0]; n <= nums[1]; n++) vals.push(n); }
  else if (dots && nums.length >= 3) {
    const step = nums[1] - nums[0], head = nums.slice(0, -1), last = nums[nums.length - 1];
    if (step > 0 && last >= head[head.length - 1] && head.every((v, i) => v === nums[0] + i * step)) { vals = []; for (let n = nums[0]; n <= last; n += step) vals.push(n); }
  }
  return vals.length && vals.length <= 200 ? { l: m[1].toLowerCase(), vals } : null;
}

// Event prototype with the placeholder letter ("ev.blitz.hf26.x.slb") -> one concrete event per value of x
// ([] when the prototype has no such placeholder)
export function expandEventRange(proto, rg) {
  if (!rg) return [];
  const re = new RegExp("\\." + rg.l + "(?=\\.|$)", "i");
  return re.test(proto) ? rg.vals.map(n => proto.replace(re, "." + n)) : [];
}

// Slot numbers in program names ("...day1.01...", "...day1.03...", "...day2.01...") restart in every cycle
// (day). -> { cycles, size } when every cycle has the same size, else null. No slot numbers = one cycle.
export function nameCycles(names) {
  const slots = names.map(nm => { const t = String(nm).split(/[.\-_\s]+/).filter(x => /^\d+$/.test(x)); return t.length ? +t[t.length - 1] : null; });
  if (slots.some(x => x === null)) return { cycles: 1, size: names.length };
  const sizes = []; let prev = -1;
  slots.forEach(x => { if (x <= prev || !sizes.length) sizes.push(0); sizes[sizes.length - 1]++; prev = x; });
  return sizes.every(z => z === sizes[0]) ? { cycles: sizes.length, size: sizes[0] } : null;
}

// Flatten all 2+ column table rows into a { label(lowercased) : value } map.
export function labelValueScan(doc) {
  const out = {};
  const tables = [];
  (function w(n) { if (!n) return; if (n.type === "table") tables.push(n); (n.content || []).forEach(w); })(doc);
  tables.forEach(tb => (tb.content || []).forEach(tr => {
    const cells = (tr.content || []).map(td => adfCellLines(td).join(" ").replace(/\s+/g, " ").trim());
    if (cells.length >= 2 && cells[0]) {
      const key = cells[0].toLowerCase().replace(/[:\s]+$/, "").trim();
      if (!(key in out)) out[key] = cells.slice(1).filter(Boolean).join(" | ");
    }
  }));
  return out;
}

// Global: "yes" only when the ticket explicitly says yes; empty/"no"/absent -> "".
export function parseGlobal(lvMap, docText) {
  let g = lvMap["global"] || lvMap["global event"] || "";
  if (!g) { const m = (docText || "").match(/global(?:\s*event)?\s*[:\-]?\s*(yes|no)\b/i); if (m) g = m[1]; }
  g = (g || "").toLowerCase();
  if (g.indexOf("yes") >= 0) return "yes";
  if (g.indexOf("no") >= 0) return "no";
  return "";
}

// Repeat: parses both "repeat every X day(s), N occurrences" and "repeat daily for
// N days". Returns { repeatEvery, endsAfter } or null when there's no repeat data.
export function parseRepeat(text) {
  const t = (text || "").toLowerCase();
  if (t.indexOf("repeat") < 0 && t.indexOf("daily") < 0) return null;
  let every = null, occ = null, m;
  if ((m = t.match(/every\s+(\d+)\s*days?/))) every = +m[1];
  if (every == null && /\bdaily\b/.test(t)) every = 1;
  if ((m = t.match(/(\d+)\s*occurr?ences?/))) occ = +m[1]; // also accepts the common typo "occurences"
  if (occ == null && (m = t.match(/for\s+(\d+)\s*days?/))) occ = +m[1];
  if (every == null && occ == null) return null;
  if (every == null && occ != null) every = 1; // "for N days" implies daily
  return { repeatEvery: every, endsAfter: occ };
}

// Per-row schedule extras for program-per-row tables: reads the row's OWN
// Global Event column and Repeat (embedded in the Duration cell), keyed by
// Program ID, so each program is checked with its own data only.
export function parsePerRowExtras(doc) {
  const map = {};
  const tables = [];
  (function w(n) { if (!n) return; if (n.type === "table") tables.push(n); (n.content || []).forEach(w); })(doc);
  for (const tb of tables) {
    const rows = (tb.content || []).map(tr => (tr.content || []).map(td => adfCellLines(td).join(" ").replace(/\s+/g, " ").trim()));
    if (rows.length < 2) continue;
    const header = rows[0].map(h => h.toLowerCase());
    const findCol = (names) => { for (const nm of names) { const i = header.findIndex(h => h.indexOf(nm) >= 0); if (i >= 0) return i; } return -1; };
    const pIdx = findCol(["program id", "program name"]);
    const dIdx = header.findIndex(h => /(^|[^a-z])duration/.test(h) && !/pre|post/.test(h));
    const gIdx = findCol(["global"]);
    if (pIdx < 0 || (dIdx < 0 && gIdx < 0)) continue; // not the per-row schedule table
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const progId = (row[pIdx] || "").trim();
      if (!progId) continue;
      const durCell = dIdx >= 0 ? (row[dIdx] || "") : "";
      const globalVal = gIdx >= 0 ? (row[gIdx] || "").trim() : "";
      const rep = parseRepeat(durCell);
      const durClean = rep ? durCell.replace(/[,;]?\s*repeat\b.*$/i, "").trim() : null;
      const gnorm = /\byes\b/i.test(globalVal) ? "yes" : (/\bno\b/i.test(globalVal) ? "no" : "");
      if (gnorm || rep) map[progId] = { global: gnorm, repeatEvery: rep ? rep.repeatEvery : null, endsAfter: rep ? rep.endsAfter : null, dur: durClean };
    }
    if (Object.keys(map).length) return map;
  }
  return map;
}
