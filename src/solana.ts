// src/solana.ts
import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import bs58 from "bs58";
import dotenv from "dotenv";

dotenv.config();

export function getConnection(): Connection {
  const rpcUrl = process.env.RPC_URL || clusterApiUrl("mainnet-beta");
  return new Connection(rpcUrl, "confirmed");
}

export function loadKeypair(): Keypair {
  const keypairPath = process.env.KEYPAIR_PATH;
  if (!keypairPath) throw new Error("KEYPAIR_PATH not set in .env");

  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(keypairData));
}
