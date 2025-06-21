// src/scanner.ts
import { Connection } from "@solana/web3.js";
import {
  getPumpSwapPrice,
  debugPoolStructure,
  getPumpSwapPriceFixed,
} from "./dex/PumpSwap/pump-pricing";
import {
  getPoolBalances,
  validatePoolConfig as validatePumpConfig,
} from "./dex/PumpSwap/pump-core";
import {
  getDLMMPrice,
  getDLMMReversePrice,
} from "./dex/MeteoraDLMM/dlmm_pricing";
import { validateDLMMConfig } from "./dex/MeteoraDLMM/dlmm_core";
import { getConnection, validateSolanaConfig, logSolanaConfig } from "./solana";
import { logInfo, logWarn, logError, formatOpportunity } from "./logger";

const MIN_PROFIT_PCT = parseFloat(process.env.MIN_PROFIT_PCT || "0.3");
const PROCESS_DELAY = parseInt(process.env.PROCESS_DELAY || "3000");
const WSOL_TRADE_SIZE = parseFloat(process.env.WSOL_TRADE_SIZE || "0.1");
const DRY_RUN = process.env.DRY_RUN === "true";

// Enhanced swap details interface
interface SwapDetails {
  ammKey: string;
  label: string;
  inputMint: string;
  outputMint: string;
  inAmount: number;
  outAmount: number;
  feeAmount: number;
  slippageBps: number;
  priceImpactPct: number;
  feeBps: number;
}

// Interface for enhanced pricing functions that return detailed swap info
interface SwapQuote {
  outputAmount: number;
  feeAmount: number;
  priceImpactPct: number;
  ammKey: string;
  slippageBps: number;
  feeBps: number;
}

// Enhanced arbitrage opportunity interface
interface ArbitrageOpportunity {
  direction: "PUMP-TO-DLMM" | "DLMM-TO-PUMP";
  buyAmount: number;
  sellAmount: number;
  profit: number;
  profitPct: number;
  buyExchange: string;
  sellExchange: string;
  timestamp: Date;
  // Enhanced swap details
  firstSwap: SwapDetails;
  secondSwap: SwapDetails;
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

    // Add debug analysis of pool structure
    logInfo("\n🔍 Analyzing PumpSwap pool structure...");
    await debugPoolStructure(connection);

    // Get pool balances
    logInfo("\n💰 Current pool balances:");
    await getPoolBalances(connection);

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

