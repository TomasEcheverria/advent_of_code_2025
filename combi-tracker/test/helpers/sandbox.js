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

function crearHoja(filas) {
  const hoja = {
    formatos: [], // [{ rango, formato }]
    appendRow(fila) { filas.push(Array.from(fila)); },
    getLastRow() { return filas.length; },
    getRange(a, b, c, d) {
      const esTexto = typeof a === 'string';
      const fila = esTexto ? Number((/\d+/.exec(a) || [1])[0]) : a;
      const col = esTexto ? a.toUpperCase().charCodeAt(0) - 64 : b;
      const poner = (f, c2, valor) => {
        while (filas.length < f) filas.push([]);
        while (filas[f - 1].length < c2 - 1) filas[f - 1].push('');
        filas[f - 1][c2 - 1] = valor;
      };
      return {
        setValues(valores) {
          valores.forEach((fv, i) => fv.forEach((v, j) => poner(fila + i, col + j, v)));
        },
        setValue(v) { poner(fila, col, v); },
        setFormula(f) { poner(fila, col, f); },
        setNumberFormat(formato) { hoja.formatos.push({ rango: esTexto ? a : [a, b, c, d], formato }); },
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
      getScriptLock: () => ({ tryLock: () => lockLibre, releaseLock: () => {} }),
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
  return { ctx, hojas, fetches, triggers, props: propsVivas };
}

module.exports = { crearSandbox };
