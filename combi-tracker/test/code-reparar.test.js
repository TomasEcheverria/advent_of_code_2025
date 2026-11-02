const test = require('node:test');
const assert = require('node:assert/strict');
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
const SERIAL_0540 = 340 / 1440;
const SERIAL_20261102 = 46328;

function fila(fecha, franja, sentido, error = '') {
  const r = new Array(15).fill('');
  r[1] = fecha; r[3] = franja; r[4] = sentido; r[14] = error;
  return r;
}

// Hoja `mediciones` tal como la dejó Sheets en producción: sin formato de texto y con
// fecha y franja convertidas en fecha y hora numéricas.
function sandboxConNumericos() {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  const libro = s.ctx.SpreadsheetApp.getActive();
  const m = libro.insertSheet('mediciones');
  m.appendRow([...s.ctx.COLUMNAS_MEDICIONES]);
  s.hojas.mediciones.push(fila('', '', 'ida'));
  m.celdaNumerica(2, 2, 'fecha', SERIAL_20261102);
  m.celdaNumerica(2, 4, 'hora', SERIAL_0540);
  const v = libro.insertSheet('viajes');
  v.appendRow([...s.ctx.COLUMNAS_VIAJES]);
  s.hojas.viajes.push(['2026-11-02T08:00:00-03:00', '', 'subi', 'ida']);
  v.celdaNumerica(2, 2, 'fecha', SERIAL_20261102);
  return s;
}

test('fake models Sheets: a @ cell holding a number shows its raw serial', () => {
  const s = sandboxConNumericos();
  const m = s.objetos.mediciones;
  assert.deepEqual(m.getRange(2, 2, 1, 1).getDisplayValues(), [['2026-11-02']]);
  assert.deepEqual(m.getRange(2, 4, 1, 1).getDisplayValues(), [['5:40']]);
  m.getRange('B:B').setNumberFormat('@');
  m.getRange('D:D').setNumberFormat('@');
  assert.deepEqual(m.getRange(2, 2, 1, 1).getDisplayValues(), [['46328']]);
  assert.deepEqual(m.getRange(2, 4, 1, 1).getDisplayValues(), [['0.2361111111111111']]);
});

test('setup repairs existing numeric fecha/franja BEFORE applying the text format', () => {
  const s = sandboxConNumericos();
  s.ctx.setup();
  assert.equal(s.hojas.mediciones[1][1], '2026-11-02');
  assert.equal(s.hojas.mediciones[1][3], '05:40');
  assert.equal(s.hojas.viajes[1][1], '2026-11-02');
  assert.deepEqual(s.hojas.cobertura[1].slice(0, 2), ['2026-11-02', 1]);
  // Ya son texto de verdad: con formato '@' siguen mostrando lo mismo.
  assert.deepEqual(s.objetos.mediciones.getRange(2, 2, 1, 3).getDisplayValues(), [['2026-11-02', '', '05:40']]);
  assert.deepEqual(s.objetos.viajes.getRange(2, 2, 1, 1).getDisplayValues(), [['2026-11-02']]);
});

test('setup twice is stable and keeps 05:40 / 2026-11-02', () => {
  const s = sandboxConNumericos();
  s.ctx.setup();
  const una = JSON.stringify(s.hojas);
  s.ctx.setup();
  assert.equal(JSON.stringify(s.hojas), una);
  assert.equal(s.hojas.mediciones[1][3], '05:40');
  assert.equal(s.hojas.mediciones[1][1], '2026-11-02');
  assert.equal(s.hojas.viajes[1][1], '2026-11-02');
});

test('normalizarMediciones repairs raw serials already left behind by the old setup order', () => {
  const s = sandboxConNumericos();
  const m = s.objetos.mediciones;
  m.getRange('B:B').setNumberFormat('@');
  m.getRange('D:D').setNumberFormat('@');
  s.objetos.viajes.getRange('B:B').setNumberFormat('@');
  assert.deepEqual(m.getRange(2, 2, 1, 1).getDisplayValues(), [['46328']]);
  s.ctx.normalizarMediciones();
  s.ctx.normalizarViajes();
  assert.equal(s.hojas.mediciones[1][1], '2026-11-02');
  assert.equal(s.hojas.mediciones[1][3], '05:40');
  assert.equal(s.hojas.viajes[1][1], '2026-11-02');
  const antes = JSON.stringify(s.hojas);
  s.ctx.normalizarMediciones();
  s.ctx.normalizarViajes();
  assert.equal(JSON.stringify(s.hojas), antes);
});