            // Enhanced logging with detailed swap information
            logDetailedOpportunity(opp);

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
 * Enhanced logging function for detailed swap information
 */
function logDetailedOpportunity(opportunity: ArbitrageOpportunity) {
  logInfo(`\n🟢 ARBITRAGE OPPORTUNITY DETECTED!`);
  logInfo(`Route: ${opportunity.direction}`);
  logInfo(
    `Total Profit: ${opportunity.profit.toFixed(
      6
    )} WSOL (${opportunity.profitPct.toFixed(3)}%)`
  );
  logInfo(`Timestamp: ${opportunity.timestamp.toISOString()}`);

  if (opportunity.direction === "PUMP-TO-DLMM") {
    // First swap: PumpSwap
    logInfo(`\n💊 PumpSwap Swap Details (Step 1)`);
    logSwapDetails(opportunity.firstSwap);

    // Second swap: DLMM
    logInfo(`\n☄️ DLMM Swap Details (Step 2)`);
    logSwapDetails(opportunity.secondSwap);
  } else {
    // First swap: DLMM
    logInfo(`\n☄️ DLMM Swap Details (Step 1)`);
    logSwapDetails(opportunity.firstSwap);

    // Second swap: PumpSwap
    logInfo(`\n💊 PumpSwap Swap Details (Step 2)`);
    logSwapDetails(opportunity.secondSwap);
  }

  logInfo(`\n📊 Route Summary:`);
  logInfo(`   Input:  ${opportunity.buyAmount.toFixed(6)} WSOL`);
  logInfo(`   Output: ${opportunity.sellAmount.toFixed(6)} WSOL`);
  logInfo(`   Net Profit: ${opportunity.profit.toFixed(6)} WSOL`);
  logInfo(`   ROI: ${opportunity.profitPct.toFixed(3)}%`);
}

/**
 * Helper function to log individual swap details
 */
function logSwapDetails(swap: SwapDetails) {
  logInfo(`   ammKey: ${swap.ammKey}`);
  logInfo(`   label: ${swap.label}`);
  logInfo(`   inputMint: ${swap.inputMint}`);
  logInfo(`   outputMint: ${swap.outputMint}`);
  logInfo(`   inAmount: ${swap.inAmount.toFixed(6)}`);
  logInfo(`   outAmount: ${swap.outAmount.toFixed(6)}`);
  logInfo(`   feeAmount: ${swap.feeAmount.toFixed(6)}`);
  logInfo(`   slippageBps: ${swap.slippageBps}`);
  logInfo(`   priceImpactPct: ${swap.priceImpactPct.toFixed(4)}%`);
  logInfo(`   feeBps: ${swap.feeBps}`);
}

/**
 * Check arbitrage: Buy on PumpSwap, Sell on DLMM
 */
async function checkPumpToDLMM(
  connection: Connection,
  wsolAmount: number
): Promise<ArbitrageOpportunity | null> {
  try {
    // Step 1: Get detailed quote for PumpSwap (WSOL → Target Token)
    const pumpQuote = await getPumpSwapQuote(
      connection,
      wsolAmount,
      "quoteToBase"
    );

    // Step 2: Get detailed quote for DLMM (Target Token → WSOL)
    const dlmmQuote = await getDLMMQuote(
      connection,
      pumpQuote.outputAmount,
      "baseToQuote"
    );

    const profit = dlmmQuote.outputAmount - wsolAmount;
    const profitPct = (profit / wsolAmount) * 100;

    // Create detailed swap information with dynamic data
    const firstSwap: SwapDetails = {
      ammKey: pumpQuote.ammKey,
      label: "Pump.fun AMM",
      inputMint: getWSOLMint(),
      outputMint: getTargetTokenMint(),
      inAmount: wsolAmount,
      outAmount: pumpQuote.outputAmount,
      feeAmount: pumpQuote.feeAmount,
      slippageBps: pumpQuote.slippageBps,
      priceImpactPct: pumpQuote.priceImpactPct,
      feeBps: pumpQuote.feeBps,
    };

    const secondSwap: SwapDetails = {
      ammKey: dlmmQuote.ammKey,
      label: "Meteora DLMM Program",
      inputMint: getTargetTokenMint(),
      outputMint: getWSOLMint(),
      inAmount: pumpQuote.outputAmount,
      outAmount: dlmmQuote.outputAmount,
      feeAmount: dlmmQuote.feeAmount,
      slippageBps: dlmmQuote.slippageBps,
      priceImpactPct: dlmmQuote.priceImpactPct,
      feeBps: dlmmQuote.feeBps,
    };

    return {
      direction: "PUMP-TO-DLMM",
      buyAmount: wsolAmount,
      sellAmount: dlmmQuote.outputAmount,
      profit,
      profitPct,
      buyExchange: "Pump.fun",
      sellExchange: "Meteora DLMM",
      timestamp: new Date(),
      firstSwap,
      secondSwap,
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
    // Step 1: Get detailed quote for DLMM (WSOL → Target Token)
    const dlmmQuote = await getDLMMQuote(connection, wsolAmount, "quoteToBase");

    // Step 2: Get detailed quote for PumpSwap (Target Token → WSOL)
    const pumpQuote = await getPumpSwapQuote(
      connection,
      dlmmQuote.outputAmount,
      "baseToQuote"
    );

    const profit = pumpQuote.outputAmount - wsolAmount;
    const profitPct = (profit / wsolAmount) * 100;

    // Create detailed swap information with dynamic data
    const firstSwap: SwapDetails = {
      ammKey: dlmmQuote.ammKey,
      label: "Meteora DLMM Program",
      inputMint: getWSOLMint(),
      outputMint: getTargetTokenMint(),
      inAmount: wsolAmount,
      outAmount: dlmmQuote.outputAmount,
      feeAmount: dlmmQuote.feeAmount,
      slippageBps: dlmmQuote.slippageBps,
      priceImpactPct: dlmmQuote.priceImpactPct,
      feeBps: dlmmQuote.feeBps,
    };

    const secondSwap: SwapDetails = {
      ammKey: pumpQuote.ammKey,
      label: "Pump.fun AMM",
      inputMint: getTargetTokenMint(),
      outputMint: getWSOLMint(),
      inAmount: dlmmQuote.outputAmount,
      outAmount: pumpQuote.outputAmount,
      feeAmount: pumpQuote.feeAmount,
      slippageBps: pumpQuote.slippageBps,
      priceImpactPct: pumpQuote.priceImpactPct,
      feeBps: pumpQuote.feeBps,
    };

    return {
      direction: "DLMM-TO-PUMP",
      buyAmount: wsolAmount,
      sellAmount: pumpQuote.outputAmount,
      profit,
      profitPct,
      buyExchange: "Meteora DLMM",
      sellExchange: "Pump.fun",
      timestamp: new Date(),
      firstSwap,
      secondSwap,
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
 * Helper functions to get mint addresses dynamically
 */
function getWSOLMint(): string {
  return process.env.BASE_MINT || "So11111111111111111111111111111111111111112";
}

function getTargetTokenMint(): string {
  const mint = process.env.MINT;
  if (!mint) {
    throw new Error("MINT not configured in environment variables");
  }
  return mint;
}

/**
 * Enhanced PumpSwap quote function - you'll need to implement this
 * based on your existing pump-pricing.ts functions
 */
async function getPumpSwapQuote(
  connection: Connection,
  inputAmount: number,
  direction: "quoteToBase" | "baseToQuote"
): Promise<SwapQuote> {
  try {
    // Get the basic price from your existing function
    const outputAmount = await getPumpSwapPriceFixed(
      connection,
      inputAmount,
      0.01,
      direction
    );

    // You'll need to enhance your PumpSwap functions to return these details
    // This is a placeholder - implement based on your actual PumpSwap integration
    return {
      outputAmount,
      feeAmount: calculatePumpSwapFee(inputAmount),
      priceImpactPct: await calculatePumpSwapPriceImpact(
        connection,
        inputAmount
      ),
      ammKey: await getPumpSwapAMMKey(connection),
      slippageBps: 100, // 1% - get from your pool config
      feeBps: 100, // 1% - get from your pool config
    };
  } catch (error) {
    throw new Error(`PumpSwap quote failed: ${error}`);
  }
}

/**
 * Enhanced DLMM quote function - you'll need to implement this
 * based on your existing dlmm_pricing.ts functions
 */
async function getDLMMQuote(
  connection: Connection,
  inputAmount: number,
  direction: "quoteToBase" | "baseToQuote"
): Promise<SwapQuote> {
  try {
    // Get the basic price from your existing function
    const outputAmount =
      direction === "quoteToBase"
        ? await getDLMMReversePrice(connection, inputAmount, 0.005)
        : await getDLMMPrice(connection, inputAmount, 0.005);

    // You'll need to enhance your DLMM functions to return these details
    // This is a placeholder - implement based on your actual DLMM integration
    return {
      outputAmount,
      feeAmount: calculateDLMMFee(inputAmount),
      priceImpactPct: await calculateDLMMPriceImpact(connection, inputAmount),
      ammKey: await getDLMMAMMKey(connection),
      slippageBps: 50, // 0.5% - get from your pool config
      feeBps: 50, // 0.5% - get from your pool config
    };
  } catch (error) {
    throw new Error(`DLMM quote failed: ${error}`);
  }
}

/**
 * Helper functions to calculate fees and get AMM keys
 * You'll need to implement these based on your actual DEX integrations
 */
function calculatePumpSwapFee(inputAmount: number): number {
  // Implement based on your PumpSwap fee structure
  return inputAmount * 0.01; // 1% assumption
}

function calculateDLMMFee(inputAmount: number): number {
  // Implement based on your DLMM fee structure
  return inputAmount * 0.005; // 0.5% assumption
}

async function calculatePumpSwapPriceImpact(
  connection: Connection,
  inputAmount: number
): Promise<number> {
  // Implement based on your PumpSwap pool liquidity data
  // This is a simplified calculation - you should use actual pool reserves
  return Math.min(inputAmount / 10, 2.0); // Placeholder calculation
}

async function calculateDLMMPriceImpact(
  connection: Connection,
  inputAmount: number
): Promise<number> {
  // Implement based on your DLMM pool liquidity data
  // This is a simplified calculation - you should use actual bin liquidity
  return Math.min(inputAmount / 20, 1.0); // Placeholder calculation
}

async function getPumpSwapAMMKey(connection: Connection): Promise<string> {
  // Get the actual AMM key from your PumpSwap pool
  // This might come from your pool configuration or be fetched dynamically
  const ammKey = process.env.PUMPSWAP_POOL;
  if (!ammKey) {
    throw new Error("PUMPSWAP_POOL not configured");
  }
  return ammKey;
}

async function getDLMMAMMKey(connection: Connection): Promise<string> {
  // Get the actual AMM key from your DLMM pool
  // This might come from your pool configuration or be fetched dynamically
  const ammKey = process.env.DLMM_POOL;
  if (!ammKey) {
    throw new Error("DLMM_POOL not configured");
  }
  return ammKey;
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
export type { ArbitrageOpportunity, SwapDetails };
