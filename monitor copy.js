// monitor.js
const fs = require("fs");

const SEEN_FILE = "./seen_pairs.json";

// Used only to deduplicate high-score signals (avoids duplicate alerts)
let alerted = new Set();

if (fs.existsSync(SEEN_FILE)) {
  try {
    alerted = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")));
  } catch {
    alerted = new Set();
  }
}

function saveAlerted() {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...alerted], null, 2));
}

// ✅ More robust: validate HTTP status and HTML responses, and include the head in errors
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "meme-monitor/1.0",
    },
  });

  const text = await res.text();
  const head = text.slice(0, 140).replace(/\s+/g, " ");

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} | url=${url} | head=${head}`);
  }

  // DexScreener may occasionally return HTML (for example, due to rate limiting or bot protection)
  if (text.trim().startsWith("<")) {
    throw new Error(`Non-JSON (HTML) | url=${url} | head=${head}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON.parse failed | url=${url} | head=${head}`);
  }
}

// ====== Configurable parameters ======
const MIN_SCORE = 0;         // Minimum score pushed by the backend (0 or 1 recommended)
const DEDUP_SCORE = 5;       // Deduplicate only when score >= 5 (written to seen_pairs.json)

// ✅ Relaxed: many tokens have a missing or apparently older pairCreatedAt, so allow up to 60 minutes
const MAX_AGE_MIN = 60;

const LIQ_80K = 80000;
const LIQ_50K = 50000;
const VOL_200K = 200000;
const VOL_100K = 100000;

// Growth-rate scoring thresholds
const LIQ_1M_PCT_1 = 0.15;
const LIQ_3M_PCT_2 = 0.40;

const PRICE_1M_PCT_1 = 0.20;
const PRICE_3M_PCT_2 = 0.60;

const HISTORY_WINDOW_MS = 3 * 60 * 1000;
// ======================

// ====== In-memory history for calculating growth rates ======
const pairHistory = new Map();

function pushHistory(pairAddr, liqUsd, priceUsd) {
  const now = Date.now();
  const h = pairHistory.get(pairAddr) || { liq: [], price: [] };

  if (typeof liqUsd === "number") h.liq.push({ ts: now, v: liqUsd });
  if (typeof priceUsd === "number") h.price.push({ ts: now, v: priceUsd });

  h.liq = h.liq.filter((x) => now - x.ts <= HISTORY_WINDOW_MS);
  h.price = h.price.filter((x) => now - x.ts <= HISTORY_WINDOW_MS);

  pairHistory.set(pairAddr, h);
}

function pctChange(series, lookbackMs) {
  const now = Date.now();
  const cutoff = now - lookbackMs;

  if (!Array.isArray(series) || series.length < 2) return null;

  const latest = series[series.length - 1];

  let past = null;
  for (let i = 0; i < series.length; i++) {
    if (series[i].ts >= cutoff) {
      past = series[i];
      break;
    }
  }
  if (!past) past = series[0];

  if (!past || past.v <= 0) return null;
  return (latest.v - past.v) / past.v;
}

function scorePair(pair) {
  const reasons = [];
  let score = 0;

  const now = Date.now();

  // ✅ Do not return -999 when createdAt is missing; use an unknown age and continue scoring
  const createdAt = pair.pairCreatedAt;
  let ageMin = null;
  if (createdAt) {
    ageMin = (now - createdAt) / 60000;
    if (ageMin > MAX_AGE_MIN) {
      return { score: -999, reasons: ["too_old"], ageMin };
    }
  } else {
    reasons.push("no_createdAt(+0)");
  }

  const liq = pair.liquidity?.usd;
  const fdv = pair.fdv;
  const vol24 = pair.volume?.h24;
  const buys5m = pair.txns?.m5?.buys;
  const sells5m = pair.txns?.m5?.sells;

  const priceUsdNum = pair.priceUsd != null ? Number(pair.priceUsd) : null;

  if (pair.pairAddress) {
    pushHistory(
      pair.pairAddress,
      typeof liq === "number" ? liq : null,
      Number.isFinite(priceUsdNum) ? priceUsdNum : null
    );
  }

  // 1) Base liquidity score
  if (typeof liq === "number") {
    if (liq >= LIQ_80K) { score += 2; reasons.push("liq>=80k(+2)"); }
    else if (liq >= LIQ_50K) { score += 1; reasons.push("liq>=50k(+1)"); }
    else reasons.push("liq<50k(+0)");
  } else {
    // ✅ Do not reject outright; continue calculating other components (the score will remain low)
    reasons.push("liq_undefined(+0)");
  }

  // 2) Age (calculated only when createdAt is available)
  if (ageMin != null) {
    if (ageMin <= 5) { score += 1; reasons.push("age<=5m(+1)"); }
    else reasons.push("age>5m(+0)");
  } else {
    reasons.push("age_unknown(+0)");
  }

  // 3) Trading activity (24h volume)
  if (typeof vol24 === "number") {
    if (vol24 >= VOL_200K) { score += 2; reasons.push("vol24>=200k(+2)"); }
    else if (vol24 >= VOL_100K) { score += 1; reasons.push("vol24>=100k(+1)"); }
    else reasons.push("vol24<100k(+0)");
  } else {
    reasons.push("vol24_undefined(+0)");
  }

  // 4) Buy/sell pressure (5 minutes)
  if (typeof buys5m === "number" && typeof sells5m === "number") {
    if (buys5m > sells5m) { score += 1; reasons.push("buys5m>sells5m(+1)"); }
    else reasons.push("buys5m<=sells5m(+0)");
  } else {
    reasons.push("txns_m5_missing(+0)");
  }

  // 5) FDV
  if (typeof fdv === "number") {
    if (fdv <= 5_000_000) { score += 1; reasons.push("fdv<=5m(+1)"); }
    else { score -= 2; reasons.push("fdv>5m(-2)"); }
  } else reasons.push("fdv_undefined(+0)");

  // ===== Growth-rate scoring (liquidity + price) =====
  const pairAddr = pair.pairAddress;
  const h = pairAddr ? pairHistory.get(pairAddr) : null;

  if (h) {
    const liq1m = pctChange(h.liq, 60 * 1000);
    const liq3m = pctChange(h.liq, 3 * 60 * 1000);

    if (liq1m != null && liq1m >= LIQ_1M_PCT_1) {
      score += 1;
      reasons.push(`liq+${Math.round(liq1m * 100)}%/1m(+1)`);
    }
    if (liq3m != null && liq3m >= LIQ_3M_PCT_2) {
      score += 2;
      reasons.push(`liq+${Math.round(liq3m * 100)}%/3m(+2)`);
    }

    const p1m = pctChange(h.price, 60 * 1000);
    const p3m = pctChange(h.price, 3 * 60 * 1000);

    if (p1m != null && p1m >= PRICE_1M_PCT_1) {
      score += 1;
      reasons.push(`px+${Math.round(p1m * 100)}%/1m(+1)`);
    }
    if (p3m != null && p3m >= PRICE_3M_PCT_2) {
      score += 2;
      reasons.push(`px+${Math.round(p3m * 100)}%/3m(+2)`);
    }
  } else {
    reasons.push("no_history(+0)");
  }

  // Score recalibration: add 1 only when score >= 4
  if (score >= 4) {
    score += 1;
    reasons.push("score_shift(score>=4,+1)");
  }

  return { score, reasons, ageMin };
}

function normalizeSignal(pair, scoreObj) {
  return {
    ts: new Date().toISOString(),
    pairAddress: pair.pairAddress,
    tokenSymbol: pair.baseToken?.symbol || "",
    tokenAddress: pair.baseToken?.address || "",
    quoteSymbol: pair.quoteToken?.symbol || "",
    liquidityUsd: pair.liquidity?.usd ?? null,
    fdv: pair.fdv ?? null,
    volume24h: pair.volume?.h24 ?? null,
    priceUsd: pair.priceUsd ?? null,
    ageMin: scoreObj.ageMin ?? null,
    score: scoreObj.score,
    reasons: scoreObj.reasons,
    url: pair.url || "",
  };
}

function startMonitor({ onSignal, intervalMs = 10_000 } = {}) {
  let timer = null;

  async function tick() {
    console.log("tick:", new Date().toISOString());

    let profilesCount = 0;
    let solCount = 0;
    let tokensFetched = 0;
    let tokenFetchErrors = 0;
    let pairsSeen = 0;
    let signalsSent = 0;

    // ✅ Track reasons for -999 rejections
    let rejectedTooOld = 0;

    const profilesUrl = "https://api.dexscreener.com/token-profiles/latest/v1";
    const profiles = await fetchJson(profilesUrl);

    profilesCount = (profiles || []).length;

    const sol = (profiles || [])
      .filter((x) => (x.chainId || "").toLowerCase() === "solana")
      .slice(0, 60);

    solCount = sol.length;

    for (const p of sol) {
      const tokenAddress = p.tokenAddress;
      if (!tokenAddress) continue;

      const pairsUrl = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      let tokenData;

      try {
        tokenData = await fetchJson(pairsUrl);
        tokensFetched += 1;
      } catch (e) {
        tokenFetchErrors += 1;
        if (tokenFetchErrors <= 3) console.error("token fetch error:", e.message);
        continue;
      }

      for (const pair of tokenData.pairs || []) {
        pairsSeen += 1;

        const pairAddr = pair.pairAddress;
        if (!pairAddr) continue;

        const scoreObj = scorePair(pair);

        if (scoreObj.score === -999) {
          if ((scoreObj.reasons && scoreObj.reasons[0]) === "too_old") rejectedTooOld += 1;
          continue;
        }

        if (scoreObj.score < MIN_SCORE) continue;

        const signal = normalizeSignal(pair, scoreObj);

        // Deduplicate only high scores
        if (scoreObj.score >= DEDUP_SCORE) {
          if (alerted.has(pairAddr)) continue;
          alerted.add(pairAddr);
          saveAlerted();
        }

        signalsSent += 1;
        onSignal?.(signal);
      }
    }

    if (pairHistory.size > 5000) pairHistory.clear();

    console.log("tick stats:", {
      profilesCount,
      solCount,
      tokensFetched,
      tokenFetchErrors,
      pairsSeen,
      rejectedTooOld,
      signalsSent,
    });
  }

  timer = setInterval(() => tick().catch((e) => console.error("tick error:", e.message)), intervalMs);
  tick().catch((e) => console.error("tick error:", e.message));

  return () => clearInterval(timer);
}

module.exports = { startMonitor };
