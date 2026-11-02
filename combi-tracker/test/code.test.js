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
  ORIGEN_CABA_VUELTA: '-34.00,-58.00',
};
const okResp = {
  codigo: 200,
  cuerpo: JSON.stringify({ routes: [{ summary: { travelTimeInSeconds: 3600, lengthInMeters: 60000 } }] }),
};

const textoEn = (hoja, rango) => hoja.formatos.filter((f) => f.rango === rango).map((f) => f.formato);

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
  assert.ok(s.fetches[1].includes('-34.00,-58.00:-34.9,-57.9'));
  // P6/P7: lock pedido sin espera y liberado una sola vez.
  assert.deepEqual(s.lock.intentos, [0, 0]);
  assert.equal(s.lock.liberaciones, 2);
  assert.ok(rows.every((f) => !JSON.stringify(f).includes('APIKEY123')));
});

test('tick takes the lock with tryLock(0) and releases it exactly once', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  s.ctx.setup(); s.ctx.tick();
  assert.deepEqual(s.lock.intentos, [0]);
  assert.equal(s.lock.liberaciones, 1);
});

test('setup leaves fecha/franja as text (@) on mediciones B:B and D:D and viajes B:B', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  assert.deepEqual(textoEn(s.objetos.mediciones, 'B:B'), ['@']);
  assert.deepEqual(textoEn(s.objetos.mediciones, 'D:D'), ['@']);
  assert.deepEqual(textoEn(s.objetos.viajes, 'B:B'), ['@']);
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
  assert.equal(rows[0][14], 'Tope diario de consultas alcanzado (1000)');
  assert.deepEqual(s.lock.intentos, [0, 0]);
  assert.equal(s.lock.liberaciones, 2);
});

test('counter at 999: exactly one fetch, the other direction gets a cap error row', () => {
  const s = crearSandbox({
    ahora: TUE_1701, props: Object.assign({}, P, { CONSULTAS: '2026-11-03|999' }), respuestas: [okResp, okResp],
  });
  s.ctx.setup(); s.ctx.tick();
  assert.equal(s.fetches.length, 1);
  const rows = s.hojas.mediciones.slice(1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][4], 'ida'); assert.equal(rows[0][5], 3600);
  assert.equal(rows[1][4], 'vuelta'); assert.equal(rows[1][5], '');
  assert.equal(rows[1][14], 'Tope diario de consultas alcanzado (1000)');
  assert.equal(s.props.CONSULTAS, '2026-11-03|1000');
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
  assert.equal(s.hojas.cobertura.length, 1);
});

test('setup keeps other triggers and replaces stale tick triggers', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.ScriptApp.newTrigger('otra').timeBased().everyMinutes(1).create();
  s.ctx.ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  s.ctx.setup();
  assert.deepEqual(s.triggers.map((t) => t.getHandlerFunction()).sort(), ['otra', 'tick']);
});

test('missing mediciones sheet: tick throws before any fetch or counter change', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  assert.throws(() => s.ctx.tick(), /Falta la hoja 'mediciones': corré setup\(\)/);
  assert.equal(s.fetches.length, 0);
  assert.equal(s.props.CONSULTAS, undefined);
  assert.equal(s.props.ULTIMA_FRANJA_MEDIDA, undefined);
  assert.equal(s.lock.liberaciones, 1);
});

test('tick adds rows and re-applies text format when fewer than 5 free rows remain', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  s.ctx.setup();
  const hoja = s.objetos.mediciones;
  while (s.hojas.mediciones.length < 996) s.hojas.mediciones.push([]);
  assert.equal(hoja.getMaxRows(), 1000);
  const antesB = textoEn(hoja, 'B:B').length;
  const antesD = textoEn(hoja, 'D:D').length;
  s.ctx.tick();
  assert.deepEqual(hoja.insertadas, [{ despuesDe: 1000, cantidad: 1000 }]);
  assert.equal(hoja.getMaxRows(), 2000);
  assert.equal(textoEn(hoja, 'B:B').length, antesB + 1);
  assert.equal(textoEn(hoja, 'D:D').length, antesD + 1);
  assert.equal(s.fetches.length, 2);
});

test('tick does not add rows while 5 or more are free', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  s.ctx.setup();
  while (s.hojas.mediciones.length < 995) s.hojas.mediciones.push([]);
  s.ctx.tick();
  assert.deepEqual(s.objetos.mediciones.insertadas, []);
});

test('probarAhora: one ida and one vuelta row on a Sunday, counts, does not mark the slot', () => {
  const dom = new Date('2026-11-08T13:07:00Z'); // domingo 10:07 local
  const s = crearSandbox({ ahora: dom, props: P, respuestas: [okResp, okResp] });
  s.ctx.setup();
  s.ctx.probarAhora();
  const rows = s.hojas.mediciones.slice(1);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r[4]), ['ida', 'vuelta']);
  assert.equal(rows[0][3], '10:00'); assert.equal(rows[0][2], 7);
  assert.equal(rows[0][5], 3600);
  assert.equal(s.fetches.length, 2);
  assert.equal(s.props.CONSULTAS, '2026-11-08|2');
  assert.equal(s.props.ULTIMA_FRANJA_MEDIDA, undefined);
  assert.deepEqual(s.lock.intentos, []);
  assert.ok(!JSON.stringify(rows).includes('APIKEY123'));
  assert.ok(s.fetches.every((u) => u.includes('key=APIKEY123')));
});

test('probarAhora: error rows keep the key out, missing sheet or bad config throws', () => {
  const boom = new Error('fallo https://api.tomtom.com/x?key=APIKEY123');
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [boom, okResp] });
  s.ctx.setup(); s.ctx.probarAhora();
  const rows = s.hojas.mediciones.slice(1);
  assert.ok(!JSON.stringify(rows).includes('APIKEY123'));
  assert.equal(rows[1][5], 3600);

  const sinHoja = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  assert.throws(() => sinHoja.ctx.probarAhora(), /Falta la hoja 'mediciones'/);
  assert.equal(sinHoja.fetches.length, 0);

  const mala = crearSandbox({ ahora: TUE_1701, props: Object.assign({}, P, { ORIGEN_LA_PLATA: 'x' }), respuestas: [okResp, okResp] });
  mala.ctx.setup();
  assert.throws(() => mala.ctx.probarAhora(), /ORIGEN_LA_PLATA/);
  assert.equal(mala.fetches.length, 0);
});

test('registrarViaje writes the header row when viajes is new or empty', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.registrarViaje('baje', 'ida'); // sin setup: la hoja se crea al vuelo
  assert.deepEqual(s.hojas.viajes[0], [...s.ctx.COLUMNAS_VIAJES]);
  assert.equal(s.hojas.viajes.length, 2);
  assert.equal(s.hojas.viajes[1][2], 'baje');
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
  // Sin doble toque: los botones se deshabilitan hasta que vuelve el handler.
  assert.ok(html.includes('.disabled = '));
  assert.ok(html.includes('botones(true)'));
  assert.ok(html.includes('botones(false)'));
  assert.equal((html.match(/<button /g) || []).length, 4);
});
