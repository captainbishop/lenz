// Ownership authentication and private reads only. No transaction or deposit methods.
import { base58 } from './intents-vendor/codecs.js';
import { getAddress } from './evm-vendor/address.js';
import { keccak256, recoverAddress } from './evm-vendor/offline-budget.js';
import { emptyAuthenticationPayload, fetchAuthenticationSalt } from './intents-auth-payload.js';
const INTENTS_API = 'https://1click.chaindefuser.com';

const assert = (ok, message) => { if (!ok) throw Error(message); };
const encoder = new TextEncoder();
function joinBytes(chunks) {
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
const token = value => typeof value === 'string' && /^[A-Za-z0-9._~-]{1,16384}$/.test(value);
const lifetime = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
function walletAddress(value) {
  assert(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value), 'Invalid account address.');
  return getAddress(value).toLowerCase();
}
function signedAuthentication(payload, signature, address) {
  assert(typeof signature === 'string' && /^0x[0-9a-fA-F]{130}$/.test(signature), 'Invalid authentication signature.');
  const bytes = Uint8Array.from(signature.slice(2).match(/../g), byte => parseInt(byte, 16));
  assert([0, 1, 27, 28].includes(bytes[64]), 'Invalid authentication recovery byte.');
  const text = encoder.encode(payload), prefix = encoder.encode(`\x19Ethereum Signed Message:\n${text.length}`);
  try {
    assert(recoverAddress(keccak256(joinBytes([prefix, text])), signature).toLowerCase() === address, 'Authentication signature belongs to another account.');
  } catch { throw Error('Authentication signature does not match this account.'); }
  if (bytes[64] >= 27) bytes[64] -= 27;
  return { standard: 'erc191', payload, signature: 'secp256k1:' + base58.encode(bytes) };
}
async function walletSignature(payload, signMessage, signal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  let onAbort;
  try {
    return await Promise.race([
      Promise.resolve().then(() => { deadline.throwIfAborted(); return signMessage(payload); })
        .catch(() => { throw Error('Wallet authentication was declined or failed.'); }),
      new Promise((_, reject) => {
        onAbort = () => reject(Error(signal.aborted ? 'Confidential account disconnected.' : 'Wallet authentication timed out.'));
        deadline.addEventListener('abort', onAbort, { once: true });
        if (deadline.aborted) onAbort();
      }),
    ]);
  } finally { deadline.removeEventListener('abort', onAbort); }
}
async function readJson(response) {
  assert(response.body, 'Confidential account returned an empty response.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert(size <= 1_000_000, 'Confidential account response is too large.');
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joinBytes(chunks)));
  } catch { throw Error('Invalid confidential account response.'); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function privateBalances(value) {
  assert(value && Array.isArray(value.balances) && value.balances.length <= 2048, 'Invalid private balances.');
  const seen = new Set();
  return value.balances.map(entry => {
    assert(entry && typeof entry.tokenId === 'string' && /^[A-Za-z0-9:._-]{1,512}$/.test(entry.tokenId)
      && !seen.has(entry.tokenId) && entry.source === 'private'
      && typeof entry.available === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(entry.available), 'Invalid private balance entry.');
    seen.add(entry.tokenId);
    return { tokenId: entry.tokenId, available: entry.available, source: 'private' };
  });
}

export function createIntentsAccount({ address, signMessage, fetcher = fetch, now = Date.now } = {}) {
  const accountId = walletAddress(address);
  assert(typeof signMessage === 'function' && typeof fetcher === 'function' && typeof now === 'function', 'A wallet signer and account reader are required.');
  let credentials = null, generation = 0, pending = false, signing = false, controller = new AbortController();
  const current = epoch => assert(epoch === generation && !controller.signal.aborted, 'Confidential account disconnected.');
  function disconnect() { generation++; controller.abort(); controller = new AbortController(); credentials = null; pending = false; }
  function requireSession() { assert(credentials, 'Authenticate this account first.'); }
  async function request(path, { body, bearer, signal } = {}) {
    let response;
    try {
      response = await fetcher(INTENTS_API + path, { method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
    } catch { throw Error('Confidential account request failed.'); }
    if (!response.ok) {
      const error = Error(`Confidential account HTTP ${response.status}.`); error.status = response.status;
      await response.body?.cancel().catch(() => {});
      throw error;
    }
    return readJson(response);
  }
  async function operation(work) {
    assert(!pending, 'A confidential account request is already open.');
    const epoch = generation, signal = controller.signal;
    pending = true;
    try { const value = await work(epoch, signal); current(epoch); return value; }
    finally { if (epoch === generation) pending = false; }
  }
  async function connect() {
    assert(!signing, 'A wallet authentication request is still open. Finish it in your wallet.');
    return operation(async (epoch, signal) => {
      credentials = null;
      let salt;
      try {
        salt = await fetchAuthenticationSalt({ fetcher: async (url, options) => {
          const response = await fetcher(url, { ...options, redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.any([signal, options.signal]) });
          return { ok: response.ok, json: () => readJson(response) };
        } });
      } catch { current(epoch); throw Error('Authentication salt request failed.'); }
      current(epoch);
      const started = now();
      const payload = JSON.stringify(emptyAuthenticationPayload({ signerId: accountId, salt, now: started }));
      const signature = await walletSignature(payload, async text => {
        signing = true;
        try { return await signMessage(text); }
        finally { signing = false; }
      }, signal);
      current(epoch);
      assert(now() < Date.parse(JSON.parse(payload).deadline), 'Authentication request expired.');
      const signedData = signedAuthentication(payload, signature, accountId);
      const auth = await request('/v0/auth/authenticate', { body: { signedData }, signal });
      current(epoch);
      assert(token(auth?.accessToken) && token(auth?.refreshToken) && lifetime(auth.expiresIn, 86400)
        && lifetime(auth.refreshExpiresIn, 31 * 86400), 'Invalid authentication session.');
      assert(started + auth.expiresIn * 1000 > now(), 'Authentication session expired.');
      credentials = { accessToken: auth.accessToken, refreshToken: auth.refreshToken,
        expiresAt: started + auth.expiresIn * 1000, refreshExpiresAt: started + auth.refreshExpiresIn * 1000 };
      return { accountId, state: 'authenticated', expiresAt: credentials.expiresAt };
    });
  }
  async function readBalances() {
    requireSession();
    return operation(async (epoch, signal) => {
      try {
        if (credentials.expiresAt <= now()) {
          assert(credentials.refreshExpiresAt > now(), 'Authenticate this account again; the session expired.');
          const started = now();
          const refreshed = await request('/v0/auth/refresh', { body: { refreshToken: credentials.refreshToken }, signal });
          current(epoch);
          assert(token(refreshed?.accessToken) && lifetime(refreshed.expiresIn, 86400)
            && started + refreshed.expiresIn * 1000 > now(), 'Invalid refreshed session.');
          credentials = { ...credentials, accessToken: refreshed.accessToken, expiresAt: started + refreshed.expiresIn * 1000 };
        }
        const data = await request('/v0/account/balances', { bearer: credentials.accessToken, signal });
        current(epoch);
        return { accountId, observedAt: now(), balances: privateBalances(data), evidence: 'authenticated-provider-response',
          spendableOffline: false, settlementVerified: false };
      } catch (error) {
        current(epoch);
        if (error.status === 401) credentials = null;
        throw error;
      }
    });
  }
  function receivingAccount() {
    requireSession();
    assert(credentials.expiresAt > now(), 'Authenticate this account again; the session expired.');
    return { type: 'CONFIDENTIAL_INTENTS', id: accountId };
  }
  return Object.freeze({ connect, readBalances, receivingAccount, disconnect });
}
