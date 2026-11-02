const test = require('node:test');
const assert = require('node:assert/strict');
const { crearSandbox } = require('./helpers/sandbox.js');

const TUE_1701 = new Date('2026-11-03T20:01:12Z'); // martes 17:01 local, franja 17:00
const TUE_0541 = new Date('2026-11-03T08:41:30Z'); // martes 05:41 local, franja 05:40
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

// Fila de 15 columnas de mediciones con solo lo que interesa.
function fila(fecha, franja, sentido, error = '') {
  const r = new Array(15).fill('');
  r[1] = fecha; r[3] = franja; r[4] = sentido; r[14] = error;
  return r;
}
const celdas = (hoja, col) => hoja.escrituras.filter((e) => e.col === col);

test('actualizarCobertura fills cobertura from mediciones, E as percent, and clears old content', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.hojas.mediciones.push(
    fila('2026-11-02', '17:00', 'ida'), fila('2026-11-02', '17:00', 'vuelta', 'HTTP 500'),
    fila('2026-11-03', '17:00', 'ida'), fila('2026-11-03', '17:00', 'ida'), fila('2026-11-03', '17:00', 'vuelta'),
  );
  // Restos de la versión con fórmulas: deben desaparecer.
  s.hojas.cobertura[1] = ['=SORT(UNIQUE(x))', '=ARRAYFORMULA(y)', '', '', '=z'];
  s.hojas.cobertura[7] = ['viejo', 1, 2, 3, 4];
  s.ctx.actualizarCobertura();
  assert.deepEqual(s.hojas.cobertura, [
    [...s.ctx.COLUMNAS_COBERTURA],
    ['2026-11-03', 1, 1, 0, 2 / 94],
    ['2026-11-02', 1, 0, 1, 1 / 94],
  ]);
  assert.ok(s.objetos.cobertura.formatos.some((x) => x.rango === 'E2:E' && x.formato === '0%'));
});

test('actualizarCobertura with no measurement rows leaves cobertura with the header only', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.hojas.cobertura[1] = ['stale', 1, 1, 1, 1];
  s.ctx.actualizarCobertura();
  assert.deepEqual(s.hojas.cobertura, [[...s.ctx.COLUMNAS_COBERTURA]]);
});

test('actualizarCobertura normalizes franja display values before deduplicating', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.hojas.mediciones.push(fila('2026-11-03', '5:40', 'ida'), fila('2026-11-03', '05:40', 'ida'));
  s.ctx.actualizarCobertura();
  assert.deepEqual(s.hojas.cobertura[1].slice(0, 4), ['2026-11-03', 1, 0, 0]);
});

test('actualizarCobertura throws a clear error when a sheet is missing', () => {
  const sinNada = crearSandbox({ ahora: TUE_1701, props: P });
  assert.throws(() => sinNada.ctx.actualizarCobertura(), /Falta la hoja 'mediciones'/);
  const sinCobertura = crearSandbox({ ahora: TUE_1701, props: P });
  sinCobertura.ctx.SpreadsheetApp.getActive().insertSheet('mediciones');
  assert.throws(() => sinCobertura.ctx.actualizarCobertura(), /Falta la hoja 'cobertura'/);
});

test('normalizarMediciones turns 5:40 into 05:40, sets @ on B and D, and is idempotent', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.hojas.mediciones.push(fila('2026-11-03', '5:40', 'ida'), fila('2026-11-03', '6:00', 'vuelta'), fila('2026-11-03', '17:00', 'ida'));
  s.ctx.normalizarMediciones();
  const franjas = () => s.hojas.mediciones.slice(1).map((r) => r[3]);
  assert.deepEqual(franjas(), ['05:40', '06:00', '17:00']);
  assert.deepEqual(s.hojas.mediciones.slice(1).map((r) => r[1]), ['2026-11-03', '2026-11-03', '2026-11-03']);
  const h = s.objetos.mediciones;
  assert.ok(celdas(h, 2).concat(celdas(h, 4)).filter((e) => e.fila >= 2).every((e) => e.formato === '@' && typeof e.valor === 'string'));
  const despues = JSON.stringify(s.hojas.mediciones);
  s.ctx.normalizarMediciones();
  assert.equal(JSON.stringify(s.hojas.mediciones), despues);
  assert.deepEqual(s.hojas.mediciones[1].slice(4), fila('', '', 'ida').slice(4));
});

test('normalizarMediciones keeps empty fecha empty and does nothing without data rows', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.ctx.normalizarMediciones();
  assert.equal(s.hojas.mediciones.length, 1);
  s.hojas.mediciones.push(fila('', '', ''));
  s.ctx.normalizarMediciones();
  assert.equal(s.hojas.mediciones[1][1], '');
  assert.equal(s.hojas.mediciones[1][3], '');
});

