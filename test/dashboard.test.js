const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const logic = require("../public/dashboard-logic.js");

test("DexScreener URLs are allowlisted", () => {
  assert.equal(
    logic.safeDexScreenerUrl("https://dexscreener.com/solana/example"),
    "https://dexscreener.com/solana/example",
  );
  assert.equal(logic.safeDexScreenerUrl("javascript:alert(1)"), null);
  assert.equal(logic.safeDexScreenerUrl("https://dexscreener.com.evil.example/pair"), null);
  assert.equal(logic.safeDexScreenerUrl("http://dexscreener.com/pair"), null);
});

test("V2 scoring identifies a strong launch", () => {
  const result = logic.scoreV2({
    ageMin: 5,
    liquidityUsd: 30000,
    volume24h: 250000,
    reasons: ["buys5m>=sells5m(+1)", "px+10%/1m(+1)"],
  });

  assert.equal(result.score, 8);
  assert.equal(result.confidence, "High");
  assert.equal(result.stage, "Stage 1 — Launch");
});

test("V2 scoring caps illiquid pairs", () => {
  const result = logic.scoreV2({ ageMin: 2, liquidityUsd: 1000, volume24h: 300000 });
  assert.ok(result.score <= 2);
  assert.equal(result.action, "Avoid");
  assert.ok(result.tags.includes("Illiquid Microcap"));
});

test("reason groups keep risk and momentum separate", () => {
  const groups = logic.groupReasons(["liq>=80k(+2)", "liq+50%/3m(+2)", "fdv>5m(-2)"]);
  assert.equal(groups.base.length, 1);
  assert.equal(groups.momentum.length, 1);
  assert.equal(groups.risk.length, 1);
});

test("legacy routes redirect into the shared dashboard", () => {
  const projectRoot = path.resolve(__dirname, "..");
  const aliases = {
    "public/index copy.html": "view=10m",
    "public/meme15m.html": "view=15m",
    "public/meme30m.html": "view=30m",
    "public/meme60m.html": "view=60m",
    "public/morememe.html": "view=v2",
  };

  for (const [file, query] of Object.entries(aliases)) {
    const html = fs.readFileSync(path.join(projectRoot, file), "utf8");
    assert.match(html, new RegExp(query));
    assert.match(html, /index\.html/);
  }
});

test("the shared dashboard loads the hardened modules", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../public/index.html"), "utf8");
  assert.match(html, /dashboard-shell\.js/);
  assert.match(html, /dashboard-logic\.js/);
  assert.match(html, /dashboard-app\.js/);
  assert.doesNotMatch(html, /Debug:/);
});
