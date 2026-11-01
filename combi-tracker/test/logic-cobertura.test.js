const test = require('node:test');
const assert = require('node:assert/strict');
const { formulasCobertura } = require('../apps-script/Logic.js');

test('formulasCobertura', () => {
  const f = formulasCobertura(94);
  assert.deepEqual(Object.keys(f), ['A2', 'B2', 'C2', 'D2', 'E2']);
  for (const v of Object.values(f)) assert.ok(v.startsWith('='));
  assert.equal(f.A2, '=SORT(UNIQUE(IFERROR(FILTER(mediciones!B2:B,mediciones!B2:B<>""),"")),1,FALSE)');
  assert.equal(f.B2, '=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(mediciones!B2:B,A2:A,mediciones!E2:E,"ida",mediciones!O2:O,"")))');
  assert.equal(f.C2, f.B2.replace('"ida"', '"vuelta"'));
  assert.equal(f.D2, '=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(mediciones!B2:B,A2:A,mediciones!O2:O,"<>")))');
  assert.equal(f.E2, '=ARRAYFORMULA(IF(A2:A="",,(B2:B+C2:C)/94))');
});
