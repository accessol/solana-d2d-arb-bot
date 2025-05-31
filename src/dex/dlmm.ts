// src/dex/dlmm.ts
import { Connection, PublicKey } from "@solana/web3.js";
import { DLMM } from "@meteora-ag/dlmm";
import dotenv from "dotenv";
dotenv.config();

const DLMM_POOL = new PublicKey(process.env.DLMM_POOL!);
const MINT = new PublicKey(process.env.MINT!);
const BASE_MINT = new PublicKey(process.env.BASE_MINT!);

export async function getDLMMPrice(
  connection: Connection,
  inputAmount: number // in TARGET token (TokenA)
): Promise<number> {
  const dlmm = new DLMM(connection);
  const quote = await dlmm.getSwapQuote({
    pool: DLMM_POOL,
    inputMint: MINT, // You’re selling TokenA
    outputMint: BASE_MINT, // You’re getting WSOL or USDC
    inputAmount,
    slippage: Number(process.env.SLIPPAGE || 0.5),
  });

  return quote.outputAmount;
}
