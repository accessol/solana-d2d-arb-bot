// src/dex/pump.ts
import { Connection, PublicKey, AccountInfo } from "@solana/web3.js";
import { PumpAmmSdk } from "@pump-fun/pump-swap-sdk";
import dotenv from "dotenv";

dotenv.config();

// Environment variables
const PUMPSWAP_POOL = new PublicKey(process.env.PUMPSWAP_POOL!);
const MINT = new PublicKey(process.env.MINT!);
const BASE_MINT = new PublicKey(process.env.BASE_MINT!);

// Complete Pool interface based on PumpSwap SDK requirements
export interface PumpPool {
  pubkey: PublicKey;
  base_mint: PublicKey;
  quote_mint: PublicKey;
  creator: PublicKey;
  index: number;
  lp_mint: PublicKey;
  lp_supply: bigint;
  pool_base_token_account: PublicKey;
  pool_quote_token_account: PublicKey;
  pool_bump: number;
}

// Borsh schema for deserializing pool account data
class PoolAccount {
  base_mint!: Uint8Array;
  quote_mint!: Uint8Array;
  creator!: Uint8Array;
  index!: number;
  lp_mint!: Uint8Array;
  lp_supply!: bigint;
  pool_base_token_account!: Uint8Array;
  pool_quote_token_account!: Uint8Array;
  pool_bump!: number;

  constructor(fields: {
    base_mint: Uint8Array;
    quote_mint: Uint8Array;
    creator: Uint8Array;
    index: number;
    lp_mint: Uint8Array;
    lp_supply: bigint;
    pool_base_token_account: Uint8Array;
    pool_quote_token_account: Uint8Array;
    pool_bump: number;
  }) {
    Object.assign(this, fields);
  }
}

// Borsh schema definition for pool account
const poolAccountSchema = {
  struct: {
    base_mint: { array: { type: "u8", len: 32 } },
    quote_mint: { array: { type: "u8", len: 32 } },
    creator: { array: { type: "u8", len: 32 } },
    index: "u64",
    lp_mint: { array: { type: "u8", len: 32 } },
    lp_supply: "u64",
    pool_base_token_account: { array: { type: "u8", len: 32 } },
    pool_quote_token_account: { array: { type: "u8", len: 32 } },
    pool_bump: "u8",
  },
};

// Cache for pool data to avoid repeated fetches
let poolCache: PumpPool | null = null;
let poolCacheTimestamp = 0;
const CACHE_DURATION = 60000; // 1 minute cache

/**
 * Fetch pool data from the blockchain
 */
async function fetchPoolData(
  connection: Connection,
  poolAddress: PublicKey
): Promise<PumpPool> {
  // Check cache first
  const now = Date.now();
  if (poolCache && now - poolCacheTimestamp < CACHE_DURATION) {
    return poolCache;
  }

  try {
    // Fetch pool account data
    const poolAccountInfo = await connection.getAccountInfo(poolAddress);
    if (!poolAccountInfo) {
      throw new Error(`Pool not found: ${poolAddress.toString()}`);
    }

    // Deserialize pool account data
    const poolData = deserializePoolAccount(poolAccountInfo);

    // Create Pool object
    const pool: PumpPool = {
      pubkey: poolAddress,
      base_mint: new PublicKey(poolData.base_mint),
      quote_mint: new PublicKey(poolData.quote_mint),
      creator: new PublicKey(poolData.creator),
      index: poolData.index,
      lp_mint: new PublicKey(poolData.lp_mint),
      lp_supply: poolData.lp_supply,
      pool_base_token_account: new PublicKey(poolData.pool_base_token_account),
      pool_quote_token_account: new PublicKey(
        poolData.pool_quote_token_account
      ),
      pool_bump: poolData.pool_bump,
    };

    // Update cache
    poolCache = pool;
    poolCacheTimestamp = now;

    return pool;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Error fetching pool data:", errMsg);
    throw new Error(`Failed to fetch pool data: ${errMsg}`);
  }
}

/**
 * Deserialize pool account data using Borsh
 */
function deserializePoolAccount(accountInfo: AccountInfo<Buffer>): PoolAccount {
  try {
    // Skip the discriminator (first 8 bytes) if present
    const data = accountInfo.data.slice(8);
    const result = borsh.deserialize(poolAccountSchema, data) as any;

    // Create PoolAccount instance from deserialized data
    return new PoolAccount({
      base_mint: new Uint8Array(result.base_mint),
      quote_mint: new Uint8Array(result.quote_mint),
      creator: new Uint8Array(result.creator),
      index: Number(result.index),
      lp_mint: new Uint8Array(result.lp_mint),
      lp_supply: BigInt(result.lp_supply),
      pool_base_token_account: new Uint8Array(result.pool_base_token_account),
      pool_quote_token_account: new Uint8Array(result.pool_quote_token_account),
      pool_bump: result.pool_bump,
    });
  } catch (error) {
    console.error("Error deserializing pool account:", error);
    // Fallback: manual deserialization if Borsh fails
    return manualDeserializePoolAccount(accountInfo.data);
  }
}

/**
 * Manual deserialization fallback for pool account data
 */
