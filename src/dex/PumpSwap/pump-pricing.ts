// src/dex/pump-pricing.ts
import { Connection } from "@solana/web3.js";
import { PumpAmmSdk } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";
import { logDebug, logError, logInfo, logWarn } from "../../logger";
import {
  PumpPool,
  SwapDirection,
  PoolPriceInfo,
  PriceImpactResult,
  PUMPSWAP_POOL,
  MINT,
  BASE_MINT,
  DEFAULT_SLIPPAGE,
} from "./pump-types";
import { fetchPoolData, getTokenDecimals } from "./pump-core";

/**
 * Get PumpSwap price/quote for a given input amount
 * @param connection - Solana connection
 * @param inputAmount - Amount of base token to swap (in base token units)
 * @param slippage - Slippage tolerance (default 1%)
 * @returns Output amount in target token units
 */
export async function getPumpSwapPrice(
  connection: Connection,
  inputAmount: number,
  slippage: number = DEFAULT_SLIPPAGE
): Promise<number> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    const pumpAmmSdk = new PumpAmmSdk(connection);

    // Convert inputAmount to BN in base token's smallest units
    const baseDecimals = await getTokenDecimals(connection, BASE_MINT);
    const inputAmountBN = new BN(Math.floor(inputAmount * 10 ** baseDecimals));

    // Debug: print inputAmount, inputAmountBN, baseDecimals
    logDebug(
      `PumpSwap input: ${inputAmount} base token (${BASE_MINT.toString()}), BN: ${inputAmountBN.toString()}, decimals: ${baseDecimals}`
    );

    const outputAmountBN = await pumpAmmSdk.swapAutocompleteQuoteFromBase(
      pool.pubkey,
      inputAmountBN,
      slippage,
      "baseToQuote"
    );

    // Debug: print outputAmountBN
    logDebug(`PumpSwap output BN: ${outputAmountBN.toString()}`);

    // Convert output to number in target token units
    const targetDecimals = await getTokenDecimals(connection, MINT);
    const output = Number(outputAmountBN.toString()) / 10 ** targetDecimals;

    // Debug: print output and targetDecimals
    logDebug(
      `PumpSwap output: ${output} target token (${MINT.toString()}), decimals: ${targetDecimals}`
    );

    return output;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error getting PumpSwap price: ${errMsg}`);
    throw new Error(`Failed to get PumpSwap price: ${errMsg}`);
  }
}

/**
 * Get reverse quote (target token to base token)
 * @param connection - Solana connection
 * @param inputAmount - Amount of target token to swap
 * @param slippage - Slippage tolerance (default 1%)
 * @returns Output amount in base token units
 */
export async function getPumpSwapReversePrice(
  connection: Connection,
  inputAmount: number,
  slippage: number = DEFAULT_SLIPPAGE
): Promise<number> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    const pumpAmmSdk = new PumpAmmSdk(connection);

    // Convert inputAmount to BN in target token's smallest units
    const targetDecimals = await getTokenDecimals(connection, MINT);
    const inputAmountBN = new BN(
      Math.floor(inputAmount * 10 ** targetDecimals)
    );

    const outputAmountBN = await pumpAmmSdk.swapAutocompleteBaseFromQuote(
      pool.pubkey,
      inputAmountBN,
      slippage,
      "quoteToBase"
    );

    // Convert output to number in base token units
    const baseDecimals = await getTokenDecimals(connection, BASE_MINT);
    return Number(outputAmountBN.toString()) / 10 ** baseDecimals;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error getting PumpSwap reverse price: ${errMsg}`);
    throw new Error(`Failed to get PumpSwap reverse price: ${errMsg}`);
  }
}

/**
 * Get current pool price ratio
 * @param connection - Solana connection
 * @returns Price ratio (base token per target token and vice versa)
 */