test('normalizarViajes writes fecha as text only in column B and is idempotent', () => {
  const s = sandboxConNumericos();
  s.ctx.normalizarViajes();
  assert.deepEqual(s.hojas.viajes[1], ['2026-11-02T08:00:00-03:00', '2026-11-02', 'subi', 'ida']);
  const e = s.objetos.viajes.escrituras.filter((x) => x.fila >= 2 && x.valor === '2026-11-02');
  assert.ok(e.length >= 1 && e.every((x) => x.col === 2 && x.formato === '@'));
  const antes = JSON.stringify(s.hojas.viajes);
  s.ctx.normalizarViajes();
  assert.equal(JSON.stringify(s.hojas.viajes), antes);
});

test('normalizarViajes does nothing without data rows and throws without the sheet', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  assert.throws(() => s.ctx.normalizarViajes(), /Falta la hoja 'viajes'/);
  s.ctx.setup();
  s.ctx.normalizarViajes();
  assert.equal(s.hojas.viajes.length, 1);
});

test('setup applies no @ format to existing mediciones/viajes cells before the repair reads them', () => {
  const s = sandboxConNumericos();
  const lecturasAntes = [];
  for (const h of [s.objetos.mediciones, s.objetos.viajes]) {
    const original = h.getRange;
    h.getRange = (...a) => {
      const rango = original(...a);
      const leer = rango.getDisplayValues;
      rango.getDisplayValues = () => {
        const v = leer();
        lecturasAntes.push(v.flat().join('|'));
        return v;
      };
      return rango;
    };
  }
  s.ctx.setup();
  const todas = lecturasAntes.join('~');
  assert.ok(!todas.includes('46328'), todas);
  assert.ok(!todas.includes('0.2361'), todas);
});

test('actualizarCobertura reads only the columns it needs', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.hojas.mediciones.push(fila('2026-11-03', '17:00', 'ida'), fila('2026-11-03', '17:00', 'vuelta', 'HTTP 500'));
  s.objetos.mediciones.lecturas.length = 0;
  s.ctx.actualizarCobertura();
  const l = s.objetos.mediciones.lecturas;
  assert.ok(l.length >= 1);
  assert.ok(l.every((x) => (x.c === 2 && x.nc === 4) || (x.c === 15 && x.nc === 1)), JSON.stringify(l));
  assert.deepEqual(s.hojas.cobertura[1], ['2026-11-03', 1, 0, 1, 1 / 94]);
});

test('actualizarCobertura turns a raw date serial into the ISO date', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.hojas.mediciones.push(fila('', '5:40', 'ida'));
  s.objetos.mediciones.celdaNumerica(2, 2, 'fecha', SERIAL_20261102);
  s.ctx.actualizarCobertura();
  assert.deepEqual(s.hojas.cobertura[1].slice(0, 4), ['2026-11-02', 1, 0, 0]);
});

test('tick logs the swallowed actualizarCobertura error (message only) and still completes', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  s.ctx.setup();
  delete s.objetos.cobertura;
  assert.doesNotThrow(() => s.ctx.tick());
  assert.deepEqual(s.consola.errores, ["actualizarCobertura: Falta la hoja 'cobertura': corré setup()"]);
  assert.ok(!s.consola.errores.join('').includes('APIKEY123'));
  assert.equal(s.hojas.mediciones.slice(1).length, 2);
  assert.equal(s.props.CONSULTAS, '2026-11-03|2');
  assert.equal(s.props.ULTIMA_FRANJA_MEDIDA, '2026-11-03 17:00');
  assert.equal(s.lock.liberaciones, 1);
});

