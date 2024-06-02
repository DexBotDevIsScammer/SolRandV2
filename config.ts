import { Connection, Keypair } from "@solana/web3.js"
import bs58 from "bs58" 

export const devKey = "" 
 
export const walletKey = Keypair.fromSecretKey(bs58.decode(devKey))
  
export const privateKey =  walletKey;
  
export const RPC_URL =   '';

export const connection = new Connection(RPC_URL, 'confirmed')
export const HELIUS_API_KEY=''
export const devNet=false;

  