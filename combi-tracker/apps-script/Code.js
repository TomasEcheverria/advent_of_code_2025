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

// Agrega UNA fila al final de `hoja` como texto en las columnas `colsTexto` (números de
// columna). Fija el formato '@' en esas celdas ANTES de escribir; si no, Sheets convierte
// '05:40' en una hora aunque la columna sea de texto. No usa appendRow por eso.
// No es atómica (lee la última fila y después escribe): quien la llama debe tener el lock.
function agregarFilaTexto_(hoja, fila, colsTexto) {
  var n = hoja.getLastRow() + 1;
  // getRange más allá de la última fila de la hoja falla: se agregan filas antes de escribir.
  if (n > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 1000);
  colsTexto.forEach(function (col) { hoja.getRange(n, col).setNumberFormat('@'); });
  hoja.getRange(n, 1, 1, fila.length).setValues([fila]);
}

// fecha (B) y franja (D) de `mediciones` como texto.
function agregarMedicion_(hoja, fila) {
  agregarFilaTexto_(hoja, fila, [2, 4]);
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
      agregarMedicion_(hoja, filaError(ctxSentido, '', mensajeTope_(), cfg.apiKey));
      return;
    }
    var ruta = cfg.rutas[sentido];
    try {
      consultas += 1;
      var resp = UrlFetchApp.fetch(construirUrl(ruta.origen, ruta.destino, cfg.apiKey), { muteHttpExceptions: true });
      agregarMedicion_(hoja, filaMedicion(ctxSentido, resp.getResponseCode(), resp.getContentText(), cfg.apiKey));
    } catch (e) {
      agregarMedicion_(hoja, filaError(ctxSentido, '', e.message, cfg.apiKey));
    }
  });
  return consultas;
}

// Actualiza el resumen sin dejar que un fallo afecte la medición ni el lock.
function actualizarCoberturaSegura_() {
  try {
    actualizarCobertura();
  } catch (e) {
    // El resumen se reconstruye entero en la próxima franja: no vale la pena interrumpir.
    // Solo el mensaje: nada de esto toca la API key.
    console.error('actualizarCobertura: ' + e.message);
  }
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
      agregarMedicion_(hoja, filaError(ctx, '', 'Faltan o son inválidas: ' + cfg.faltantes.join(', '), cfg.apiKey));
      props.setProperty(PROP_ULTIMA_FRANJA_, clave);
      actualizarCoberturaSegura_();
      return;
    }

    var consultas = leerContador(props.getProperty(PROP_CONSULTAS_), ctx.fecha);
    if (consultas >= TOPE_DIARIO) {
      agregarMedicion_(hoja, filaError(ctx, '', mensajeTope_(), cfg.apiKey));
      props.setProperty(PROP_ULTIMA_FRANJA_, clave);
      actualizarCoberturaSegura_();
      return;
    }

    consultas = medirSentidos_(hoja, cfg, ahora, consultas);
    props.setProperty(PROP_CONSULTAS_, escribirContador(ctx.fecha, consultas));
    props.setProperty(PROP_ULTIMA_FRANJA_, clave);
    actualizarCoberturaSegura_();
  } finally {
    lock.releaseLock();
  }
}

// Pide el lock del script y espera hasta 30 s. Devuelve el lock (hay que liberarlo en un
// finally) o lanza un error claro si otra ejecución lo sigue teniendo.
function tomarLockEsperando_() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    throw new Error('El sistema está ocupado con otra ejecución, probá de nuevo en un momento');
  }
  return lock;
}

// Se corre a mano: una consulta de ida y una de vuelta, sin ventana horaria ni franja ya
// medida. No marca la franja, pero suma al contador diario de consultas. Toma el lock para
// no pisarse con tick (filas y contador).
function probarAhora() {
  var lock = tomarLockEsperando_();
  try {
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
  } finally {
    lock.releaseLock();
  }
}

function hojaOCrear_(libro, nombre) {
  return libro.getSheetByName(nombre) || libro.insertSheet(nombre);
}

function escribirEncabezadosSiVacia_(hoja, columnas) {
  if (hoja.getLastRow() === 0) hoja.appendRow(columnas);
}

