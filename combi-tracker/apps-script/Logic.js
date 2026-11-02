// Lógica pura (sin servicios de Google). En Apps Script las constantes de Config.js
// son globales; en Node se importan con require.
var CONFIG_ = (typeof module !== 'undefined' && module.exports) ? require('./Config.js') : globalThis;

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

// Hora local redondeada hacia abajo a múltiplo de `intervalo` minutos, como 'HH:MM'.
function franjaPara(hora, minuto, intervalo) {
  var piso = Math.floor(minuto / intervalo) * intervalo;
  return pad2_(hora) + ':' + pad2_(piso);
}

// Lunes a viernes (1 a 5) y franja dentro de [primera, ultima], ambas inclusive.
// Compara 'HH:MM' como texto (con cero a la izquierda el orden alfabético es el horario).
function debeMedir(diaSemana, franja, primera, ultima) {
  if (diaSemana < 1 || diaSemana > 5) return false;
  return franja >= primera && franja <= ultima;
}

// Todas las franjas de primera a ultima (inclusive) cada `intervalo` minutos.
function franjasDelDia(primera, ultima, intervalo) {
  var aMin = function (s) { return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)); };
  var franjas = [];
  for (var t = aMin(primera); t <= aMin(ultima); t += intervalo) {
    franjas.push(pad2_(Math.floor(t / 60)) + ':' + pad2_(t % 60));
  }
  return franjas;
}

// URL de TomTom Routing. `origen` y `destino` ya vienen normalizados como 'lat,lon'.
function construirUrl(origen, destino, apiKey) {
  return 'https://api.tomtom.com/routing/1/calculateRoute/' + origen + ':' + destino +
    '/json?key=' + encodeURIComponent(apiKey) +
    '&traffic=true&departAt=now&computeTravelTimeFor=all&travelMode=car' +
    '&routeType=fastest&maxAlternatives=0';
}

// Oculta la clave (cruda y codificada) con '***' y recorta a MAX_LARGO_ERROR.
function limpiarMensaje(mensaje, apiKey) {
  var texto = String(mensaje);
  if (apiKey) {
    var clave = String(apiKey);
    texto = texto.split(clave).join('***');
    texto = texto.split(encodeURIComponent(clave)).join('***');
  }
  return texto.slice(0, CONFIG_.MAX_LARGO_ERROR);
}

// Fila de 15 columnas (orden de COLUMNAS_MEDICIONES) sin datos de la API.
function filaError(ctx, estadoHttp, mensaje, apiKey) {
  return [
    ctx.medidoEn, ctx.fecha, ctx.diaSemana, ctx.franja, ctx.sentido,
    '', '', '', '', '', '', '', '',
    estadoHttp, limpiarMensaje(mensaje, apiKey),
  ];
}

function parsearJson_(texto) {
  try {
    return JSON.parse(texto);
  } catch (e) {
    return null;
  }
}

function valorONada_(v) {
  return (v === undefined || v === null) ? '' : v;
}

// Convierte la respuesta de TomTom en una fila de medición (o de error).
function filaMedicion(ctx, estadoHttp, cuerpo, apiKey) {
  var datos = parsearJson_(cuerpo);
  if (estadoHttp !== 200) {
    var mensaje = 'HTTP ' + estadoHttp;
    if (datos && datos.detailedError && datos.detailedError.message) {
      mensaje = datos.detailedError.message;
    } else if (datos && datos.error && datos.error.description) {
      mensaje = datos.error.description;
    }
    return filaError(ctx, estadoHttp, mensaje, apiKey);
  }
  if (datos === null || typeof datos !== 'object') {
    return filaError(ctx, estadoHttp, 'Respuesta inválida de TomTom', apiKey);
  }
  var ruta = datos.routes && datos.routes[0];
  var r = ruta && ruta.summary;
  if (!r || typeof r !== 'object') {
    return filaError(ctx, estadoHttp, 'Sin rutas en la respuesta', apiKey);
  }
  var sinTiempo = typeof r.travelTimeInSeconds !== 'number' || !isFinite(r.travelTimeInSeconds);
  return [
    ctx.medidoEn, ctx.fecha, ctx.diaSemana, ctx.franja, ctx.sentido,
    valorONada_(r.travelTimeInSeconds),
    valorONada_(r.noTrafficTravelTimeInSeconds),
    valorONada_(r.historicTrafficTravelTimeInSeconds),
    valorONada_(r.liveTrafficIncidentsTravelTimeInSeconds),
    valorONada_(r.trafficDelayInSeconds),
    valorONada_(r.lengthInMeters),
    valorONada_(r.departureTime),
    valorONada_(r.arrivalTime),
    estadoHttp, sinTiempo ? 'Sin travelTimeInSeconds' : '',
  ];
}

var REGEX_NUMERO_ = /^-?\d+(\.\d+)?$/;
var REGEX_CONTADOR_ = /^(\d{4}-\d{2}-\d{2})\|(\d+)$/;

// 'lat,lon' decimal plano (sin espacios) con |lat| <= 90 y |lon| <= 180; si no, null.
function normalizarCoordenada(texto) {
  if (typeof texto !== 'string') return null;
  var partes = texto.replace(/\s+/g, '').split(',');
  if (partes.length !== 2) return null;
  if (!REGEX_NUMERO_.test(partes[0]) || !REGEX_NUMERO_.test(partes[1])) return null;
  var lat = Number(partes[0]);
  var lon = Number(partes[1]);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return partes[0] + ',' + partes[1];
}

