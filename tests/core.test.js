// Smoke tests for the pure modules in src/core (no chrome.*, no document).
// Run: npm test   (Node 18+)
import test from "node:test";
import assert from "node:assert/strict";
import { durSeconds, durVal } from "../src/core/duration.js";
import { slashDate, normDate, parseDateParts, parseTimeToken } from "../src/core/dates.js";
import { hasId, evLev, gluedParts, splitTagTokens } from "../src/core/ids.js";
import { cmpExact, cmpDuration, flagRuleChecks, kmTagFormatCheck } from "../src/core/compare.js";
import { withTerm, reportOutSize } from "../src/core/layout.js";
import { adfPlainText } from "../src/core/adf.js";
import { parseCountyConfig, parseTicketV2 } from "../src/core/parser/index.js";
import { eventValues, nameCycles } from "../src/core/parser/extras.js";
import { cmpVersion, manifestVersion, parseVersion } from "../src/core/version.js";

test("duration: compared by value, not by characters", () => {
  assert.equal(durSeconds("24h"), 86400);
  assert.equal(durSeconds("1d"), 86400);
  assert.equal(durSeconds("23h50m"), 85800);
  assert.equal(durVal(" 2d 3h "), "2d 3h");
  assert.equal(durVal("N/A"), "");
  assert.equal(cmpDuration("Duration", "24h", "1d").pass, true);
});

test("dates: weekday decides day/month order", () => {
  assert.equal(slashDate("Tuesday, 03/11/2026"), "11/3/2026");
  assert.equal(normDate("25th September 2026"), "9/25/2026");
  assert.deepEqual(parseDateParts("11/3/2026"), { mo: 11, d: 3, y: 2026 });
  assert.deepEqual(parseTimeToken("10:00 UTC"), { sec: 36000, tz: "UTC" });
});

test("ids: whole-id match, glued ids are split", () => {
  assert.equal(hasId("kvk-c033-b072, x", "kvk-c033"), false);
  assert.equal(hasId("kvk-c033, x", "KVK-C033"), true);
  assert.equal(evLev("abc", "abd"), 1);
  assert.deepEqual(gluedParts("ev.Atag.B"), ["ev.A", "tag.B"]);
  assert.deepEqual(splitTagTokens("ev.a.sms, tag.b"), { tokens: ["ev.a.sms", "tag.b"], glued: [] });
});

test("compare: exact match is case-insensitive, tbd flag is rejected", () => {
  assert.equal(cmpExact("Flag", "live", "Live").pass, true);
  const r = flagRuleChecks("tbd", "tbd", "program", true);
  assert.equal(r[0].pass, false);
  assert.equal(r[0].flagBad, "tbd");
});

test("layout + adf + parser entry", () => {
  assert.equal(withTerm("https://x.test/design/calendars?a=1", "cal.1"), "https://x.test/design/calendars?a=1&term=cal.1");
  assert.deepEqual(reportOutSize(4800, 1000), { w: 2400, h: 500, f: 0.5 });
  assert.equal(adfPlainText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] }), " hello");
  assert.deepEqual(parseTicketV2(null), { cases: [], warnings: [] });
});

test("version: compared number by number", () => {
  assert.equal(cmpVersion("2.33.0", "2.33.0"), 0);
  assert.equal(cmpVersion("2.33", "2.33.0"), 0);
  assert.equal(cmpVersion("2.9.0", "2.10.0"), -1);
  assert.equal(cmpVersion("2.34.0", "2.33.9"), 1);
  assert.equal(cmpVersion("2.33.0", "abc"), null);
  assert.deepEqual(parseVersion(" 2.33.0 "), [2, 33, 0]);
  assert.equal(manifestVersion('{"version":"2.33.0"}'), "2.33.0");
  assert.equal(manifestVersion("<html>404</html>"), "");
  assert.equal(manifestVersion('{"name":"x"}'), "");
});

test("parser: one program with two stacked tags keeps both", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = JSON.parse(readFileSync(new URL("./fixtures/one-program-two-tags.json", import.meta.url), "utf8"));
  const c = parseTicketV2(doc, { title: "iBP34 | Week 2 - Daily Login Fund 2" }).cases[0];
  assert.equal(c.tags, "tag.fund.bp34v2.daily.w2, tag.fund.bp34v2.daily.w2.gift");
  assert.equal(c.dur, "7d");
});

