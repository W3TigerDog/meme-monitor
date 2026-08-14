(function initDashboardLogic(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MemeDashboardLogic = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  "use strict";

  function toNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const cleaned = String(value).trim().replace(/,/g, "").replace(/[^0-9.\-]/g, "");
    if (!cleaned) return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(number, min, max) {
    return Math.max(min, Math.min(max, number));
  }

  function parseTimestamp(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function signalAgeMinutes(signal, now = Date.now()) {
    const timestamp = parseTimestamp(signal?.ts);
    if (timestamp === null) return null;
    return Math.max(0, (now - timestamp) / 60000);
  }

  function parseReason(reason) {
    const raw = String(reason ?? "");
    const match = raw.match(/\(([-+]\d+)\)/);
    const points = match ? Number(match[1]) : 0;
    const text = raw.replace(/\s*\(([-+]\d+)\)\s*/g, "").trim();
    return { raw, points, text };
  }

  function groupReasons(reasons) {
    const groups = { base: [], momentum: [], risk: [] };

    for (const reason of reasons || []) {
      const item = parseReason(reason);
      if (item.points < 0) groups.risk.push(item);
      else if (/^(liq\+|px\+)/i.test(item.text)) groups.momentum.push(item);
      else groups.base.push(item);
    }

    groups.base.sort((a, b) => b.points - a.points);
    groups.momentum.sort((a, b) => b.points - a.points);
    groups.risk.sort((a, b) => a.points - b.points);
    return groups;
  }

  function extractReasonSignals(reasons) {
    const result = {
      liquidityPercent3m: null,
      pricePercent1m: null,
      pricePercent5m: null,
      buysAtLeastSells5m: false,
      buysAtMostSells5m: false,
    };

    for (const reason of reasons || []) {
      const { text } = parseReason(reason);
      let match = text.match(/^liq\+(\d+(?:\.\d+)?)%\s*\/\s*3m/i);
      if (match) result.liquidityPercent3m = Number(match[1]);

      match = text.match(/^px\+(\d+(?:\.\d+)?)%\s*\/\s*1m/i);
      if (match) result.pricePercent1m = Number(match[1]);

      match = text.match(/^px\+(\d+(?:\.\d+)?)%\s*\/\s*5m/i);
      if (match) result.pricePercent5m = Number(match[1]);

      if (/buys5m\s*>=\s*sells5m/i.test(text)) result.buysAtLeastSells5m = true;
      if (/buys5m\s*<=\s*sells5m/i.test(text)) result.buysAtMostSells5m = true;
    }

    return result;
  }

  function scoreV2(signal) {
    const tags = [];
    const ageMinutes = toNumber(signal?.ageMin);
    const liquidityUsd = toNumber(signal?.liquidityUsd);
    const fdv = toNumber(signal?.fdv);
    const volume24h = toNumber(signal?.volume24h);
    const makers = toNumber(signal?.makers) ?? toNumber(signal?.makerCount);
    const buys = toNumber(signal?.buys) ?? toNumber(signal?.buyTxns);
    const sells = toNumber(signal?.sells) ?? toNumber(signal?.sellTxns);
    const buyVolume = toNumber(signal?.buyVolume);
    const sellVolume = toNumber(signal?.sellVolume);
    const reasonSignals = extractReasonSignals(signal?.reasons || []);

    let turnover = null;
    if (liquidityUsd !== null && liquidityUsd > 0 && volume24h !== null) {
      turnover = volume24h / liquidityUsd;
      if (turnover > 15) tags.push("High Turnover");
    }

    if (liquidityUsd !== null && liquidityUsd < 5000) tags.push("Illiquid Microcap");

    let liquidity = 0;
    if (liquidityUsd !== null) {
      if (liquidityUsd >= 25000) liquidity = 2;
      else if (liquidityUsd >= 10000) liquidity = 1;
    }

    let participation = 0;
    if (makers !== null) {
      if (makers >= 300) participation = 2;
      else if (makers >= 80) participation = 1;
    } else if (volume24h !== null && volume24h >= 50000) {
      participation = 1;
    }

    let orderFlow = 0;
    if (buys !== null && sells !== null && sells > 0) {
      const ratio = buys / sells;
      if (ratio >= 1.5 && (buyVolume === null || sellVolume === null || buyVolume > sellVolume)) orderFlow = 2;
      else if (ratio >= 1.1) orderFlow = 1;
    } else if (reasonSignals.buysAtLeastSells5m) {
      orderFlow = 1;
    }

    const volume5m = toNumber(signal?.volume5m);
    const volume15m = toNumber(signal?.volume15m);
    let volumeEnergy = 0;
    if (volume5m !== null) {
      if (volume5m >= 50000) volumeEnergy = 2;
      else if (volume5m >= 15000) volumeEnergy = 1;
    } else if (volume15m !== null) {
      if (volume15m >= 120000) volumeEnergy = 2;
      else if (volume15m >= 40000) volumeEnergy = 1;
    } else if (volume24h !== null) {
      if (volume24h >= 200000) volumeEnergy = 2;
      else if (volume24h >= 50000) volumeEnergy = 1;
    }

    const price1m = reasonSignals.pricePercent1m;
    const price5m = reasonSignals.pricePercent5m;
    const fomoSpike = (price1m !== null && price1m > 25) || (price5m !== null && price5m > 60);
    let priceStructure = 0;
    if (fomoSpike) {
      tags.push("FOMO Spike");
    } else {
      const reference = price5m !== null ? price5m : price1m;
      if (reference === null) priceStructure = 1;
      else if (reference >= 5 && reference <= 25) priceStructure = 2;
      else priceStructure = 1;
    }

    let score = clamp(liquidity + participation + orderFlow + volumeEnergy + priceStructure, 0, 10);
    let confidence = score >= 7 ? "High" : score >= 5 ? "Medium" : "Low";
    let stage = "Watch";
    let action = "Watch";

    if (liquidityUsd !== null && liquidityUsd < 5000) {
      stage = "Stage 0 — Illiquid";
      action = "Avoid";
      score = Math.min(score, 2);
      confidence = "Low";
    } else if (ageMinutes !== null && ageMinutes <= 10 && score >= 5 && !tags.includes("FOMO Spike")) {
      stage = "Stage 1 — Launch";
      action = "Small Entry / Watch Pullback";
    } else if (ageMinutes !== null && ageMinutes <= 120 && score >= 6) {
      stage = "Stage 2 — Expansion";
      action = tags.includes("FOMO Spike") ? "Wait Pullback" : "Pullback / Breakout";
    } else if (score >= 6 && (tags.includes("FOMO Spike") || (buys !== null && sells !== null && buys <= sells))) {
      stage = "Stage 3 — Distribution";
      action = "Avoid Chasing / Wait Deep Pullback";
    } else if (score <= 4) {
      stage = "Stage 4 — Decay";
      action = "Avoid";
    } else if (tags.includes("FOMO Spike")) {
      action = "Wait Pullback";
    }

    if (tags.includes("High Turnover") && action !== "Avoid" && !action.includes("Wait")) {
      action = "Watch (High Turnover)";
    }

    const reasons = [
      `Liquidity Quality: ${liquidity}/2 (+${liquidity})`,
      `Participation: ${participation}/2 (+${participation})`,
      `Order Flow: ${orderFlow}/2 (+${orderFlow})`,
      `Volume Energy: ${volumeEnergy}/2 (+${volumeEnergy})`,
      `Price Structure: ${priceStructure}/2 (+${priceStructure})`,
    ];

    if (tags.length) reasons.push(`Tags: ${tags.join(", ")} (+0)`);
    if (turnover !== null) reasons.push(`Turnover: ${turnover.toFixed(1)}x (+0)`);
    reasons.push(`Confidence: ${confidence} (+0)`);

    for (const reason of signal?.reasons || []) {
      const parsed = parseReason(reason);
      if (/^(liq\+|px\+)/i.test(parsed.text)) reasons.push(`${parsed.text} (+${Math.max(0, parsed.points)})`);
    }

    return { score, stage, tags, action, reasons, confidence, turnover, fdv };
  }

  function safeDexScreenerUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(String(value));
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:") return null;
      if (host !== "dexscreener.com" && !host.endsWith(".dexscreener.com")) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function formatCurrency(value) {
    const number = toNumber(value);
    if (number === null) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: Math.abs(number) >= 1000 ? "compact" : "standard",
      maximumFractionDigits: Math.abs(number) < 1 ? 4 : 2,
    }).format(number);
  }

  function formatPrice(value) {
    const number = toNumber(value);
    if (number === null) return "—";
    const maximumFractionDigits = number < 0.0001 ? 10 : number < 0.01 ? 8 : number < 1 ? 6 : 4;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits,
    }).format(number);
  }

  function formatAge(minutes) {
    const number = toNumber(minutes);
    if (number === null) return "Unknown";
    if (number < 1) return "<1 min";
    if (number < 60) return `${Math.round(number)} min`;
    if (number < 1440) return `${(number / 60).toFixed(number < 120 ? 1 : 0)} hr`;
    return `${(number / 1440).toFixed(1)} d`;
  }

  return {
    extractReasonSignals,
    formatAge,
    formatCurrency,
    formatPrice,
    groupReasons,
    parseReason,
    parseTimestamp,
    safeDexScreenerUrl,
    scoreV2,
    signalAgeMinutes,
    toNumber,
  };
});
