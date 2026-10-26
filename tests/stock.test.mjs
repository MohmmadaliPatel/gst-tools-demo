import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMaster, normalizeMoves, computeStock, reconcileChannels, sizeColourMatrix, daySummary, normSku } from '../js/stock.js';

const master = normalizeMaster([
  { SKU: 'ts-blk-m', Name: 'Tee', Size: 'M', Colour: 'Black', Reorder: '5', Opening: '10' },
  { SKU: 'TS-BLK-L', Name: 'Tee', Size: 'L', Colour: 'Black', Reorder: '5', Opening: '2' },
  { SKU: 'TS-WHT-M', Name: 'Tee', Size: 'M', Colour: 'White', Reorder: '3', Opening: '0' },
]);
const moves = normalizeMoves([
  { date: '2026-10-25', sku: 'TS-BLK-M', type: 'in', qty: '12' },
  { date: '2026-10-26', sku: 'TS-BLK-M', type: 'OUT', qty: '9', channel: 'Shopify' },
  { date: '2026-10-26', sku: 'TS-BLK-M', type: 'RETURN', qty: '1', channel: 'Amazon' },
  { date: '2026-10-26', sku: 'TS-BLK-M', type: 'DAMAGED', qty: '2' },
  { date: '2026-10-26', sku: 'TS-BLK-L', type: 'OUT', qty: '1', channel: 'Amazon' },
  { date: '2026-10-26', sku: 'TS-WHT-M', type: 'OUT', qty: '1', channel: 'Shopify' },
  { date: '2026-10-27', sku: 'TS-BLK-L', type: 'IN', qty: '50' },
  { date: '2026-10-26', sku: 'ts red m', type: 'OUT', qty: '1' },
]);

test('SKUs are normalised (case, spaces)', () => { assert.equal(normSku(' ts red m '), 'TS-RED-M'); assert.equal(master[0].sku, 'TS-BLK-M'); });
test('unknown movement type is a clear error', () => assert.throws(() => normalizeMoves([{ sku: 'A', type: 'SOLD', qty: 1 }]), /Row 2: unknown movement type "SOLD"/));
test('available = opening + in - out + returns - damaged; as-of date excludes future rows', () => {
  const s = computeStock(master, moves, '2026-10-26');
  const by = Object.fromEntries(s.map((x) => [x.sku, x]));
  assert.equal(by['TS-BLK-M'].available, 12); assert.equal(by['TS-BLK-M'].status, 'OK');
  assert.equal(by['TS-BLK-L'].available, 1); assert.equal(by['TS-BLK-L'].status, 'Low');
  assert.equal(by['TS-WHT-M'].available, -1); assert.equal(by['TS-WHT-M'].status, 'Out');
  assert.equal(by['TS-RED-M'].unknown, true);
  assert.equal(computeStock(master, moves).find((x) => x.sku === 'TS-BLK-L').available, 51);
});
test('channel reconciliation flags oversell risk first, then under-listing and unmapped SKUs', () => {
  const s = computeStock(master, moves, '2026-10-26');
  const r = reconcileChannels(s, [{ sku: 'TS-BLK-M', qty: '12' }, { sku: 'ts-blk-l', qty: '4' }, { sku: 'TS-WHT-M', qty: '0' }, { 'Variant SKU': 'TS-BLK-S', Inventory: '3' }, { sku: 'TS-BLK-M', qty: '10', channel: 'Amazon' }]);
  assert.deepEqual(r.map((x) => [x.sku, x.status]), [['TS-BLK-L', 'Oversell-risk'], ['TS-BLK-M', 'Mismatch-qty'], ['TS-BLK-S', 'Not-listed']]);
  assert.equal(r[0].diff, 3); assert.equal(r[1].diff, -2);
});
test('size x colour grid and day summary', () => {
  const s = computeStock(master, moves, '2026-10-26');
  const m = sizeColourMatrix(s, 'Tee');
  assert.deepEqual(m.sizes, ['M', 'L']); assert.equal(m.cell('M', 'White'), -1); assert.equal(m.cell('L', 'White'), null);
  const d = daySummary(moves, '2026-10-26');
  assert.equal(d.outward, 12); assert.equal(d.returns, 1); assert.equal(d.damaged, 2); assert.equal(d.byChannel.Shopify, 10);
});
