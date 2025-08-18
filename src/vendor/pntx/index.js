/*
Pocketnet/Bastyon unsigned Subscribe (follow) transaction builder library.

Exports:
- createUnsignedSubscribeTx(params)
- buildSubscribeOpReturn(addressToFollow)

This mirrors the logic validated in build_unsigned_subscribe_tx.js and Bastyon GUI/core.
*/

import { Buffer } from 'node:buffer'
import * as bitcoin from 'bitcoinjs-lib'
// Enable verbose logs when app is started with VITE_SDK_DEBUG=true
const DEBUG = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SDK_DEBUG

// Pocketnet/PKOIN network params (sourced from pocketnet.gui/js/lib/pocketnet/btc17.js)
const POCKETNET_TESTNET = {
  messagePrefix: '\x18Bitcoin Signed Message:\n',
  bech32: 'bc',
  bip32: {
    public: 0x043587CF,
    private: 0x04358394,
  },
  pubKeyHash: 0x41,
  scriptHash: 0x4E,
  wif: 0x1E,
}

const POCKETNET_MAINNET = {
  messagePrefix: '\x18Bitcoin Signed Message:\n',
  bech32: 'bc',
  bip32: {
    public: 0x043587CF,
    private: 0x04358394,
  },
  pubKeyHash: 0x37,
  scriptHash: 0x50,
  wif: 0x21,
}

// Constants from ActionOptions in actions.js
const AMOUNT_C = 100000000 // satoshis per coin
const DEFAULT_DUST_VALUE_SATS = 700 // dustValue = 700 sats
const DEFAULT_FEE_SATS = 1 // pcTxFee

/**
 * Minimal input selection to mirror getBestInputs for small value (subscribe)
 * - Ensures selected sum >= max(dustValue, value). For subscribe value effectively equals fee.
 * - Picks UTXOs close to diff; we keep it simple: sort by |amount - diff| and pick until threshold reached.
 *
 * @param {Array<{txid:string,vout:number,scriptPubKey:string,amount:number,address?:string}>} utxos amount in coins
 * @param {number} valueSats target value in sats (fee for subscribe)
 * @param {number} dustValueSats minimum sats to cover (700 by default)
 */
function selectInputsLikeGui(utxos, valueSats, dustValueSats = DEFAULT_DUST_VALUE_SATS) {
  const target = Math.max(valueSats, dustValueSats)
  if (!Array.isArray(utxos) || utxos.length === 0)
    throw new Error('No UTXOs')
  // Map to sats for sorting
  const enriched = utxos.map(u => ({ ...u, amountSats: Math.round(u.amount * AMOUNT_C) }))
  const selected = []
  let sum = 0
  const pool = enriched.slice()
  while (sum < target && pool.length) {
    const diff = Math.max(target - sum, 0)
    // sort by closeness to diff and take one deterministically
    pool.sort((a, b) => Math.abs(a.amountSats - diff) - Math.abs(b.amountSats - diff))
    const pick = pool.shift()
    selected.push(pick)
    sum += pick.amountSats
  }
  if (sum < target)
    throw new Error('Insufficient input sum for dust threshold')
  return selected
}

/**
 * Build OP_RETURN buffer array exactly like actions.js:
 *   - first push: Buffer.from('subscribe','utf8')
 *   - second push: Buffer of sha256d(serialize())
 * For subscribe, serialize() is target address string.
 */
function buildSubscribeOpReturn(addressToFollow) {
  if (!addressToFollow)
    throw new Error('addressToFollow required')
  const typeBuf = Buffer.from('subscribe', 'utf8')
  const payload = addressToFollow // Subscribe.serialize() returns address string
  const hashBuf = bitcoin.crypto.hash256(Buffer.from(payload, 'utf8'))
  return [typeBuf, hashBuf]
}

/**
 * Create unsigned (incomplete) subscribe transaction hex.
 *
 * @param {object} params
 * @param {Array<{txid:string,vout:number,scriptPubKey:string,amount:number,address?:string}>} params.utxos amount in coins
 * @param {string} params.changeAddress P2PKH or compatible address
 * @param {string} params.addressToFollow target address to subscribe to
 * @param {number} [params.feeSats] flat fee in sats
 * @param {number} [params.timeDifference] optional time offset used when delayedNtime is set
 * @param {number} [params.delayedNtime] optional locktime
 * @param {bitcoin.networks.Network} [params.network] network
 * @returns {{hex:string, txid:string, vsize:number, inputs:any[], outputs:any[]}} unsigned tx summary including hex, pre-sign txid, virtual size, selected inputs, and outputs
 */
