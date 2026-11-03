// Network metadata is separate from wallet keys, balances and transfer journals.
export const WALLET_NETWORKS = Object.freeze({
  '0x1': Object.freeze({ name: 'Ethereum', key: 'ethereum', id: '1', symbol: 'ETH', decimals: 18 }),
  '0xa4b1': Object.freeze({ name: 'Arbitrum', key: 'arbitrum', id: '42161', symbol: 'ETH', decimals: 18 }),
  '0x2105': Object.freeze({ name: 'Base', key: 'base', id: '8453', symbol: 'ETH', decimals: 18 }),
});
export const NETWORK_STORAGE_KEY = 'lenz-evm-networks-v1';
const check = (ok, message, field) => { if (!ok) throw Object.assign(Error(message), { field }); };
export function networkId(value) {
  check(typeof value === 'string' && /^(?:[1-9][0-9]{0,15}|0x[1-9a-f][0-9a-f]{0,13})$/i.test(value), 'Enter a decimal or hexadecimal chain ID.', 'chainId');
  const id = BigInt(value);
  check(id > 0n && id <= BigInt(Number.MAX_SAFE_INTEGER), 'Chain ID is outside the supported range.', 'chainId');
  return '0x' + id.toString(16);
}
export function customNetwork(input) {
  check(input && typeof input === 'object', 'Enter network details.');
  const chainId = networkId(input.chainId);
  check(!Object.hasOwn(WALLET_NETWORKS, chainId), 'This network is already built in.', 'chainId');
  check(typeof input.name === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} .()_-]{0,47}$/u.test(input.name), 'Use a network name of 1–48 letters, numbers or spaces.', 'name');
  check(!Object.values(WALLET_NETWORKS).some(n => n.name.toLowerCase() === input.name.toLowerCase()), 'Use the custom network’s own name.', 'name');
  check(typeof input.symbol === 'string' && /^[A-Za-z][A-Za-z0-9]{0,10}$/.test(input.symbol), 'Use a currency symbol of 1–11 letters or numbers.', 'symbol');
  check(Number.isInteger(input.decimals) && input.decimals >= 0 && input.decimals <= 36, 'Decimals must be a whole number from 0 to 36.', 'decimals');
  check(typeof input.rpcUrl === 'string' && input.rpcUrl.length <= 512 && !/[\s\\]/.test(input.rpcUrl), 'Enter an HTTPS RPC URL.', 'rpcUrl');
  let url; try { url = new URL(input.rpcUrl); } catch { check(false, 'Enter an HTTPS RPC URL.', 'rpcUrl'); }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'Use HTTPS without a login, query or fragment.', 'rpcUrl');
  // No local endpoints, literal IPs or non-default ports. Lenz never proxies this URL.
  check(!url.port && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) && !/^[\d.]+$/.test(url.hostname) && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname), 'Use a public RPC hostname with the standard HTTPS port.', 'rpcUrl');
  return Object.freeze({ chainId, id: BigInt(chainId).toString(), name: input.name, symbol: input.symbol, decimals: input.decimals, rpcUrl: url.href, custom: true });
}
export function walletNetworkParameters(network) {
  const n = customNetwork(network);
  return { chainId: n.chainId, chainName: n.name, nativeCurrency: { name: n.symbol, symbol: n.symbol, decimals: n.decimals }, rpcUrls: [n.rpcUrl] };
}
export function createNetworkStore({ storage, locks } = {}) {
  function list() {
    const raw = storage.getItem(NETWORK_STORAGE_KEY);
    if (raw === null) return [];
    check(raw.length <= 32768, 'Saved networks are unreadable.');
    let data; try { data = JSON.parse(raw); } catch { check(false, 'Saved networks are unreadable.'); }
    check(data?.version === 1 && Array.isArray(data.networks) && data.networks.length <= 20, 'Saved networks are unreadable.');
    const rows = data.networks.map(customNetwork);
    check(new Set(rows.map(n => n.chainId)).size === rows.length, 'Saved networks contain duplicate chain IDs.');
    return rows;
  }
  async function update(change) {
    check(locks && typeof locks.request === 'function', 'This browser cannot safely save network settings.');
    return locks.request(NETWORK_STORAGE_KEY, () => {
      const rows = change(list());
      const raw = JSON.stringify({ version: 1, networks: rows });
      storage.setItem(NETWORK_STORAGE_KEY, raw);
      check(storage.getItem(NETWORK_STORAGE_KEY) === raw, 'Network settings were not saved. Try again.');
      return rows;
    });
  }
  return Object.freeze({ list,
    get(id) { const key = networkId(id); return WALLET_NETWORKS[key] ?? list().find(n => n.chainId === key) ?? null; },
    add(input) { const n = customNetwork(input); return update(rows => {
      check(!rows.some(row => row.chainId === n.chainId), 'This chain ID is already saved.', 'chainId');
      check(rows.length < 20, 'Remove a custom network before adding another.');
      return [...rows, n];
    }); },
    remove(id) { const key = networkId(id); check(!Object.hasOwn(WALLET_NETWORKS, key), 'Built-in networks cannot be removed.'); return update(rows => rows.filter(n => n.chainId !== key)); },
  });
}
