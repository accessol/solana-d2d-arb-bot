// src/scanner.ts
import { Connection } from "@solana/web3.js";
import {
  getPumpSwapPrice,
  getPumpSwapReversePrice,
  validatePoolConfig as validatePumpConfig,
} from "./dex/pump";
import {
  getDLMMPrice,
  getDLMMReversePrice,
  validateDLMMConfig,
} from "./dex/dlmm";
import { getConnection, validateSolanaConfig, logSolanaConfig } from "./solana";
import { logInfo, logWarn, logError } from "./logger";

const MIN_PROFIT_PCT = parseFloat(process.env.MIN_PROFIT_PCT || "0.3");
const PROCESS_DELAY = parseInt(process.env.PROCESS_DELAY || "3000");
const WSOL_TRADE_SIZE = parseFloat(process.env.WSOL_TRADE_SIZE || "0.1");
const DRY_RUN = process.env.DRY_RUN === "true";

// Arbitrage opportunity interface
interface ArbitrageOpportunity {
  direction: "PUMP-TO-DLMM" | "DLMM-TO-PUMP";
  buyAmount: number;
  sellAmount: number;
  profit: number;
  profitPct: number;
  buyExchange: string;
  sellExchange: string;
  timestamp: Date;
}

/**
 * Initialize and start the arbitrage scanner
 */
export async function initializeScanner() {
  const mode = DRY_RUN ? "DRY RUN" : "LIVE TRADING";
  logInfo(`🚀 Initializing arbitrage scanner in ${mode} mode...`);

  try {
    // Log configuration
    logSolanaConfig();

    // Validate Solana connection and wallet
    const { connection, wallet, publicKey } = await validateSolanaConfig();

    // Validate DEX pool configurations
    validatePumpConfig();
    validateDLMMConfig();
    logInfo("✅ All configurations validated successfully");

    // Start the main scanner loop
    await startScanner(connection);
  } catch (error) {
    logError(
      `❌ Initialization failed: ${
        error instanceof Error ? error.message : error
      }`
    );
    process.exit(1);
  }
}

export async function startScanner(connection: Connection) {
  logInfo("📊 Starting arbitrage opportunity scanner...");

  let scanCount = 0;
  let lastOpportunityTime: Date | null = null;

  while (true) {
    try {
      scanCount++;
      const scanStart = new Date();

      logInfo(`\n🔍 Scan #${scanCount} - ${scanStart.toISOString()}`);

      // Check both arbitrage directions concurrently
      const opportunities = await Promise.allSettled([
        checkPumpToDLMM(connection, WSOL_TRADE_SIZE),
        checkDLMMToPump(connection, WSOL_TRADE_SIZE),
      ]);

      let foundOpportunity = false;
      let bestOpportunity: ArbitrageOpportunity | null = null;

      // Process results and find the best opportunity
      opportunities.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value) {
          const opp = result.value;

          if (opp.profitPct >= MIN_PROFIT_PCT) {
            foundOpportunity = true;

            // Track the best opportunity
            if (!bestOpportunity || opp.profitPct > bestOpportunity.profitPct) {
              bestOpportunity = opp;
            }

            logInfo(`\n🟢 ARBITRAGE OPPORTUNITY DETECTED!`);
            logInfo(`   Direction: ${opp.direction.toUpperCase()}`);
            logInfo(
              `   Buy on ${opp.buyExchange}: ${opp.buyAmount.toFixed(6)} WSOL`
            );
            logInfo(
              `   Sell on ${opp.sellExchange}: ${opp.sellAmount.toFixed(
                6
              )} WSOL`
            );
            logInfo(
              `   Profit: ${opp.profit.toFixed(
                6
              )} WSOL (${opp.profitPct.toFixed(3)}%)`
            );

            if (DRY_RUN) {
              logInfo(`   🔍 DRY RUN: Trade simulation only`);
            } else {
              logInfo(`   ⚡ LIVE MODE: Ready for execution`);
              // TODO: Implement actual trade execution
              logWarn(`   ⚠️  Trade execution not yet implemented`);
            }

            lastOpportunityTime = scanStart;
          } else {
            logInfo(
              `   ${opp.direction}: ${opp.profitPct.toFixed(
                3
              )}% (below ${MIN_PROFIT_PCT}% threshold)`
            );
          }
        } else if (result.status === "rejected") {
          const direction = index === 0 ? "PumpSwap→DLMM" : "DLMM→PumpSwap";
          logWarn(`   ${direction} check failed: ${result.reason}`);
        }
      });

      if (!foundOpportunity) {
        logInfo("   No profitable opportunities found");
      } else if (bestOpportunity) {
        // Log best opportunity summary
        logInfo(
          `\n⭐ Best opportunity: ${(
            bestOpportunity as ArbitrageOpportunity
          ).profitPct.toFixed(3)}% profit via ${
            (bestOpportunity as ArbitrageOpportunity).direction
          }`
        );
      }

      // Log scan performance
      const scanDuration = Date.now() - scanStart.getTime();
      logInfo(`   Scan completed in ${scanDuration}ms`);

      // Log time since last opportunity
      if (lastOpportunityTime) {
        const timeSinceLastOpp = Math.round(
          (scanStart.getTime() - (lastOpportunityTime as Date).getTime()) / 1000
        );
        logInfo(`   Last opportunity: ${timeSinceLastOpp}s ago`);
      }
    } catch (err: any) {
      logError(`Scan error: ${err.message}`);

      // Try to reconnect on connection errors
      if (
        err.message.includes("connection") ||
        err.message.includes("network")
      ) {
        logWarn("Attempting to reconnect...");
        try {
          connection = getConnection();
          await connection.getSlot(); // Test connection
          logInfo("✅ Reconnection successful");
        } catch (reconnectError) {
          logError(`❌ Reconnection failed: ${reconnectError}`);
        }
      }
    }

    await delay(PROCESS_DELAY);
  }
}

