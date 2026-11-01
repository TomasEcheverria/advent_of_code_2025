// Pegamento con los servicios de Google. Usa las constantes de Config.js y las
// funciones de Logic.js como globales (ámbito compartido de Apps Script).

var PROP_ULTIMA_FRANJA_ = 'ULTIMA_FRANJA_MEDIDA';
var PROP_CONSULTAS_ = 'CONSULTAS';

// Contexto de una medición o viaje a partir del instante `fecha` en hora local.
function contextoAhora_(fecha, sentido) {
  var hora = Number(Utilities.formatDate(fecha, ZONA_HORARIA, 'H'));
  var minuto = Number(Utilities.formatDate(fecha, ZONA_HORARIA, 'm'));
  return {
    medidoEn: Utilities.formatDate(fecha, ZONA_HORARIA, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    fecha: Utilities.formatDate(fecha, ZONA_HORARIA, 'yyyy-MM-dd'),
    diaSemana: Number(Utilities.formatDate(fecha, ZONA_HORARIA, 'u')),
    franja: franjaPara(hora, minuto, INTERVALO_MIN),
    hora: hora,
    minuto: minuto,
    sentido: sentido,
  };
}

function hojaMediciones_() {
  return SpreadsheetApp.getActive().getSheetByName('mediciones');
}

function hojaMedicionesObligatoria_() {
  var hoja = hojaMediciones_();
  if (!hoja) throw new Error("Falta la hoja 'mediciones': corré setup()");
  return hoja;
}

// Texto plano para que Sheets no convierta fechas ni franjas ('17:00') en otros tipos.
function formatoTextoMediciones_(hoja) {
  hoja.getRange('B:B').setNumberFormat('@');
  hoja.getRange('D:D').setNumberFormat('@');
}

// Las filas que Sheets agrega solas al pasar la fila 1000 no heredan el formato de columna:
// se agregan filas a mano y se vuelve a aplicar el formato antes de escribir.
function asegurarFilas_(hoja) {
  if (hoja.getMaxRows() - hoja.getLastRow() < 5) {
    hoja.insertRowsAfter(hoja.getMaxRows(), 1000);
    formatoTextoMediciones_(hoja);
  }
}

function mensajeTope_() {
  return 'Tope diario de consultas alcanzado (' + TOPE_DIARIO + ')';
}

// Una consulta por sentido (ida y vuelta) y una fila por consulta. Devuelve el contador
// de consultas actualizado; el que llama lo guarda.
function medirSentidos_(hoja, cfg, ahora, consultas) {
  ['ida', 'vuelta'].forEach(function (sentido) {
    var ctxSentido = contextoAhora_(ahora, sentido);
    if (consultas >= TOPE_DIARIO) {
      hoja.appendRow(filaError(ctxSentido, '', mensajeTope_(), cfg.apiKey));
      return;
    }
    var ruta = cfg.rutas[sentido];
    try {
      consultas += 1;
      var resp = UrlFetchApp.fetch(construirUrl(ruta.origen, ruta.destino, cfg.apiKey), { muteHttpExceptions: true });
      hoja.appendRow(filaMedicion(ctxSentido, resp.getResponseCode(), resp.getContentText(), cfg.apiKey));
    } catch (e) {
      hoja.appendRow(filaError(ctxSentido, '', e.message, cfg.apiKey));
    }
  });
  return consultas;
}

// Se ejecuta cada 5 minutos; mide como máximo una vez por franja.
function tick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;
  try {
    var ahora = new Date();
    var ctx = contextoAhora_(ahora, '');
    if (!debeMedir(ctx.diaSemana, ctx.franja, PRIMERA_FRANJA, ULTIMA_FRANJA)) return;
    var props = PropertiesService.getScriptProperties();
    var clave = claveFranja(ctx.fecha, ctx.franja);
    if (props.getProperty(PROP_ULTIMA_FRANJA_) === clave) return;
    var hoja = hojaMedicionesObligatoria_();
    asegurarFilas_(hoja);

    var cfg = validarConfig(props.getProperties());
    if (!cfg.ok) {
      hoja.appendRow(filaError(ctx, '', 'Faltan o son inválidas: ' + cfg.faltantes.join(', '), cfg.apiKey));
      props.setProperty(PROP_ULTIMA_FRANJA_, clave);
      return;
    }

    var consultas = leerContador(props.getProperty(PROP_CONSULTAS_), ctx.fecha);
    if (consultas >= TOPE_DIARIO) {
      hoja.appendRow(filaError(ctx, '', mensajeTope_(), cfg.apiKey));
      props.setProperty(PROP_ULTIMA_FRANJA_, clave);
      return;
    }

    consultas = medirSentidos_(hoja, cfg, ahora, consultas);
    props.setProperty(PROP_CONSULTAS_, escribirContador(ctx.fecha, consultas));
    props.setProperty(PROP_ULTIMA_FRANJA_, clave);
  } finally {
    lock.releaseLock();
  }
}

