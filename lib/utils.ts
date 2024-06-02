import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Signer, SystemProgram, Transaction, TransactionInstruction, TransactionSignature } from "@solana/web3.js";
import { Drop, TransactionWithSigners } from "./constants";
import { WalletAdapter } from "@metaplex-foundation/js";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";
import { ComputeBudgetConfig, Liquidity, LiquidityPoolKeys, Percent, SPL_ACCOUNT_LAYOUT, Token, TokenAccount, TokenAmount } from "@raydium-io/raydium-sdk";
import axios from "axios";
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { connection } from "../config";

export type ClusterType = "mainnet-beta" | "testnet" | "devnet" | "custom";

export const escape_markdown = (text: any) => {
    return text.replace(/([\.\+\-\|\(\)\#\_\[\]\~\=\{\}\,\!\`\>\<])/g, "\\$1").replaceAll('"', '`')
}
const PRIORITY_RATE = 25000; // MICRO_LAMPORTS 
export const SEND_AMT = 1000000;
export const PRIORITY_FEE_IX = ComputeBudgetProgram.setComputeUnitPrice({microLamports: SEND_AMT});
export const sell_remove_fees = 5000000;
const TX_INTERVAL = 1000;



interface SolanaFeeInfo {
  min: number;
  max: number;
  avg: number;
  priorityTx: number;
  nonVotes: number;
  priorityRatio: number;
  avgCuPerBlock: number;
  blockspaceUsageRatio: number;
}
type SolanaFeeInfoJson = {
  '1': SolanaFeeInfo;
  '5': SolanaFeeInfo;
  '15': SolanaFeeInfo;
};
export async function signTransactions({
    transactionsAndSigners,
    wallet,
    connection,
  }: {
    transactionsAndSigners: TransactionWithSigners[];
    wallet: NodeWallet;
    connection: Connection;
  }) {
    if (!wallet.signAllTransactions) {
      throw new Error("Wallet not connected");
    }
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("max");
    transactionsAndSigners.forEach(({ transaction, signers = [] }) => {
      if (!wallet.publicKey) {
        throw new Error("Wallet not connected");
      }
  
      transaction.feePayer = wallet.publicKey;
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      transaction.setSigners(
        wallet.publicKey,
        ...signers.map((s) => s.publicKey)
      );
      if (signers?.length > 0) {
        transaction.partialSign(...signers);
      }
    });
  
    return await wallet.signAllTransactions(
      transactionsAndSigners.map(({ transaction }) => transaction)
    );
  }

  export async function sendSignedTransaction({
    signedTransaction,
    connection,
    successCallback,
    sendingCallback,
    timeout = DEFAULT_TIMEOUT,
    skipPreflight = true,
  }: {
    signedTransaction: Transaction;
    connection: Connection;
    successCallback?: (txSig: string) => Promise<void>;
    sendingCallback?: () => Promise<void>;
    // sentCallback?: (txSig: string) => void;
    timeout?: number;
    skipPreflight?: boolean;
  }): Promise<string> {
    const rawTransaction = signedTransaction.serialize();
    const startTime = getUnixTs();
  
    sendingCallback && sendingCallback();
  
    const txid: TransactionSignature = await connection.sendRawTransaction(
      rawTransaction,
      {
        skipPreflight,
      }
    );
  
    console.log("Started awaiting confirmation for", txid);
  
    let done = false;
    (async () => {
      while (!done && getUnixTs() - startTime < timeout) {
        connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
        });
        await sleep(300);
      }
    })();
    try {
      await awaitTransactionSignatureConfirmation(txid, timeout, connection);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.timeout) {
        throw new Error("Timed out awaiting confirmation on transaction");
      }
      const simulateResult = await connection.simulateTransaction(
        signedTransaction
      );
      if (simulateResult && simulateResult.value.err) {
        if (simulateResult.value.logs) {
          for (let i = simulateResult.value.logs.length - 1; i >= 0; --i) {
            const line = simulateResult.value.logs[i];
            if (line.startsWith("Program log: ")) {
              throw new Error(
                "Transaction failed: " + line.slice("Program log: ".length)
              );
            }
          }
        }
        throw new Error(JSON.stringify(simulateResult.value.err));
      }
      throw new Error("Transaction failed");
    } finally {
      done = true;
    }
  
    successCallback && successCallback(txid);
  
    console.log("Latency", txid, getUnixTs() - startTime);
    return txid;
  }

  async function awaitTransactionSignatureConfirmation(
    txid: TransactionSignature,
    timeout: number,
    connection: Connection
  ) {
    let done = false;
    const result = await new Promise((resolve, reject) => {
      (async () => {
        setTimeout(() => {
          if (done) {
            return;
          }
          done = true;
          console.log("Timed out for txid", txid);
          reject({ timeout: true });
        }, timeout);
        try {
          connection.onSignature(
            txid,
            (result) => {
              console.log("WS confirmed", txid, result);
              done = true;
              if (result.err) {
                reject(result.err);
              } else {
                resolve(result);
              }
            },
            connection.commitment
          );
          console.log("Set up WS connection", txid);
        } catch (e) {
          done = true;
          console.log("WS error in setup", txid, e);
        }
        while (!done) {
          // eslint-disable-next-line no-loop-func
          (async () => {
            try {
              const signatureStatuses = await connection.getSignatureStatuses([
                txid,
              ]);
              const result = signatureStatuses && signatureStatuses.value[0];
              if (!done) {
                if (!result) {
                  // console.log('REST null result for', txid, result);
                } else if (result.err) {
                  console.log("REST error for", txid, result);
                  done = true;
                  reject(result.err);
                } else if (
                  !(
                    result.confirmations ||
                    result.confirmationStatus === "confirmed" ||
                    result.confirmationStatus === "finalized"
                  )
                ) {
                  console.log("REST not confirmed", txid, result);
                } else {
                  console.log("REST confirmed", txid, result);
                  done = true;
                  resolve(result);
                }
              }
            } catch (e) {
              if (!done) {
                console.log("REST connection error: txid", txid, e);
              }
            }
          })();
          await sleep(300);
        }
      })();
    });
    done = true;
    return result;
  }

  export const getUnixTs = () => {
    return new Date().getTime() / 1000;
  };
  export function getExplorerAccountLink(
    account: PublicKey,
    cluster: ClusterType
  ): string {
    return `https://explorer.solana.com/address/${account.toString()}?cluster=${
      cluster === "mainnet-beta" ? null : cluster
    }`;
  }
  
  export const isLocalhost = (url: string) => {
    return url.includes("localhost") || url.includes("127.0.0.1");
  };
  
  export async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  export async function getComputeBudgetConfigHigh(): Promise<ComputeBudgetConfig | undefined> {

    const response = await axios.get<SolanaFeeInfoJson>('https://solanacompass.com/api/fees');
    const json = response.data;
    const { avg } = json?.[15] ?? {};
    if (!avg) return undefined; // fetch error
    return {
      units: sell_remove_fees,
      microLamports: Math.min(Math.ceil((avg * 1000000) / 600000), 25000),
    } as ComputeBudgetConfig;
  }


  export async function getTokenBalance(tokenMintAddress: PublicKey,wallet: Keypair) {
    try {
      const fromTokenAccount = await getOrCreateAssociatedTokenAccount(connection, wallet, tokenMintAddress, wallet.publicKey);
      const tokenAccountBalance = await connection.getTokenAccountBalance(fromTokenAccount.address);
      
      return tokenAccountBalance.value.amount;
    } catch (error) {
        console.error('Error fetching token balance:', error);
    }
  } 


  export async function getWalletTokenAccount(connection: Connection, wallet: PublicKey): Promise<TokenAccount[]> {
    const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
        programId: TOKEN_PROGRAM_ID,
    });
    return walletTokenAccount.value.map((i) => ({
        pubkey: i.pubkey,
        programId: i.account.owner,
        accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
    }));
}

  export async function getSolprice(){
    const data = await fetch(
			"https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/So11111111111111111111111111111111111111112"
		);
		const json = await data.json();
		const solPrice =
			json?.data?.attributes?.token_prices
				.So11111111111111111111111111111111111111112;

        return solPrice;
  }
  
 
  export async function   calcAmountOut(poolKeys: LiquidityPoolKeys, rawAmountIn: number, swapInDirection: boolean, slippagePct:number) {
    const poolInfo = await Liquidity.fetchInfo({ connection: connection, poolKeys })
  
    let currencyInMint = poolKeys.baseMint
    let currencyInDecimals = poolInfo.baseDecimals
    let currencyOutMint = poolKeys.quoteMint
    let currencyOutDecimals = poolInfo.quoteDecimals
  
    if (!swapInDirection) {
      currencyInMint = poolKeys.quoteMint
      currencyInDecimals = poolInfo.quoteDecimals
      currencyOutMint = poolKeys.baseMint
      currencyOutDecimals = poolInfo.baseDecimals
    }
  
    const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals)
    const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)
    const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals)
    const slippage = new Percent(slippagePct, 100)  
  
    const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut,
      slippage,
    })
  
    return {
      amountIn,
      amountOut,
      minAmountOut,
      currentPrice,
      executionPrice,
      priceImpact,
      fee,
    }
  }


