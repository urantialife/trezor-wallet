/* @flow */
'use strict';

import Web3 from 'web3';
import HDKey from 'hdkey';
import EthereumjsUtil from 'ethereumjs-util';
import EthereumjsTx from 'ethereumjs-tx';
import TrezorConnect from 'trezor-connect';
import { strip } from '../utils/ethUtils';
import * as ACTIONS from './index';
import * as ADDRESS from './constants/Address';
import * as WEB3 from './constants/Web3';
import { loadHistory } from '../services/EtherscanService';
import { httpRequest } from '../utils/networkUtils';

type ActionMethod = (dispatch: any, getState: any) => Promise<any>;


export function init(web3: ?Web3, coinIndex: number = 0): ActionMethod {
    return async (dispatch, getState) => {

        const { config, ethERC20 } = getState().localStorage;

        const coin = config.coins[ coinIndex ];
        if (!coin) {
            // all instances done
            dispatch({
                type: WEB3.READY,
            });
            return;
        }

        const coinName = coin.shortcut;
        const urls = coin.backends[0].urls;

        let web3host: string = urls[0];

        if (web3) {
            const currentHost = web3.currentProvider.host;
            let currentHostIndex: number = urls.indexOf(currentHost);

            if (currentHostIndex + 1 < urls.length) {
                web3host = urls[currentHostIndex + 1];
            } else {
                console.error("TODO: Backend " + coinName + " not working");
                // try next coin
                dispatch( init(web3, coinIndex + 1) );
                return;
            }
        }

        //const instance = new Web3(window.web3.currentProvider);
        const instance = new Web3( new Web3.providers.HttpProvider(web3host) );

        // instance = new Web3( new Web3.providers.HttpProvider('https://pyrus2.ubiqscan.io') ); // UBQ
        //instance = new Web3( new Web3.providers.HttpProvider('https://node.expanse.tech/') ); // EXP
        //instance = new Web3( new Web3.providers.HttpProvider('http://10.34.0.91:8545/') );

        //web3 = new Web3(new Web3.providers.HttpProvider("https://api.myetherapi.com/rop"));
        //instance = new Web3(new Web3.providers.HttpProvider("https://ropsten.infura.io2/QGyVKozSUEh2YhL4s2G4"));
        //web3 = new Web3( new Web3.providers.HttpProvider("ws://34.230.234.51:30303") );

        // initial check if backend is running
        // instance.version.getNetwork(function(error, chainId){
        //     if (!error) {

        
        
        instance.eth.getGasPrice((error, gasPrice) => {
            if (error) {
                // try different url
                dispatch( init(instance, coinIndex) );
            } else {

                const erc20 = instance.eth.contract(ethERC20);

                dispatch({
                    type: WEB3.CREATE,
                    name: coinName,
                    web3: instance,
                    erc20,
                    chainId: instance.version.network
                });

                dispatch({
                    type: WEB3.GAS_PRICE_UPDATED,
                    coin: coinName,
                    gasPrice
                });

                


                // console.log("GET CHAIN", instance.version.network)

                // instance.version.getWhisper((err, shh) => {
                //     console.log("-----whisperrr", error, shh)
                // })
                

                // const sshFilter = instance.ssh.filter('latest');
                // sshFilter.watch((error, blockHash) => {
                //     console.warn("SSH", error, blockHash);
                // });

                //const shh = instance.shh.newIdentity();

                const latestBlockFilter = instance.eth.filter('latest');
                latestBlockFilter.watch(async (error, blockHash) => {

                    if (error) {
                        console.warn("ERROR!", error);

                        // setInterval(() => {
                        //     dispatch( getGasPrice(coinName) );
                        // }, 5000);
                    }
                    
                    dispatch({
                        type: WEB3.BLOCK_UPDATED,
                        name: coinName,
                        blockHash
                    });

                    // TODO: filter only current device
                    const accounts = getState().accounts.filter(a => a.coin === coinName);
                    for (const addr of accounts) {
                        dispatch( getBalance(addr) );
                    }

                    dispatch( getGasPrice(coinName) );

                    // if (pendingTxs.length > 0) {
                    //     for (const tx of pendingTxs) {
                    //         dispatch( getTransactionReceipt(tx) );
                    //     }
                    // }
                });

                // init next coin
                dispatch( init(instance, coinIndex + 1) );

            }
        });

        // let instance2 = new Web3( new Web3.providers.HttpProvider('https://pyrus2.ubiqscan.io') );
        // console.log("INIT WEB3", instance, instance2);
        // instance2.eth.getGasPrice((error, gasPrice) => {
        //     console.log("---gasss price from UBQ", gasPrice)
        // });
    }
}