// Se corre a mano: una consulta de ida y una de vuelta, sin ventana horaria ni franja ya
// medida ni lock. No marca la franja, pero suma al contador diario de consultas.
function probarAhora() {
  var hoja = hojaMedicionesObligatoria_();
  var props = PropertiesService.getScriptProperties();
  var cfg = validarConfig(props.getProperties());
  if (!cfg.ok) throw new Error('Faltan o son inválidas: ' + cfg.faltantes.join(', '));
  asegurarFilas_(hoja);
  var ahora = new Date();
  var fecha = contextoAhora_(ahora, '').fecha;
  var consultas = medirSentidos_(hoja, cfg, ahora, leerContador(props.getProperty(PROP_CONSULTAS_), fecha));
  props.setProperty(PROP_CONSULTAS_, escribirContador(fecha, consultas));
  return 'Listo: 2 filas nuevas en mediciones (revisá la columna error)';
}

function hojaOCrear_(libro, nombre) {
  return libro.getSheetByName(nombre) || libro.insertSheet(nombre);
}

function escribirEncabezadosSiVacia_(hoja, columnas) {
  if (hoja.getLastRow() === 0) hoja.appendRow(columnas);
}

// Se corre a mano una vez: crea hojas, encabezados, fórmulas y el disparador.
function setup() {
  var libro = SpreadsheetApp.getActive();
  var mediciones = hojaOCrear_(libro, 'mediciones');
  var cobertura = hojaOCrear_(libro, 'cobertura');
  var viajes = hojaOCrear_(libro, 'viajes');

  escribirEncabezadosSiVacia_(mediciones, COLUMNAS_MEDICIONES);
  escribirEncabezadosSiVacia_(viajes, COLUMNAS_VIAJES);
  formatoTextoMediciones_(mediciones);
  viajes.getRange('B:B').setNumberFormat('@');

  cobertura.getRange(1, 1, 1, COLUMNAS_COBERTURA.length).setValues([COLUMNAS_COBERTURA]);
  var filasEsperadas = 2 * franjasDelDia(PRIMERA_FRANJA, ULTIMA_FRANJA, INTERVALO_MIN).length;
  var f = formulasCobertura(filasEsperadas);
  cobertura.getRange('A2').setFormula(f.A2);
  cobertura.getRange('B2').setFormula(f.B2);
  cobertura.getRange('C2').setFormula(f.C2);
  cobertura.getRange('D2').setFormula(f.D2);
  cobertura.getRange('E2').setFormula(f.E2);
  cobertura.getRange('E2:E').setNumberFormat('0%');

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
}

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Viajes')
    .setTitle('Combi')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// La llama la página del celular con google.script.run.
function registrarViaje(evento, sentido) {
  if (!validarViaje(evento, sentido)) throw new Error('Viaje inválido');
  var ctx = contextoAhora_(new Date(), sentido);
  var hoja = hojaOCrear_(SpreadsheetApp.getActive(), 'viajes');
  escribirEncabezadosSiVacia_(hoja, COLUMNAS_VIAJES);
  hoja.appendRow([ctx.medidoEn, ctx.fecha, evento, sentido]);
  return 'Registrado: ' + evento + ' (' + sentido + ') ' + pad2_(ctx.hora) + ':' + pad2_(ctx.minuto);
}

if (typeof module !== 'undefined') {
  module.exports = { tick, setup, probarAhora, doGet, registrarViaje, contextoAhora_ };
}
