import assert from 'node:assert/strict';
import {MAX_ENGINE_BYTES} from './engine-codec.mjs';

export class EngineViewError extends Error {}
const missingToken = 'wasm execution failed with error: HostError(GuestPanic { panic_msg: "ERR_NEP141_NOT_FOUND" })';
export const isMissingToken = error => error instanceof EngineViewError && error.message === missingToken;

export function decodeEngineQuery(result, block) {
  assert(result && !Array.isArray(result) && result.block_hash === block.hash &&
    result.block_height === block.height, 'Engine query returned a different block.');
  if (Object.hasOwn(result, 'error')) {
    assert(!Object.hasOwn(result, 'result') && typeof result.error === 'string' &&
      result.error.length > 0 && result.error.length <= 1024, 'Malformed Engine query error.');
    throw new EngineViewError(result.error);
  }
  assert(Array.isArray(result.result) && result.result.length <= MAX_ENGINE_BYTES &&
    result.result.every(n => Number.isInteger(n) && n >= 0 && n <= 255), 'Invalid Engine query bytes.');
  return Buffer.from(result.result);
}