function createUnsignedSubscribeTx({
  utxos,
  changeAddress,
  addressToFollow,
  feeSats = DEFAULT_FEE_SATS,
  timeDifference = 0,
  delayedNtime = 0,
  network = POCKETNET_MAINNET,
}) {
  if (!Array.isArray(utxos) || utxos.length === 0)
    throw new Error('utxos required')
  if (!changeAddress)
    throw new Error('changeAddress required')
  if (!addressToFollow)
    throw new Error('addressToFollow required')

  // Input selection (subscribe has no send amount, only fee). GUI enforces dustValue.
  const selected = selectInputsLikeGui(utxos, feeSats, DEFAULT_DUST_VALUE_SATS)
  const totalInSats = selected.reduce((m, u) => m + Math.round(u.amount * AMOUNT_C), 0)
  if (totalInSats <= feeSats)
    throw new Error('inputs total <= fee')

  const changeSats = totalInSats - feeSats // all remainder returns as change

  const txb = new bitcoin.TransactionBuilder(network)

  if (delayedNtime)
    txb.setLockTime(delayedNtime + (timeDifference || 0))
    // NOTE: setNTime/addNTime are custom in Bastyon fork; not in bitcoinjs-lib upstream.

  // Add inputs with provided scriptPubKey like GUI does
  selected.forEach((input) => {
    const prevOutScript = Buffer.from(input.scriptPubKey, 'hex')
    txb.addInput(input.txid, input.vout, undefined, prevOutScript)
  })

  // Add OP_RETURN
  const opreturnData = buildSubscribeOpReturn(addressToFollow)
  const embed = bitcoin.payments.embed({ data: opreturnData })
  txb.addOutput(embed.output, 0)

  // Add change output
  txb.addOutput(changeAddress, changeSats)

  // Build incomplete (unsigned)
  const tx = txb.buildIncomplete()
  const hex = tx.toHex()
  const vsize = tx.virtualSize ? tx.virtualSize() : tx.byteLength()

  return {
    hex,
    txid: tx.getId(), // Will change after signing
    vsize,
    inputs: selected,
    outputs: [
      { type: 'op_return', value: 0 },
      { address: changeAddress, valueSats: changeSats },
    ],
  }
}

export {
  createUnsignedSubscribeTx,
  buildSubscribeOpReturn,
  // also export internal bits for advanced usage/testing
  DEFAULT_DUST_VALUE_SATS,
  DEFAULT_FEE_SATS,
  POCKETNET_MAINNET,
  POCKETNET_TESTNET,
}

/**
 * Convenience helper that gathers UTXOs via RPC and then builds the unsigned subscribe tx.
 * Requires RPC methods compatible with backend:
 *   - txunspent [[address], 1, 9999999] (public proxy)
 *   - getrawtransaction [txid, 1] to extract vout[n].scriptPubKey.hex
 * Proof methods are not required.
 *
 * @param {object} params
 * @param {{ call: (method:string, params?:any)=>Promise<any> }} params.rpc - JSON-RPC client wrapper
 * @param {string} params.spendAddress - address to gather UTXOs from (usually same as change)
 * @param {string} params.changeAddress - where change should return
 * @param {string} params.addressToFollow - target address to subscribe to
 * @param {number} [params.feeSats] - default 1
 * @param {number} [params.timeDifference]
 * @param {number} [params.delayedNtime]
 * @param {any} [params.network]
 * @returns {Promise<ReturnType<typeof createUnsignedSubscribeTx>>} promise resolving to the unsigned transaction summary produced by createUnsignedSubscribeTx
 */
