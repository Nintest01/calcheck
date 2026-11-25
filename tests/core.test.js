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

test("no tag in ticket: KM empty = no check; KM tags noted, FAIL only on wrong format", () => {
  assert.equal(kmTagFormatCheck(""), null);
  const ok = kmTagFormatCheck("tag.store.bp43, tag.x"); assert.equal(ok.pass, null); assert.ok(/KM has: tag\.store\.bp43/.test(ok.line));
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
  assert.ok(r.cases.every(c => c.global === ""));                                   // no Global row in the ticket: not checked
  const gdoc = JSON.parse(raw), cell = t => ({ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
  gdoc.description.content.find(n => n.type === "table").content.push({ type: "tableRow", content: [cell("Global Event"), cell("Yes")] });
  assert.ok(run(JSON.stringify(gdoc)).cases.every(c => c.global === "yes"));        // "Global Event | Yes" row -> every program
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

test("'Target calendar shard tag' line: one CAL row per calendar in the table, with that Tag", () => {
  const cell = t => ({ type: "tableCell", content: [{ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] }] });
  const row = (...c) => ({ type: "tableRow", content: c.map(cell) });
  const para = t => ({ type: "paragraph", content: [{ type: "text", text: t }] });
  const doc = { type: "doc", content: [para("Target calendar shard tag: events-rps"), { type: "table", content: [
    row("Calendar ID", "Eligible Shards", "Shard Tags", "Program ID", "Content", "Type", "Start Time"),
    row("cal.bp.generic", "b077", "season1-m2", "b077.season1m2.battlepass", "cal.bp.33", "Calendar IDs", "11/26/2026, 00:00:00 UTC"),
    row("cal.bp.generic", "b077", "season1-m2", "b077.season1m2.kvk", "cal.onboard.kvk", "Calendar IDs", "12/17/2026, 00:00:00 UTC")] }] };
  const cs = parseTicketV2(doc, { title: "Seasonal Calendar for b077" }).cases;
  assert.equal(parseTicketV2(doc, { title: "Battle pass fund" }).cases.filter(c => c.calCheck).length, 0);   // title without "calendar": no CAL row
  const cal = cs.filter(c => c.calCheck);
  assert.equal(cal.length, 1); assert.equal(cal[0].calId, "cal.bp.generic"); assert.equal(cal[0].expTag, "events-rps");
  assert.equal(cs.filter(c => !c.calCheck).length, 2);
});

test("offer / pack ticket: Flag is compared and 'Shard Targets' becomes the Shard Tag", () => {
  const p = t => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
  const cell = (...lines) => ({ type: "tableCell", content: lines.map(p) });
  const row = (label, ...lines) => ({ type: "tableRow", content: [cell(label), cell(...lines)] });
  const doc = { type: "doc", content: [{ type: "table", content: [
    row("Vertical", "beq"),
    row("Flag", "store-bp33v2-generic-token"),
    row("Shard Targets", "season1-m2"),
    row("Store Window ID", "sw.bp33.store.tokens"),
    row("Start Date",
      "Week 1: 2/5/2026 2:00 UTC, duration 23h 59m, repeat every 1 day, 4 occurences, program id: store.3.tokens.beq.wk1",
      "Week 3: 2/19/2026 2:00 UTC, duration 4d, program id: store.3.tokens.beq.wk3"),
    row("Calendar ID", "cal.bp.33")] }] };
  const cs = parseTicketV2(doc, { title: "iBP33 | Relic Token pack" }).cases;
  const cal = cs.filter(c => c.calCheck), prog = cs.filter(c => !c.calCheck);
  // "Shard Targets" -> one CAL row: the calendar's own Tag, checked on the calendar's first page
  assert.equal(cal.length, 1);
  assert.equal(cal[0].calId, "cal.bp.33"); assert.equal(cal[0].expTag, "season1-m2");
  assert.equal(cs[0], cal[0]);              // the calendar is checked first
  assert.equal(prog.length, 2);
  assert.ok(prog.every(c => c.flag === "store-bp33v2-generic-token" && c.flagCmp === true));   // compared, not just recorded
  assert.ok(prog.every(c => !c.shard));     // NOT checked on each program
  assert.deepEqual(prog.map(c => c.progId), ["store.3.tokens.beq.wk1", "store.3.tokens.beq.wk3"]);
  assert.deepEqual(prog.map(c => c.dur), ["23h 59m", "4d"]);
  assert.equal(prog[0].repeatEvery, 1); assert.equal(prog[0].endsAfter, 4);
  assert.equal(prog[1].repeatEvery, null);  // repeat belongs to its own line only
});
