const fs = require("fs");

const SEEN_FILE = "./seen_pairs.json";
const CSV_FILE = "./signals.csv";

// ====== 可调参数 ======
const MIN_SCORE = 3;
const MAX_AGE_MIN = 10;







// 打分阈值（你可以改）
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

// ====== 评分函数 ======
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
  const vol24 = pair.volume?.h24; // DexScreener常见字段
  const buys5m = pair.txns?.m5?.buys;
  const sells5m = pair.txns?.m5?.sells;
  const buyVol24 = pair.volume?.h24 ? pair.volume?.h24 : null; // 这里只能拿总量

  // 1) 流动性
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
    // liquidity undefined 直接不给分，也可以直接淘汰：
    return { score: -999, reasons: ["liq_undefined"], ageMin };
  }

  // 2) 年龄：越早越好
  if (ageMin <= 5) {
    score += 1;
    reasons.push("age<=5m(+1)");
  } else {
    reasons.push("age>5m(+0)");
  }

  // 3) 交易活跃度（用24h成交量粗略代替）
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

  // 4) 买卖压力（5分钟 buys vs sells）
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

  // 5) FDV 上限（你原来的条件）
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

// ====== 主流程 ======
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

      // 先打分
      const { score, reasons, ageMin } = scorePair(pair);

      // 记录所有见到的pair，避免重复刷屏
      seen.add(pairAddr);
      saveSeen();

      // 写日志（所有都写CSV，方便回测；你也可以只写高分）
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

      // 只输出高分
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