/**
 * Check arbitrage: Buy on PumpSwap, Sell on DLMM
 */
async function checkPumpToDLMM(
  connection: Connection,
  wsolAmount: number
): Promise<ArbitrageOpportunity | null> {
  try {
    // Step 1: Buy target token on PumpSwap with WSOL
    const targetTokenAmount = await getPumpSwapPrice(
      connection,
      wsolAmount,
      0.01
    );
    // Debug: log targetTokenAmount and units
    logInfo(
      `PumpSwap: For ${wsolAmount} WSOL, get ${targetTokenAmount} target tokens`
    );

    // Step 2: Sell target token on DLMM for WSOL
    const wsolReceived = await getDLMMPrice(
      connection,
      targetTokenAmount,
      0.005
    );
    // Debug: log wsolReceived and units
    logInfo(
      `DLMM: For ${targetTokenAmount} target tokens, get ${wsolReceived} WSOL`
    );

    const profit = wsolReceived - wsolAmount;
    const profitPct = (profit / wsolAmount) * 100;

    return {
      direction: "PUMP-TO-DLMM",
      buyAmount: wsolAmount,
      sellAmount: wsolReceived,
      profit,
      profitPct,
      buyExchange: "PumpSwap",
      sellExchange: "Meteora DLMM",
      timestamp: new Date(),
    };
  } catch (error) {
    logWarn(
      `PumpSwap→DLMM check failed: ${
        error instanceof Error ? error.message : error
      }`
    );
    return null;
  }
}

/**
 * Check arbitrage: Buy on DLMM, Sell on PumpSwap
 */
async function checkDLMMToPump(
  connection: Connection,
  wsolAmount: number
): Promise<ArbitrageOpportunity | null> {
  try {
    // Step 1: Buy target token on DLMM with WSOL
    const targetTokenAmount = await getDLMMReversePrice(
      connection,
      wsolAmount,
      0.005
    );
    // Debug: log targetTokenAmount and units
    logInfo(
      `DLMM: For ${wsolAmount} WSOL, get ${targetTokenAmount} target tokens`
    );

    // Step 2: Sell target token on PumpSwap for WSOL
    const wsolReceived = await getPumpSwapReversePrice(
      connection,
      targetTokenAmount,
      0.01
    );
    // Debug: log wsolReceived and units
    logInfo(
      `PumpSwap: For ${targetTokenAmount} target tokens, get ${wsolReceived} WSOL`
    );

    const profit = wsolReceived - wsolAmount;
    const profitPct = (profit / wsolAmount) * 100;

    return {
      direction: "DLMM-TO-PUMP",
      buyAmount: wsolAmount,
      sellAmount: wsolReceived,
      profit,
      profitPct,
      buyExchange: "Meteora DLMM",
      sellExchange: "PumpSwap",
      timestamp: new Date(),
    };
  } catch (error) {
    logWarn(
      `DLMM→PumpSwap check failed: ${
        error instanceof Error ? error.message : error
      }`
    );
    return null;
  }
}

