// src/dex/dlmm_types.ts
import { PublicKey } from "@solana/web3.js";

// Pool information interface based on DLMM SDK
export interface DLMMPoolInfo {
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
export interface SwapQuoteInfo {
  inputAmount: number;
  outputAmount: number;
  fee: number;
  priceImpact: number;
  minOutputAmount: number;
  binArraysPubkey: PublicKey[];
}

// Price information interface
export interface DLMMPriceInfo {
  tokenAToTokenBPrice: number;
  tokenBToTokenAPrice: number;
  activePrice: number;
  poolAddress: string;
  poolInfo: DLMMPoolInfo;
}

// Price impact calculation result
export interface DLMMPriceImpact {
  outputAmount: number;
  priceImpact: number;
  effectivePrice: number;
  fee: number;
  poolInfo: DLMMPoolInfo;
}

// Bin information
export interface DLMMBinInfo {
  binId: number;
  price: number;
  liquidityX: bigint;
  liquidityY: bigint;
  supply: bigint;
}

// Bin data response
export interface DLMMBinData {
  activeBinId: number;
  bins: DLMMBinInfo[];
}

// Pool statistics
export interface DLMMPoolStats {
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
}

// Swap direction type
export type SwapDirection = "sell" | "buy";
