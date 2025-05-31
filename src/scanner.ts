// src/scanner.ts

import { logInfo, logWarn } from "./logger";

interface PriceCheck {
  buyPrice: number;
  sellPrice: number;
  profitPct: number;
}

const MIN_PROFIT_PCT = parseFloat(process.env.MIN_PROFIT_PCT || "0.3");
const PROCESS_DELAY = parseInt(process.env.PROCESS_DELAY || "3000");

export async function startScanner() {
  logInfo("Starting dry-run arbitrage scanner...");

  while (true) {
    try {
      const result = await simulatePriceCheck();

      if (result.profitPct >= MIN_PROFIT_PCT) {
        logInfo(
          `🟢 Arbitrage Opportunity Found! Profit: ${result.profitPct.toFixed(
            2
          )}%`
        );
        logInfo(`   Buy @ ${result.buyPrice}, Sell @ ${result.sellPrice}`);
      } else {
        logWarn(
          `No arbitrage. Buy: ${result.buyPrice}, Sell: ${
            result.sellPrice
          }, Profit: ${result.profitPct.toFixed(2)}%`
        );
      }
    } catch (err: any) {
      logWarn(`Scan error: ${err.message}`);
    }

    await delay(PROCESS_DELAY);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Simulated quote fetch
async function simulatePriceCheck(): Promise<PriceCheck> {
  const buyPrice = Math.random() * (0.95 - 0.9) + 0.9; // e.g., PumpSwap
  const sellPrice = Math.random() * (1.05 - 1.0) + 1.0; // e.g., Meteora
  const profitPct = ((sellPrice - buyPrice) / buyPrice) * 100;

  return {
    buyPrice,
    sellPrice,
    profitPct,
  };
}