/**
 * Get current price comparison across both DEXs
 */
export async function getPriceComparison(connection: Connection): Promise<{
  pumpPrice: number;
  dlmmPrice: number;
  priceDifference: number;
  priceDifferencePct: number;
  timestamp: Date;
}> {
  try {
    const [pumpTokens, dlmmTokens] = await Promise.all([
      getPumpSwapPrice(connection, 1, 0.01), // 1 WSOL → tokens on PumpSwap
      getDLMMReversePrice(connection, 1, 0.005), // 1 WSOL → tokens on DLMM
    ]);

    const pumpPrice = 1 / pumpTokens; // WSOL per token
    const dlmmPrice = 1 / dlmmTokens; // WSOL per token

    const priceDifference = Math.abs(pumpPrice - dlmmPrice);
    const avgPrice = (pumpPrice + dlmmPrice) / 2;
    const priceDifferencePct = (priceDifference / avgPrice) * 100;

    return {
      pumpPrice,
      dlmmPrice,
      priceDifference,
      priceDifferencePct,
      timestamp: new Date(),
    };
  } catch (error) {
    logError(
      `Price comparison failed: ${
        error instanceof Error ? error.message : error
      }`
    );
    throw error;
  }
}

/**
 * Monitor price spreads without trading
 */
export async function monitorPriceSpreads() {
  logInfo("🔄 Starting price spread monitoring mode...");

  try {
    const { connection } = await validateSolanaConfig();

    while (true) {
      try {
        const comparison = await getPriceComparison(connection);

        logInfo(
          `\n📈 Price Comparison (${comparison.timestamp.toISOString()}):`
        );
        logInfo(`   PumpSwap: ${comparison.pumpPrice.toFixed(8)} WSOL/token`);
        logInfo(`   Meteora:  ${comparison.dlmmPrice.toFixed(8)} WSOL/token`);
        logInfo(`   Spread:   ${comparison.priceDifferencePct.toFixed(3)}%`);

        if (comparison.priceDifferencePct > MIN_PROFIT_PCT) {
          logInfo(`   🚨 Spread above threshold (${MIN_PROFIT_PCT}%)!`);
        }
      } catch (error) {
        logWarn(
          `Price monitoring error: ${
            error instanceof Error ? error.message : error
          }`
        );
      }

      await delay(PROCESS_DELAY);
    }
  } catch (error) {
    logError(`Failed to initialize price monitoring: ${error}`);
    process.exit(1);
  }
}

/**
 * Get detailed market analysis
 */
export async function getMarketAnalysis(): Promise<{
  priceComparison: Awaited<ReturnType<typeof getPriceComparison>>;
  opportunities: (ArbitrageOpportunity | null)[];
  summary: {
    bestOpportunity: ArbitrageOpportunity | null;
    avgSpread: number;
    marketDirection: "pumpswap_higher" | "dlmm_higher" | "balanced";
  };
}> {
  const connection = getConnection();

  const [priceComparison, pumpToDlmmOpp, dlmmToPumpOpp] = await Promise.all([
    getPriceComparison(connection),
    checkPumpToDLMM(connection, WSOL_TRADE_SIZE),
    checkDLMMToPump(connection, WSOL_TRADE_SIZE),
  ]);

  const opportunities = [pumpToDlmmOpp, dlmmToPumpOpp];

  const validOpportunities: ArbitrageOpportunity[] = opportunities.filter(
    (opp): opp is ArbitrageOpportunity => opp !== null
  );

  const bestOpportunity =
    validOpportunities.reduce<ArbitrageOpportunity | null>(
      (best, current) =>
        !best || current.profitPct > best.profitPct ? current : best,
      null
    );

  const marketDirection =
    priceComparison.pumpPrice > priceComparison.dlmmPrice
      ? "pumpswap_higher"
      : priceComparison.dlmmPrice > priceComparison.pumpPrice
      ? "dlmm_higher"
      : "balanced";

  return {
    priceComparison,
    opportunities,
    summary: {
      bestOpportunity,
      avgSpread: priceComparison.priceDifferencePct,
      marketDirection,
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Export for external use
export type { ArbitrageOpportunity };
