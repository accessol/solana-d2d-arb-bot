// src/dex/dlmm_pricing.ts
import { Connection } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import BN from "bn.js";
import dotenv from "dotenv";
import { logError } from "../../logger";
import {
  DLMM_POOL,
  MINT,
  BASE_MINT,
  getTokenDecimals,
  fetchPoolData,
} from "./dlmm_core";
import {
  SwapQuoteInfo,
  DLMMPriceInfo,
  DLMMPriceImpact,
  SwapDirection,
} from "./dlmm_types";

dotenv.config();

const DEFAULT_SLIPPAGE = parseFloat(process.env.SLIPPAGE || "0.005");

/**
 * Get DLMM swap price/quote for selling target token (TokenA) for base token
 * @param connection - Solana connection
 * @param inputAmount - Amount of target token to swap (in target token units)
 * @param slippage - Slippage tolerance (default 0.5%)
 * @returns Output amount in base token units
 */
export async function getDLMMPrice(
  connection: Connection,
  inputAmount: number,
  slippage: number = DEFAULT_SLIPPAGE
): Promise<number> {
  try {
    const dlmm = await DLMM.create(connection, DLMM_POOL);
    const targetDecimals = await getTokenDecimals(connection, MINT);
    const baseDecimals = await getTokenDecimals(connection, BASE_MINT);

    // inputAmount is in target token units (e.g., USDC)
    const inputAmountBN = new BN(
      Math.floor(inputAmount * 10 ** targetDecimals)
    );

    const binArrays = await dlmm.getBinArrayForSwap(false); // false for X to Y swap
    const quote = dlmm.swapQuote(
      inputAmountBN,
      false,
      new BN(Math.floor(slippage * 100)),
      binArrays
    );

    // output is in base token units (WSOL)
    return Number(quote.outAmount.toString()) / 10 ** baseDecimals;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error getting DLMM price: ${errMsg}`);
    throw new Error(`Failed to get DLMM price: ${errMsg}`);
  }
}

/**
 * Get reverse quote (buying target token with base token)
 * @param connection - Solana connection
 * @param inputAmount - Amount of base token to swap
 * @param slippage - Slippage tolerance (default 0.5%)
 * @returns Output amount in target token units
 */
export async function getDLMMReversePrice(
  connection: Connection,
  inputAmount: number,
  slippage: number = DEFAULT_SLIPPAGE
): Promise<number> {
  try {
    const dlmm = await DLMM.create(connection, DLMM_POOL);
    const baseDecimals = await getTokenDecimals(connection, BASE_MINT);
    const targetDecimals = await getTokenDecimals(connection, MINT);

    // inputAmount is in base token units (WSOL)
    const inputAmountBN = new BN(Math.floor(inputAmount * 10 ** baseDecimals));

    const binArrays = await dlmm.getBinArrayForSwap(true); // true for Y to X swap
    const quote = dlmm.swapQuote(
      inputAmountBN,
      true,
      new BN(Math.floor(slippage * 100)),
      binArrays
    );

    // output is in target token units (e.g., USDC)
    return Number(quote.outAmount.toString()) / 10 ** targetDecimals;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error getting DLMM reverse price: ${errMsg}`);
    throw new Error(`Failed to get DLMM reverse price: ${errMsg}`);
  }
}

/**
 * Get detailed swap quote with price impact and fees
 * @param connection - Solana connection
 * @param inputAmount - Amount to swap
 * @param direction - Swap direction ("sell" for target->base, "buy" for base->target)
 * @param slippage - Slippage tolerance
 */
