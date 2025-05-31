// src/scanner.ts
import { Connection } from "@solana/web3.js";
import { getPumpSwapPrice } from "./dex/pump";
import { getDLMMPrice } from "./dex/dlmm";
import { logInfo, logWarn } from "./logger";

const MIN_PROFIT_PCT = parseFloat(process.env.MIN_PROFIT_PCT || "0.3");
const PROCESS_DELAY = parseInt(process.env.PROCESS_DELAY || "3000");
const WSOL_TRADE_SIZE = parseFloat(process.env.WSOL_TRADE_SIZE || "0.1");

export async function startScanner(connection: Connection) {
  logInfo("Starting dry-run arbitrage scanner (live price)...");

  while (true) {
    try {
      const buyAmount = WSOL_TRADE_SIZE;

      const pumpOutput = await getPumpSwapPrice(connection, buyAmount); // TokenA from PumpSwap
      const dlmmOutput = await getDLMMPrice(connection, pumpOutput); // Sell TokenA to DLMM

      const profit = dlmmOutput - buyAmount;
      const profitPct = (profit / buyAmount) * 100;

      if (profitPct >= MIN_PROFIT_PCT) {
        logInfo(`🟢 Arbitrage Opportunity! Profit: ${profitPct.toFixed(2)}%`);
        logInfo(`   Buy on PumpSwap: ${pumpOutput.toFixed(4)} tokens`);
        logInfo(`   Sell on Meteora: ${dlmmOutput.toFixed(4)} base`);
      } else {
        logWarn(
          `No arbitrage. Pump: ${pumpOutput.toFixed(
            4
          )} → DLMM: ${dlmmOutput.toFixed(4)} (${profitPct.toFixed(2)}%)`
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
