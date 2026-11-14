import test from 'node:test';
import assert from 'node:assert/strict';
import {createLendingService} from './intent-lending-service.mjs';

test('unconfigured lending stays unavailable without opening a signer or network', async () => {
  const service = createLendingService();
  const config = await service.configuration();
  assert.equal(config.available, false);
  assert.equal(config.execute, false);
  await assert.rejects(service.prepare({}), /unavailable/i);
});
