// src/logger.ts

const levels = { debug: 0, info: 1, warn: 2, error: 3 } as const;

export const LOG_LEVEL = (
  process.env.LOG_LEVEL || "info"
).toLowerCase() as keyof typeof levels;

function shouldLog(level: keyof typeof levels): boolean {
  return levels[level] >= levels[LOG_LEVEL];
}

export function logDebug(message: string) {
  if (shouldLog("debug")) {
    console.debug(`[DEBUG] ${message}`);
  }
}

export function logInfo(message: string) {
  if (shouldLog("info")) {
    console.log(`[INFO] ${message}`);
  }
}

export function logWarn(message: string) {
  if (shouldLog("warn")) {
    console.warn(`[WARN] ${message}`);
  }
}

export function logError(message: string) {
  if (shouldLog("error")) {
    console.error(`[ERROR] ${message}`);
  }
}

// Helper to format an arbitrage opportunity into aligned, multi-line output
export function formatOpportunity(
  opp: import("./scanner").ArbitrageOpportunity
): string {
  const labelPad = 11;
  const lines = [
    "🟢 ARBITRAGE OPPORTUNITY DETECTED!",
    `   ${"Direction".padEnd(labelPad)}: ${opp.direction.toUpperCase()}`,
    `   ${"Buy".padEnd(labelPad)}: ${opp.buyExchange} ${opp.buyAmount.toFixed(
      6
    )} WSOL`,
    `   ${"Sell".padEnd(labelPad)}: ${
      opp.sellExchange
    } ${opp.sellAmount.toFixed(6)} WSOL`,
    `   ${"Profit".padEnd(labelPad)}: ${opp.profit.toFixed(
      6
    )} WSOL (${opp.profitPct.toFixed(3)}%)`,
  ];
  return lines.join("\n");
}