function initBlockTicker() {

}

export function initContracts(): ActionMethod {
    return async (dispatch, getState) => {
        const { web3, abi, tokens } = getState().web3;

        const contracts = [];
        for (let token of tokens) {
            contracts.push({
                contract: web3.eth.contract(abi).at(token.address),
                name: token.name,
                symbol: token.symbol,
                decimal: token.decimal
            });

            // web3.eth.contract(abi).at(token.address).balanceOf('0x98ead4bd2fbbb0cf0b49459aa0510ef53faa6cad', (e, r) => {
            //     console.warn('contrR', e, r.toString(10));
            // });
        }

        const contract = web3.eth.contract(abi).at('0x58cda554935e4a1f2acbe15f8757400af275e084');

        contract.name.call((error, name) => {
            if (error) {
                // TODO: skip
            }
            contract.symbol.call((error, symbol) => {
                if (error) {
                    // TODO: skip
                }

                contract.decimals.call((error, decimals) => {
                    console.log("nameeeee", name, symbol, decimals)
                })
            });
            
            
        })
    }
}


export function getGasPrice(coinName: string): ActionMethod {
    return async (dispatch, getState) => {

        const index: number = getState().web3.findIndex(w3 => {
            return w3.coin === coinName;
        });

        const web3 = getState().web3[ index ].web3;
        web3.eth.getGasPrice((error, gasPrice) => {
            if (!error) {
                dispatch({
                    type: WEB3.GAS_PRICE_UPDATED,
                    coin: coinName,
                    gasPrice
                });
            }
        });
    }
}

export function getBalance(addr: Address): ActionMethod {
    return async (dispatch, getState) => {

        const web3instance = getState().web3.filter(w3 => w3.coin === addr.coin)[0];
        const web3 = web3instance.web3;

        web3.eth.getBalance(addr.address, (error, balance) => {
            if (!error) {
                const newBalance: string = web3.fromWei(balance.toString(), 'ether');
                if (addr.balance !== newBalance) {
                    dispatch({
                        type: ADDRESS.SET_BALANCE,
                        address: addr.address,
                        balance: newBalance
                    });

                    // dispatch( loadHistory(addr) );
                }
            }
        });
    }
}

export function getTransactionReceipt(txid: string): any {
    return async (dispatch, getState) => {
        const { web3 } = getState().web3;
        //web3.eth.getTransactionReceipt(txid, (error, tx) => {
        web3.eth.getTransaction(txid, (error, tx) => {
            if (tx && tx.blockNumber) {
                web3.eth.getBlock(tx.blockHash, (error, block) => {
                    console.log("---MAMM BLOCK", error, block, tx, tx.blockHash)
                    dispatch({
                        type: ACTIONS.TX_CONFIRMED,
                        txid,
                        tx,
                        block
                    })
                });
            }
        });
    }
}


export function updateLastBlock(hash: string) {
    return {
        type: 'web3__update_last_block',
        hash
    }
}

