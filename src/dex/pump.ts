// src/dex/pump.ts
import { Connection, PublicKey, AccountInfo } from "@solana/web3.js";
import { PumpAmmSdk } from "@pump-fun/pump-swap-sdk";
import * as borsh from "borsh";
import dotenv from "dotenv";
import BN from "bn.js";

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
    console.error("Error deserializing pool account:", error);
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

// Helper to get decimals for a mint (WSOL=9, USDC=6, fallback=9)
function getTokenDecimals(mint: PublicKey): number {
  if (mint.toString() === "So11111111111111111111111111111111111111112")
    return 9; // WSOL
  if (mint.toString() === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
    return 6; // USDC
  return 9;
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
    // Convert inputAmount to BN in base token's smallest units
    const baseDecimals = getTokenDecimals(BASE_MINT);
    const inputAmountBN = new BN(Math.floor(inputAmount * 10 ** baseDecimals));
    // Debug: print inputAmount, inputAmountBN, baseDecimals
    console.log(
      `[DEBUG] PumpSwap input: ${inputAmount} base token (${BASE_MINT.toString()}), BN: ${inputAmountBN.toString()}, decimals: ${baseDecimals}`
    );
    const outputAmountBN = await pumpAmmSdk.swapAutocompleteQuoteFromBase(
      pool.pubkey,
      inputAmountBN,
      slippage,
      "baseToQuote"
    );
    // Debug: print outputAmountBN
    console.log(`[DEBUG] PumpSwap output BN: ${outputAmountBN.toString()}`);
    // Convert output to number in target token units
    const targetDecimals = getTokenDecimals(MINT);
    const output = Number(outputAmountBN.toString()) / 10 ** targetDecimals;
    // Debug: print output and targetDecimals
    console.log(
      `[DEBUG] PumpSwap output: ${output} target token (${MINT.toString()}), decimals: ${targetDecimals}`
    );
    return output;
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
    // Convert inputAmount to BN in target token's smallest units
    const targetDecimals = getTokenDecimals(MINT);
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
    const baseDecimals = getTokenDecimals(BASE_MINT);
    return Number(outputAmountBN.toString()) / 10 ** baseDecimals;
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

    // Use BN for amounts
    const baseDecimals = getTokenDecimals(BASE_MINT);
    const targetDecimals = getTokenDecimals(MINT);
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
      const baseDecimals = getTokenDecimals(BASE_MINT);
      const inputAmountBN = new BN(
        Math.floor(inputAmount * 10 ** baseDecimals)
      );
      const outputAmountBN = await pumpAmmSdk.swapAutocompleteQuoteFromBase(
        pool.pubkey,
        inputAmountBN,
        slippage,
        "baseToQuote"
      );
      const targetDecimals = getTokenDecimals(MINT);
      outputAmount = Number(outputAmountBN.toString()) / 10 ** targetDecimals;
      currentPrice = poolPriceInfo.baseToQuotePrice;
    } else {
      const targetDecimals = getTokenDecimals(MINT);
      const inputAmountBN = new BN(
        Math.floor(inputAmount * 10 ** targetDecimals)
      );
      const outputAmountBN = await pumpAmmSdk.swapAutocompleteBaseFromQuote(
        pool.pubkey,
        inputAmountBN,
        slippage,
        "quoteToBase"
      );
      const baseDecimals = getTokenDecimals(BASE_MINT);
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

// ================== DEBUGGING FUNCTIONS ==================

/**
 * Debug pool structure to understand token roles
 */
export async function debugPoolStructure(
  connection: Connection
): Promise<void> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    console.log("=== POOL STRUCTURE DEBUG ===");
    console.log(`Pool Address: ${pool.pubkey.toString()}`);
    console.log(`Pool Base Mint: ${pool.base_mint.toString()}`);
    console.log(`Pool Quote Mint: ${pool.quote_mint.toString()}`);
    console.log(`Pool Bump: ${pool.pool_bump}`);
    console.log(`Pool Index: ${pool.index}`);
    console.log(`Creator: ${pool.creator.toString()}`);
    console.log(`Coin Creator: ${pool.coin_creator.toString()}`);
    console.log(`LP Mint: ${pool.lp_mint.toString()}`);
    console.log(`LP Supply: ${pool.lp_supply.toString()}`);
    console.log("Your Environment Variables:");
    console.log(`BASE_MINT: ${BASE_MINT.toString()}`);
    console.log(`MINT (target): ${MINT.toString()}`);

    // Check if your env vars match the pool structure
    const baseMatches = pool.base_mint.equals(BASE_MINT);
    const quoteMatches = pool.quote_mint.equals(MINT);
    const baseMatchesTarget = pool.base_mint.equals(MINT);
    const quoteMatchesBase = pool.quote_mint.equals(BASE_MINT);

    console.log(`\nMatching Analysis:`);
    console.log(`Pool base == your BASE_MINT: ${baseMatches}`);
    console.log(`Pool quote == your MINT: ${quoteMatches}`);
    console.log(`Pool base == your MINT: ${baseMatchesTarget}`);
    console.log(`Pool quote == your BASE_MINT: ${quoteMatchesBase}`);

    if (baseMatchesTarget && quoteMatchesBase) {
      console.log(
        "\n🚨 ISSUE FOUND: Your BASE_MINT and MINT variables are swapped!"
      );
      console.log("The pool's base token is what you call MINT (target token)");
      console.log("The pool's quote token is what you call BASE_MINT");
    }
  } catch (error) {
    console.error("Error debugging pool structure:", error);
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

    console.log(`\n=== POOL BALANCES ===`);
    console.log(`Base token (${pool.base_mint.toString()}): ${baseBalance}`);
    console.log(`Quote token (${pool.quote_mint.toString()}): ${quoteBalance}`);
    console.log(
      `Current pool ratio: 1 base = ${quoteBalance / baseBalance} quote`
    );
    console.log(
      `Current pool ratio: 1 quote = ${baseBalance / quoteBalance} base`
    );

    return {
      baseBalance,
      quoteBalance,
      baseToken: pool.base_mint.toString(),
      quoteToken: pool.quote_mint.toString(),
    };
  } catch (error) {
    console.error("Error getting pool balances:", error);
    throw error;
  }
}

