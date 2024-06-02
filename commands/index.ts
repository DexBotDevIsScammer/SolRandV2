import { Keypair, LAMPORTS_PER_SOL, PublicKey, PublicKeyInitData, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import base58 from "bs58";
import { say } from "cfonts";
import { prompt } from 'enquirer';
import { readFileSync, writeFileSync } from "fs";
import { connection, privateKey } from '../config';
import { findMarketId, findPoolId, getWalletTokenAccount, getWalletTokenAccounts, getWalletTokenBalance, quoteMint } from "../lib/raydiumUtil";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { DEFAULT_TOKEN, mainWallet, PROGRAMIDS } from "../lib/constants";
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes";
import { Liquidity, MARKET_STATE_LAYOUT_V3, Token, TokenAmount, TxVersion, SPL_ACCOUNT_LAYOUT, SwapSide } from '@raydium-io/raydium-sdk';
import { calcAmountOut, executeTransactions, generateTransactions, getSolprice, PRIORITY_FEE_IX, sendConfirm } from "../lib/utils";
import { formatAmmKeysById } from "../lib/formatAmmKeysById";
import { lookupTableProvider } from "../lib/LookupTableProvider";
import { dropList } from "../lib/constants";
import HeliusExecutor from "../lib/executors/HeliusExecutor";
import { createJupiterApiClient } from '@jup-ag/api';

interface Response1 {
    tokenAddress: string;
    tokenType: string;
    walletCount: number;
    boostAmount: number;
    boostInterval: number;
    boostDuration: number;
    tradesPerInterval: number;
}

let tokenAddress = '';
let baseMint = PublicKey.default;
let wallets: any = [];
let selectedWallet = 0;
let boosterInterval = 0;
let jsonPoolInfo: any = {};
let poolKeys: any = {};
let baseToken: Token;
let quoteToken: Token;
let pumpFun: boolean = false;
const NUM_DROPS_PER_TX = 10;
let apiClient = createJupiterApiClient();

 

const main = async () => {
    console.clear();
    say('SoloRand', {
        font: 'tiny',
        align: 'center',
        gradient: ['white', 'red'],
        background: 'transparent',
        letterSpacing: 1,
        lineHeight: 1,
        space: true,
        maxLength: '0',
        independentGradient: false,
        transitionGradient: false,
        env: 'node'
    });

    const response: Response1 = await prompt([
        {
            type: 'input',
            name: 'tokenAddress',
            message: 'Enter Token Address to Boost > ',
            async onSubmit(_name: any, value: any) {
                try {
                    const p = new PublicKey(value);
                    return value;
                } catch (Error) {
                    console.log('\n')
                    console.log('Invalid PublicKey entered')
                    process.exit(0)
                }
            }
        },
        {
            type: 'input',
            name: 'tokenType',
            message: 'The Token is a PumpFUN token (Press Y / N)  > ',
            async onSubmit(_name: any, value: any) {
                try {
                    return value;
                } catch (Error) {
                    process.exit(0)
                }
            }
        }
    ]);

    tokenAddress = response.tokenAddress;
    pumpFun = response.tokenType == 'Y' ? true : response.tokenType == 'N' ? false : true;
    baseMint = new PublicKey(tokenAddress);
    await preInitializeData(tokenAddress);

    try {
        wallets = JSON.parse(readFileSync(`./wallets/${tokenAddress}.json`, 'utf-8'));
    } catch (error) {

    }
    if (wallets.length > 0) {
        console.log('Wallets Loaded from Existing File')

        main0();

    } else {

        const wals: Response1 = await prompt([
            {
                type: 'input',
                name: 'walletCount',
                message: 'Enter the Booster Wallets Count to Generate (min 20)>',
                async result(value: string) {
                    return value;
                }
            },
            {
                type: 'input',
                name: 'tradesPerInterval',
                message: 'Enter the Trades Per Interval (Default 4)>',
                async result(value: string) {
                    return value;
                }
            },
            {
                type: 'input',
                name: 'boostAmount',
                message: 'Enter the Amount to use Per trade per wallet (in Sol)>',
                async result(value: string) {
                    return value;
                }
            },
            {
                type: 'input',
                name: 'boostInterval',
                message: 'Enter the Time Interval to Run Booster (in Seconds)>',
                async result(value: string) {
                    return value;
                }
            }
        ])
        if (wals.walletCount > 0 && wals.boostAmount && wals.tradesPerInterval && wals.boostInterval) {

            const solPrice = await getSolprice();
            const totalTrades = wals.walletCount * (3600 / wals.boostInterval);
            const perTrade = Number(wals.boostAmount);
            const marketCap = solPrice * perTrade * totalTrades * 2;
            boosterInterval = wals.boostInterval;
            const feePerTrade = (0.25 / 100) * perTrade * totalTrades;
            const totalDecay = Number(feePerTrade)
            const minRequiredSolana = 2 * perTrade + totalDecay;
            const wallBalanceWei = await connection.getBalance(mainWallet.publicKey);
            const wallBal = wallBalanceWei / 1e9;

            const showcase = [{
                "Trades/Hr": (60 / wals.boostInterval),
                "Wallets": wals.walletCount,
                "Sol/Wallet": perTrade,
                "Trades": totalTrades,
                "Raydium Fees": '0.25%',
                "Reqd Solana": Number(minRequiredSolana).toFixed(2),
                "Target MCap": Number(marketCap).toFixed(0)
            }]

            console.table(showcase);

            if (Number(wallBal) < minRequiredSolana) {
                console.log(`Your Current Wallet  is : ${privateKey.publicKey.toString()}`)
                console.log(`Your Current Wallet balance is : ${Number(wallBal).toFixed(2)} SOL`)
                console.log(`Amount Required to Run the Boost : ${Number(minRequiredSolana).toFixed(2)} SOL`)
                console.log('You do not have Enough Solana Balance to Run the Boost')

                const questions = [{
                    type: 'select',
                    name: 'exitoptions',
                    message: 'Select Operation to Perform?',
                    initial: 1,
                    choices: [
                        { name: 1, message: 'Restart >', value: '1' },
                        { name: 3, message: 'Quit >', value: '3' }
                    ]
                }];

                const answers: any = await prompt(questions);

                if (answers.exitoptions == '1')
                    main()
                else {
                    process.exit(0)
                }
            }
            else {

                let csvWallets: any = '';
                for (var i = 0; i < wals.walletCount; i++) {
                    const w = Keypair.generate();
                    dropList.push({
                        address: w.publicKey.toBase58(),
                        privateKey: base58.encode(w.secretKey),
                        tradeAmount: perTrade,
                        gen: true
                    })

                    csvWallets += '\n' + base58.encode(w.secretKey)
                }

                console.log('Wallets Generated - ' + wals.walletCount);
                writeFileSync(`./wallets/${tokenAddress}.json`, JSON.stringify(dropList, null, 2), 'utf8');

                const config = {
                    "boosterInterval": wals.boostInterval,
                    "tokenAddress": tokenAddress,
                    "slippagePctg": 5,
                    "tradesPerInterval": wals.tradesPerInterval
                }
                writeFileSync(`./wallets/${tokenAddress}.config.json`, JSON.stringify(config, null, 2), 'utf8');


                const response: any = await prompt([
                    {
                        type: 'input',
                        name: 'x',
                        message: 'Press any Key to continue > ',
                        async onSubmit(_name: any, value: any) {
                            return value;
                        }
                    }
                ]);

                main0();

            }
        }
    }
}


const main0 = async () => {

    wallets = JSON.parse(readFileSync(`./wallets/${tokenAddress}.json`, 'utf-8'));

    const walletCount = wallets.length;
    // console.clear();
    say('SoloRand', {
        font: 'tiny',
        align: 'center',
        gradient: ['red', 'green'],
        background: 'transparent',
        letterSpacing: 1,
        lineHeight: 1,
        space: true,
        maxLength: '0',
        independentGradient: false,
        transitionGradient: false,
        env: 'node'
    });

    const questions = [{
        type: 'select',
        name: 'optiontokens',
        message: 'Select Operation to Perform?',
        initial: 1,
        choices: [
            { name: 1, message: 'List Wallets Sol Balances >', value: 1 },
            { name: 12, message: 'List Wallets Token Balances >', value: 12 },
            { name: 19, message: 'Change Slippage (Default: 5 %) >', value: 19 },
            { name: 2, message: 'Transfer Trading Amount (Sol) to All Wallets >', value: 2 },
            { name: 6, message: 'Sell all Tokens from all Wallets >', value: 6 },
            { name: 3, message: 'Recover all Sol balances from Wallets to Main Wallet >', value: 3 },
            { name: 4, message: 'Start Booster Bot >', value: 4 },
            { name: 5, message: 'Quit >', value: 5 }
        ]
    }];

    const answers: any = await prompt(questions);
    if (answers.optiontokens == 2) {

        const solamnts: any = await prompt([
            {
                type: 'input',
                name: 'solAmounts',
                message: 'Enter Amount of SOL to transfer to each Wallet > ',
                async onSubmit(_name: any, value: any) {
                    try {
                        const p = Number(Number(value).toFixed(4));
                        if (isNaN(p)) throw Error('Not a Number');
                        return value;
                    } catch (Error) {
                        console.log('\n')
                        console.log('Invalid amount entered')
                        process.exit(0)
                    }
                }
            }
        ]);
        wallets = JSON.parse(readFileSync(`./wallets/${tokenAddress}.json`, 'utf-8'));

        const solAmounts = solamnts.solAmounts;
        const transactionList = generateTransactions(NUM_DROPS_PER_TX, wallets, privateKey.publicKey, solAmounts);
        const txResults = await executeTransactions(connection, transactionList, privateKey);
        console.log(txResults);

        const response: any = await prompt([
            {
                type: 'input',
                name: 'x',
                message: 'Press any Key to continue > ',
                async onSubmit(_name: any, value: any) {
                    return value;
                }
            }
        ]);

        main0();

    }
    else if (answers.optiontokens == 19) {
        const slppageP: any = await prompt([
            {
                type: 'input',
                name: 'slippagePctg',
                message: 'Enter Slippage percentage (min 5%) > ',
                async onSubmit(_name: any, value: any) {
                    try {
                        const p = Number(Number(value).toFixed(4));
                        if (isNaN(p)) throw Error('Not a Number');
                        return value;
                    } catch (Error) {
                        console.log('\n')
                        console.log('Invalid value entered')
                        process.exit(0)
                    }
                }
            }
        ]);

        const slippagePctg = slppageP.slippagePctg;
        const boosterConfig = JSON.parse(readFileSync(`./wallets/${tokenAddress}.config.json`, 'utf-8'));
        boosterConfig.slippagePctg = slippagePctg;

        writeFileSync(`./wallets/${tokenAddress}.config.json`, JSON.stringify(boosterConfig, null, 2), 'utf8');
        const response: any = await prompt([
            {
                type: 'input',
                name: 'x',
                message: 'Press any Key to continue > ',
                async onSubmit(_name: any, value: any) {
                    return value;
                }
            }
        ]);

        main0();

    }
    else if (answers.optiontokens == 4) {

        const boosterConfig = JSON.parse(readFileSync(`./wallets/${tokenAddress}.config.json`, 'utf-8'));
        wallets = JSON.parse(readFileSync(`./wallets/${tokenAddress}.json`, 'utf-8'));
        const inToken = new Token(TOKEN_PROGRAM_ID, quoteMint, 9, 'SOL', 'SOL');
        const buysCount = boosterConfig.buyCount;



        const generateSwapAndExecute = async () => {
            console.log(' Prepare Random Trades  - ' + boosterConfig.tradesPerInterval)
            const walletsRandom = getRandomWallets(wallets, boosterConfig.tradesPerInterval);
            const tns: any[] = [];
            let inTokenAmount = new TokenAmount(inToken, 0.001, false);
            let outTokenAmount = new TokenAmount(baseToken, 1, false); 
            const quoteResponseInit = await apiClient.quoteGet({
                inputMint: "So11111111111111111111111111111111111111112",
                outputMint: tokenAddress,
                amount:Number(walletsRandom[0].tradeAmount)*LAMPORTS_PER_SOL,
                swapMode: "ExactIn",
                 asLegacyTransaction: false
            })

            for (var twall in walletsRandom) {
                const item = walletsRandom[twall];
                const wallet = Keypair.fromSecretKey(bs58.decode(item.privateKey));
                const tokenAccnt = await getWalletTokenAccount(connection, wallet.publicKey, baseMint);
                let tokenBal = 0;
                let trade = ' Preparing '
                let side :SwapSide = 'out'
                inTokenAmount = new TokenAmount(inToken, item.tradeAmount, false);
                outTokenAmount = new TokenAmount(baseToken, quoteResponseInit.otherAmountThreshold, true);
                if (tokenAccnt.length > 0) {
                    const tokenBalance = Number(tokenAccnt[0].accountInfo.amount.toNumber().toFixed(0));
                    tokenBal = tokenBalance;

                    if (tokenBal > Number(quoteResponseInit.otherAmountThreshold)/ 8) {
                        inTokenAmount = new TokenAmount(baseToken, Number(quoteResponseInit.otherAmountThreshold), true);
                        outTokenAmount = new TokenAmount(inToken, 0.0001, false);
                        trade += ' Sell '
                        side ='in'
                    } else {
                        trade += ' Buy '

                    }
                } else {
                    trade += ' Buy '

                }

                console.log(trade + ' For ' + wallet.publicKey.toBase58());
                const walletTokenAccounts = await getWalletTokenAccounts(connection, wallet.publicKey)

                const finalInst: TransactionInstruction[] = [];

                const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
                    connection: connection,
                    poolKeys,
                    userKeys: {
                        tokenAccounts: walletTokenAccounts,
                        owner: wallet.publicKey,
                    },
                    amountIn: inTokenAmount,
                    amountOut: outTokenAmount,
                    fixedSide: side,
                    makeTxVersion: TxVersion.V0,
                })
                for (var ixL of innerTransactions) {
                    for (var ix of ixL.instructions) {
                        finalInst.push(ix);
                    }
                }
                const addressesSwapMain: PublicKey[] = [];
                finalInst.forEach((ixn) => {
                    ixn.keys.forEach((key: { pubkey: any; }) => {
                        addressesSwapMain.push(key.pubkey);
                    });
                });
               
                const versionedTransaction = new  Transaction().add(PRIORITY_FEE_IX)
                .add(...finalInst);
                

                tns.push({transaction:versionedTransaction,wallet:wallet});
            }

            try {

                const responses = await Promise.all(
                    tns.map(async (tnx) => {
                        return await sendConfirm(connection,tnx.transaction,[tnx.wallet]);
                    })
                );
                console.log(responses);
            } catch (error) {
                console.log(error);
            }
        }

        setInterval(async () => {
            await generateSwapAndExecute();

        }, boosterConfig.boosterInterval * 1000)

        await generateSwapAndExecute();


    }
    else if (answers.optiontokens == 5) {
        process.exit(0);
    }
    else if (answers.optiontokens == 1) {
        wallets = JSON.parse(readFileSync(`./wallets/${tokenAddress}.json`, 'utf-8'));

        const balances = await Promise.all((wallets.map(async (wallet: any) => {

            return {
                walletAddress: wallet.address,
                walletBalanceInSol: Number((await connection.getBalance(new PublicKey(wallet.address)) / 1e9)).toFixed(4)
            }
        })));

        console.table(balances);
        const response: any = await prompt([
            {
                type: 'input',
                name: 'x',
                message: 'Press any Key to continue > ',
                async onSubmit(_name: any, value: any) {
                    return value;
                }
            }
        ]);

        main0();
    }
    else if (answers.optiontokens == 12) {
        wallets = JSON.parse(readFileSync(`./wallets/${tokenAddress}.json`, 'utf-8'));
        const publicKeys = wallets.map((wallet: any) => new PublicKey(wallet.address));
        const balancesList = await Promise.all(
            publicKeys.map(async (wallet: PublicKey) => {
                try {
                    const balAcnt = await connection.getTokenAccountsByOwner(wallet, {
                        mint: baseMint
                    })
                    return {
                        Address: wallet.toBase58(),
                        Amount: Number(Number(SPL_ACCOUNT_LAYOUT.decode(balAcnt.value[0].account.data).amount.toString()) / (10 ** poolKeys.baseDecimals)).toFixed(2)
                    }
                } catch (error) {
                    return {
                        Address: wallet.toBase58(),
                        Amount: 0
                    }
                }

            })
        );
        console.table(balancesList);

        const response: any = await prompt([
            {
                type: 'input',
                name: 'x',
                message: 'Press any Key to continue > ',
                async onSubmit(_name: any, value: any) {
                    return value;
                }
            }
        ]);

        main0();
    }
    else if (answers.optiontokens == 13) {
        wallets = JSON.parse(readFileSync(`./wallets/${tokenAddress}.json`, 'utf-8'));

        const balances = await Promise.all((wallets.map(async (wallet: any) => {

            const walletBalance = await getWalletTokenBalance(connection, new PublicKey(wallet.address), quoteMint);

            return {
                walletAddress: wallet.address,
                WSOLBalance: Number(walletBalance) / 1e9
            }
        })));

        console.table(balances);
        const response: any = await prompt([
            {
                type: 'input',
                name: 'x',
                message: 'Press any Key to continue > ',
                async onSubmit(_name: any, value: any) {
                    return value;
                }
            }
        ]);

        main0();
    }
    else if (answers.optiontokens == 3) {
        const newWallets = JSON.parse(readFileSync(`./wallets/${tokenAddress}.json`, 'utf8'));
        let cnt = 10;
        const prewal = privateKey
        const tnsList: Transaction[] = [];

        for (var i = 0; i < newWallets.length; i++) {
             const wallet = Keypair.fromSecretKey(bs58.decode(newWallets[i].privateKey));
            const walletBalance: number = await connection.getBalance(wallet.publicKey);
            const d = await connection.getMinimumBalanceForRentExemption(50);

            if (walletBalance > d) {
                console.log(' Transferring Sols From Sub Wallet to main wallet');
                const ix = SystemProgram.transfer({
                    fromPubkey: wallet.publicKey,
                    toPubkey: prewal.publicKey,
                    lamports: Number(walletBalance - Number(d))
                })
                const tnx: Transaction = new Transaction().add(PRIORITY_FEE_IX);
                const { blockhash } = await connection.getLatestBlockhash('confirmed');
                tnx.feePayer = wallet.publicKey;
                tnx.recentBlockhash = blockhash;
                tnx.add(ix)
                tnx.sign(wallet);

                tnsList.push(tnx);
            }
        }
        const responses = await Promise.all(
            tnsList.map(async tnx => {
                try {
                    return await connection.sendRawTransaction(tnx.serialize());
                } catch (error) {
                    return null;
                }

            })
        );
        console.log(responses);


        const response: any = await prompt([
            {
                type: 'input',
                name: 'x',
                message: 'Press any Key to continue > ',
                async onSubmit(name: any, value: any) {
                    return value;
                }
            }
        ]);
        main0();

    }
    else if(answers.optiontokens == 6){
        const boosterConfig = JSON.parse(readFileSync(`./wallets/${tokenAddress}.config.json`, 'utf-8'));
        wallets = JSON.parse(readFileSync(`./wallets/${tokenAddress}.json`, 'utf-8'));
        const inToken = new Token(TOKEN_PROGRAM_ID, quoteMint, 9, 'SOL', 'SOL');
 
        const generateSwapAndExecute = async () => {
            console.log(' Prepare Random Trades  - ' )
            const walletsRandom = getRandomWallets(wallets, boosterConfig.tradesPerInterval);
            const tns: any[] = [];
            let inTokenAmount = new TokenAmount(inToken, 0.001, false);
            let outTokenAmount = new TokenAmount(baseToken, 1, false); 

            for (var twall in wallets) {
                const item = wallets[twall];
                const wallet = Keypair.fromSecretKey(bs58.decode(item.privateKey));
                const tokenAccnt = await getWalletTokenAccount(connection, wallet.publicKey, baseMint);
                let tokenBal = 0;
                let trade = ' Preparing '

                if (tokenAccnt.length > 0) {
                    const tokenBalance = Number(tokenAccnt[0].accountInfo.amount.toNumber().toFixed(0));
                    tokenBal = tokenBalance;

                        inTokenAmount = new TokenAmount(baseToken, Number(tokenBal).toFixed(0), true);
                        outTokenAmount = new TokenAmount(inToken, 0.000001, false);
                        trade += ' Sell '
                    
               if( Number(tokenBal) ==0 )continue;
                console.log(trade + ' For ' + wallet.publicKey.toBase58());
                const walletTokenAccounts = await getWalletTokenAccounts(connection, wallet.publicKey)

                const finalInst: TransactionInstruction[] = [];

                const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
                    connection: connection,
                    poolKeys,
                    userKeys: {
                        tokenAccounts: walletTokenAccounts,
                        owner: wallet.publicKey,
                    },
                    amountIn: inTokenAmount,
                    amountOut: outTokenAmount,
                    fixedSide: 'in',
                    makeTxVersion: TxVersion.V0,
                })
                for (var ixL of innerTransactions) {
                    for (var ix of ixL.instructions) {
                        finalInst.push(ix);
                    }
                }
                const addressesSwapMain: PublicKey[] = [];
                finalInst.forEach((ixn) => {
                    ixn.keys.forEach((key: { pubkey: any; }) => {
                        addressesSwapMain.push(key.pubkey);
                    });
                });
                const versionedTransaction = new  Transaction().add(PRIORITY_FEE_IX)
                .add(...finalInst);
                

                tns.push({transaction:versionedTransaction,wallet:wallet});
            }
        }
            try {

                const responses = await Promise.all(
                    tns.map(async (tnx) => {
                        return await sendConfirm(connection,tnx.transaction,[tnx.wallet]);
                    })
                );
                console.log(responses);

                const response: any = await prompt([
                    {
                        type: 'input',
                        name: 'x',
                        message: 'Press any Key to continue > ',
                        async onSubmit(name: any, value: any) {
                            return value;
                        }
                    }
                ]);
                main0();
            } catch (error) {
                console.log(error);
            }
        }  

        
 
        await generateSwapAndExecute();


    }
}

