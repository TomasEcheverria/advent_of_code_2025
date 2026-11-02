const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../apps-script/Logic.js');
const { normalizarFranja, resumenCobertura } = L;

test('formulasCobertura no longer exists', () => {
  assert.equal(L.formulasCobertura, undefined);
});

test('normalizarFranja pads hours and drops seconds', () => {
  assert.equal(normalizarFranja('5:40'), '05:40');
  assert.equal(normalizarFranja('05:40'), '05:40');
  assert.equal(normalizarFranja('5:40:00'), '05:40');
  assert.equal(normalizarFranja('21:00'), '21:00');
});

test('normalizarFranja leaves anything else unchanged', () => {
  assert.equal(normalizarFranja('abc'), 'abc');
  assert.equal(normalizarFranja(''), '');
  assert.equal(normalizarFranja('5:4'), '5:4');
  assert.equal(normalizarFranja('123:40'), '123:40');
  assert.equal(normalizarFranja(' 5:40'), ' 5:40');
});

const f = (fecha, franja, sentido, error = '') => [fecha, franja, sentido, error];

test('resumenCobertura: empty input gives no rows', () => {
  assert.deepEqual(resumenCobertura([], 94), []);
});

test('resumenCobertura counts ok rows per direction and the coverage ratio', () => {
  const r = resumenCobertura([
    f('2026-11-03', '05:40', 'ida'), f('2026-11-03', '05:40', 'vuelta'),
    f('2026-11-03', '06:00', 'ida'),
  ], 94);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].slice(0, 4), ['2026-11-03', 2, 1, 0]);
  assert.equal(r[0][4], 3 / 94);
});

test('resumenCobertura: duplicates of the same franja count once', () => {
  const r = resumenCobertura([
    f('2026-11-03', '17:00', 'ida'), f('2026-11-03', '17:00', 'ida'),
    f('2026-11-03', '17:00', 'vuelta'), f('2026-11-03', '17:00', 'vuelta'),
    f('2026-11-03', '17:00', 'vuelta'),
  ], 94);
  assert.deepEqual(r[0].slice(0, 4), ['2026-11-03', 1, 1, 0]);
  assert.equal(r[0][4], 2 / 94);
});

test('resumenCobertura normalizes franja before deduplicating', () => {
  const r = resumenCobertura([
    f('2026-11-03', '5:40', 'ida'), f('2026-11-03', '05:40', 'ida'), f('2026-11-03', '5:40:00', 'ida'),
  ], 94);
  assert.deepEqual(r[0].slice(0, 4), ['2026-11-03', 1, 0, 0]);
});

test('resumenCobertura: error rows are excluded from ok and counted in errores', () => {
  const r = resumenCobertura([
    f('2026-11-03', '17:00', 'ida', 'HTTP 500'),
    f('2026-11-03', '17:00', 'vuelta'),
    f('2026-11-03', '17:20', 'ida', 'Sin rutas'),
    f('2026-11-03', '17:20', 'ida'),
    f('2026-11-03', '17:40', '', 'Faltan o son inválidas: X'),
  ], 94);
  assert.deepEqual(r[0].slice(0, 4), ['2026-11-03', 1, 1, 3]);
  assert.equal(r[0][4], 2 / 94);
});

test('resumenCobertura: dates sorted descending, each with its own counts', () => {
  const r = resumenCobertura([
    f('2026-11-02', '17:00', 'ida'),
    f('2026-11-04', '17:00', 'ida'), f('2026-11-04', '17:00', 'vuelta'),
    f('2026-11-03', '17:00', 'vuelta', 'x'),
  ], 94);
  assert.deepEqual(r.map((x) => x[0]), ['2026-11-04', '2026-11-03', '2026-11-02']);
  assert.deepEqual(r.map((x) => x.slice(1, 4)), [[1, 1, 0], [0, 0, 1], [1, 0, 0]]);
});

test('resumenCobertura skips rows with an empty fecha', () => {
  const r = resumenCobertura([f('', '17:00', 'ida'), f(undefined, '17:00', 'ida'), f(null, '17:00', 'vuelta')], 94);
  assert.deepEqual(r, []);
});

test('resumenCobertura: 47 distinct franjas in both directions over 94 expected = 1', () => {
  const franjas = L.franjasDelDia('05:40', '21:00', 20);
  assert.equal(franjas.length, 47);
  const filas = [];
  franjas.forEach((fr) => { filas.push(f('2026-11-03', fr, 'ida'), f('2026-11-03', fr, 'vuelta')); });
  const r = resumenCobertura(filas, 94);
  assert.deepEqual(r, [['2026-11-03', 47, 47, 0, 1]]);
});

test('resumenCobertura does not cap coverage above 1', () => {
  const r = resumenCobertura([f('2026-11-03', '17:00', 'ida'), f('2026-11-03', '17:20', 'ida')], 1);
  assert.equal(r[0][4], 2);
});