// Reconstruye la hoja `cobertura` (A2:E) con valores calculados acá, no con fórmulas.
// Se puede correr a mano; tick la llama después de cada franja medida.
function actualizarCobertura() {
  var libro = SpreadsheetApp.getActive();
  var mediciones = libro.getSheetByName('mediciones');
  if (!mediciones) throw new Error("Falta la hoja 'mediciones': corré setup()");
  var cobertura = libro.getSheetByName('cobertura');
  if (!cobertura) throw new Error("Falta la hoja 'cobertura': corré setup()");

  var filas = [];
  var ultima = mediciones.getLastRow();
  if (ultima >= 2) {
    // getDisplayValues: lo que se ve, sin depender de cómo Sheets convirtió cada celda.
    // Solo las columnas que hacen falta: fecha..sentido (B:E) y error (O).
    var base = mediciones.getRange(2, 2, ultima - 1, 4).getDisplayValues();
    var errores = mediciones.getRange(2, 15, ultima - 1, 1).getDisplayValues();
    filas = base.map(function (f, i) { return [normalizarFecha(f[0]), f[2], f[3], errores[i][0]]; });
  }
  var filasEsperadas = 2 * franjasDelDia(PRIMERA_FRANJA, ULTIMA_FRANJA, INTERVALO_MIN).length;
  var resumen = resumenCobertura(filas, filasEsperadas);

  // clearContent también borra las fórmulas viejas que hayan quedado.
  var maxFilas = cobertura.getMaxRows();
  if (maxFilas > 1) cobertura.getRange(2, 1, maxFilas - 1, COLUMNAS_COBERTURA.length).clearContent();
  if (resumen.length > 0) {
    cobertura.getRange(2, 1, resumen.length, 1).setNumberFormat('@');
    cobertura.getRange(2, 1, resumen.length, COLUMNAS_COBERTURA.length).setValues(resumen);
  }
  cobertura.getRange('E2:E').setNumberFormat('0%');
}

// Repara columnas de `hoja` (filas 2 en adelante) como texto. `columnas` = [{ col, normalizar }].
// ORDEN: primero se leen TODOS los valores mostrados y recién después se fija el formato '@';
// una celda numérica (hora, fecha) con formato texto muestra su serial crudo ('0.236…', '46328').
// Las funciones `normalizar` también arreglan ese caso si el formato ya estaba puesto.
function repararColumnasTexto_(hoja, columnas) {
  var ultima = hoja.getLastRow();
  if (ultima < 2) return;
  var rangos = columnas.map(function (c) { return hoja.getRange(2, c.col, ultima - 1, 1); });
  var valores = rangos.map(function (r, i) {
    return r.getDisplayValues().map(function (f) { return [columnas[i].normalizar(f[0])]; });
  });
  rangos.forEach(function (r, i) {
    r.setNumberFormat('@');
    r.setValues(valores[i]);
  });
}

// Repara las filas existentes de `mediciones`: fecha (B) como 'YYYY-MM-DD' y franja (D) como
// 'HH:MM', las dos como texto. Se puede correr a mano; no cambia nada si ya está bien.
function normalizarMediciones() {
  repararColumnasTexto_(hojaMedicionesObligatoria_(), [
    { col: 2, normalizar: normalizarFecha },
    { col: 4, normalizar: normalizarFranja },
  ]);
}

// Repara la fecha (B) de las filas existentes de `viajes`, igual que normalizarMediciones.
function normalizarViajes() {
  var hoja = SpreadsheetApp.getActive().getSheetByName('viajes');
  if (!hoja) throw new Error("Falta la hoja 'viajes': corré setup()");
  repararColumnasTexto_(hoja, [{ col: 2, normalizar: normalizarFecha }]);
}

// Se corre a mano: crea hojas, encabezados y el disparador, y repara/reconstruye los datos
// existentes. Se puede volver a correr sin duplicar nada.
function setup() {
  var libro = SpreadsheetApp.getActive();
  var mediciones = hojaOCrear_(libro, 'mediciones');
  var cobertura = hojaOCrear_(libro, 'cobertura');
  var viajes = hojaOCrear_(libro, 'viajes');

  escribirEncabezadosSiVacia_(mediciones, COLUMNAS_MEDICIONES);
  escribirEncabezadosSiVacia_(viajes, COLUMNAS_VIAJES);

  // Primero reparar lo existente (lee lo que se ve) y recién después fijar el formato de
  // texto: al revés, las horas y fechas ya convertidas quedarían como '0.236…' y '46328'.
  normalizarMediciones();
  normalizarViajes();
  formatoTextoMediciones_(mediciones);
  viajes.getRange('B:B').setNumberFormat('@');

  cobertura.getRange(1, 1, 1, COLUMNAS_COBERTURA.length).setValues([COLUMNAS_COBERTURA]);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();

  actualizarCobertura();
}

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Viajes')
    .setTitle('Combi')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// La llama la página del celular con google.script.run. Varias llamadas pueden llegar a la
// vez: el lock evita que dos escriban en la misma fila.
function registrarViaje(evento, sentido) {
  var lock = tomarLockEsperando_();
  try {
    if (!validarViaje(evento, sentido)) throw new Error('Viaje inválido');
    var ctx = contextoAhora_(new Date(), sentido);
    var hoja = hojaOCrear_(SpreadsheetApp.getActive(), 'viajes');
    escribirEncabezadosSiVacia_(hoja, COLUMNAS_VIAJES);
    agregarFilaTexto_(hoja, [ctx.medidoEn, ctx.fecha, evento, sentido], [2]);
    return 'Registrado: ' + evento + ' (' + sentido + ') ' + pad2_(ctx.hora) + ':' + pad2_(ctx.minuto);
  } finally {
    lock.releaseLock();
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    tick, setup, probarAhora, doGet, registrarViaje, contextoAhora_,
    actualizarCobertura, normalizarMediciones, normalizarViajes,
  };
}