/**
 * Fixed version of getPumpSwapPrice with proper direction detection
 */
export async function getPumpSwapPriceFixed(
  connection: Connection,
  inputAmount: number,
  slippage: number = 0.01
): Promise<number> {
  try {
    const pool = await fetchPoolData(connection, PUMPSWAP_POOL);
    const pumpAmmSdk = new PumpAmmSdk(connection);

    // First, determine the correct swap direction based on pool structure
    const isSwappingFromPoolBase = pool.base_mint.equals(BASE_MINT);
    const isSwappingFromPoolQuote = pool.quote_mint.equals(BASE_MINT);

    console.log(`\n=== SWAP DEBUG ===`);
    console.log(`Pool base mint: ${pool.base_mint.toString()}`);
    console.log(`Pool quote mint: ${pool.quote_mint.toString()}`);
    console.log(`Your input token (BASE_MINT): ${BASE_MINT.toString()}`);
    console.log(`Your output token (MINT): ${MINT.toString()}`);
    console.log(`Swapping FROM pool base: ${isSwappingFromPoolBase}`);
    console.log(`Swapping FROM pool quote: ${isSwappingFromPoolQuote}`);

    let outputAmountBN: BN;
    let inputDecimals: number;
    let outputDecimals: number;

    if (isSwappingFromPoolBase) {
      // You're swapping from pool's base token to pool's quote token
      inputDecimals = getTokenDecimals(BASE_MINT);
      outputDecimals = getTokenDecimals(MINT);
      const inputAmountBN = new BN(
        Math.floor(inputAmount * 10 ** inputDecimals)
      );

      console.log(`Using swapAutocompleteQuoteFromBase`);
      console.log(
        `Input: ${inputAmount} tokens = ${inputAmountBN.toString()} smallest units (${inputDecimals} decimals)`
      );

      outputAmountBN = await pumpAmmSdk.swapAutocompleteQuoteFromBase(
        pool.pubkey,
        inputAmountBN,
        slippage,
        "baseToQuote"
      );
    } else if (isSwappingFromPoolQuote) {
      // You're swapping from pool's quote token to pool's base token
      inputDecimals = getTokenDecimals(BASE_MINT);
      outputDecimals = getTokenDecimals(MINT);
      const inputAmountBN = new BN(
        Math.floor(inputAmount * 10 ** inputDecimals)
      );

      console.log(`Using swapAutocompleteBaseFromQuote`);
      console.log(
        `Input: ${inputAmount} tokens = ${inputAmountBN.toString()} smallest units (${inputDecimals} decimals)`
      );

      outputAmountBN = await pumpAmmSdk.swapAutocompleteBaseFromQuote(
        pool.pubkey,
        inputAmountBN,
        slippage,
        "quoteToBase"
      );
    } else {
      throw new Error(
        `Token mismatch: BASE_MINT ${BASE_MINT.toString()} doesn't match pool base ${pool.base_mint.toString()} or quote ${pool.quote_mint.toString()}`
      );
    }

    const output = Number(outputAmountBN.toString()) / 10 ** outputDecimals;

    console.log(
      `Output: ${outputAmountBN.toString()} smallest units = ${output} tokens (${outputDecimals} decimals)`
    );
    console.log(`Rate: 1 input token = ${output / inputAmount} output tokens`);

    return output;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Error getting PumpSwap price:", errMsg);
    throw new Error(`Failed to get PumpSwap price: ${errMsg}`);
  }
}

// Export types and constants for external use
export { PUMPSWAP_POOL, MINT, BASE_MINT, PoolAccount };
