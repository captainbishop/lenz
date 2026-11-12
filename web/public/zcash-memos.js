const hashPattern = /^[0-9a-f]{64}$/;
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
export function decodeMemo(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{1024}$/.test(hex)) throw Error('Invalid authenticated memo.');
  const bytes = Uint8Array.from(hex.match(/../g), pair => parseInt(pair, 16));
  let format = 'unsupported', text;
  if (bytes[0] === 0xf6 && bytes.slice(1).every(byte => byte === 0)) format = 'empty';
  else if (bytes[0] === 0xff) format = 'binary';
  else if (bytes[0] <= 0xf4) {
    let end = bytes.length; while (end && bytes[end - 1] === 0) end--;
    try { text = new TextDecoder('utf-8', { fatal:true, ignoreBOM:true }).decode(bytes.slice(0,end)); format = 'text'; } catch { format = 'invalid-text'; }
  }
  const unsafeText = typeof text === 'string' && /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(text);
  return { hex, format, unsafeText, ...(text === undefined ? {} : { text }) };
}
export function memoBindingTerms(review, pcztSha256, recipientSha256, changeSha256) {
  if (![pcztSha256,recipientSha256,changeSha256].every(value => hashPattern.test(value))) throw Error('Invalid memo fingerprint.');
  return JSON.stringify({ version:1, id:review.id, wallet:review.wallet,
    amount:String(review.value ?? review.amount), fee:review.summary?.fee ?? review.fee,
    change:review.summary?.change ?? review.change, recipient:review.summary?.address ?? review.address,
    pcztSha256, memos:[['recipient',recipientSha256],['change',changeSha256]] });
}
export async function verifyMemoInspection(inspection, review) {
  await verifyMemoReview(review.memos,review);
  if (!inspection || inspection.pcztSha256 !== review.memos?.pcztSha256 || inspection.binding !== review.memos?.binding) throw Error('Memo inspection differs from this review.');
  const decoded = {};
  for (const role of ['recipient','change']) {
    decoded[role] = decodeMemo(inspection[role]?.hex);
    const sha256 = await digest(Uint8Array.from(decoded[role].hex.match(/../g), pair=>parseInt(pair,16)));
    const descriptor = review.memos[role];
    if (descriptor?.sha256 !== sha256 || descriptor.format !== decoded[role].format || descriptor.unsafeText !== decoded[role].unsafeText) throw Error('Memo bytes differ from this review.');
  }
  const binding = await digest(new TextEncoder().encode(memoBindingTerms(review,inspection.pcztSha256,review.memos.recipient.sha256,review.memos.change.sha256)));
  if (binding !== inspection.binding) throw Error('Memo terms differ from this review.');
  return { pcztSha256:inspection.pcztSha256, binding, ...decoded };
}
export async function verifyMemoReview(value, review) {
  if (value == null || value.status === 'unreviewed') return;
  if (['checking','unavailable'].includes(value.status)) {
    if (!Number.isFinite(Date.parse(value.checkedAt))) throw Error('Invalid memo check.');
    return;
  }
  if (!['inspected','confirmed'].includes(value.status) || value.version !== 1 || !hashPattern.test(value.pcztSha256) || !hashPattern.test(value.binding) || !Number.isFinite(Date.parse(value.inspectedAt)) || (value.status === 'confirmed' && !Number.isFinite(Date.parse(value.confirmedAt)))) throw Error('Invalid saved memo review.');
  for (const role of ['recipient','change']) if (!hashPattern.test(value[role]?.sha256) || !['empty','text','binary','unsupported','invalid-text'].includes(value[role].format) || typeof value[role].unsafeText !== 'boolean') throw Error('Invalid memo descriptor.');
  const binding = await digest(new TextEncoder().encode(memoBindingTerms(review,value.pcztSha256,value.recipient.sha256,value.change.sha256)));
  if (binding !== value.binding) throw Error('Saved memo terms differ from this review.');
}
