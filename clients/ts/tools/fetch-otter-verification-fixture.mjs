// Read-only, hash-pinned SBF fixture. Never signs, submits, or logs RPC credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const endpoint = process.env.AMOEBA_TEST_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const expected = 'b501789b71bb383556f7c1cc7a01e51ae9bb4111bf14e4dec9f09b18e506307a';
async function rpc(method, params = []) {
  const response = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
  assert(response.ok, `fixture RPC HTTP ${response.status}`);
  const result = await response.json();assert(!result.error, 'fixture RPC error');return result.result;
}
try {
  assert(endpoint.startsWith('https://'));assert(process.argv[2], 'output path required');
  assert.equal(await rpc('getGenesisHash'), '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
  const result = await rpc('getAccountInfo', ['GfDVhTJnKy42h1MojVP5r7qYVNU3gCXbq6vMcHQCSJwJ',{encoding:'base64',commitment:'finalized'}]);
  assert.equal(result.value?.owner, 'BPFLoaderUpgradeab1e11111111111111111111111');
  const data = Buffer.from(result.value.data[0], 'base64');assert.equal(data.readUInt32LE(0), 3);assert.equal(data.readBigUInt64LE(4),294017967n);
  const elf = data.subarray(45);assert.equal(createHash('sha256').update(elf).digest('hex'), expected, 'Otter fixture changed: review required');
  await writeFile(process.argv[2],elf);console.log(`Otter fixture ${elf.length} bytes SHA256 ${expected}`);
} catch { console.error('Pinned Otter fixture fetch failed; no unverified fixture was accepted.');process.exitCode=1; }