function manualDeserializePoolAccount(data: Buffer): PoolAccount {
  let offset = 8; // Skip discriminator

  const base_mint = data.slice(offset, offset + 32);
  offset += 32;

  const quote_mint = data.slice(offset, offset + 32);
  offset += 32;

  const creator = data.slice(offset, offset + 32);
  offset += 32;

  const index = data.readBigUInt64LE(offset);
  offset += 8;

  const lp_mint = data.slice(offset, offset + 32);
  offset += 32;

  const lp_supply = data.readBigUInt64LE(offset);
  offset += 8;

  const pool_base_token_account = data.slice(offset, offset + 32);
  offset += 32;

  const pool_quote_token_account = data.slice(offset, offset + 32);
  offset += 32;

  const pool_bump = data.readUInt8(offset);

  return new PoolAccount({
    base_mint,
    quote_mint,
    creator,
    index: Number(index),
    lp_mint,
    lp_supply,
    pool_base_token_account,
    pool_quote_token_account,
    pool_bump,
  });
}

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
  slippage: number = 0.01
): Promise<number> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    const pumpAmmSdk = new PumpAmmSdk(connection);

    const outputAmount = await pumpAmmSdk.swapAutocompleteQuoteFromBase(
      pool.pubkey,
      inputAmount,
      slippage,
      "baseToQuote"
    );

    return outputAmount;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Error getting PumpSwap price:", errMsg);
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
  slippage: number = 0.01
): Promise<number> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    const pumpAmmSdk = new PumpAmmSdk(connection);

    const outputAmount = await pumpAmmSdk.swapAutocompleteBaseFromQuote(
      pool.pubkey,
      inputAmount,
      slippage,
      "quoteToBase"
    );

    return outputAmount;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Error getting PumpSwap reverse price:", errMsg);
    throw new Error(`Failed to get PumpSwap reverse price: ${errMsg}`);
  }
}

/**
 * Get current pool price ratio
 * @param connection - Solana connection
 * @returns Price ratio (base token per target token and vice versa)
 */
export async function getPumpSwapPoolPrice(connection: Connection): Promise<{
  baseToQuotePrice: number;
  quoteToBasePrice: number;
  poolAddress: string;
  poolInfo: PumpPool;
}> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    const pumpAmmSdk = new PumpAmmSdk(connection);

    const baseAmount = 1;
    const quoteAmount = 1;

    const [quoteFromBase, baseFromQuote] = await Promise.all([
      pumpAmmSdk.swapAutocompleteQuoteFromBase(
        pool.pubkey,
        baseAmount,
        0.01,
        "baseToQuote"
      ),
      pumpAmmSdk.swapAutocompleteBaseFromQuote(
        pool.pubkey,
        quoteAmount,
        0.01,
        "quoteToBase"
      ),
    ]);

    return {
      baseToQuotePrice: quoteFromBase / baseAmount,
      quoteToBasePrice: baseFromQuote / quoteAmount,
      poolAddress: PUMPSWAP_POOL.toString(),
      poolInfo: pool,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Error getting pool price:", errMsg);
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
  direction: "baseToQuote" | "quoteToBase" = "baseToQuote",
  slippage: number = 0.01
): Promise<{
  outputAmount: number;
  priceImpact: number;
  effectivePrice: number;
  poolInfo: PumpPool;
}> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    const pumpAmmSdk = new PumpAmmSdk(connection);
    const poolPriceInfo = await getPumpSwapPoolPrice(connection);

    let outputAmount: number;
    let currentPrice: number;

    if (direction === "baseToQuote") {
      outputAmount = await pumpAmmSdk.swapAutocompleteQuoteFromBase(
        pool.pubkey,
        inputAmount,
        slippage,
        "baseToQuote"
      );
      currentPrice = poolPriceInfo.baseToQuotePrice;
    } else {
      outputAmount = await pumpAmmSdk.swapAutocompleteBaseFromQuote(
        pool.pubkey,
        inputAmount,
        slippage,
        "quoteToBase"
      );
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
    console.error("Error calculating price impact:", errMsg);
    throw new Error(`Failed to calculate price impact: ${errMsg}`);
  }
}

/**
 * Get detailed pool information
 * @param connection - Solana connection
 * @returns Complete pool information
 */
export async function getPoolInfo(connection: Connection): Promise<PumpPool> {
  return await fetchPoolData(connection, PUMPSWAP_POOL);
}

/**
 * Validate pool configuration
 */
export function validatePoolConfig(): void {
  if (!process.env.PUMPSWAP_POOL) {
    throw new Error("PUMPSWAP_POOL environment variable is required");
  }
  if (!process.env.MINT) {
    throw new Error("MINT environment variable is required");
  }
  if (!process.env.BASE_MINT) {
    throw new Error("BASE_MINT environment variable is required");
  }

  console.log("Pool configuration:");
  console.log(`Pool Address: ${PUMPSWAP_POOL.toString()}`);
  console.log(`Target Token: ${MINT.toString()}`);
  console.log(`Base Token: ${BASE_MINT.toString()}`);
}

/**
 * Clear cache function (useful for testing or manual cache invalidation)
 */
export function clearPoolCache(): void {
  poolCache = null;
  poolCacheTimestamp = 0;
}

// Export types and constants for external use
export { PUMPSWAP_POOL, MINT, BASE_MINT, PoolAccount };
export type { PumpPool };
