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

function crearHoja(filas) {
  const hoja = {
    formatos: [], // [{ rango, formato }]
    reglas: [], // formatos efectivos por celda; gana el último que cubre la celda
    escrituras: [], // [{ fila, col, valor, formato }]: formato de la celda al escribirla
    formulas: [], // fórmulas escritas con setFormula
    maxFilas: 1000, // una hoja nueva de Sheets trae 1000 filas
    insertadas: [], // [{ despuesDe, cantidad }]
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
      const poner = (f, c2, valor) => {
        const formato = hoja.formatoDe(f, c2);
        hoja.escrituras.push({ fila: f, col: c2, valor, formato });
        let guardado = valor;
        const h = typeof valor === 'string' && formato !== '@' ? REGEX_HORA.exec(valor) : null;
        if (h) guardado = String(Number(h[1])) + ':' + h[2];
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
          const salida = [];
          for (let i = 0; i < r.nf; i += 1) {
            const fila = [];
            for (let j = 0; j < r.nc; j += 1) {
              const v = (filas[r.f - 1 + i] || [])[r.c - 1 + j];
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
  const lock = { intentos: [], liberaciones: 0 };
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
  };

  const ctx = vm.createContext(entorno);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(DIR, archivo), 'utf8'), ctx, { filename: archivo });
  }
  return { ctx, hojas, objetos: objetosHoja, fetches, triggers, lock, props: propsVivas };
}

module.exports = { crearSandbox };
