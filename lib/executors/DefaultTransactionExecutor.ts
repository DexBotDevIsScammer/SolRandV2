import {
  BlockhashWithExpiryBlockHeight,
  Connection,
  Keypair,
  Signer,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { TransactionExecutor } from './TransactionExecutor';
import { sleep } from '../utils';


export class DefaultTransactionExecutor implements TransactionExecutor {
  constructor(private readonly connection: Connection) { }

  public async executeAndConfirm(
    transaction: VersionedTransaction,
    payer: Keypair,
    latestBlockhash: BlockhashWithExpiryBlockHeight,
  ): Promise<{ confirmed: boolean; signature?: string, error?: string }> {
    console.log('Executing transaction...');
    const signature = await this.execute(transaction);

    console.log('Confirming transaction... ' + signature);
    return this.confirm(signature, latestBlockhash);
  }

  public async execute(transaction: Transaction | VersionedTransaction) {
    return this.connection.sendRawTransaction(transaction.serialize(), {
      preflightCommitment: this.connection.commitment,
      skipPreflight: false
    });
  }

  private async confirm(signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
    const confirmation = await this.connection.confirmTransaction(
      {
        signature,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        blockhash: latestBlockhash.blockhash,
      },
      this.connection.commitment,
    );

    return { confirmed: !confirmation.value.err, signature };
  }

  public async sendConfirm(connection: Connection, transaction: Transaction, payers: Signer[]) {
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

    return signature;
  }

  

}