test('tick logs nothing when cobertura works, and keeps using tryLock only', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  s.ctx.setup(); s.ctx.tick();
  assert.deepEqual(s.consola.errores, []);
  assert.deepEqual(s.lock.intentos, [0]);
  assert.deepEqual(s.lock.esperas, []);
});

test('registrarViaje waits for the script lock once and releases it once', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.ctx.registrarViaje('subi', 'ida');
  assert.deepEqual(s.lock.esperas, [30000]);
  assert.equal(s.lock.liberaciones, 1);
  assert.deepEqual(s.lock.intentos, []);
});

test('registrarViaje releases the lock when the input is invalid', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  assert.throws(() => s.ctx.registrarViaje('x', 'ida'), /Viaje inválido/);
  assert.deepEqual(s.lock.esperas, [30000]);
  assert.equal(s.lock.liberaciones, 1);
  assert.equal(s.hojas.viajes.length, 1);
});

test('registrarViaje surfaces a clear Spanish error when the lock cannot be taken', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, lockLibre: false });
  assert.throws(() => s.ctx.registrarViaje('subi', 'ida'), /ocupado.*de nuevo/);
  assert.equal(s.lock.liberaciones, 0);
  assert.equal(s.objetos.viajes, undefined);
});

test('registrarViaje releases the lock when the append itself fails', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.objetos.viajes.getLastRow = () => { throw new Error('boom'); };
  assert.throws(() => s.ctx.registrarViaje('subi', 'ida'), /boom/);
  assert.equal(s.lock.liberaciones, 1);
});

test('probarAhora waits for the script lock once and releases it once', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  s.ctx.setup();
  s.ctx.probarAhora();
  assert.deepEqual(s.lock.esperas, [30000]);
  assert.equal(s.lock.liberaciones, 1);
  assert.deepEqual(s.lock.intentos, []);
  assert.equal(s.hojas.mediciones.slice(1).length, 2);
});

test('probarAhora releases the lock when the sheet is missing or the config is bad', () => {
  const sinHoja = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  assert.throws(() => sinHoja.ctx.probarAhora(), /Falta la hoja 'mediciones'/);
  assert.deepEqual(sinHoja.lock.esperas, [30000]);
  assert.equal(sinHoja.lock.liberaciones, 1);

  const mala = crearSandbox({ ahora: TUE_1701, props: Object.assign({}, P, { ORIGEN_LA_PLATA: 'x' }), respuestas: [okResp, okResp] });
  mala.ctx.setup();
  assert.throws(() => mala.ctx.probarAhora(), /ORIGEN_LA_PLATA/);
  assert.deepEqual(mala.lock.esperas, [30000]);
  assert.equal(mala.lock.liberaciones, 1);
});

test('probarAhora does nothing and throws when the lock cannot be taken', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp], lockLibre: false });
  s.ctx.setup();
  assert.throws(() => s.ctx.probarAhora(), /ocupado.*de nuevo/);
  assert.equal(s.fetches.length, 0);
  assert.equal(s.lock.liberaciones, 0);
  assert.equal(s.props.CONSULTAS, undefined);
});

test('viajes grows when its grid is full instead of throwing', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  const hoja = s.objetos.viajes;
  while (s.hojas.viajes.length < 1000) s.hojas.viajes.push(['x', '2026-11-01', 'subi', 'ida']);
  assert.equal(hoja.getMaxRows(), 1000);
  s.ctx.registrarViaje('baje', 'vuelta');
  assert.deepEqual(hoja.insertadas, [{ despuesDe: 1000, cantidad: 1000 }]);
  assert.equal(hoja.getMaxRows(), 2000);
  assert.equal(s.hojas.viajes.length, 1001);
  assert.deepEqual(s.hojas.viajes[1000].slice(1), ['2026-11-03', 'baje', 'vuelta']);
  const e = hoja.escrituras.filter((x) => x.fila === 1001 && x.col === 2);
  assert.ok(e.length === 1 && e[0].formato === '@');
});

test('viajes does not insert rows while there is room', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P });
  s.ctx.setup();
  s.ctx.registrarViaje('subi', 'ida');
  assert.deepEqual(s.objetos.viajes.insertadas, []);
});
