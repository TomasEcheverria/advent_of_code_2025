const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarFranja, normalizarFecha } = require('../apps-script/Logic.js');

test('normalizarFranja turns a fraction of a day into HH:MM', () => {
  assert.equal(normalizarFranja('0.2361111111111111'), '05:40');
  assert.equal(normalizarFranja('0.7083333333333334'), '17:00');
  assert.equal(normalizarFranja('0.0'), '00:00');
  assert.equal(normalizarFranja('0'), '00:00');
  assert.equal(normalizarFranja('.5'), '12:00');
  assert.equal(normalizarFranja('0.99999'), '23:59');
  assert.equal(normalizarFranja('0.9999999999'), '23:59');
});

test('normalizarFranja keeps its H:MM, HH:MM and H:MM:SS behavior', () => {
  assert.equal(normalizarFranja('5:40'), '05:40');
  assert.equal(normalizarFranja('05:40'), '05:40');
  assert.equal(normalizarFranja('5:40:00'), '05:40');
  assert.equal(normalizarFranja('17:00'), '17:00');
});

test('normalizarFranja leaves anything else unchanged', () => {
  for (const x of ['', 'abc', '1.5', '2', '12345', '0.2.3', '-0.5', '05:4']) {
    assert.equal(normalizarFranja(x), x);
  }
});

test('normalizarFecha converts day serials to ISO with UTC arithmetic', () => {
  assert.equal(normalizarFecha('46328'), '2026-11-02');
  assert.equal(normalizarFecha('46327'), '2026-11-01');
  assert.equal(normalizarFecha('36526'), '2000-01-01');
  assert.match(normalizarFecha('30000'), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(normalizarFecha('60000'), /^\d{4}-\d{2}-\d{2}$/);
});

test('normalizarFecha leaves ISO dates and everything else unchanged', () => {
  for (const x of ['2026-11-02', '', 'abc', '29999', '60001', '1234', '123456', '4632.8', '46328 ', '5:40']) {
    assert.equal(normalizarFecha(x), x);
  }
});
