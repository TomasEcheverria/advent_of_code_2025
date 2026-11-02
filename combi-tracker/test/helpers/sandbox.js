// Carga Config.js, Logic.js y Code.js en UN contexto vm, como si fueran un proyecto de
// Apps Script (ámbito global compartido, sin `module`), con servicios de Google falsos.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', 'apps-script');
const ARCHIVOS = ['Config.js', 'Logic.js', 'Code.js'];
const DIAS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Utilities.formatDate con los tokens que usa Code.js. Argentina no tiene horario de
// verano, así que el desfase es siempre -03:00.
function formatearFecha(fecha, zona, patron) {
  const partes = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(fecha).forEach((p) => { partes[p.type] = p.value; });
  const valores = {
    yyyy: partes.year, MM: partes.month, dd: partes.day,
    HH: partes.hour, mm: partes.minute, ss: partes.second,
    XXX: '-03:00', u: String(DIAS[partes.weekday]),
    H: String(Number(partes.hour)), m: String(Number(partes.minute)),
  };
  return patron.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|XXX|u|H|m/g,
    (token, literal) => (literal !== undefined ? literal : valores[token]));
}

// Rango en A1 ('B:B', 'E2:E', 'A2') o numérico (fila, col, filas, cols) a {f, c, nf, nc}.
// `nf` es Infinity cuando el rango no tiene fila final.
function describirRango(a, b, c, d) {
  if (typeof a !== 'string') return { f: a, c: b, nf: c === undefined ? 1 : c, nc: d === undefined ? 1 : d };
  const m = /^([A-Z])(\d*)(?::([A-Z])(\d*))?$/.exec(a.toUpperCase());
  const col = m[1].charCodeAt(0) - 64;
  const f = m[2] ? Number(m[2]) : 1;
  const ultimaCol = m[3] ? m[3].charCodeAt(0) - 64 : col;
  const finito = !m[3] && m[2];
  return { f, c: col, nf: finito ? 1 : (m[4] ? Number(m[4]) - f + 1 : Infinity), nc: ultimaCol - col + 1 };
}

// Como Sheets, una celda que no es de texto ('@') convierte '5:40' en una hora y la muestra
// sin cero a la izquierda ('5:40').
const REGEX_HORA = /^(\d{1,2}):(\d{2})$/;
const REGEX_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

// Serial de Sheets (días desde 1899-12-30) de una fecha ISO, con aritmética UTC.
const serialDeFecha = (iso) => {
  const m = REGEX_FECHA.exec(iso);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 + 25569;
};
const fechaDeSerial = (serial) => new Date((serial - 25569) * 86400000).toISOString().slice(0, 10);

function crearHoja(filas) {
  const hoja = {
    formatos: [], // [{ rango, formato }]
    reglas: [], // formatos efectivos por celda; gana el último que cubre la celda
    escrituras: [], // [{ fila, col, valor, formato }]: formato de la celda al escribirla
    formulas: [], // fórmulas escritas con setFormula
    maxFilas: 1000, // una hoja nueva de Sheets trae 1000 filas
    insertadas: [], // [{ despuesDe, cantidad }]
    // Valor numérico subyacente de las celdas que Sheets convirtió en hora o fecha:
    // 'f,c' -> { tipo: 'hora'|'fecha', serial }. Con formato '@' la celda muestra el serial.
    numericos: {},
    lecturas: [], // [{ f, c, nf, nc }] de cada getDisplayValues
    // Deja en la celda una hora (fracción de día) o una fecha (serial) como la dejaría Sheets.
    celdaNumerica(f, c, tipo, serial) {
      while (filas.length < f) filas.push([]);
      while (filas[f - 1].length < c - 1) filas[f - 1].push('');
      if (tipo === 'hora') {
        const min = Math.round(serial * 1440);
        filas[f - 1][c - 1] = String(Math.floor(min / 60)) + ':' + String(min % 60).padStart(2, '0');
      } else {
        filas[f - 1][c - 1] = fechaDeSerial(serial);
      }
      hoja.numericos[f + ',' + c] = { tipo, serial };
    },
    formatoDe(f, c) {
      for (let i = hoja.reglas.length - 1; i >= 0; i -= 1) {
        const r = hoja.reglas[i];
        if (f >= r.f && f < r.f + r.nf && c >= r.c && c < r.c + r.nc) return r.formato;
      }
      return '';
    },
    appendRow(fila) {
      filas.push(Array.from(fila));
      // Sheets agrega filas solas al agregar al final, pero sin el formato de columna.
      if (filas.length > hoja.maxFilas) hoja.maxFilas = filas.length;
    },
    getLastRow() { return filas.length; },
    getMaxRows() { return hoja.maxFilas; },
    insertRowsAfter(despuesDe, cantidad) {
      hoja.insertadas.push({ despuesDe, cantidad });
      hoja.maxFilas += cantidad;
    },
    getRange(a, b, c, d) {
      const r = describirRango(a, b, c, d);
      if (typeof a !== 'string' && r.f + r.nf - 1 > hoja.maxFilas) {
        throw new Error('El rango queda fuera de los límites de la hoja (' + hoja.maxFilas + ' filas)');
      }
      const poner = (f, c2, valor) => {
        const formato = hoja.formatoDe(f, c2);
        hoja.escrituras.push({ fila: f, col: c2, valor, formato });
        let guardado = valor;
        const h = typeof valor === 'string' && formato !== '@' ? REGEX_HORA.exec(valor) : null;
        delete hoja.numericos[f + ',' + c2];
        if (h) {
          guardado = String(Number(h[1])) + ':' + h[2];
          hoja.numericos[f + ',' + c2] = { tipo: 'hora', serial: (Number(h[1]) * 60 + Number(h[2])) / 1440 };
        } else if (typeof valor === 'string' && formato !== '@' && REGEX_FECHA.test(valor)) {
          hoja.numericos[f + ',' + c2] = { tipo: 'fecha', serial: serialDeFecha(valor) };
        }
        while (filas.length < f) filas.push([]);
        while (filas[f - 1].length < c2 - 1) filas[f - 1].push('');
        filas[f - 1][c2 - 1] = guardado;
      };
      return {
        setValues(valores) {
          valores.forEach((fv, i) => fv.forEach((v, j) => poner(r.f + i, r.c + j, v)));
        },
        setValue(v) { poner(r.f, r.c, v); },
        setFormula(f) { hoja.formulas.push(f); poner(r.f, r.c, f); },
        setNumberFormat(formato) {
          hoja.formatos.push({ rango: typeof a === 'string' ? a : [a, b, c, d], formato });
          hoja.reglas.push({ f: r.f, c: r.c, nf: r.nf, nc: r.nc, formato });
        },
        getDisplayValues() {
          hoja.lecturas.push({ f: r.f, c: r.c, nf: r.nf, nc: r.nc });
          const salida = [];
          for (let i = 0; i < r.nf; i += 1) {
            const fila = [];
            for (let j = 0; j < r.nc; j += 1) {
              const f2 = r.f + i;
              const c2 = r.c + j;
              const num = hoja.numericos[f2 + ',' + c2];
              if (num && hoja.formatoDe(f2, c2) === '@') {
                fila.push(String(num.serial)); // formato texto: Sheets muestra el serial crudo
                continue;
              }
              const v = (filas[f2 - 1] || [])[c2 - 1];
              fila.push(v === undefined || v === null ? '' : String(v));
            }
            salida.push(fila);
          }
          return salida;
        },
        clearContent() {
          for (let i = 0; i < filas.length; i += 1) if (filas[i] === undefined) filas[i] = [];
          for (let i = 0; i < r.nf && r.f - 1 + i < filas.length; i += 1) {
            for (let j = 0; j < r.nc; j += 1) {
              if (r.c - 1 + j < filas[r.f - 1 + i].length) filas[r.f - 1 + i][r.c - 1 + j] = '';
              delete hoja.numericos[(r.f + i) + ',' + (r.c + j)];
            }
          }
          // getLastRow() no cuenta las filas finales sin contenido.
          while (filas.length > 0 && filas[filas.length - 1].every((v) => v === '' || v === undefined)) filas.pop();
        },
      };
    },
  };
  return hoja;
}