async function createUnsignedSubscribeTxFromAddress({
  rpc,
  spendAddress,
  changeAddress,
  addressToFollow,
  feeSats = DEFAULT_FEE_SATS,
  timeDifference = 0,
  delayedNtime = 0,
  network = POCKETNET_MAINNET,
}) {
  if (!rpc || typeof rpc.call !== 'function')
    throw new Error('rpc client with call(method, params) required')
  if (!spendAddress)
    throw new Error('spendAddress required')

  // 1) Enumerate UTXOs via public proxy 'txunspent'
  let utxos
  try {
    // Preferred: [[address], 1, 9999999]
    if (DEBUG)
      console.debug('[pntx] RPC txunspent ([[addr],1,9999999])')
    let res = await rpc.call('txunspent', [[spendAddress], 1, 9999999])
    utxos = Array.isArray(res) ? res : (res && Array.isArray(res.result) ? res.result : [])
    // Fallbacks for legacy parameter shapes
    if ((!utxos || utxos.length === 0)) {
      if (DEBUG)
        console.debug('[pntx] RPC txunspent ([addr,1,9999999]) fallback')
      res = await rpc.call('txunspent', [spendAddress, 1, 9999999])
      utxos = Array.isArray(res) ? res : (res && Array.isArray(res.result) ? res.result : [])
    }
    if ((!utxos || utxos.length === 0)) {
      if (DEBUG)
        console.debug('[pntx] RPC txunspent ([addr]) fallback')
      res = await rpc.call('txunspent', [spendAddress])
      utxos = Array.isArray(res) ? res : (res && Array.isArray(res.result) ? res.result : [])
    }
  }
  catch (e) {
    if (DEBUG)
      console.warn('[pntx] txunspent failed:', e)
    utxos = []
  }

  if (!Array.isArray(utxos) || utxos.length === 0)
    throw new Error('No UTXOs returned for spendAddress')

  // 2) Ensure scriptPubKey.hex for each UTXO (fetch via getrawtransaction if missing)
  const prepared = []
  // Helper to fetch scriptPubKey hex with multiple fallbacks
  const fetchScriptHex = async (txid, vout) => {
    // Prefer public getrawtransaction with verbose output
    try {
      if (DEBUG)
        console.debug('[pntx] RPC getrawtransaction (verbose)')
      const tx = await rpc.call('getrawtransaction', [txid, 1])
      const txRes = tx && tx.result ? tx.result : tx
      const vouts = txRes?.vout || []
      let out = Array.isArray(vouts) ? vouts.find(o => o?.n === vout) : undefined
      if (!out && Array.isArray(vouts) && vouts[vout])
        out = vouts[vout]

      const hex = out?.scriptPubKey?.hex
      if (hex)
        return hex
    }
    catch {}
    // Fallback to getrawtransactionwithmessage if available
    try {
      if (DEBUG)
        console.debug('[pntx] RPC getrawtransactionwithmessage (verbose) fallback')
      const tx = await rpc.call('getrawtransactionwithmessage', [txid])
      const txRes = tx && tx.result ? tx.result : tx
      const vouts = txRes?.vout || []
      let out = Array.isArray(vouts) ? vouts.find(o => o?.n === vout) : undefined
      if (!out && Array.isArray(vouts) && vouts[vout])
        out = vouts[vout]

      const hex = out?.scriptPubKey?.hex
      if (hex)
        return hex
    }
    catch {}
    return undefined
  }

  for (const u of utxos) {
    const txid = u.txid || u.txId || u.txID
    const vout = u.vout != null ? u.vout : u.n
    if (!txid || vout == null)
      continue

    let scriptHex = (u.scriptPubKey && (u.scriptPubKey.hex || u.scriptPubKey)) || undefined
    if (!scriptHex)
      scriptHex = await fetchScriptHex(txid, vout)
    if (!scriptHex)
      continue // spent or cannot fetch

    // amount in coins (PKOIN). Support both amount and value fields.
    const amount = u.amount != null ? u.amount : (u.value != null ? u.value : undefined)
    if (typeof amount !== 'number')
      continue

    prepared.push({ txid, vout, scriptPubKey: scriptHex, amount })
  }

  if (prepared.length === 0)
    throw new Error('No usable UTXOs after filtering')

  // 3) Build unsigned tx
  return createUnsignedSubscribeTx({
    utxos: prepared,
    changeAddress: changeAddress || spendAddress,
    addressToFollow,
    feeSats,
    timeDifference,
    delayedNtime,
    network,
  })
}

export { createUnsignedSubscribeTxFromAddress }

// Provide a default export for CJS-style consumers, if any
export default {
  createUnsignedSubscribeTx,
  buildSubscribeOpReturn,
  createUnsignedSubscribeTxFromAddress,
  DEFAULT_DUST_VALUE_SATS,
  DEFAULT_FEE_SATS,
  POCKETNET_MAINNET,
  POCKETNET_TESTNET,
}
