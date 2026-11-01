const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarCoordenada, validarConfig, leerContador, escribirContador, claveFranja, validarViaje,
} = require('../apps-script/Logic.js');

const P = { TOMTOM_API_KEY: 'K', ORIGEN_LA_PLATA: '-34.9, -57.9', DESTINO_CABA_IDA: '-34.6,-58.3', ORIGEN_CABA_VUELTA: '-34.00,-58.00' };

test('normalizarCoordenada', () => {
  assert.equal(normalizarCoordenada(' -34.9 , -57.9 '), '-34.9,-57.9');
  for (const bad of ['abc', '-34.9', '-95,-57', '-34,-190', '', null]) assert.equal(normalizarCoordenada(bad), null);
});

test('normalizarCoordenada rejects extra parts, empty parts, NaN, Infinity, non-strings', () => {
  for (const bad of ['1,2,3', '1,', ',1', ',', 'NaN,1', '1,NaN', 'Infinity,1', '1,-Infinity', '1e1,2', '+1,2', '1.,2', undefined, 5, {}]) {
    assert.equal(normalizarCoordenada(bad), null, String(bad));
  }
  assert.equal(normalizarCoordenada('90,180'), '90,180');
  assert.equal(normalizarCoordenada('-90,-180'), '-90,-180');
  assert.equal(normalizarCoordenada('0,0'), '0,0');
});

test('validarConfig ok builds routes', () => {
  const c = validarConfig(P);
  assert.equal(c.ok, true);
  assert.equal(c.apiKey, 'K');
  assert.deepEqual(c.faltantes, []);
  assert.deepEqual(c.rutas.ida, { origen: '-34.9,-57.9', destino: '-34.6,-58.3' });
  assert.deepEqual(c.rutas.vuelta, { origen: '-34.00,-58.00', destino: '-34.9,-57.9' });
});

test('validarConfig lists missing and invalid', () => {
  const c = validarConfig({ ...P, TOMTOM_API_KEY: '', DESTINO_CABA_IDA: 'x' });
  assert.equal(c.ok, false);
  assert.deepEqual(c.faltantes.sort(), ['DESTINO_CABA_IDA', 'TOMTOM_API_KEY']);
});

test('validarConfig keeps declaration order, trims key, fills rutas with nulls', () => {
  const c = validarConfig({ TOMTOM_API_KEY: '  abc  ', ORIGEN_CABA_VUELTA: 'zz' });
  assert.equal(c.ok, false);
  assert.equal(c.apiKey, 'abc');
  assert.deepEqual(c.faltantes, ['ORIGEN_LA_PLATA', 'DESTINO_CABA_IDA', 'ORIGEN_CABA_VUELTA']);
  assert.deepEqual(c.rutas.ida, { origen: null, destino: null });
  assert.deepEqual(c.rutas.vuelta, { origen: null, destino: null });
  const d = validarConfig({});
  assert.equal(d.apiKey, '');
  assert.deepEqual(d.faltantes, ['TOMTOM_API_KEY', 'ORIGEN_LA_PLATA', 'DESTINO_CABA_IDA', 'ORIGEN_CABA_VUELTA']);
  const e = validarConfig({ ...P, DESTINO_CABA_IDA: 'x' });
  assert.deepEqual(e.rutas.ida, { origen: '-34.9,-57.9', destino: null });
  assert.deepEqual(e.rutas.vuelta, { origen: '-34.00,-58.00', destino: '-34.9,-57.9' });
});

test('contador resets on new day', () => {
  assert.equal(leerContador(null, '2026-11-03'), 0);
  assert.equal(leerContador('2026-11-02|57', '2026-11-03'), 0);
  assert.equal(leerContador(escribirContador('2026-11-03', 12), '2026-11-03'), 12);
});

test('contador format and malformed values', () => {
  assert.equal(escribirContador('2026-11-03', 12), '2026-11-03|12');
  for (const bad of ['', '2026-11-03', '2026-11-03|', '2026-11-03|x', '2026-11-03|1.5', '2026-11-03|-3', '2026-11-03|1|2', undefined]) {
    assert.equal(leerContador(bad, '2026-11-03'), 0, String(bad));
  }
});

test('claveFranja includes date', () => {
  assert.notEqual(claveFranja('2026-11-02', '17:00'), claveFranja('2026-11-03', '17:00'));
  assert.equal(claveFranja('2026-11-02', '17:00'), '2026-11-02 17:00');
});

test('validarViaje', () => {
  assert.equal(validarViaje('subi', 'ida'), true);
  assert.equal(validarViaje('baje', 'vuelta'), true);
  assert.equal(validarViaje('otro', 'ida'), false);
  assert.equal(validarViaje('subi', 'x'), false);
  assert.equal(validarViaje('baje', 'ida'), true);
  assert.equal(validarViaje('subi', 'vuelta'), true);
  assert.equal(validarViaje(undefined, 'ida'), false);
  assert.equal(validarViaje('subi', null), false);
});