// Valida las Script Properties. `faltantes` conserva el orden de PROPS.
// `rutas` siempre está presente; los valores inválidos o ausentes quedan en null.
function validarConfig(props) {
  var P = CONFIG_.PROPS;
  var origen = props || {};
  var clave = typeof origen[P.apiKey] === 'string' ? origen[P.apiKey].trim() : '';
  var laPlata = normalizarCoordenada(origen[P.origenLaPlata]);
  var cabaIda = normalizarCoordenada(origen[P.destinoCabaIda]);
  var cabaVuelta = normalizarCoordenada(origen[P.origenCabaVuelta]);
  var faltantes = [];
  if (!clave) faltantes.push(P.apiKey);
  if (laPlata === null) faltantes.push(P.origenLaPlata);
  if (cabaIda === null) faltantes.push(P.destinoCabaIda);
  if (cabaVuelta === null) faltantes.push(P.origenCabaVuelta);
  return {
    ok: faltantes.length === 0,
    faltantes: faltantes,
    apiKey: clave,
    rutas: {
      ida: { origen: laPlata, destino: cabaIda },
      vuelta: { origen: cabaVuelta, destino: laPlata },
    },
  };
}

// Contador diario guardado como 'YYYY-MM-DD|n'. Otra fecha o valor mal formado: 0.
function leerContador(valorGuardado, fecha) {
  if (typeof valorGuardado !== 'string') return 0;
  var m = REGEX_CONTADOR_.exec(valorGuardado);
  if (!m || m[1] !== fecha) return 0;
  return Number(m[2]);
}

function escribirContador(fecha, n) {
  return fecha + '|' + n;
}

// Clave única por día y franja, 'YYYY-MM-DD HH:MM'.
function claveFranja(fecha, franja) {
  return fecha + ' ' + franja;
}

function validarViaje(evento, sentido) {
  return (evento === 'subi' || evento === 'baje') && (sentido === 'ida' || sentido === 'vuelta');
}

var REGEX_FRANJA_ = /^(\d{1,2}):(\d{2})(:\d{2})?$/;
var REGEX_FRACCION_ = /^(0?\.\d+|0)$/;
var REGEX_SERIAL_DIA_ = /^\d{5}$/;

// Sheets puede convertir '05:40' en una hora y mostrarla como '5:40' (o '5:40:00'); en una
// celda ya con formato de texto muestra la fracción de día cruda ('0.2361111111111111').
// Vuelve a 'HH:MM'. Cualquier otro texto se devuelve igual.
function normalizarFranja(texto) {
  var s = String(texto);
  var m = REGEX_FRANJA_.exec(s);
  if (m) return pad2_(Number(m[1])) + ':' + m[2];
  if (REGEX_FRACCION_.test(s)) {
    var minutos = Math.min(Math.round(Number(s) * 1440), 1439);
    return pad2_(Math.floor(minutos / 60)) + ':' + pad2_(minutos % 60);
  }
  return s;
}

// Sheets cuenta los días desde 1899-12-30; 25569 es el serial de 1970-01-01.
var SERIAL_EPOCH_UNIX_ = 25569;

// Una celda de fecha con formato de texto muestra el serial crudo ('46328'). Lo convierte a
// 'YYYY-MM-DD' con aritmética UTC pura (nunca un Date de getValues: tiene desfases
// históricos). Fechas ISO y cualquier otro texto se devuelven igual.
function normalizarFecha(texto) {
  var s = String(texto);
  if (!REGEX_SERIAL_DIA_.test(s)) return s;
  var serial = Number(s);
  if (serial < 30000 || serial > 60000) return s;
  return new Date((serial - SERIAL_EPOCH_UNIX_) * 86400000).toISOString().slice(0, 10);
}

// Resumen diario para la hoja `cobertura`. `filas` = [fecha, franja, sentido, error] de
// `mediciones`; `filasEsperadas` = filas por día completo. Cuenta franjas distintas (las
// repeticiones de `probarAhora` no suman). Devuelve [fecha, okIda, okVuelta, errores,
// cobertura] ordenado por fecha descendente.
function resumenCobertura(filas, filasEsperadas) {
  var dias = {};
  var fechas = [];
  filas.forEach(function (fila) {
    var fecha = String(valorONada_(fila[0]));
    if (fecha === '') return;
    if (!Object.prototype.hasOwnProperty.call(dias, fecha)) {
      dias[fecha] = { ida: {}, vuelta: {}, errores: 0 };
      fechas.push(fecha);
    }
    var dia = dias[fecha];
    if (String(valorONada_(fila[3])) !== '') {
      dia.errores += 1;
      return;
    }
    var sentido = String(valorONada_(fila[2]));
    if (sentido === 'ida' || sentido === 'vuelta') dia[sentido][normalizarFranja(valorONada_(fila[1]))] = true;
  });
  fechas.sort();
  fechas.reverse();
  return fechas.map(function (fecha) {
    var dia = dias[fecha];
    var ida = Object.keys(dia.ida).length;
    var vuelta = Object.keys(dia.vuelta).length;
    return [fecha, ida, vuelta, dia.errores, (ida + vuelta) / filasEsperadas];
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    franjaPara, debeMedir, franjasDelDia,
    construirUrl, limpiarMensaje, filaMedicion, filaError,
    normalizarCoordenada, validarConfig, leerContador, escribirContador,
    claveFranja, validarViaje, normalizarFranja, normalizarFecha, resumenCobertura,
  };
}