export async function getPumpSwapPoolPrice(
  connection: Connection
): Promise<PoolPriceInfo> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    const pumpAmmSdk = new PumpAmmSdk(connection);

    // Use BN for amounts
    const baseDecimals = await getTokenDecimals(connection, BASE_MINT);
    const targetDecimals = await getTokenDecimals(connection, MINT);
    const baseAmountBN = new BN(10 ** baseDecimals); // 1 base token
    const quoteAmountBN = new BN(10 ** targetDecimals); // 1 target token

    const [quoteFromBaseBN, baseFromQuoteBN] = await Promise.all([
      pumpAmmSdk.swapAutocompleteQuoteFromBase(
        pool.pubkey,
        baseAmountBN,
        0.01,
        "baseToQuote"
      ),
      pumpAmmSdk.swapAutocompleteBaseFromQuote(
        pool.pubkey,
        quoteAmountBN,
        0.01,
        "quoteToBase"
      ),
    ]);

    // Convert BN to numbers
    const quoteFromBase =
      Number(quoteFromBaseBN.toString()) / 10 ** targetDecimals;
    const baseFromQuote =
      Number(baseFromQuoteBN.toString()) / 10 ** baseDecimals;

    return {
      baseToQuotePrice: quoteFromBase / 1, // 1 base token
      quoteToBasePrice: baseFromQuote / 1, // 1 quote token
      poolAddress: PUMPSWAP_POOL.toString(),
      poolInfo: pool,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error getting pool price: ${errMsg}`);
    throw new Error(`Failed to get pool price: ${errMsg}`);
  }
}

/**
 * Calculate price impact for a potential swap
 * @param connection - Solana connection
 * @param inputAmount - Amount to swap
 * @param direction - Swap direction ("baseToQuote" or "quoteToBase")
 * @param slippage - Slippage tolerance
 */
export async function calculatePriceImpact(
  connection: Connection,
  inputAmount: number,
  direction: SwapDirection = "baseToQuote",
  slippage: number = 0.01
): Promise<PriceImpactResult> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    const pumpAmmSdk = new PumpAmmSdk(connection);
    const poolPriceInfo = await getPumpSwapPoolPrice(connection);

    let outputAmount: number;
    let currentPrice: number;

    if (direction === "baseToQuote") {
      const baseDecimals = await getTokenDecimals(connection, BASE_MINT);
      const inputAmountBN = new BN(
        Math.floor(inputAmount * 10 ** baseDecimals)
      );
      const outputAmountBN = await pumpAmmSdk.swapAutocompleteQuoteFromBase(
        pool.pubkey,
        inputAmountBN,
        slippage,
        "baseToQuote"
      );
      const targetDecimals = await getTokenDecimals(connection, MINT);
      outputAmount = Number(outputAmountBN.toString()) / 10 ** targetDecimals;
      currentPrice = poolPriceInfo.baseToQuotePrice;
    } else {
      const targetDecimals = await getTokenDecimals(connection, MINT);
      const inputAmountBN = new BN(
        Math.floor(inputAmount * 10 ** targetDecimals)
      );
      const outputAmountBN = await pumpAmmSdk.swapAutocompleteBaseFromQuote(
        pool.pubkey,
        inputAmountBN,
        slippage,
        "quoteToBase"
      );
      const baseDecimals = await getTokenDecimals(connection, BASE_MINT);
      outputAmount = Number(outputAmountBN.toString()) / 10 ** baseDecimals;
      currentPrice = poolPriceInfo.quoteToBasePrice;
    }

    const expectedOutput = inputAmount * currentPrice;
    const priceImpact =
      ((expectedOutput - outputAmount) / expectedOutput) * 100;
    const effectivePrice = outputAmount / inputAmount;

    return {
      outputAmount,
      priceImpact,
      effectivePrice,
      poolInfo: pool,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error calculating price impact: ${errMsg}`);
    throw new Error(`Failed to calculate price impact: ${errMsg}`);
  }
}

/**
 * Fixed version of getPumpSwapPrice with proper direction detection
 */
