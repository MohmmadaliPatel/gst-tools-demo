import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gstinCheckChar, validateGstin, validatePan, makeGstin, round2 } from '../js/gst.js';

test('GSTIN check character matches the published example GSTIN', () => {
  // 27AAPFU0939F1ZV is the sample GSTIN used in GSTN/CBIC public documentation.
  assert.equal(gstinCheckChar('27AAPFU0939F1Z'), 'V');
  assert.equal(validateGstin('27AAPFU0939F1ZV').valid, true);
});
test('GSTIN checksum failure is reported with the expected character', () => {
  const r = validateGstin('27AAPFU0939F1ZA');
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /should be "V"/);
});
test('GSTIN: lowercase / spaces are normalised', () => {
  assert.equal(validateGstin(' 27aapfu0939f1zv ').valid, true);
});
test('GSTIN: bad state code, bad length, bad format', () => {
  assert.match(validateGstin(makeGstin('99', 'AAPFU0939F')).errors.join(), /state code/);
  assert.match(validateGstin('27AAPFU0939F1Z').errors.join(), /15 characters/);
  assert.match(validateGstin('27AAPFU0939F1XV').errors.join(), /format/);
});
test('makeGstin always produces checksum-valid GSTINs', () => {
  for (const [st, pan] of [['29', 'AAHCD4444R'], ['07', 'AALPZ7777H'], ['33', 'AAKCF6666N']]) {
    assert.equal(validateGstin(makeGstin(st, pan)).valid, true);
  }
});
test('PAN validation', () => {
  assert.equal(validatePan('AAPFU0939F'), true);
  assert.equal(validatePan('AAPXU0939F'), false); // 4th char must be a valid holder type
  assert.equal(validatePan('AAPF0939F'), false);
});
test('round2 rounds half away from zero without float drift', () => {
  assert.equal(round2(2294.995), 2295);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
});
