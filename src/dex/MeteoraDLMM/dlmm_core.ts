// src/dex/dlmm_core.ts
import { Connection, PublicKey } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import dotenv from "dotenv";
import { logDebug, logError, logInfo, logWarn } from "../../logger";
import {
  DLMMPoolInfo,
  DLMMBinData,
  DLMMBinInfo,
  DLMMPoolStats,
} from "./dlmm_types";

dotenv.config();

// Environment variables
export const DLMM_POOL = new PublicKey(process.env.DLMM_POOL!);
export const MINT = new PublicKey(process.env.MINT!);
export const BASE_MINT = new PublicKey(process.env.BASE_MINT!);

// Cache for pool data to avoid repeated fetches
let poolCache: DLMMPoolInfo | null = null;
let poolCacheTimestamp = 0;
const CACHE_DURATION = parseInt(process.env.CACHE_DURATION || "60000"); // 1 minute cache

// Decimals cache
const decimalsCache: Record<string, number> = {};

// Helper to get decimals for a mint (WSOL=9, USDC=6, fallback=9)
export async function getTokenDecimals(
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
export async function fetchPoolData(
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
 * Get bin information around the active bin
 * @param connection - Solana connection
 * @param binRange - Number of bins to retrieve on each side of active bin (default 10)
 */
export async function getDLMMBinInfo(
  connection: Connection,
  binRange: number = 10
): Promise<DLMMBinData> {
  try {
    const pool = await fetchPoolData(connection, DLMM_POOL);
    const dlmm = await DLMM.create(connection, DLMM_POOL);
    const activeBinId = pool.activeId;
    const binsResult = await dlmm.getBinsAroundActiveBin(binRange, binRange);

    const bins: DLMMBinInfo[] = binsResult.bins.map((bin: any) => {
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
      bins: bins.filter((bin: DLMMBinInfo) => bin.price > 0),
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error getting DLMM bin info: ${errMsg}`);
    throw new Error(`Failed to get DLMM bin info: ${errMsg}`);
  }
}

/**
 * Get pool statistics
 * @param connection - Solana connection
 */
export async function getDLMMPoolStats(
  connection: Connection
): Promise<DLMMPoolStats> {
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

  logInfo("☄️- DLMM Pool configuration:");
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
