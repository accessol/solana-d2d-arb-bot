// src/solana.ts
import { Connection, Keypair, clusterApiUrl, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import bs58 from "bs58";
import dotenv from "dotenv";
import { logDebug, logError, logInfo, logWarn } from "./logger";

dotenv.config();

/**
 * Get Solana connection with proper configuration
 */
export function getConnection(): Connection {
  const rpcUrl = process.env.RPC_URL || clusterApiUrl("mainnet-beta");

  // Enhanced connection configuration for better performance
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60000,
    disableRetryOnRateLimit: false,
    httpHeaders: {
      "Content-Type": "application/json",
    },
  });

  return connection;
}

/**
 * Load keypair from file or environment variable
 */
export function loadKeypair(): Keypair {
  // Try to load from file path first
  const keypairPath = process.env.KEYPAIR_PATH;
  if (keypairPath) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (error) {
      logWarn(`Failed to load keypair from file: ${error}`);
    }
  }

  // Fallback to base58 private key from environment
  const privateKeyBase58 = process.env.PRIVATE_KEY;
  if (privateKeyBase58) {
    try {
      const privateKeyBytes = bs58.decode(privateKeyBase58);
      return Keypair.fromSecretKey(privateKeyBytes);
    } catch (error) {
      logWarn(`Failed to load keypair from base58: ${error}`);
    }
  }

  throw new Error(
    "No valid keypair found. Set either KEYPAIR_PATH (JSON file path) or PRIVATE_KEY (base58) in .env"
  );
}

/**
 * Get public key from keypair or environment
 */
export function getPublicKey(): PublicKey {
  try {
    const keypair = loadKeypair();
    return keypair.publicKey;
  } catch (error) {
    // Fallback to public key from environment if available
    const publicKeyString = process.env.PUBLIC_KEY;
    if (publicKeyString) {
      return new PublicKey(publicKeyString);
    }
    throw error;
  }
}

/**
 * Validate Solana connection and wallet configuration
 */
export async function validateSolanaConfig(): Promise<{
  connection: Connection;
  wallet: Keypair;
  publicKey: PublicKey;
}> {
  logInfo("🔗 Validating Solana configuration...");

  // Test connection
  const connection = getConnection();
  try {
    const slot = await connection.getSlot();
    logInfo(`✅ Connection successful - Current slot: ${slot}`);
  } catch (error) {
    throw new Error(`Failed to connect to Solana RPC: ${error}`);
  }

  // Load wallet
  const wallet = loadKeypair();
  const publicKey = wallet.publicKey;
  logInfo(`✅ Wallet loaded - Public key: ${publicKey.toString()}`);

  // Check wallet balance
  try {
    const balance = await connection.getBalance(publicKey);
    const solBalance = balance / 1e9;
    logInfo(`💰 Wallet balance: ${solBalance.toFixed(4)} SOL`);

    if (balance === 0) {
      logWarn("⚠️  Warning: Wallet has 0 SOL balance");
    }
  } catch (error) {
    logWarn(`Failed to check wallet balance: ${error}`);
  }

  return { connection, wallet, publicKey };
}

/**
 * Get connection with retry logic for better reliability
 */
export async function getConnectionWithRetry(
  maxRetries: number = 3
): Promise<Connection> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const connection = getConnection();
      // Test the connection
      await connection.getSlot();
      return connection;
    } catch (error) {
      lastError = error as Error;
      logWarn(`Connection attempt ${i + 1} failed: ${error}`);

      if (i < maxRetries - 1) {
        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, i) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to establish connection after ${maxRetries} attempts: ${lastError?.message}`
  );
}

/**
 * Check if we're on mainnet, devnet, or testnet
 */
export function getNetworkType():
  | "mainnet"
  | "devnet"
  | "testnet"
  | "localnet" {
  const rpcUrl = process.env.RPC_URL || clusterApiUrl("mainnet-beta");

  if (rpcUrl.includes("mainnet")) return "mainnet";
  if (rpcUrl.includes("devnet")) return "devnet";
  if (rpcUrl.includes("testnet")) return "testnet";
  if (rpcUrl.includes("localhost") || rpcUrl.includes("127.0.0.1"))
    return "localnet";

  // Default assumption for custom RPCs
  return "mainnet";
}

/**
 * Log current Solana configuration
 */
export function logSolanaConfig(): void {
  const rpcUrl = process.env.RPC_URL || clusterApiUrl("mainnet-beta");
  const network = getNetworkType();

  logInfo("🔧 Solana Configuration:");
  logInfo(`   Network: ${network.toUpperCase()}`);
  logInfo(`   RPC URL: ${rpcUrl}`);
  logInfo(`   Keypair Path: ${process.env.KEYPAIR_PATH || "Not set"}`);
  logInfo(
    `   Private Key: ${process.env.PRIVATE_KEY ? "Set (base58)" : "Not set"}`
  );
}