test("no tag in ticket: KM tags must exist and be tag.xxx", () => {
  assert.equal(kmTagFormatCheck("tag.store.bp43, tag.x").pass, true);
  assert.equal(kmTagFormatCheck("").pass, false);
  assert.equal(kmTagFormatCheck("tag.a, store.b").pass, false);
  assert.equal(kmTagFormatCheck("tag.").pass, false);
});

test("blitz: x = 1, 3, 5,...23 gives program i its i-th event (2 cycles of 6)", async () => {
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(new URL("./fixtures/blitz-x-list.json", import.meta.url), "utf8");
  const run = (txt) => { const j = JSON.parse(txt); return parseTicketV2(j.description, { title: j.summary }); };
  const r = run(raw), ev = r.cases.map(c => c.event.replace(/.*hf26\.|\.slb$/g, ""));
  assert.equal(r.cases.length, 12); assert.deepEqual(r.warnings, []);
  assert.deepEqual(ev, ["1", "3", "5", "7", "9", "11", "13", "15", "17", "19", "21", "23"]);
  assert.ok(r.cases.every(c => c.evSeq && c.flagCmp && c.flag === "hf26-blitz-spend-resource-slb"));
  const r2 = run(raw.replace("x = 1, 3, 5, 7,…23", "x = 1 - 12"));
  assert.equal(r2.cases[11].event, "ev.blitz.spend.resource.hf26.12.slb");
  const r3 = run(raw.replace("x = 1, 3, 5, 7,…23", "x = 1 - 11"));          // 11 events for 12 programs: guess nothing
  assert.ok(r3.warnings.some(w => /does not match/.test(w))); assert.ok(r3.cases.every(c => !c.event && !c.evSeq));
});

test("blitz helpers: x values, slot cycles", () => {
  assert.deepEqual(eventValues("x = 1 - 4").vals, [1, 2, 3, 4]);
  assert.deepEqual(eventValues("x = 1, 3, 5, 7,…11").vals, [1, 3, 5, 7, 9, 11]);
  assert.deepEqual(eventValues("n = 2, 6, 7").vals, [2, 6, 7]);
  assert.equal(eventValues("no range here"), null);
  const d = (day, n) => "blitz.hf26.day" + day + "." + n + ".spend";
  assert.deepEqual(nameCycles([d(1, "01"), d(1, "03"), d(2, "01"), d(2, "03")]), { cycles: 2, size: 2 });
  assert.equal(nameCycles([d(1, "01"), d(1, "03"), d(2, "01")]), null);
  assert.deepEqual(nameCycles(["a.b", "c.d"]), { cycles: 1, size: 2 });
});

test("county config: v3 / v4 / v5 columns with a coc id make a check per version", () => {
  const cell = (t, attrs) => ({ type: "tableCell", content: [{ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] }] });
  const row = (...c) => ({ type: "tableRow", content: c.map(x => cell(x)) });
  const doc = { type: "doc", content: [{ type: "table", content: [row("", "v3", "v4", "v5"), row("ID", "p.a", "p.b", "p.c"), row("County Config (if Applicable)", "coc.x.v3", "", "coc.x.v5"), row("Shard Tag", "s1", "", "s5")] }] };
  assert.deepEqual(parseCountyConfig(doc).map(b => b.ver + ":" + b.coc), ["v3:coc.x.v3", "v5:coc.x.v5"]);
});

test("county config: Start Time / Duration rows (one merged cell) are the spawn's own schedule", async () => {
  const { readFileSync } = await import("node:fs");
  const j = JSON.parse(readFileSync(new URL("./fixtures/blitz-county.json", import.meta.url), "utf8"));
  const b = parseCountyConfig(j.description);
  assert.deepEqual(b.map(x => x.ver + ":" + x.coc + ":" + x.shard), ["v3:coc.v3nux.ev.kvk.armies:events-v3nux-spawn", "v4:coc.v4.ev.kvk.armies:events-v4-spawn", "v5:coc.v5.ev.kvk.armies:events-v5-spawn"]);
  assert.ok(b.every(x => x.date === "11/27/2026" && x.time === "15:55:00 UTC" && x.dur === "2d 5m"));
  const r = parseTicketV2(j.description, { title: j.summary });
  assert.equal(r.cases.length, 12); assert.deepEqual(r.warnings, []); assert.equal(r.cases[10].event, "ev.blitz.pve.armies.hf26.22.slb");   // x = 2, 4, ...24
});