main();


async function preInitializeData(tokenAddress: PublicKeyInitData) {
    baseMint = new PublicKey(tokenAddress);
    console.log('Pre Intializing Market .......')
    const marketId = await findMarketId(baseMint);
    const marketBufferInfo: any = await connection.getAccountInfo(marketId)
    const { quoteMint, baseLotSize, quoteLotSize, baseVault, quoteVault, bids, asks, eventQueue, requestQueue } = MARKET_STATE_LAYOUT_V3.decode(marketBufferInfo.data)
    console.log('Pre Intializing PoolInfo .......')
    const poolId = await findPoolId(baseMint);
    const ammKeys = await formatAmmKeysById(poolId);
    poolKeys = Liquidity.getAssociatedPoolKeys({
        version: 4,
        marketVersion: 3,
        baseMint,
        quoteMint,
        baseDecimals: ammKeys.baseDecimals,
        quoteDecimals: 9,
        marketId: new PublicKey(ammKeys.marketId),
        programId: PROGRAMIDS.AmmV4,
        marketProgramId: PROGRAMIDS.OPENBOOK_MARKET
    })
    poolKeys.marketBaseVault = baseVault;
    poolKeys.marketQuoteVault = quoteVault;
    poolKeys.marketBids = bids;
    poolKeys.marketAsks = asks;
    poolKeys.marketEventQueue = eventQueue;

    quoteToken = DEFAULT_TOKEN.SOL;
    baseToken = new Token(TOKEN_PROGRAM_ID, baseMint, ammKeys.baseMint == baseMint.toBase58() ? ammKeys.baseDecimals : ammKeys.quoteDecimals, 'TokenMVB', 'TVB');
    jsonPoolInfo = ammKeys;

}



function getRandomWallets(walletAddresses: any[], count: number) {
    const randomWallets = [];
    const shuffledAddresses = walletAddresses.sort(() => 0.5 - Math.random());
    for (let i = 0; i < count; i++) {
        randomWallets.push(shuffledAddresses[i]);
    }
    return randomWallets;
}