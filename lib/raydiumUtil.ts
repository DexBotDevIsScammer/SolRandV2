import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  buildSimpleTransaction,
  DEVNET_PROGRAM_ID,
  findProgramAddress,
  InnerSimpleV0Transaction,
  LIQUIDITY_STATE_LAYOUT_V4,
  MAINNET_PROGRAM_ID, 
  MARKET_STATE_LAYOUT_V3,
  SPL_ACCOUNT_LAYOUT,
  Token,
  TOKEN_PROGRAM_ID,
  TokenAccount,
} from '@raydium-io/raydium-sdk';
import {
  Connection,
  Keypair,
  PublicKey,
  SendOptions,
  Signer,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';

import {
  addLookupTableInfo,
  makeTxVersion, 
  mainWallet,
  PROGRAMIDS,
} from './constants';
import { connection, devNet } from '../config';
import { BN } from '@project-serum/anchor';
 
const ZERO = new BN(0)
type LiquidityPairTargetInfo = {
    baseToken: Token
    quoteToken: Token
    targetMarketId: PublicKey
}
type CalcStartPrice = {
    addBaseAmount: BN
    addQuoteAmount: BN
}
type WalletTokenAccounts = Awaited<ReturnType<typeof getWalletTokenAccount>>


type TestTxInputInfo = LiquidityPairTargetInfo &
  CalcStartPrice & {
    startTime: number // seconds
    walletTokenAccounts: WalletTokenAccounts
    wallet: Keypair
  }
export async function sendTx(
  connection: Connection,
  payer: Keypair | Signer,
  txs: (VersionedTransaction | Transaction)[],
  options?: SendOptions
): Promise<string[]> {
  const txids: string[] = [];
  for (const iTx of txs) {
    if (iTx instanceof VersionedTransaction) {
      iTx.sign([payer]);
      txids.push(await connection.sendTransaction(iTx, options));
    } else {
      iTx.sign(payer);
      txids.push(await connection.sendTransaction(iTx, [payer], options));
    }
  }
  return txids;
}

export const quoteMint = new PublicKey('So11111111111111111111111111111111111111112')
export const openbookProgram =  devNet? DEVNET_PROGRAM_ID.OPENBOOK_MARKET: MAINNET_PROGRAM_ID.OPENBOOK_MARKET;
export const raydiumProgram = devNet? DEVNET_PROGRAM_ID.AmmV4: MAINNET_PROGRAM_ID.AmmV4;


export const findMarketId = async (baseMint: PublicKey) => {

 
  let filters = [
    {
      memcmp: {
        offset: MARKET_STATE_LAYOUT_V3.offsetOf('baseMint'),
        bytes: baseMint.toBase58(),
      },
    },
    {
      memcmp: {
        offset: MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
        bytes: quoteMint.toBase58(),
      },
    },
  ];

  let resp: any = await connection.getProgramAccounts(openbookProgram, {
     encoding: 'base64',
    filters,
  });
 
  if(resp.length==0)
    {
      filters = [
        {
          memcmp: {
            offset: MARKET_STATE_LAYOUT_V3.offsetOf('baseMint'),
            bytes: quoteMint.toBase58(),
          },
        },
        {
          memcmp: {
            offset: MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
            bytes: baseMint.toBase58(),
          },
        },
      ];
    
      resp  = await connection.getProgramAccounts(openbookProgram, {
         encoding: 'base64',
        filters,
      });
     }

    

  const marketId = resp[0]?.pubkey;


  return marketId;

}

export const findPoolId = async (baseMint: PublicKey) => {

  console.log(raydiumProgram);

  let filters = [
    {
      memcmp: {
        offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
        bytes: baseMint.toBase58(),
      },
    },
    {
      memcmp: {
        offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
        bytes: quoteMint.toBase58(),
      },
    },
  ];

  let resp: any = await connection.getProgramAccounts(raydiumProgram, {
     encoding: 'base64',
    filters,
  });

   console.log(resp);

  if(resp.length==0){
    filters = [
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
          bytes: quoteMint.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
          bytes: baseMint.toBase58(),
        },
      },
    ];
  
      resp = await connection.getProgramAccounts(raydiumProgram, {
       encoding: 'base64',
      filters,
    });
    console.log(resp);

  }

  const poolId = resp[0]?.pubkey;
  return poolId;

}


export async function getWalletTokenBalance(connection: Connection, wallet: PublicKey,tokenMint: PublicKey) {
  const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
    programId: TOKEN_PROGRAM_ID,
  });
  

  const accountInfos=  walletTokenAccount.value.filter((i)=>SPL_ACCOUNT_LAYOUT.decode(i.account.data).mint.toBase58().toLowerCase() == tokenMint.toBase58().toLowerCase());

  if(accountInfos.length>0){

    console.log(' Token balance Is : '+ SPL_ACCOUNT_LAYOUT.decode(accountInfos[0].account.data).amount.toString());

    return SPL_ACCOUNT_LAYOUT.decode(accountInfos[0].account.data).amount.toString();
  }
   else return '0';
}



export async function getWalletTokenAccount(connection: Connection, wallet: PublicKey,tokenMint:PublicKey): Promise<TokenAccount[]> {
  const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
     mint:tokenMint
  });
  return walletTokenAccount.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
}

export async function getWalletTokenAccounts(connection: Connection, wallet: PublicKey): Promise<TokenAccount[]> {
  const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
     programId:TOKEN_PROGRAM_ID
  },{'commitment':'confirmed'});
  return walletTokenAccount.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
}

 
export async function sendTransaction( senderTx: (VersionedTransaction | Transaction)[],options?: SendOptions){
  return await sendTx(connection, mainWallet.payer, senderTx, options)

}

export async function buildAndSendTx(innerSimpleV0Transaction: InnerSimpleV0Transaction[],options?: SendOptions) {
  const willSendTx = await buildSimpleTransaction({
    connection,
    makeTxVersion,
    payer: mainWallet.publicKey,
    innerTransactions: innerSimpleV0Transaction,
    addLookupTableInfo: addLookupTableInfo,
  })

  
 
  return await sendTx(connection, mainWallet.payer, willSendTx, options)
}

export function getATAAddress(programId: PublicKey, owner: PublicKey, mint: PublicKey) {
  const { publicKey, nonce } = findProgramAddress(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  );
  return { publicKey, nonce };
}

export async function sleepTime(ms: number) {
  console.log((new Date()).toLocaleString(), 'sleepTime', ms)
  return new Promise(resolve => setTimeout(resolve, ms))
}
 
 

export async function findAssociatedTokenAddress(
  walletAddress: PublicKey,
  tokenMintAddress: PublicKey
) {
  const { publicKey } = await findProgramAddress(
    [
      walletAddress.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      tokenMintAddress.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  return publicKey
}