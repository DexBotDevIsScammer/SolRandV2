import {
    BlockhashWithExpiryBlockHeight,
    Connection,
    Keypair,
    Transaction,
    VersionedTransaction,
} from '@solana/web3.js';
import { TransactionExecutor } from './TransactionExecutor';
import { Helius } from 'helius-sdk';
import { connection, devNet, HELIUS_API_KEY } from '../../config';



class HeliusExecutor implements TransactionExecutor {
    exec: Helius;

    constructor() {
        this.exec = devNet ? new Helius(HELIUS_API_KEY, 'devnet') : new Helius(HELIUS_API_KEY, 'mainnet-beta')
    }
    executeAndConfirm(transaction: VersionedTransaction, payer: Keypair, latestBlockHash: Readonly<{ blockhash: string; lastValidBlockHeight: number; }>): Promise<{ confirmed: boolean; signature?: string | undefined; error?: string | undefined; }> {
        throw new Error('Method not implemented.');
    }

  

    public async sendAndConfirm(instructions: any, fromKeypair: Keypair) { 
        
        const transactionSignature = await this.exec.rpc.sendSmartTransaction(instructions, fromKeypair, true, 4);
        console.log(`Successful : ${transactionSignature}`);
        return transactionSignature; 
    }
}


export default HeliusExecutor;