// monitor.js
const fs = require("fs");

const SEEN_FILE = "./seen_pairs.json";

// 只用于“高分信号”的去重（避免高分重复弹）
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

// ✅ 更稳：检查 HTTP、检查是否 HTML、并在报错里带 head
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

  // DexScreener 偶尔会返回 HTML（例如被限流/反爬）
  if (text.trim().startsWith("<")) {
    throw new Error(`Non-JSON (HTML) | url=${url} | head=${head}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON.parse failed | url=${url} | head=${head}`);
  }
}

// ====== 可调参数 ======
const MIN_SCORE = 0;         // 后端推送下限（建议 0 或 1）
const DEDUP_SCORE = 5;       // 只有 score>=5 才去重（写 seen_pairs.json）

// ✅ 放宽：很多 token 的 pairCreatedAt 要么缺失要么“看起来更老”，先放宽到 60 分钟
const MAX_AGE_MIN = 60;

const LIQ_80K = 80000;
const LIQ_50K = 50000;
const VOL_200K = 200000;
const VOL_100K = 100000;

// 增速打分阈值
const LIQ_1M_PCT_1 = 0.15;
const LIQ_3M_PCT_2 = 0.40;

const PRICE_1M_PCT_1 = 0.20;
const PRICE_3M_PCT_2 = 0.60;

const HISTORY_WINDOW_MS = 3 * 60 * 1000;
// ======================

// ====== 内存历史：用于计算增速 ======
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

  // ✅ 不再因为缺少 createdAt 直接 -999：给一个“未知年龄”并继续算分
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

  // 1) 流动性基础分
  if (typeof liq === "number") {
    if (liq >= LIQ_80K) { score += 2; reasons.push("liq>=80k(+2)"); }
    else if (liq >= LIQ_50K) { score += 1; reasons.push("liq>=50k(+1)"); }
    else reasons.push("liq<50k(+0)");
  } else {
    // ✅ 不直接判死刑：允许继续算其它分（但会是低分）
    reasons.push("liq_undefined(+0)");
  }

  // 2) 年龄（只有有 createdAt 才算）
  if (ageMin != null) {
    if (ageMin <= 5) { score += 1; reasons.push("age<=5m(+1)"); }
    else reasons.push("age>5m(+0)");
  } else {
    reasons.push("age_unknown(+0)");
  }

  // 3) 交易活跃度（24h volume）
  if (typeof vol24 === "number") {
    if (vol24 >= VOL_200K) { score += 2; reasons.push("vol24>=200k(+2)"); }
    else if (vol24 >= VOL_100K) { score += 1; reasons.push("vol24>=100k(+1)"); }
    else reasons.push("vol24<100k(+0)");
  } else {
    reasons.push("vol24_undefined(+0)");
  }

  // 4) 买卖压力（5分钟）
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

  // ===== 增速评分（liq + price）=====
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

  // 分数重标定：只对 score>=4 的 +1
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

    // ✅ 统计 -999 的原因
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

        // 只有高分才去重
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