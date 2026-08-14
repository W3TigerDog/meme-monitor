const fs = require("fs");

const SEEN_FILE = "./seen_pairs.json";
const CSV_FILE = "./signals.csv";

// ====== Configurable parameters ======
const MIN_SCORE = 3;
const MAX_AGE_MIN = 10;







// Scoring thresholds (adjust as needed)
const LIQ_80K = 80000;
const LIQ_50K = 50000;
const VOL_200K = 200000;
const VOL_100K = 100000;
// ======================



let seen = new Set();
if (fs.existsSync(SEEN_FILE)) {
  try {
    seen = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")));
  } catch {
    seen = new Set();
  }
}

function saveSeen() {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen], null, 2));
}

function ensureCsvHeader() {
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(
      CSV_FILE,
      [
        "ts_utc",
        "pairAddress",
        "tokenSymbol",
        "tokenAddress",
        "quoteSymbol",
        "liquidityUsd",
        "fdv",
        "volume24h",
        "priceUsd",
        "ageMin",
        "score",
        "reasons",
        "url",
      ].join(",") + "\n"
    );
  }
}

function appendCsv(row) {
  const line =
    [
      row.ts_utc,
      row.pairAddress,
      row.tokenSymbol,
      row.tokenAddress,
      row.quoteSymbol,
      row.liquidityUsd,
      row.fdv,
      row.volume24h,
      row.priceUsd,
      row.ageMin,
      row.score,
      `"${row.reasons.replaceAll('"', '""')}"`,
      row.url,
    ].join(",") + "\n";

  fs.appendFileSync(CSV_FILE, line);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "meme-monitor/1.0",
    },
  });
  const text = await res.text();
  return JSON.parse(text);
}

// ====== Scoring function ======
function scorePair(pair) {
  const reasons = [];
  let score = 0;

  const now = Date.now();
  const createdAt = pair.pairCreatedAt;
  if (!createdAt) return { score: -999, reasons: ["no_createdAt"], ageMin: null };

  const ageMin = (now - createdAt) / 60000;
  if (ageMin > MAX_AGE_MIN) return { score: -999, reasons: ["too_old"], ageMin };

  const liq = pair.liquidity?.usd;
  const fdv = pair.fdv;
  const vol24 = pair.volume?.h24; // Common DexScreener field
  const buys5m = pair.txns?.m5?.buys;
  const sells5m = pair.txns?.m5?.sells;
  const buyVol24 = pair.volume?.h24 ? pair.volume?.h24 : null; // Only total volume is available here

  // 1) Liquidity
  if (typeof liq === "number") {
    if (liq >= LIQ_80K) {
      score += 2;
      reasons.push("liq>=80k(+2)");
    } else if (liq >= LIQ_50K) {
      score += 1;
      reasons.push("liq>=50k(+1)");
    } else {
      reasons.push("liq<50k(+0)");
    }
  } else {
    reasons.push("liq_undefined(-)");
    // If liquidity is undefined, assign no points; alternatively, reject it outright:
    return { score: -999, reasons: ["liq_undefined"], ageMin };
  }

  // 2) Age: newer is better
  if (ageMin <= 5) {
    score += 1;
    reasons.push("age<=5m(+1)");
  } else {
    reasons.push("age>5m(+0)");
  }

  // 3) Trading activity (using 24h volume as a rough proxy)
  if (typeof vol24 === "number") {
    if (vol24 >= VOL_200K) {
      score += 2;
      reasons.push("vol24>=200k(+2)");
    } else if (vol24 >= VOL_100K) {
      score += 1;
      reasons.push("vol24>=100k(+1)");
    } else {
      reasons.push("vol24<100k(+0)");
    }
  } else {
    reasons.push("vol24_undefined(+0)");
  }

  // 4) Buy/sell pressure (5-minute buys vs. sells)
  if (typeof buys5m === "number" && typeof sells5m === "number") {
    if (buys5m > sells5m) {
      score += 1;
      reasons.push("buys5m>sells5m(+1)");
    } else {
      reasons.push("buys5m<=sells5m(+0)");
    }
  } else {
    reasons.push("txns_m5_missing(+0)");
  }

  // 5) FDV ceiling (the original condition)
  if (typeof fdv === "number") {
    if (fdv <= 5_000_000) {
      score += 1;
      reasons.push("fdv<=5m(+1)");
    } else {
      score -= 2;
      reasons.push("fdv>5m(-2)");
    }
  } else {
    reasons.push("fdv_undefined(+0)");
  }

  return { score, reasons, ageMin };
}

// ====== Main flow ======
ensureCsvHeader();

async function runOnce() {
  const profilesUrl = "https://api.dexscreener.com/token-profiles/latest/v1";
  const profiles = await fetchJson(profilesUrl);

  const sol = (profiles || [])
    .filter((x) => (x.chainId || "").toLowerCase() === "solana")
    .slice(0, 60);

  for (const p of sol) {
    const tokenAddress = p.tokenAddress;
    if (!tokenAddress) continue;

    const pairsUrl = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
    let tokenData;
    try {
      tokenData = await fetchJson(pairsUrl);
    } catch {
      continue;
    }

    for (const pair of tokenData.pairs || []) {
      const pairAddr = pair.pairAddress;
      if (!pairAddr || seen.has(pairAddr)) continue;

      // Score first
      const { score, reasons, ageMin } = scorePair(pair);

      // Record every pair encountered to avoid repeated output
      seen.add(pairAddr);
      saveSeen();

      // Log everything to CSV for backtesting; optionally, log only high scores
      appendCsv({
        ts_utc: new Date().toISOString(),
        pairAddress: pairAddr,
        tokenSymbol: pair.baseToken?.symbol || "",
        tokenAddress: pair.baseToken?.address || tokenAddress,
        quoteSymbol: pair.quoteToken?.symbol || "",
        liquidityUsd: pair.liquidity?.usd ?? "",
        fdv: pair.fdv ?? "",
        volume24h: pair.volume?.h24 ?? "",
        priceUsd: pair.priceUsd ?? "",
        ageMin: typeof ageMin === "number" ? ageMin.toFixed(2) : "",
        score,
        reasons: reasons.join(" | "),
        url: pair.url || "",
      });

      // Output only high scores
      if (score >= MIN_SCORE) {
        console.log("⭐ HIGH SCORE CANDIDATE");
        console.log("Score:", score, "Age(min):", ageMin.toFixed(1));
        console.log("Token:", pair.baseToken?.symbol, pair.baseToken?.address);
        console.log("Quote:", pair.quoteToken?.symbol);
        console.log("LiqUSD:", pair.liquidity?.usd, "FDV:", pair.fdv, "Vol24:", pair.volume?.h24);
        console.log("Reasons:", reasons.join(" | "));
        console.log("URL:", pair.url);
        console.log("--------------------------------------------------");
      }
    }
  }
}

console.log("🚀 Scoring Meme Monitor Started... MIN_SCORE =", MIN_SCORE);

setInterval(() => {
  runOnce().catch((err) => console.error("❌", err.message));
}, 10_000);
