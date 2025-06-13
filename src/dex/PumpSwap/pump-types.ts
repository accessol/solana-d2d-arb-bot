// src/dex/pump-types.ts
import { PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";

dotenv.config();

// Environment variables
export const PUMPSWAP_POOL = new PublicKey(process.env.PUMPSWAP_POOL!);
export const MINT = new PublicKey(process.env.MINT!);
export const BASE_MINT = new PublicKey(process.env.BASE_MINT!);
export const DEFAULT_SLIPPAGE = parseFloat(process.env.SLIPPAGE || "0.01");
export const CACHE_DURATION = parseInt(process.env.CACHE_DURATION || "60000"); // 1 minute cache

// Pool interface based on actual SolScan data
export interface PumpPool {
  pubkey: PublicKey;
  pool_bump: number;
  index: number;
  creator: PublicKey;
  base_mint: PublicKey;
  quote_mint: PublicKey;
  lp_mint: PublicKey;
  pool_base_token_account: PublicKey;
  pool_quote_token_account: PublicKey;
  lp_supply: bigint;
  coin_creator: PublicKey;
}

// Borsh schema class
export class PoolAccount {
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

// Borsh schema definition matching SolScan structure
export const poolAccountSchema = {
  struct: {
    pool_bump: "u8",
    index: "u16",
    creator: { array: { type: "u8", len: 32 } },
    base_mint: { array: { type: "u8", len: 32 } },
    quote_mint: { array: { type: "u8", len: 32 } },
    lp_mint: { array: { type: "u8", len: 32 } },
    pool_base_token_account: { array: { type: "u8", len: 32 } },
    pool_quote_token_account: { array: { type: "u8", len: 32 } },
    lp_supply: "u64",
    coin_creator: { array: { type: "u8", len: 32 } },
  },
};

export type SwapDirection = "baseToQuote" | "quoteToBase";

export interface PoolPriceInfo {
  baseToQuotePrice: number;
  quoteToBasePrice: number;
  poolAddress: string;
  poolInfo: PumpPool;
}

export interface PriceImpactResult {
  outputAmount: number;
  priceImpact: number;
  effectivePrice: number;
  poolInfo: PumpPool;
}

export interface PoolBalances {
  baseBalance: number;
  quoteBalance: number;
  baseToken: string;
  quoteToken: string;
}
