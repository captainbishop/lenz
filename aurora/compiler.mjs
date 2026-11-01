import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import solc from 'solc';

export function compileSource(name, source, contract) {
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources: { [name]: { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
  })));
  const errors = (output.errors ?? []).filter(error => error.severity === 'error');
  assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
  const compiled = output.contracts?.[name]?.[contract];
  assert(compiled?.evm.bytecode.object, `Missing deployable contract: ${contract}`);
  return compiled;
}

export async function compileContract(name, contract) {
  const source = await readFile(new URL(`./contracts/${name}`, import.meta.url), 'utf8');
  return compileSource(name, source, contract);
}
