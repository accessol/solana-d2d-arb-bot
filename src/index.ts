import dotenv from "dotenv";
dotenv.config();

import { getConnection, loadKeypair } from "./solana";
import { logInfo } from "./logger";
import { startScanner } from "./scanner";

(async () => {
  const connection = getConnection();
  const wallet = loadKeypair();

  logInfo(`Wallet: ${wallet.publicKey.toBase58()}`);
  const balance = await connection.getBalance(wallet.publicKey);
  logInfo(`Balance: ${balance / 1e9} SOL`);

  await startScanner(connection);
})();
