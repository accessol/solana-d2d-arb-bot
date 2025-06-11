// src/dex/dlmm.ts
import { Connection, PublicKey } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import dotenv from "dotenv";
import BN from "bn.js";
import { logDebug, logError, logInfo, logWarn } from "../logger";

dotenv.config();

// Environment variables
const DLMM_POOL = new PublicKey(process.env.DLMM_POOL!);
const MINT = new PublicKey(process.env.MINT!);
const BASE_MINT = new PublicKey(process.env.BASE_MINT!);

// Pool information interface based on DLMM SDK
interface DLMMPoolInfo {
  pubkey: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  reserveA: bigint;
  reserveB: bigint;
  binStep: number;
  baseFactor: number;
  activeId: number;
  maxId: number;
  minId: number;
  protocolFee: number;
  lpFeeRate: number;
  status: number;
  pairType: number;
  whitelisted: boolean;
  tokenADecimals: number;
  tokenBDecimals: number;
}

// Swap quote interface
interface SwapQuoteInfo {
  inputAmount: number;
  outputAmount: number;
  fee: number;
  priceImpact: number;
  minOutputAmount: number;
  binArraysPubkey: PublicKey[];
}

// Cache for pool data to avoid repeated fetches
let poolCache: DLMMPoolInfo | null = null;
let poolCacheTimestamp = 0;
const CACHE_DURATION = parseInt(process.env.CACHE_DURATION || "60000"); // 1 minute cache

// Decimals cache
const decimalsCache: Record<string, number> = {};

// Helper to get decimals for a mint (WSOL=9, USDC=6, fallback=9)
async function getTokenDecimals(
  connection: Connection,
  mint: PublicKey
): Promise<number> {
  const mintAddress = mint.toString();
  if (decimalsCache[mintAddress] !== undefined) {
    return decimalsCache[mintAddress];
  }

  try {
    const supplyInfo = await connection.getTokenSupply(mint);
    const decimals = supplyInfo.value.decimals;
    decimalsCache[mintAddress] = decimals;
    return decimals;
  } catch (error) {
    logError(`Failed to fetch decimals for mint ${mintAddress}: ${error}`);
    return 9; // Default fallback
  }
}

/**
 * Fetch DLMM pool information
 */
async function fetchPoolData(
  connection: Connection,
  poolAddress: PublicKey
): Promise<DLMMPoolInfo> {
  // Check cache first
  const now = Date.now();
  if (poolCache && now - poolCacheTimestamp < CACHE_DURATION) {
    return poolCache;
  }

  try {
    const dlmm = await DLMM.create(connection, poolAddress);

    if (!dlmm) {
      throw new Error(`Pool not found: ${poolAddress.toString()}`);
    }

    // Access the pool state from the DLMM instance
    const lbPair = dlmm.lbPair;

    const pool: DLMMPoolInfo = {
      pubkey: poolAddress,
      tokenMintA: lbPair.tokenXMint,
      tokenMintB: lbPair.tokenYMint,
      reserveA: BigInt(lbPair.reserveX?.toString() || "0"),
      reserveB: BigInt(lbPair.reserveY?.toString() || "0"),
      binStep: lbPair.binStep,
      baseFactor: lbPair.parameters?.baseFactor || 0,
      activeId: lbPair.activeId,
      maxId: 0, // Will be fetched separately if needed
      minId: 0, // Will be fetched separately if needed
      protocolFee: lbPair.parameters?.protocolShare || 0,
      lpFeeRate: lbPair.parameters?.baseFactor || 0,
      status: lbPair.status || 0,
      pairType: lbPair.pairType || 0,
      whitelisted: false, // Default value
      tokenADecimals: 9, // Default, should be fetched from token metadata
      tokenBDecimals: 9, // Default, should be fetched from token metadata
    };

    // Update cache
    poolCache = pool;
    poolCacheTimestamp = now;

    return pool;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error fetching DLMM pool data: ${errMsg}`);
    throw new Error(`Failed to fetch DLMM pool data: ${errMsg}`);
  }
}

/**
 * Get DLMM swap price/quote for selling target token (TokenA) for base token
 * @param connection - Solana connection
 * @param inputAmount - Amount of target token to swap (in target token units)
 * @param slippage - Slippage tolerance (default 0.5%)
 * @returns Output amount in base token units
 */
const DEFAULT_SLIPPAGE = parseFloat(process.env.SLIPPAGE || "0.005");
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
  direction: "sell" | "buy" = "sell",
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
export async function getDLMMPoolPrice(connection: Connection): Promise<{
  tokenAToTokenBPrice: number;
  tokenBToTokenAPrice: number;
  activePrice: number;
  poolAddress: string;
  poolInfo: DLMMPoolInfo;
}> {
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
  direction: "sell" | "buy" = "sell",
  slippage: number = 0.005
): Promise<{
  outputAmount: number;
  priceImpact: number;
  effectivePrice: number;
  fee: number;
  poolInfo: DLMMPoolInfo;
}> {
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

/**
 * Get bin information around the active bin
 * @param connection - Solana connection
 * @param binRange - Number of bins to retrieve on each side of active bin (default 10)
 */
export async function getDLMMBinInfo(
  connection: Connection,
  binRange: number = 10
): Promise<{
  activeBinId: number;
  bins: Array<{
    binId: number;
    price: number;
    liquidityX: bigint;
    liquidityY: bigint;
    supply: bigint;
  }>;
}> {
  try {
    const pool = await fetchPoolData(connection, DLMM_POOL);
    const dlmm = await DLMM.create(connection, DLMM_POOL);
    const activeBinId = pool.activeId;
    const binsResult = await dlmm.getBinsAroundActiveBin(binRange, binRange);
    const bins = binsResult.bins.map((bin: any) => {
      const binStep = pool.binStep;
      const price = Math.pow(1 + binStep / 10000, bin.binId - pool.activeId);
      return {
        binId: bin.binId,
        price,
        liquidityX: BigInt(bin.xAmount.toString()),
        liquidityY: BigInt(bin.yAmount.toString()),
        supply: BigInt(bin.supply.toString()),
      };
    });
    return {
      activeBinId,
      bins: bins.filter((bin: any) => bin.price > 0),
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error getting DLMM bin info: ${errMsg}`);
    throw new Error(`Failed to get DLMM bin info: ${errMsg}`);
  }
}

