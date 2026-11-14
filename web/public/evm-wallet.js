// EIP-1193 session. Keys remain in the selected wallet; no account storage here.
import { WALLET_NETWORKS, networkId, walletNetworkParameters } from './evm-networks.js';
import {receivingWalletData,verifyReceivingWallet} from './receiving-instructions.js';
import {checkedOrderAction,orderTypedData,verifyOrderSignature} from './hyperliquid-order.js';
import {checkAuthenticationPayload} from './intents-auth-payload.js';
import {acquireWalletPrompt} from './wallet-prompt.js';
import {checkedHyperliquidSetupAction,hyperliquidSetupTypedData,verifyHyperliquidSetupSignature} from './hyperliquid-account-setup.js';
export { WALLET_NETWORKS } from './evm-networks.js';
const assert = (ok, message) => { if (!ok) throw Error(message); };
const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) && value.length <= 66;
function account(value) {
  assert(Array.isArray(value) && value.length > 0 && value.length <= 100, 'No account shared. Connect in your wallet.');
  assert(typeof value[0] === 'string' && /^0x[0-9a-f]{40}$/i.test(value[0]) && !/^0x0{40}$/i.test(value[0]), 'Wallet returned an invalid address.');
  return value[0].toLowerCase();
}
function chain(value, resolve = id => WALLET_NETWORKS[id]) {
  assert(quantity(value), 'Wallet returned an invalid network.');
  const id = '0x' + BigInt(value).toString(16);
  assert(resolve(id), 'Choose Ethereum, Arbitrum or Base, or save a custom network under Networks.');
  return id;
}
export function nativeAmount(value, decimals = 18) {
  assert(quantity(value), 'Wallet returned an invalid balance.');
  assert(Number.isInteger(decimals) && decimals >= 0 && decimals <= 36, 'Invalid native currency decimals.');
  const units = BigInt(value), scale = 10n ** BigInt(decimals), whole = units / scale;
  const fraction = decimals ? (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '') : '';
  return whole.toString() + (fraction ? '.' + fraction : '');
}
export function createWalletSession({ changed = () => {}, timeoutMs = 30000, networks = { get: id => WALLET_NETWORKS[id] } } = {}) {
  let provider = null, snapshot = null, generation = 0, listeners = [], pending = false, switching = null;
  const resolve = id => WALLET_NETWORKS[id] ?? networks.get(id);
  const sameNetwork = (id, network) => JSON.stringify(resolve(id)) === JSON.stringify(network);
  const publish = message => changed(snapshot, message);
  function disconnect(message = '') {
    generation++; snapshot = null; pending = false; switching = null;
    for (const [event, listener] of listeners) { try { provider?.removeListener(event, listener); } catch {} }
    listeners = []; provider = null; publish(message);
  }
  async function request(method, params, current, ticket) {
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => { assert(ticket === generation && current === provider, 'Wallet changed. Reconnect to continue.'); return current.request({ method, ...(params ? { params } : {}) }); }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Wallet did not respond. Reconnect to try again.')), timeoutMs); }),
      ]);
      assert(ticket === generation && current === provider, 'Wallet changed. Reconnect to continue.');
      return value;
    } finally { clearTimeout(timer); }
  }
  async function observe(interactive, expectedChain = null, expectedAddress = null) {
    assert(provider && !pending, 'A wallet request is already open.');
    const current = provider, ticket = generation;
    pending = true; snapshot = null; publish('Check your wallet…');
    try {
      const address = account(await request(interactive ? 'eth_requestAccounts' : 'eth_accounts', null, current, ticket));
      const chainId = chain(await request('eth_chainId', null, current, ticket), resolve);
      assert((!expectedChain || chainId === expectedChain) && (!expectedAddress || address === expectedAddress), 'Wallet selected a different account or network. Reconnect.');
      const network = resolve(chainId);
      const block = await request('eth_blockNumber', null, current, ticket);
      assert(quantity(block), 'Wallet returned an invalid block.');
      const balance = await request('eth_getBalance', [address, block], current, ticket);
      const amount = nativeAmount(balance, network.decimals);
      assert(chain(await request('eth_chainId', null, current, ticket), resolve) === chainId && account(await request('eth_accounts', null, current, ticket)) === address, 'Account or network changed. Reconnect.');
      assert(sameNetwork(chainId, network), 'Network settings changed. Reconnect.');
      snapshot = Object.freeze({ address, chainId, network, balance, amount, block, observedAt: Date.now(), receiveUri: `ethereum:${address}@${network.id}` });
      pending = false; switching = null; publish(''); return snapshot;
    } catch (error) {
      if (ticket === generation) disconnect(error?.code === 4001 ? 'Connection declined in your wallet.' : error?.code === -32002 ? 'A request is already open in your wallet.' : 'Wallet connection failed. ' + (error instanceof Error ? error.message.slice(0, 180) : 'Try again.'));
      throw error;
    }
  }
  async function switchNetwork(id, { addConsent = false, interactive = false, expectedNetwork = null } = {}) {
    assert(provider && !pending, 'Connect your wallet and finish any open request first.');
    const chainId = networkId(id), network = resolve(chainId);
    assert(network, 'Save this network first.');
    assert(!expectedNetwork || JSON.stringify(expectedNetwork) === JSON.stringify(network), 'Network settings changed. Review the network again.');
    assert(!network.custom || addConsent === true, 'Allow sharing this custom network with your wallet first.');
    const previousAddress = snapshot?.address, current = provider, ticket = ++generation;
    snapshot = null; pending = true; switching = chainId; publish('Confirm the network in your wallet…');
    try {
      // Registration and selection are distinct requests; a successful add is not a switch.
      if (network.custom) await request('wallet_addEthereumChain', [walletNetworkParameters(network)], current, ticket);
      assert(sameNetwork(chainId, network), 'Network settings changed. Reconnect.');
      await request('wallet_switchEthereumChain', [{ chainId }], current, ticket);
      assert(sameNetwork(chainId, network), 'Network settings changed. Reconnect.');
      assert(chain(await request('eth_chainId', null, current, ticket), resolve) === chainId, 'Wallet did not select the requested network.');
      pending = false;
      return await observe(interactive, chainId, previousAddress);
    } catch (error) {
      if (ticket === generation) disconnect(error?.code === 4001 ? 'Network change declined in your wallet.' : error?.code === 4902 ? 'Add this network in your wallet, then try again.' : 'Network change failed. ' + (error instanceof Error ? error.message.slice(0, 160) : 'Reconnect.'));
      throw error;
    }
  }
  return Object.freeze({
    get snapshot() { return snapshot; },
    get pending() { return pending; },
    capture() {
      assert(snapshot && provider && !pending, 'Connect your wallet first.');
      const current = provider, ticket = generation, identity = snapshot;
      const assertCurrent = () => assert(current === provider && ticket === generation && identity === snapshot && sameNetwork(identity.chainId, identity.network), 'Wallet changed. Review again.');
      return Object.freeze({ identity, assertCurrent,
        async signIntentsAuthentication(payload, { signal } = {}) {
          assertCurrent(); signal?.throwIfAborted();
          checkAuthenticationPayload(payload, identity.address);
          const releasePrompt = acquireWalletPrompt(current);
          try {
            assert(account(await request('eth_accounts',null,current,ticket))===identity.address
              && chain(await request('eth_chainId',null,current,ticket),resolve)===identity.chainId, 'Wallet changed. Review again.');
            assert(await request('eth_getCode',[identity.address,'latest'],current,ticket)==='0x', 'Private balances currently require an externally owned wallet.');
            assertCurrent(); signal?.throwIfAborted(); checkAuthenticationPayload(payload, identity.address);
            const hex = '0x' + [...new TextEncoder().encode(payload)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
            // Retain the lock until the provider prompt actually settles, even after cancellation.
            const signature = await current.request({method:'personal_sign',params:[hex,identity.address]});
            assertCurrent(); signal?.throwIfAborted(); checkAuthenticationPayload(payload, identity.address);
            assert(account(await request('eth_accounts',null,current,ticket))===identity.address
              && chain(await request('eth_chainId',null,current,ticket),resolve)===identity.chainId, 'Wallet changed. Review again.');
            return signature;
          } finally { releasePrompt(); }
        },
        request(method, params) {
          assertCurrent();
          assert(['eth_accounts','eth_chainId','eth_blockNumber','eth_getBalance','eth_getTransactionCount','eth_gasPrice','eth_estimateGas','eth_call','eth_getCode','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBlockByNumber'].includes(method), 'Unsupported wallet read.');
          return request(method, params, current, ticket);
        },
        sendTransaction(transaction) {
          assertCurrent();
          // Keep the eventual hash even if the account changes after wallet dispatch.
          // The transfer service durably records this attempt before invoking us.
          return current.request({method:'eth_sendTransaction',params:[structuredClone(transaction)]});
        },
        async signHyperliquid(action,nonce,expiresAt) {
          assertCurrent();
          const data=orderTypedData(checkedOrderAction(action),nonce,expiresAt);
          assert(Date.now()<expiresAt,'Order review expired. Review again.');
          assert(account(await request('eth_accounts',null,current,ticket))===identity.address&&chain(await request('eth_chainId',null,current,ticket),resolve)===identity.chainId,'Wallet changed. Review again.');
          const typed={...data,types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],...data.types}};
          const signature=await request('eth_signTypedData_v4',[identity.address,JSON.stringify(typed)],current,ticket);
          assertCurrent();assert(Date.now()<expiresAt,'Order review expired. Review again.');
          assert(account(await request('eth_accounts',null,current,ticket))===identity.address,'Wallet changed. Review again.');
          return verifyOrderSignature(data,signature,identity.address);
        },
        async signHyperliquidSetup(action,expiresAt,{retainSignature}={}) {
          let providerInvoked=false,releasePrompt;
          try{
            assertCurrent();const checked=checkedHyperliquidSetupAction(action),data=hyperliquidSetupTypedData(checked);
            assert(checked.user===identity.address&&Number.isSafeInteger(expiresAt)&&expiresAt<=checked.nonce+60000&&Date.now()<expiresAt&&typeof retainSignature==='function','Account setup review changed or expired.');
            releasePrompt=acquireWalletPrompt(current);
            assert(account(await request('eth_accounts',null,current,ticket))===identity.address&&chain(await request('eth_chainId',null,current,ticket),resolve)===identity.chainId,'Wallet changed. Review again.');
            assertCurrent();assert(Date.now()<expiresAt,'Account setup review expired. Review again.');
            const typed={...data,types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],...data.types}};
            providerInvoked=true;
            const signature=await current.request({method:'eth_signTypedData_v4',params:[identity.address,JSON.stringify(typed)]});
            verifyHyperliquidSetupSignature(checked,signature);await retainSignature(signature);
            assertCurrent();assert(Date.now()<expiresAt,'Account setup review expired. Review again.');
            assert(account(await request('eth_accounts',null,current,ticket))===identity.address&&chain(await request('eth_chainId',null,current,ticket),resolve)===identity.chainId,'Wallet changed. Review again.');
            return signature;
          }catch(error){if(!providerInvoked||error?.code===4001)error.hyperliquidSetupNotSigned=true;throw error;}
          finally{releasePrompt?.();}
        },
        async signReceiving(terms) {
          assertCurrent();
          const data=receivingWalletData(terms);
          assert(terms.address===identity.address&&terms.chainId===identity.chainId,'Receiving wallet changed.');
          assert(account(await request('eth_accounts',null,current,ticket))===identity.address&&chain(await request('eth_chainId',null,current,ticket),resolve)===identity.chainId,'Receiving wallet changed.');
          const code=await request('eth_getCode',[identity.address,'latest'],current,ticket);
          assert(code==='0x','Receiving links currently require an externally owned wallet.');
          assertCurrent();receivingWalletData(terms);
          const typed={...data,types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'}],...data.types}};
          const signature=await request('eth_signTypedData_v4',[identity.address,JSON.stringify(typed)],current,ticket);
          assertCurrent();
          assert(account(await request('eth_accounts',null,current,ticket))===identity.address&&chain(await request('eth_chainId',null,current,ticket),resolve)===identity.chainId,'Receiving wallet changed.');
          verifyReceivingWallet(terms,signature);return signature;
        },
      });
    },
    async connect(next, selection = null) {
      assert(!pending, 'A wallet request is already open.');
      disconnect();
      assert(next && ['request', 'on', 'removeListener'].every(key => typeof next[key] === 'function'), 'This wallet does not support account-change notifications.');
      provider = next;
      try {
        for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
          const listener = value => {
            if (event === 'chainChanged' && switching && quantity(value) && '0x' + BigInt(value).toString(16) === switching) return;
            disconnect('Account or network changed. Reconnect to continue.');
          };
          listeners.push([event, listener]); next.on(event, listener);
        }
      } catch (error) { disconnect('Wallet connection failed.'); throw error; }
      const operation = selection ? switchNetwork(selection.chainId, { addConsent: selection.addConsent, expectedNetwork: selection.expectedNetwork, interactive: true }) : observe(true);
      const ticket = generation;
      try { return await operation; }
      catch (error) { if (ticket === generation && provider === next && !pending) disconnect(error.message); throw error; }
    },
    refresh() { return observe(false); },
    switchNetwork,
    disconnect,
  });
}