export async function getDLMMSwapQuote(
  connection: Connection,
  inputAmount: number,
  direction: SwapDirection = "sell",
  slippage: number = DEFAULT_SLIPPAGE
): Promise<SwapQuoteInfo> {
  try {
    const dlmm = await DLMM.create(connection, DLMM_POOL);
    const swapYtoX = direction === "buy";
    const baseDecimals = await getTokenDecimals(connection, BASE_MINT);
    const targetDecimals = await getTokenDecimals(connection, MINT);

    const inputAmountBN = new BN(
      Math.floor(inputAmount * 10 ** (swapYtoX ? baseDecimals : targetDecimals))
    );

    const binArrays = await dlmm.getBinArrayForSwap(swapYtoX);
    const quote = dlmm.swapQuote(
      inputAmountBN,
      swapYtoX,
      new BN(Math.floor(slippage * 100)),
      binArrays
    );

    return {
      inputAmount: inputAmount,
      outputAmount:
        Number(quote.outAmount.toString()) /
        10 ** (swapYtoX ? targetDecimals : baseDecimals),
      fee: quote.fee
        ? Number(quote.fee.toString()) /
          10 ** (swapYtoX ? targetDecimals : baseDecimals)
        : 0,
      priceImpact: quote.priceImpact?.toNumber() || 0,
      minOutputAmount: quote.minOutAmount
        ? Number(quote.minOutAmount.toString()) /
          10 ** (swapYtoX ? targetDecimals : baseDecimals)
        : (Number(quote.outAmount.toString()) /
            10 ** (swapYtoX ? targetDecimals : baseDecimals)) *
          (1 - slippage),
      binArraysPubkey: binArrays.map((ba: any) => ba.publicKey),
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error getting DLMM swap quote: ${errMsg}`);
    throw new Error(`Failed to get DLMM swap quote: ${errMsg}`);
  }
}

/**
 * Get current pool price information
 * @param connection - Solana connection
 * @returns Price information and pool details
 */
export async function getDLMMPoolPrice(
  connection: Connection
): Promise<DLMMPriceInfo> {
  try {
    const pool = await fetchPoolData(connection, DLMM_POOL);
    const dlmm = await DLMM.create(connection, DLMM_POOL);

    // Get active bin information
    const activeBin = await dlmm.getActiveBin();
    const activePrice = parseFloat(activeBin.price) || 0;

    // Calculate unit prices for both directions
    const unitAmount = 1;

    const [tokenBFromA, tokenAFromB] = await Promise.all([
      getDLMMPrice(connection, unitAmount, 0.001),
      getDLMMReversePrice(connection, unitAmount, 0.001),
    ]);

    return {
      tokenAToTokenBPrice: tokenBFromA / unitAmount,
      tokenBToTokenAPrice: tokenAFromB / unitAmount,
      activePrice,
      poolAddress: DLMM_POOL.toString(),
      poolInfo: pool,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error getting DLMM pool price: ${errMsg}`);
    throw new Error(`Failed to get DLMM pool price: ${errMsg}`);
  }
}

/**
 * Calculate price impact for a potential swap
 * @param connection - Solana connection
 * @param inputAmount - Amount to swap
 * @param direction - Swap direction ("sell" or "buy")
 * @param slippage - Slippage tolerance
 */
export async function calculateDLMMPriceImpact(
  connection: Connection,
  inputAmount: number,
  direction: SwapDirection = "sell",
  slippage: number = 0.005
): Promise<DLMMPriceImpact> {
  try {
    const pool = await fetchPoolData(connection, DLMM_POOL);
    const quote = await getDLMMSwapQuote(
      connection,
      inputAmount,
      direction,
      slippage
    );
    const poolPriceInfo = await getDLMMPoolPrice(connection);

    const currentPrice =
      direction === "sell"
        ? poolPriceInfo.tokenAToTokenBPrice
        : poolPriceInfo.tokenBToTokenAPrice;

    const expectedOutput = inputAmount * currentPrice;
    const priceImpact =
      ((expectedOutput - quote.outputAmount) / expectedOutput) * 100;
    const effectivePrice = quote.outputAmount / inputAmount;

    return {
      outputAmount: quote.outputAmount,
      priceImpact: Math.max(0, priceImpact), // Ensure non-negative
      effectivePrice,
      fee: quote.fee,
      poolInfo: pool,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error calculating DLMM price impact: ${errMsg}`);
    throw new Error(`Failed to calculate DLMM price impact: ${errMsg}`);
  }
}
