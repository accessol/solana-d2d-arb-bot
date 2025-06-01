// src/index.ts
import dotenv from "dotenv";
import {
  initializeScanner,
  monitorPriceSpreads,
  getMarketAnalysis,
} from "./scanner";
import { logInfo, logError } from "./logger";

// Load environment variables
dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || "scan";

  try {
    switch (mode.toLowerCase()) {
      case "scan":
      case "scanner":
        logInfo("🔄 Starting arbitrage scanner mode");
        await initializeScanner();
        break;

      case "monitor":
      case "watch":
        logInfo("👀 Starting price monitoring mode");
        await monitorPriceSpreads();
        break;

      case "analysis":
      case "analyze":
        logInfo("📊 Running market analysis");
        await runMarketAnalysis();
        break;

      case "help":
      case "--help":
      case "-h":
        showHelp();
        break;

      default:
        logError(`❌ Unknown mode: ${mode}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    logError(
      `❌ Application error: ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }
}

async function runMarketAnalysis() {
  try {
    const analysis = await getMarketAnalysis();

    logInfo("\n📊 MARKET ANALYSIS REPORT");
    logInfo("=".repeat(50));

    // Price comparison
    logInfo(`\n💰 Current Prices:`);
    logInfo(
      `   PumpSwap: ${analysis.priceComparison.pumpPrice.toFixed(8)} WSOL/token`
    );
    logInfo(
      `   Meteora:  ${analysis.priceComparison.dlmmPrice.toFixed(8)} WSOL/token`
    );
    logInfo(
      `   Spread:   ${analysis.priceComparison.priceDifferencePct.toFixed(3)}%`
    );

    // Market direction
    logInfo(
      `\n📈 Market Direction: ${analysis.summary.marketDirection
        .replace("_", " ")
        .toUpperCase()}`
    );

    // Best opportunity
    if (analysis.summary.bestOpportunity) {
      const best = analysis.summary.bestOpportunity;
      logInfo(`\n🎯 Best Opportunity:`);
      logInfo(`   Direction: ${best.direction.toUpperCase()}`);
      logInfo(
        `   Profit: ${best.profit.toFixed(6)} WSOL (${best.profitPct.toFixed(
          3
        )}%)`
      );
      logInfo(`   Route: ${best.buyExchange} → ${best.sellExchange}`);

      if (best.profitPct >= parseFloat(process.env.MIN_PROFIT_PCT || "0.3")) {
        logInfo(`   ✅ Above profit threshold - EXECUTABLE`);
      } else {
        logInfo(`   ❌ Below profit threshold`);
      }
    } else {
      logInfo(`\n🎯 Best Opportunity: None found`);
    }

    // Opportunities breakdown
    logInfo(`\n📋 All Opportunities:`);
    analysis.opportunities.forEach((opp, index) => {
      if (opp) {
        logInfo(
          `   ${index + 1}. ${opp.direction}: ${opp.profitPct.toFixed(3)}%`
        );
      } else {
        logInfo(`   ${index + 1}. Failed to calculate`);
      }
    });

    logInfo("\n" + "=".repeat(50));
  } catch (error) {
    logError(`Market analysis failed: ${error}`);
  }
}

function showHelp() {
  console.log(`
🤖 Solana Arbitrage Scanner

USAGE:
  npm start [mode]
  
MODES:
  scan, scanner    - Run continuous arbitrage scanning (default)
  monitor, watch   - Monitor price spreads only (no trading)
  analysis         - Run one-time market analysis
  help            - Show this help message

ENVIRONMENT VARIABLES:
  RPC_URL          - Solana RPC endpoint (default: mainnet-beta)
  KEYPAIR_PATH     - Path to wallet keypair JSON file
  PRIVATE_KEY      - Base58 encoded private key (alternative to KEYPAIR_PATH)
  
  PUMPSWAP_POOL    - PumpSwap pool address
  DLMM_POOL        - Meteora DLMM pool address  
  MINT             - Target token mint address
  BASE_MINT        - Base token mint address (usually WSOL)
  
  MIN_PROFIT_PCT   - Minimum profit percentage (default: 0.3)
  WSOL_TRADE_SIZE  - Trade size in WSOL (default: 0.1)
  PROCESS_DELAY    - Delay between scans in ms (default: 3000)
  DRY_RUN          - Set to 'true' for simulation mode (default: false)

EXAMPLES:
  npm start scan         # Start arbitrage scanner
  npm start monitor      # Monitor prices only
  npm start analysis     # Run market analysis
  
For more information, check the README.md file.
`);
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  logInfo("\n👋 Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logInfo("\n👋 Shutting down gracefully...");
  process.exit(0);
});

// Start the application
main().catch((error) => {
  logError(`❌ Unhandled error: ${error}`);
  process.exit(1);
});
