// src/dex/pump.ts
import { Connection, PublicKey, AccountInfo } from "@solana/web3.js";
import { PumpAmmSdk } from "@pump-fun/pump-swap-sdk";
import * as borsh from "borsh";
import dotenv from "dotenv";
import BN from "bn.js";
import { logDebug, logError, logInfo, logWarn } from "../logger";

dotenv.config();

// Environment variables
const PUMPSWAP_POOL = new PublicKey(process.env.PUMPSWAP_POOL!);
const MINT = new PublicKey(process.env.MINT!);
const BASE_MINT = new PublicKey(process.env.BASE_MINT!);

// Corrected Pool interface based on actual SolScan data
export interface PumpPool {
  pubkey: PublicKey;
  pool_bump: number;
  index: number; // Changed from number to match u16
  creator: PublicKey;
  base_mint: PublicKey;
  quote_mint: PublicKey;
  lp_mint: PublicKey;
  pool_base_token_account: PublicKey;
  pool_quote_token_account: PublicKey;
  lp_supply: bigint;
  coin_creator: PublicKey; // Added missing field
}

// Corrected Borsh schema class
class PoolAccount {
  pool_bump!: number;
  index!: number;
  creator!: Uint8Array;
  base_mint!: Uint8Array;
  quote_mint!: Uint8Array;
  lp_mint!: Uint8Array;
  pool_base_token_account!: Uint8Array;
  pool_quote_token_account!: Uint8Array;
  lp_supply!: bigint;
  coin_creator!: Uint8Array;

  constructor(fields: {
    pool_bump: number;
    index: number;
    creator: Uint8Array;
    base_mint: Uint8Array;
    quote_mint: Uint8Array;
    lp_mint: Uint8Array;
    pool_base_token_account: Uint8Array;
    pool_quote_token_account: Uint8Array;
    lp_supply: bigint;
    coin_creator: Uint8Array;
  }) {
    Object.assign(this, fields);
  }
}

// Corrected Borsh schema definition matching SolScan structure
const poolAccountSchema = {
  struct: {
    pool_bump: "u8",
    index: "u16", // Changed from u64 to u16
    creator: { array: { type: "u8", len: 32 } },
    base_mint: { array: { type: "u8", len: 32 } },
    quote_mint: { array: { type: "u8", len: 32 } },
    lp_mint: { array: { type: "u8", len: 32 } },
    pool_base_token_account: { array: { type: "u8", len: 32 } },
    pool_quote_token_account: { array: { type: "u8", len: 32 } },
    lp_supply: "u64",
    coin_creator: { array: { type: "u8", len: 32 } }, // Added missing field
  },
};

// Cache for pool data to avoid repeated fetches
let poolCache: PumpPool | null = null;
let poolCacheTimestamp = 0;
const CACHE_DURATION = parseInt(process.env.CACHE_DURATION || "60000"); // 1 minute cache

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
 * Manual deserialization fallback for pool account data - CORRECTED ORDER
 */
function manualDeserializePoolAccount(data: Buffer): PoolAccount {
  let offset = 8; // Skip discriminator

  // Read fields in the correct order based on SolScan data
  const pool_bump = data.readUInt8(offset);
  offset += 1;

  const index = data.readUInt16LE(offset); // Changed from readBigUInt64LE to readUInt16LE
  offset += 2; // Changed from 8 to 2 bytes

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

  const coin_creator = data.slice(offset, offset + 32); // Added missing field

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

const DEFAULT_SLIPPAGE = parseFloat(process.env.SLIPPAGE || "0.01");

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
export async function getPumpSwapPoolPrice(connection: Connection): Promise<{
  baseToQuotePrice: number;
  quoteToBasePrice: number;
  poolAddress: string;
  poolInfo: PumpPool;
}> {
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

/**
 * Get pool token balances for additional debugging
 */
export async function getPoolBalances(connection: Connection): Promise<{
  baseBalance: number;
  quoteBalance: number;
  baseToken: string;
  quoteToken: string;
}> {
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

/**
 * Fixed version of getPumpSwapPrice with proper direction detection
 */
export async function getPumpSwapPriceFixed(
  connection: Connection,
  inputAmount: number,
  slippage: number = DEFAULT_SLIPPAGE,
  direction: "baseToQuote" | "quoteToBase"
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

// Export types and constants for external use
export { PUMPSWAP_POOL, MINT, BASE_MINT, PoolAccount };

/**
 * Token decimals cache and retrieval
 */
const decimalsCache: Record<string, number> = {};

/**
 * Get the number of decimals for a given token mint
 * @param connection - Solana connection
 * @param mint - Token mint address
 * @returns Number of decimals for the token
 */
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