test('tick stores fecha and franja as text even if the column format was lost', () => {
  const s = crearSandbox({ ahora: TUE_0541, props: P, respuestas: [okResp, okResp] });
  // Hoja armada a mano, sin formato de columna: Sheets convertiría '05:40' en hora.
  const h = s.ctx.SpreadsheetApp.getActive().insertSheet('mediciones');
  h.appendRow([...s.ctx.COLUMNAS_MEDICIONES]);
  s.ctx.SpreadsheetApp.getActive().insertSheet('cobertura');
  s.ctx.tick();
  const rows = s.hojas.mediciones.slice(1);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r[3]), ['05:40', '05:40']);
  assert.deepEqual(rows.map((r) => r[1]), ['2026-11-03', '2026-11-03']);
  assert.deepEqual(rows.map((r) => r[4]), ['ida', 'vuelta']);
  for (const col of [2, 4]) {
    const e = celdas(h, col).filter((x) => x.fila >= 2);
    assert.equal(e.length, 2);
    assert.ok(e.every((x) => x.formato === '@' && typeof x.valor === 'string'), `col ${col}`);
  }
  assert.equal(s.props.CONSULTAS, '2026-11-03|2');
});

test('error rows (invalid config, daily cap) are also text-safe', () => {
  const mala = crearSandbox({
    ahora: TUE_0541, props: Object.assign({}, P, { ORIGEN_LA_PLATA: 'abc' }), respuestas: [okResp, okResp],
  });
  const tope = crearSandbox({
    ahora: TUE_0541, props: Object.assign({}, P, { CONSULTAS: '2026-11-03|1000' }), respuestas: [okResp, okResp],
  });
  for (const s of [mala, tope]) {
    const h = s.ctx.SpreadsheetApp.getActive().insertSheet('mediciones');
    h.appendRow([...s.ctx.COLUMNAS_MEDICIONES]);
    s.ctx.SpreadsheetApp.getActive().insertSheet('cobertura');
    s.ctx.tick();
    assert.equal(s.hojas.mediciones.length, 2);
    assert.equal(s.hojas.mediciones[1][3], '05:40');
    const e = celdas(h, 4).filter((x) => x.fila === 2);
    assert.equal(e.length, 1);
    assert.ok(e.every((x) => x.formato === '@' && x.valor === '05:40'));
  }
});

test('probarAhora stores fecha and franja as text, one row per direction', () => {
  const s = crearSandbox({ ahora: TUE_0541, props: P, respuestas: [okResp, okResp] });
  const h = s.ctx.SpreadsheetApp.getActive().insertSheet('mediciones');
  h.appendRow([...s.ctx.COLUMNAS_MEDICIONES]);
  s.ctx.probarAhora();
  const rows = s.hojas.mediciones.slice(1);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r[3]), ['05:40', '05:40']);
  for (const col of [2, 4]) {
    const e = celdas(h, col).filter((x) => x.fila >= 2);
    assert.equal(e.length, 2);
    assert.ok(e.every((x) => x.formato === '@' && typeof x.valor === 'string'), `col ${col}`);
  }
});

test('registrarViaje stores fecha as text even without column format', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.registrarViaje('subi', 'ida');
  const h = s.objetos.viajes;
  const e = celdas(h, 2).filter((x) => x.fila === 2);
  assert.equal(e.length, 1);
  assert.equal(e[0].formato, '@');
  assert.equal(e[0].valor, '2026-11-03');
  assert.deepEqual(s.hojas.viajes[1], ['2026-11-03T17:01:12-03:00', '2026-11-03', 'subi', 'ida']);
});

test('tick refreshes cobertura after measuring', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  s.ctx.setup(); s.ctx.tick();
  assert.deepEqual(s.hojas.cobertura[1], ['2026-11-03', 1, 1, 0, 2 / 94]);
});

test('tick survives a failing actualizarCobertura: rows, counter, slot saved and lock released once', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  s.ctx.setup();
  delete s.objetos.cobertura; // getSheetByName('cobertura') pasa a devolver null
  assert.doesNotThrow(() => s.ctx.tick());
  assert.equal(s.hojas.mediciones.slice(1).length, 2);
  assert.equal(s.props.CONSULTAS, '2026-11-03|2');
  assert.equal(s.props.ULTIMA_FRANJA_MEDIDA, '2026-11-03 17:00');
  assert.equal(s.lock.liberaciones, 1);
});

test('setup writes no formulas to cobertura and fills it from existing rows', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.hojas.mediciones.push(fila('2026-11-03', '5:40', 'ida'), fila('2026-11-03', '5:40', 'vuelta'));
  s.hojas.cobertura[1] = ['=SORT(UNIQUE(x))', '=y', '=z', '=w', '=v'];
  s.ctx.setup();
  assert.deepEqual(s.objetos.cobertura.formulas, []);
  assert.ok(s.hojas.cobertura.flat().every((v) => !String(v).startsWith('=')));
  assert.deepEqual(s.hojas.cobertura, [[...s.ctx.COLUMNAS_COBERTURA], ['2026-11-03', 1, 1, 0, 2 / 94]]);
  assert.deepEqual(s.hojas.mediciones.slice(1).map((r) => r[3]), ['05:40', '05:40']);
});

test('setup twice gives the same sheets and a single tick trigger', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.hojas.mediciones.push(fila('2026-11-03', '6:00', 'ida'), fila('2026-11-02', '6:00', 'ida', 'HTTP 500'));
  s.ctx.setup();
  const una = JSON.stringify(s.hojas);
  s.ctx.setup();
  assert.equal(JSON.stringify(s.hojas), una);
  assert.equal(s.triggers.filter((t) => t.getHandlerFunction() === 'tick').length, 1);
});