export function generateTransactions(batchSize: number, dropList: Drop[], fromWallet: PublicKey, solAmounts: any):Transaction[] {
    let result: Transaction[] = [];
    let txInstructions: TransactionInstruction[] = dropList.map(drop => {return SystemProgram.transfer({
        fromPubkey: fromWallet,
        toPubkey: new PublicKey(drop.address),
        lamports: solAmounts*LAMPORTS_PER_SOL
    })})
    const numTransactions = Math.ceil(txInstructions.length / batchSize);
    for (let i = 0; i < numTransactions; i++){
        let bulkTransaction = new Transaction().add(PRIORITY_FEE_IX);
        let lowerIndex = i * batchSize;
        let upperIndex = (i+1) * batchSize;
        for (let j = lowerIndex; j < upperIndex; j++){
            if (txInstructions[j]) bulkTransaction.add(txInstructions[j]);  
        }
        result.push(bulkTransaction);
    }
    return result;
}


export async function executeTransactions(solanaConnection: Connection, transactionList: Transaction[], payer: Keypair):Promise<PromiseSettledResult<string>[]> {
  let result:PromiseSettledResult<string>[] = [];
  let staggeredTransactions:Promise<string>[] = transactionList.map((transaction, i, allTx) => {
      return (new Promise((resolve) => {
          setTimeout(() => {
              console.log(`Requesting Transaction ${i+1}/${allTx.length}`);                
              solanaConnection.getLatestBlockhash('finalized')
                  .then((recentHash: { blockhash: any; })=>transaction.recentBlockhash = recentHash.blockhash)
                  .then(()=>sendAndConfirmTransaction(solanaConnection,transaction,[payer])).then(resolve);
          }, i * TX_INTERVAL);
       })
  )})
  result = await Promise.allSettled(staggeredTransactions);
  return result;
}


export async function sendConfirm(connection: Connection, transaction: Transaction, payers: Signer[]) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  let blockheight = await connection.getBlockHeight('finalized'); 
   let signature = '';
  while (blockheight < lastValidBlockHeight) {

      if (signature != '') {
          const a = await connection.getSignatureStatus(signature);
          if (!a.value?.err) break;
      }
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

      transaction.recentBlockhash = blockhash;
      transaction.sign(...payers);
      const rawTransaction = transaction.serialize();

      signature = await connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
      });
      console.log(`Signature: ${signature}`);
      await sleep(1500);
      
      blockheight = await connection.getBlockHeight('finalized');
  }

  return {wallet:payers[0].publicKey.toBase58(), signature:signature};
}

  const DEFAULT_TIMEOUT = 30000;
 