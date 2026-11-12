import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateEffects } from './payment-effects.mjs';
import { decodeMemo, memoBindingTerms } from '../web/public/zcash-memos.js';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[0-9a-f]{64}$/;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
export function publicMemos(review) {
  const value = review.memos;
  if (!value || value.status === 'unreviewed') return {status:'unreviewed'};
  if (['checking','unavailable'].includes(value.status)) return timestamp(value.checkedAt)?{status:value.status,checkedAt:value.checkedAt}:{status:'unreviewed'};
  if (value.version !== 1 || !['inspected','confirmed'].includes(value.status) || value.pcztSha256 !== review.sha256 || !hashPattern.test(value.binding) || !timestamp(value.inspectedAt) || (value.status === 'confirmed' && !timestamp(value.confirmedAt))) return {status:'unreviewed'};
  const descriptor = {};
  for (const role of ['recipient','change']) {
    const memo = value[role];
    if (!hashPattern.test(memo?.sha256) || !['empty','text','binary','unsupported','invalid-text'].includes(memo.format) || typeof memo.unsafeText !== 'boolean') return {status:'unreviewed'};
    descriptor[role] = {sha256:memo.sha256,format:memo.format,unsafeText:memo.unsafeText};
  }
  if (sha(memoBindingTerms(review,value.pcztSha256,descriptor.recipient.sha256,descriptor.change.sha256)) !== value.binding) return {status:'unreviewed'};
  return {version:1,status:value.status,pcztSha256:value.pcztSha256,binding:value.binding,...descriptor,inspectedAt:value.inspectedAt,...(value.status === 'confirmed'?{confirmedAt:value.confirmedAt}:{})};
}
export function validateMemos(value, review) {
  validateEffects(value, review);
  assert.equal(value.pcztSha256, review.sha256, 'Inspected transaction differs from the saved review');
  assert.match(value.pcztSha256,/^[0-9a-f]{64}$/);
  const recipient = decodeMemo(value.memos?.recipient?.hex), change = decodeMemo(value.memos?.change?.hex);
  const describe = memo => ({sha256:sha(Buffer.from(memo.hex,'hex')),format:memo.format,unsafeText:memo.unsafeText});
  const descriptor = {version:1,pcztSha256:value.pcztSha256,recipient:describe(recipient),change:describe(change)};
  descriptor.binding = sha(memoBindingTerms(review,descriptor.pcztSha256,descriptor.recipient.sha256,descriptor.change.sha256));
  return { descriptor, inspection:{pcztSha256:descriptor.pcztSha256,binding:descriptor.binding,recipient,change} };
}