export function getTransaction(web3, txid) {
    return new Promise((resolve, reject) => {
        web3.eth.getTransaction(txid, (error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });
}



export function getBalanceAsync(web3, address) {
    return new Promise((resolve, reject) => {
        web3.eth.getBalance(address, (error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });
}

export const getTokenBalanceAsync = (erc20: any, token: any, address: any): Promise<any> => {
    return new Promise((resolve, reject) => {

        const contr = erc20.at(token);
        contr.balanceOf(address, (error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });
}

export function getNonce(web3, address) {
    return new Promise((resolve, reject) => {
        web3.eth.getTransactionCount(address, (error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });
}


export function getTokenInfoAsync(erc20: any, address: string): Promise<any> {
    return new Promise((resolve, reject) => {

        const contract = erc20.at(address);
        const info = {};
        // TODO: handle errors
        contract.name.call((e, name) => {
            if (e) {
                //console.log("1", address, e)
                //resolve(null);
                //return;
            }
            info.name = name;
            contract.symbol.call((e, symbol) => {
                if (e) {
                    console.log("2", e)
                    resolve(null);
                    return;
                }
                info.symbol = symbol;
                contract.decimals.call((e, decimals) => {
                    if (e) {
                        console.log("3", e)
                        resolve(null);
                        return;
                    }
                    info.decimals = decimals.toString();
                    resolve(info);
                });
            })
        });
    });
}

export function estimateGas(web3, gasOptions) {
    return new Promise((resolve, reject) => {
        web3.eth.estimateGas(gasOptions, (error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    })
}

export function getGasPrice2(web3) {
    return new Promise((resolve, reject) => {
        web3.eth.getGasPrice((error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    })
}

export function pushTx(web3, tx) {
    return new Promise((resolve, reject) => {
        web3.eth.sendRawTransaction(tx, (error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    })
}

export function composeTransaction() {
    return async function (dispatch, getState) {
        const { web3 } = getState().web3;
        const { address, amount } = getState().sendForm;

        const resp = await TrezorConnect.getPublicKey({ path: "m/44'/60'/0'/0", confirmation: false });
        
        const hdk = new HDKey();
        hdk.publicKey = new Buffer(resp.data.publicKey, 'hex');
        hdk.chainCode = new Buffer(resp.data.chainCode, 'hex');

        const derivedKey = hdk.derive("m/0");
        const myAddress = EthereumjsUtil.publicToAddress(derivedKey.publicKey, true);

        const txData = {
            address_n: [
                (44 | 0x80000000) >>> 0,
                (60 | 0x80000000) >>> 0,
                (0  | 0x80000000) >>> 0,
                0, 0
            ],
            to: address,
            value: web3.toHex(web3.toWei(amount, 'ether')),
            data,
            chainId: 3
        }

        console.log("NONCE", myAddress)
        const nonce = await getNonce(web3, '0x' + myAddress.toString('hex') );
        console.log("NONCE", nonce)

        const gasOptions = {
            to: txData.to,
            data: txData.data
        }
        const gasLimit = await estimateGas(web3, gasOptions);
        const gasPrice = await getGasPrice(web3);

        txData.nonce = web3.toHex(nonce);
        txData.gasLimit = web3.toHex(gasLimit);
        txData.gasPrice = web3.toHex(gasPrice);

        console.log("NONCE", nonce, gasLimit, gasPrice)

        let signedTransaction = await TrezorConnect.ethereumSignTransaction({
            //path: "m/44'/60'/0'/0/0",
            address_n: txData.address_n,
            nonce: strip(txData.nonce),
            gas_price: strip(txData.gasPrice),
            gas_limit: strip(txData.gasLimit),
            to: strip(txData.to),
            value: strip(txData.value),
            data: txData.data,
            chain_id: txData.chainId
        });

        txData.r = '0x' + signedTransaction.data.r;
        txData.s = '0x' + signedTransaction.data.s;
        txData.v = web3.toHex(signedTransaction.data.v);

        const tx = new EthereumjsTx(txData);
        const serializedTx = '0x' + tx.serialize().toString('hex');

        const txid = await pushTx(web3, serializedTx);

        dispatch({
            type: 'tx_complete',
            txid
        })

        console.log("TXID", txid);
    }
}




