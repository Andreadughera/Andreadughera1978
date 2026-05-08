import { logger } from "./logger";
import { getFearGreedIndex, classifyMarketMood } from "./sentiment";
import { getGlobalMarketData, getTrendingCoins } from "./coingecko";

export interface MarketBriefing {
  summary: string;
  keyPoints: string[];
  outlook: "BULLISH" | "BEARISH" | "NEUTRAL";
  generatedAt: string;
}

// Cache briefing for 30 min
let briefingCache: { data: MarketBriefing; expiresAt: number } | null = null;

/**
 * Rule-based market briefing — always works, no external AI API needed.
 * Synthesizes Fear & Greed, BTC dominance, market cap trend, and trending coins.
 */
function buildRuleBasedBriefing(
  fgValue: number,
  fgClass: string,
  totalMcapT: number | null,
  mcapChange24h: number | null,
  btcDom: number | null,
  trendingSymbols: string[],
): MarketBriefing {
  const mood = classifyMarketMood(fgValue);

  // Overall outlook
  let outlook: "BULLISH" | "BEARISH" | "NEUTRAL";
  if (fgValue >= 60 && (mcapChange24h ?? 0) > 0) outlook = "BULLISH";
  else if (fgValue <= 40 && (mcapChange24h ?? 0) < 0) outlook = "BEARISH";
  else if (fgValue >= 55 || (mcapChange24h ?? 0) > 1) outlook = "BULLISH";
  else if (fgValue <= 45 || (mcapChange24h ?? 0) < -1) outlook = "BEARISH";
  else outlook = "NEUTRAL";

  // Summary
  const mcapStr = totalMcapT ? `$${totalMcapT.toFixed(2)}T` : "the market";
  const changeStr = mcapChange24h !== null
    ? ` (${mcapChange24h >= 0 ? "+" : ""}${mcapChange24h.toFixed(2)}% in 24h)`
    : "";
  const fgBias =
    mood === "EXTREME_FEAR" ? "Sentiment is at extreme fear — historically a contrarian buy zone."
    : mood === "FEAR" ? "Sentiment remains fearful, suggesting caution but also opportunity."
    : mood === "NEUTRAL" ? "Sentiment is balanced at neutral — technical signals take priority."
    : mood === "GREED" ? "Sentiment is greedy — markets may be overextended, caution advised."
    : "Sentiment is at extreme greed — risk of a sharp correction is elevated.";

  const summary = `Total crypto market cap stands at ${mcapStr}${changeStr}. Fear & Greed Index at ${fgValue}/100 (${fgClass}). ${fgBias}`;

  // Key points
  const keyPoints: string[] = [];

  // BTC dominance insight
  if (btcDom !== null) {
    if (btcDom > 60) keyPoints.push(`BTC dominance at ${btcDom.toFixed(1)}% — capital concentrated in Bitcoin, altcoins may lag`);
    else if (btcDom < 50) keyPoints.push(`BTC dominance at ${btcDom.toFixed(1)}% — altcoin season conditions may be developing`);
    else keyPoints.push(`BTC dominance at ${btcDom.toFixed(1)}% — balanced market structure`);
  }

  // Market cap trend
  if (mcapChange24h !== null) {
    if (mcapChange24h > 2) keyPoints.push(`Strong 24h market cap gain of +${mcapChange24h.toFixed(2)}% — broad bullish momentum`);
    else if (mcapChange24h > 0) keyPoints.push(`Mild market cap gain of +${mcapChange24h.toFixed(2)}% — cautiously positive`);
    else if (mcapChange24h < -2) keyPoints.push(`Sharp 24h market cap decline of ${mcapChange24h.toFixed(2)}% — defensive positioning advised`);
    else keyPoints.push(`Market cap down ${mcapChange24h.toFixed(2)}% in 24h — mild selling pressure`);
  }

  // Trading recommendation based on F&G
  if (mood === "EXTREME_FEAR" || mood === "FEAR") {
    keyPoints.push("Bot is applying F&G bonus to BUY confidence — contrarian accumulation mode active");
  } else if (mood === "EXTREME_GREED" || mood === "GREED") {
    keyPoints.push("Bot is reducing BUY confidence — protecting against overheated market entries");
  } else {
    keyPoints.push("Bot operating on pure technical signals — no F&G bias applied");
  }

  // Trending
  if (trendingSymbols.length > 0) {
    keyPoints.push(`Most searched on CoinGecko: ${trendingSymbols.slice(0, 3).join(", ")}`);
  }

  return {
    summary,
    keyPoints,
    outlook,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateMarketBriefing(): Promise<MarketBriefing> {
  const now = Date.now();
  if (briefingCache && now < briefingCache.expiresAt) return briefingCache.data;

  try {
    const [fearGreed, globalData, trending] = await Promise.all([
      getFearGreedIndex(),
      getGlobalMarketData(),
      getTrendingCoins(),
    ]);

    const briefing = buildRuleBasedBriefing(
      fearGreed.value,
      fearGreed.classification,
      globalData ? globalData.totalMarketCapUsd / 1e12 : null,
      globalData ? globalData.marketCapChangePercent24h : null,
      globalData ? globalData.btcDominance : null,
      trending.map((c) => c.symbol),
    );

    // Try to enhance with OpenAI (optional — if it fails, rule-based briefing is used)
    try {
      const { openai } = await import("@workspace/integrations-openai-ai-server");
      const trendingList = trending.slice(0, 5).map((c) => `${c.name} (${c.symbol})`).join(", ");

      const response = await openai.chat.completions.create({
        model: "gpt-5-nano",
        max_completion_tokens: 250,
        messages: [
          {
            role: "system",
            content: 'Respond ONLY with a valid JSON object. No markdown. No explanation. Just JSON like: {"summary":"...","keyPoints":["...","...","..."],"outlook":"BULLISH"}',
          },
          {
            role: "user",
            content: `Crypto market: F&G=${fearGreed.value} (${fearGreed.classification}), MCap=${globalData ? (globalData.totalMarketCapUsd / 1e12).toFixed(2) : "?"}T (${globalData ? (globalData.marketCapChangePercent24h >= 0 ? "+" : "") + globalData.marketCapChangePercent24h.toFixed(2) : "?"}% 24h), BTC dominance=${globalData ? globalData.btcDominance.toFixed(1) : "?"}%, trending: ${trendingList}. Provide a 2-sentence summary, 3 key points, and outlook (BULLISH/BEARISH/NEUTRAL).`,
          },
        ],
      });

      const raw = (response.choices[0]?.message?.content ?? "").trim();
      if (raw && raw.includes("{")) {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; keyPoints?: string[]; outlook?: string };
          const validOutlook = (["BULLISH", "BEARISH", "NEUTRAL"] as const).includes(parsed.outlook as "BULLISH" | "BEARISH" | "NEUTRAL")
            ? (parsed.outlook as "BULLISH" | "BEARISH" | "NEUTRAL")
            : briefing.outlook;

          const enhanced: MarketBriefing = {
            summary: parsed.summary || briefing.summary,
            keyPoints: Array.isArray(parsed.keyPoints) && parsed.keyPoints.length > 0 ? parsed.keyPoints.slice(0, 4) : briefing.keyPoints,
            outlook: validOutlook,
            generatedAt: new Date().toISOString(),
          };
          briefingCache = { data: enhanced, expiresAt: now + 30 * 60 * 1000 };
          logger.info({ outlook: enhanced.outlook, source: "openai" }, "AI market briefing generated");
          return enhanced;
        }
      }
    } catch (aiErr) {
      logger.warn({ err: (aiErr as Error).message }, "OpenAI briefing enhancement failed — using rule-based briefing");
    }

    briefingCache = { data: briefing, expiresAt: now + 30 * 60 * 1000 };
    logger.info({ outlook: briefing.outlook, source: "rules" }, "Rule-based market briefing generated");
    return briefing;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Market briefing generation failed");
    const fallback: MarketBriefing = {
      summary: "Market briefing temporarily unavailable.",
      keyPoints: [],
      outlook: "NEUTRAL",
      generatedAt: new Date().toISOString(),
    };
    return briefingCache?.data ?? fallback;
  }
}