/**
 * Get detailed pool information
 * @param connection - Solana connection
 * @returns Complete pool information
 */
export async function getDLMMPoolInfo(
  connection: Connection
): Promise<DLMMPoolInfo> {
  return await fetchPoolData(connection, DLMM_POOL);
}

/**
 * Get pool statistics
 * @param connection - Solana connection
 */
export async function getDLMMPoolStats(connection: Connection): Promise<{
  totalLiquidity: {
    tokenA: bigint;
    tokenB: bigint;
  };
  activeBinId: number;
  binStep: number;
  fees: {
    protocolFee: number;
    lpFeeRate: number;
  };
  utilization: number;
  poolInfo: DLMMPoolInfo;
}> {
  try {
    const pool = await fetchPoolData(connection, DLMM_POOL);

    // Calculate utilization based on active vs total range
    const totalRange = pool.maxId - pool.minId;
    const utilization = totalRange > 0 ? 1 : 0; // Simplified calculation

    return {
      totalLiquidity: {
        tokenA: pool.reserveA,
        tokenB: pool.reserveB,
      },
      activeBinId: pool.activeId,
      binStep: pool.binStep,
      fees: {
        protocolFee: pool.protocolFee,
        lpFeeRate: pool.lpFeeRate,
      },
      utilization,
      poolInfo: pool,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error getting DLMM pool stats: ${errMsg}`);
    throw new Error(`Failed to get DLMM pool stats: ${errMsg}`);
  }
}

/**
 * Validate DLMM pool configuration
 */
export function validateDLMMConfig(): void {
  if (!process.env.DLMM_POOL) {
    throw new Error("DLMM_POOL environment variable is required");
  }
  if (!process.env.MINT) {
    throw new Error("MINT environment variable is required");
  }
  if (!process.env.BASE_MINT) {
    throw new Error("BASE_MINT environment variable is required");
  }

  logInfo("DLMM Pool configuration:");
  logInfo(`Pool Address: ${DLMM_POOL.toString()}`);
  logInfo(`Target Token (A): ${MINT.toString()}`);
  logInfo(`Base Token (B): ${BASE_MINT.toString()}`);
}

/**
 * Clear cache function (useful for testing or manual cache invalidation)
 */
export function clearDLMMCache(): void {
  poolCache = null;
  poolCacheTimestamp = 0;
}

// Export types and constants for external use
export { DLMM_POOL, MINT, BASE_MINT };
export type { DLMMPoolInfo, SwapQuoteInfo };
