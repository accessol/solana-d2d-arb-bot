import { getConnection, loadKeypair } from "./solana";

(async () => {
  const connection = getConnection();
  const wallet = loadKeypair();

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`Balance: ${balance / 1e9} SOL`);
})();