export async function getPumpSwapPriceFixed(
  connection: Connection,
  inputAmount: number,
  slippage: number = DEFAULT_SLIPPAGE,
  direction: SwapDirection
): Promise<number> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    const pumpAmmSdk = new PumpAmmSdk(connection);

    let outputAmountBN: BN;
    let inputDecimals: number;
    let outputDecimals: number;

    if (direction === "baseToQuote") {
      // Swapping from pool's base token (USDC) to pool's quote token (WSOL)
      inputDecimals = await getTokenDecimals(connection, MINT);
      outputDecimals = await getTokenDecimals(connection, BASE_MINT);
      const inputAmountBN = new BN(
        Math.floor(inputAmount * 10 ** inputDecimals)
      );

      logDebug(`Using swapAutocompleteQuoteFromBase`);
      logDebug(
        `Input: ${inputAmount} tokens = ${inputAmountBN.toString()} smallest units (${inputDecimals} decimals)`
      );

      outputAmountBN = await pumpAmmSdk.swapAutocompleteQuoteFromBase(
        pool.pubkey,
        inputAmountBN,
        slippage,
        "baseToQuote"
      );
    } else if (direction === "quoteToBase") {
      // Swapping from pool's quote token (WSOL) to pool's base token (USDC)
      inputDecimals = await getTokenDecimals(connection, BASE_MINT);
      outputDecimals = await getTokenDecimals(connection, MINT);
      const inputAmountBN = new BN(
        Math.floor(inputAmount * 10 ** inputDecimals)
      );

      logDebug(`Using swapAutocompleteBaseFromQuote`);
      logDebug(
        `Input: ${inputAmount} tokens = ${inputAmountBN.toString()} smallest units (${inputDecimals} decimals)`
      );

      outputAmountBN = await pumpAmmSdk.swapAutocompleteBaseFromQuote(
        pool.pubkey,
        inputAmountBN,
        slippage,
        "quoteToBase"
      );
    } else {
      throw new Error(`Invalid swap direction: ${direction}`);
    }

    const output = Number(outputAmountBN.toString()) / 10 ** outputDecimals;

    logDebug(
      `Output: ${outputAmountBN.toString()} smallest units = ${output} tokens (${outputDecimals} decimals)`
    );
    logDebug(`Rate: 1 input token = ${output / inputAmount} output tokens`);

    return output;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error getting PumpSwap price: ${errMsg}`);
    throw new Error(`Failed to get PumpSwap price: ${errMsg}`);
  }
}

// ================== DEBUGGING FUNCTIONS ==================

/**
 * Debug pool structure to understand token roles
 */
export async function debugPoolStructure(
  connection: Connection
): Promise<void> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    logInfo("=== POOL STRUCTURE DEBUG ===");
    logInfo(`Pool Address: ${pool.pubkey.toString()}`);
    logInfo(`Pool Base Mint: ${pool.base_mint.toString()}`);
    logInfo(`Pool Quote Mint: ${pool.quote_mint.toString()}`);
    logInfo(`Pool Bump: ${pool.pool_bump}`);
    logInfo(`Pool Index: ${pool.index}`);
    logInfo(`Creator: ${pool.creator.toString()}`);
    logInfo(`Coin Creator: ${pool.coin_creator.toString()}`);
    logInfo(`LP Mint: ${pool.lp_mint.toString()}`);
    logInfo(`LP Supply: ${pool.lp_supply.toString()}`);
    logInfo("Your Environment Variables:");
    logInfo(`BASE_MINT: ${BASE_MINT.toString()}`);
    logInfo(`MINT (target): ${MINT.toString()}`);

    // Check if your env vars match the pool structure
    const baseMatches = pool.base_mint.equals(BASE_MINT);
    const quoteMatches = pool.quote_mint.equals(MINT);
    const baseMatchesTarget = pool.base_mint.equals(MINT);
    const quoteMatchesBase = pool.quote_mint.equals(BASE_MINT);

    logInfo(`\nMatching Analysis:`);
    logInfo(`Pool base == your BASE_MINT: ${baseMatches}`);
    logInfo(`Pool quote == your MINT: ${quoteMatches}`);
    logInfo(`Pool base == your MINT: ${baseMatchesTarget}`);
    logInfo(`Pool quote == your BASE_MINT: ${quoteMatchesBase}`);

    if (baseMatchesTarget && quoteMatchesBase) {
      logWarn(
        "\n🚨 ISSUE FOUND: Your BASE_MINT and MINT variables are swapped!"
      );
      logWarn("The pool's base token is what you call MINT (target token)");
      logWarn("The pool's quote token is what you call BASE_MINT");
    }
  } catch (error) {
    logError(`Error debugging pool structure: ${error}`);
  }
}
