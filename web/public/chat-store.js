const DB = 'proof-u-private-chat-v1';
const KEY = 'workspace';
const backupContent=state=>JSON.stringify([state.identity?.profile,state.contacts,state.messages?.map(record=>[record.packet,record.receiptToShare??null,record.receivedReceipt??null]),state.recoveredChat?.archive,state.contactRecoveries??[]]);
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readState() {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readonly');
      const request = tx.objectStore('state').get(KEY);
      tx.oncomplete = () => resolve(request.result ?? { identity: null, contacts: [], messages: [] });
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('Storage read aborted'));
    });
  } finally { db.close(); }
}
async function saveState(state) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(state, KEY);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Storage write aborted'));
    });
  } finally { db.close(); }
}
export async function updateState(operation,{markBackup=true}={}) {
  if (!navigator.locks) throw new Error('This browser needs Web Locks to save messages safely across tabs.');
  return navigator.locks.request(DB, async () => {
    const state = await readState();
    const before=state.accountSync?backupContent(state):null;
    const result = await operation(state);
    const changed=markBackup&&state.accountSync&&before!==backupContent(state);
    if(changed){state.accountSync.version++;if(state.accountSync.status!=='conflict')state.accountSync.status='pending';}
    await saveState(state);
    if(changed){globalThis.dispatchEvent?.(new Event('lenz-account-changed'));if(typeof BroadcastChannel==='function'){const channel=new BroadcastChannel('lenz-account-sync');channel.postMessage('changed');channel.close();}}
    return result;
  });
}
