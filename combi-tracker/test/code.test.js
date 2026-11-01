const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { crearSandbox } = require('./helpers/sandbox.js');

const TUE_1701 = new Date('2026-11-03T20:01:12Z'); // martes 17:01 local
const P = {
  TOMTOM_API_KEY: 'APIKEY123',
  ORIGEN_LA_PLATA: '-34.9,-57.9',
  DESTINO_CABA_IDA: '-34.6,-58.3',
  ORIGEN_CABA_VUELTA: '-34.61,-58.38',
};
const okResp = {
  codigo: 200,
  cuerpo: JSON.stringify({ routes: [{ summary: { travelTimeInSeconds: 3600, lengthInMeters: 60000 } }] }),
};

test('tick measures both directions once per slot', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  s.ctx.setup(); s.ctx.tick(); s.ctx.tick();
  const rows = s.hojas.mediciones.slice(1);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r[4]), ['ida', 'vuelta']);
  assert.equal(rows[0][3], '17:00'); assert.equal(rows[0][2], 2);
  assert.equal(rows[0][1], '2026-11-03');
  assert.equal(rows[0][0], '2026-11-03T17:01:12-03:00');
  assert.equal(rows[0][5], 3600);
  assert.equal(s.fetches.length, 2);
  assert.equal(s.props.ULTIMA_FRANJA_MEDIDA, '2026-11-03 17:00');
  assert.equal(s.props.CONSULTAS, '2026-11-03|2');
  assert.ok(s.fetches[0].includes('-34.9,-57.9:-34.6,-58.3'));
  assert.ok(s.fetches[1].includes('-34.61,-58.38:-34.9,-57.9'));
});

test('same HH:MM yesterday does not block today', () => {
  const s = crearSandbox({
    ahora: TUE_1701,
    props: Object.assign({ ULTIMA_FRANJA_MEDIDA: '2026-11-02 17:00' }, P),
    respuestas: [okResp, okResp],
  });
  s.ctx.setup(); s.ctx.tick();
  assert.equal(s.hojas.mediciones.slice(1).length, 2);
  assert.equal(s.fetches.length, 2);
});

test('outside window or weekend: no fetch', () => {
  for (const ahora of [new Date('2026-11-03T08:39:00Z'), new Date('2026-11-07T10:00:00Z')]) {
    // 05:39 local martes; sábado 07:00 local
    const s = crearSandbox({ ahora, props: P, respuestas: [okResp, okResp] });
    s.ctx.setup(); s.ctx.tick();
    assert.equal(s.fetches.length, 0);
    assert.equal(s.hojas.mediciones.slice(1).length, 0);
  }
});

test('invalid config: one error row naming props, no fetch', () => {
  const s = crearSandbox({
    ahora: TUE_1701, props: Object.assign({}, P, { ORIGEN_LA_PLATA: 'abc' }), respuestas: [okResp, okResp],
  });
  s.ctx.setup(); s.ctx.tick(); s.ctx.tick();
  const rows = s.hojas.mediciones.slice(1);
  assert.equal(rows.length, 1);
  assert.ok(rows[0][14].includes('ORIGEN_LA_PLATA'));
  assert.ok(rows[0][14].startsWith('Faltan o son inválidas: '));
  assert.equal(rows[0][4], '');
  assert.equal(s.fetches.length, 0);
});

test('daily cap reached: one error row, no fetch', () => {
  const s = crearSandbox({
    ahora: TUE_1701, props: Object.assign({}, P, { CONSULTAS: '2026-11-03|1000' }), respuestas: [okResp, okResp],
  });
  s.ctx.setup(); s.ctx.tick(); s.ctx.tick();
  const rows = s.hojas.mediciones.slice(1);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0][14], '');
  assert.equal(rows[0][4], '');
  assert.equal(s.fetches.length, 0);
  assert.equal(s.props.ULTIMA_FRANJA_MEDIDA, '2026-11-03 17:00');
});

test('fetch throws: error row without key', () => {
  const boom = new Error('Address unavailable: https://api.tomtom.com/x?key=APIKEY123&traffic=true');
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [boom, okResp] });
  s.ctx.setup(); s.ctx.tick();
  const rows = s.hojas.mediciones.slice(1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][4], 'ida');
  assert.ok(rows[0][14].includes('***'));
  assert.ok(!rows[0][14].includes('APIKEY123'));
  assert.equal(rows[0][5], '');
  assert.equal(rows[1][4], 'vuelta');
  assert.equal(rows[1][5], 3600);
  assert.equal(rows[1][14], '');
});

test('lock busy: nothing happens', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp], lockLibre: false });
  s.ctx.setup(); s.ctx.tick();
  assert.equal(s.fetches.length, 0);
  assert.equal(s.hojas.mediciones.slice(1).length, 0);
  assert.equal(s.props.ULTIMA_FRANJA_MEDIDA, undefined);
});

test('setup is idempotent', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup(); s.ctx.setup();
  const ticks = s.triggers.filter((t) => t.getHandlerFunction() === 'tick');
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].minutos, 5);
  assert.equal(s.hojas.mediciones.length, 1);
  assert.equal(s.hojas.viajes.length, 1);
  assert.deepEqual(s.hojas.mediciones[0], [...s.ctx.COLUMNAS_MEDICIONES]);
  assert.deepEqual(s.hojas.viajes[0], [...s.ctx.COLUMNAS_VIAJES]);
  assert.deepEqual(s.hojas.cobertura[0], [...s.ctx.COLUMNAS_COBERTURA]);
  assert.ok(s.hojas.cobertura[1][4].includes('/94'));
  assert.ok(s.hojas.cobertura[1][0].startsWith('=SORT('));
});

test('setup keeps other triggers and replaces stale tick triggers', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.ScriptApp.newTrigger('otra').timeBased().everyMinutes(1).create();
  s.ctx.ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  s.ctx.setup();
  assert.deepEqual(s.triggers.map((t) => t.getHandlerFunction()).sort(), ['otra', 'tick']);
});

test('registrarViaje', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  const msg = s.ctx.registrarViaje('subi', 'vuelta');
  assert.match(msg, /Registrado/);
  assert.equal(msg, 'Registrado: subi (vuelta) 17:01');
  const rows = s.hojas.viajes.slice(1);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ['2026-11-03T17:01:12-03:00', '2026-11-03', 'subi', 'vuelta']);
  assert.throws(() => s.ctx.registrarViaje('x', 'ida'), /Viaje inválido/);
  assert.throws(() => s.ctx.registrarViaje('subi', 'otro'), /Viaje inválido/);
  assert.equal(s.hojas.viajes.length, 2);
});

test('doGet serves the phone page', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  const out = s.ctx.doGet({});
  assert.equal(out.html, 'Viajes');
  assert.equal(out.titulo, 'Combi');
  assert.deepEqual(out.metas, [['viewport', 'width=device-width, initial-scale=1']]);
});

test('Viajes.html has the four buttons wired to registrarViaje', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Viajes.html'), 'utf8');
  for (const t of ['Subí (ida)', 'Bajé (ida)', 'Subí (vuelta)', 'Bajé (vuelta)']) assert.ok(html.includes(t), t);
  assert.ok(html.includes('google.script.run'));
  assert.ok(html.includes('registrarViaje'));
  assert.ok(html.includes('name="viewport"'));
});
