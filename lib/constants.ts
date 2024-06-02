import { PublicKey, Signer, Transaction } from "@solana/web3.js"
import {
  ENDPOINT as _ENDPOINT,
  Currency,
  DEVNET_PROGRAM_ID,
  LOOKUP_TABLE_CACHE,
  MAINNET_PROGRAM_ID,
  RAYDIUM_MAINNET,
  Token,
  TOKEN_PROGRAM_ID,
  TxVersion,
} from '@raydium-io/raydium-sdk';
import { devNet, privateKey,  } from "../config";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet"; 
export const BOT_NAME = 'DexbotDevs BotSuite'  

export const DEX_PROGRAMS: { [key: string]: string } = {
  srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX: "Openbook Dex",
  EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj: "Openbook Dex Devnet",
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin": "Serum Dex (Compromised)",
  DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY: "Serum Dex V3 Devnet",
}; 

export interface Drop {
  address: string,
  privateKey: string,
  tradeAmount:number,
  gen:boolean
}
export const dropList:Drop[] = [];

export type TransactionWithSigners = {
    transaction: Transaction;
    signers: Array<Signer>;
  };
 
  export const PROGRAMIDS = devNet? DEVNET_PROGRAM_ID: MAINNET_PROGRAM_ID;
  
  export const ENDPOINT = _ENDPOINT;
  
  export const RAYDIUM_MAINNET_API = RAYDIUM_MAINNET;
  
  export const makeTxVersion = TxVersion.LEGACY;  
  
  export const addLookupTableInfo = LOOKUP_TABLE_CACHE  
 
 
  export const mainWallet = new NodeWallet(privateKey);

 
  export const DEFAULT_TOKEN = {
    'SOL': new Token(TOKEN_PROGRAM_ID, new PublicKey('So11111111111111111111111111111111111111112'), 9, 'WSOL', 'WSOL'),
    'USDC': new Token(TOKEN_PROGRAM_ID, new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), 6, 'USDC', 'USDC'),
    'RAY': new Token(TOKEN_PROGRAM_ID, new PublicKey('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'), 6, 'RAY', 'RAY'),
    'RAY_USDC-LP': new Token(TOKEN_PROGRAM_ID, new PublicKey('FGYXP4vBkMEtKhxrmEBcWN8VNmXX8qNgEJpENKDETZ4Y'), 6, 'RAY-USDC', 'RAY-USDC'),
  } 
  
  export const feeId = devNet ? new PublicKey("3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR") : new PublicKey("7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5")