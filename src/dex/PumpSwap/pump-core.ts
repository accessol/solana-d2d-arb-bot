// src/dex/pump-core.ts
import { Connection, PublicKey, AccountInfo } from "@solana/web3.js";
import * as borsh from "borsh";
import { logDebug, logError, logInfo, logWarn } from "../../logger";
import {
  PumpPool,
  PoolAccount,
  poolAccountSchema,
  PUMPSWAP_POOL,
  MINT,
  BASE_MINT,
  CACHE_DURATION,
  PoolBalances,
} from "./pump-types";

// Cache for pool data to avoid repeated fetches
let poolCache: PumpPool | null = null;
let poolCacheTimestamp = 0;

// Token decimals cache
const decimalsCache: Record<string, number> = {};

/**
 * Fetch pool data from the blockchain
 */
export async function fetchPoolData(
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

    // Create Pool object with corrected field order
    const pool: PumpPool = {
      pubkey: poolAddress,
      pool_bump: poolData.pool_bump,
      index: poolData.index,
      creator: new PublicKey(poolData.creator),
      base_mint: new PublicKey(poolData.base_mint),
      quote_mint: new PublicKey(poolData.quote_mint),
      lp_mint: new PublicKey(poolData.lp_mint),
      pool_base_token_account: new PublicKey(poolData.pool_base_token_account),
      pool_quote_token_account: new PublicKey(
        poolData.pool_quote_token_account
      ),
      lp_supply: poolData.lp_supply,
      coin_creator: new PublicKey(poolData.coin_creator),
    };

    // Update cache
    poolCache = pool;
    poolCacheTimestamp = now;

    return pool;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logError(`Error fetching pool data: ${errMsg}`);
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
      pool_bump: result.pool_bump,
      index: Number(result.index),
      creator: new Uint8Array(result.creator),
      base_mint: new Uint8Array(result.base_mint),
      quote_mint: new Uint8Array(result.quote_mint),
      lp_mint: new Uint8Array(result.lp_mint),
      pool_base_token_account: new Uint8Array(result.pool_base_token_account),
      pool_quote_token_account: new Uint8Array(result.pool_quote_token_account),
      lp_supply: BigInt(result.lp_supply),
      coin_creator: new Uint8Array(result.coin_creator),
    });
  } catch (error) {
    logError(`Error deserializing pool account: ${error}`);
    // Fallback: manual deserialization if Borsh fails
    return manualDeserializePoolAccount(accountInfo.data);
  }
}

/**
 * Manual deserialization fallback for pool account data
 */
function manualDeserializePoolAccount(data: Buffer): PoolAccount {
  let offset = 8; // Skip discriminator

  // Read fields in the correct order based on SolScan data
  const pool_bump = data.readUInt8(offset);
  offset += 1;

  const index = data.readUInt16LE(offset);
  offset += 2;

  const creator = data.slice(offset, offset + 32);
  offset += 32;

  const base_mint = data.slice(offset, offset + 32);
  offset += 32;

  const quote_mint = data.slice(offset, offset + 32);
  offset += 32;

  const lp_mint = data.slice(offset, offset + 32);
  offset += 32;

  const pool_base_token_account = data.slice(offset, offset + 32);
  offset += 32;

  const pool_quote_token_account = data.slice(offset, offset + 32);
  offset += 32;

  const lp_supply = data.readBigUInt64LE(offset);
  offset += 8;

  const coin_creator = data.slice(offset, offset + 32);

  return new PoolAccount({
    pool_bump,
    index: Number(index),
    creator,
    base_mint,
    quote_mint,
    lp_mint,
    pool_base_token_account,
    pool_quote_token_account,
    lp_supply,
    coin_creator,
  });
}

/**
 * Get detailed pool information
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

  logInfo("💊 PumpSwap Pool configuration:");
  logInfo(`Pool Address: ${PUMPSWAP_POOL.toString()}`);
  logInfo(`Target Token: ${MINT.toString()}`);
  logInfo(`Base Token: ${BASE_MINT.toString()}`);
}

/**
 * Clear cache function (useful for testing or manual cache invalidation)
 */
export function clearPoolCache(): void {
  poolCache = null;
  poolCacheTimestamp = 0;
}

/**
 * Get the number of decimals for a given token mint
 */
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
 * Get pool token balances for debugging
 */
export async function getPoolBalances(
  connection: Connection
): Promise<PoolBalances> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);

    // Get token account balances
    const [baseAccountInfo, quoteAccountInfo] = await Promise.all([
      connection.getTokenAccountBalance(pool.pool_base_token_account),
      connection.getTokenAccountBalance(pool.pool_quote_token_account),
    ]);

    const baseBalance =
      Number(baseAccountInfo.value.amount) /
      10 ** baseAccountInfo.value.decimals;
    const quoteBalance =
      Number(quoteAccountInfo.value.amount) /
      10 ** quoteAccountInfo.value.decimals;

    logInfo(`\n=== POOL BALANCES ===`);
    logInfo(`Base token (${pool.base_mint.toString()}): ${baseBalance}`);
    logInfo(`Quote token (${pool.quote_mint.toString()}): ${quoteBalance}`);
    logInfo(`Current pool ratio: 1 base = ${quoteBalance / baseBalance} quote`);
    logInfo(`Current pool ratio: 1 quote = ${baseBalance / quoteBalance} base`);

    return {
      baseBalance,
      quoteBalance,
      baseToken: pool.base_mint.toString(),
      quoteToken: pool.quote_mint.toString(),
    };
  } catch (error) {
    logError(`Error getting pool balances: ${error}`);
    throw error;
  }
}