function crearSandbox({ ahora, props = {}, respuestas = [], lockLibre = true }) {
  const hojas = {};
  const objetosHoja = {};
  const fetches = [];
  const triggers = [];
  const lock = { intentos: [], esperas: [], liberaciones: 0 };
  const consola = { errores: [] };
  const propsVivas = Object.assign({}, props);
  const pendientes = respuestas.slice();

  class FechaFalsa extends Date {
    constructor(...args) {
      if (args.length === 0) super(ahora.getTime()); else super(...args);
    }
    static now() { return ahora.getTime(); }
  }

  const salida = (html) => ({
    html,
    setTitle(t) { this.titulo = t; return this; },
    addMetaTag(n, c) { (this.metas = this.metas || []).push([n, c]); return this; },
  });

  const entorno = {
    Date: FechaFalsa,
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: (n) => objetosHoja[n] || null,
        insertSheet: (n) => {
          hojas[n] = [];
          objetosHoja[n] = crearHoja(hojas[n]);
          objetosHoja[n].nombre = n;
          return objetosHoja[n];
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in propsVivas ? propsVivas[k] : null),
        setProperty: (k, v) => { propsVivas[k] = String(v); },
        getProperties: () => Object.assign({}, propsVivas),
      }),
    },
    UrlFetchApp: {
      fetch(url, opciones) {
        fetches.push(url);
        if (opciones === undefined || opciones.muteHttpExceptions !== true) {
          throw new Error('el código debe usar muteHttpExceptions');
        }
        const r = pendientes.shift();
        if (r === undefined) throw new Error('sin respuesta simulada');
        if (r instanceof Error) throw r;
        return { getResponseCode: () => r.codigo, getContentText: () => r.cuerpo };
      },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: (ms) => { lock.intentos.push(ms); return lockLibre; },
        waitLock: (ms) => {
          lock.esperas.push(ms);
          if (!lockLibre) throw new Error('Tiempo de espera agotado: no se pudo obtener el bloqueo');
        },
        releaseLock: () => { lock.liberaciones += 1; },
      }),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: (fn) => {
        const t = { fn, minutos: null, getHandlerFunction: () => fn };
        const b = {
          timeBased: () => b,
          everyMinutes: (n) => { t.minutos = n; return b; },
          create: () => { triggers.push(t); return t; },
        };
        return b;
      },
    },
    HtmlService: { createHtmlOutputFromFile: (n) => salida(n) },
    Utilities: { formatDate: formatearFecha },
    console: { error: (m) => { consola.errores.push(String(m)); }, log() {}, warn() {} },
  };

  const ctx = vm.createContext(entorno);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(DIR, archivo), 'utf8'), ctx, { filename: archivo });
  }
  return { ctx, hojas, objetos: objetosHoja, fetches, triggers, lock, consola, props: propsVivas };
}

module.exports = { crearSandbox };
