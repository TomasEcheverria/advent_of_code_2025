const test = require('node:test');
const assert = require('node:assert/strict');
const { franjaPara, debeMedir, franjasDelDia } = require('../apps-script/Logic.js');
const C = require('../apps-script/Config.js');

test('franjaPara floors to interval', () => {
  assert.equal(franjaPara(17, 0, 20), '17:00');
  assert.equal(franjaPara(17, 19, 20), '17:00');
  assert.equal(franjaPara(17, 20, 20), '17:20');
  assert.equal(franjaPara(5, 39, 20), '05:20');
  assert.equal(franjaPara(0, 0, 20), '00:00');
});

test('debeMedir window edges', () => {
  const m = (d, f) => debeMedir(d, f, C.PRIMERA_FRANJA, C.ULTIMA_FRANJA);
  assert.equal(m(1, '05:20'), false);
  assert.equal(m(1, '05:40'), true);
  assert.equal(m(5, '21:00'), true);
  assert.equal(m(5, '21:20'), false);
  assert.equal(m(6, '07:00'), false);
  assert.equal(m(7, '07:00'), false);
});

test('franjasDelDia gives 47 slots', () => {
  const f = franjasDelDia(C.PRIMERA_FRANJA, C.ULTIMA_FRANJA, C.INTERVALO_MIN);
  assert.equal(f.length, 47);
  assert.equal(f[0], '05:40');
  assert.equal(f[46], '21:00');
});

test('config sanity', () => {
  assert.equal(C.COLUMNAS_MEDICIONES.length, 15);
  assert.equal(C.HORARIOS_COMBI.ida.length, 19);
  assert.equal(C.HORARIOS_COMBI.vuelta.length, 20);
});
