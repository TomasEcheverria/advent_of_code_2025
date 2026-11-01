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

// Fórmulas de la hoja `cobertura` (A2:E2). `filasEsperadas` = filas por día completo.
function formulasCobertura(filasEsperadas) {
  var fechas = 'mediciones!B2:B';
  var sentidos = 'mediciones!E2:E';
  var errores = 'mediciones!O2:O';
  var porSentido = function (sentido) {
    return '=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(' + fechas + ',A2:A,' + sentidos + ',"' + sentido +
      '",' + errores + ',"")))';
  };
  return {
    A2: '=SORT(UNIQUE(IFERROR(FILTER(' + fechas + ',' + fechas + '<>""),"")),1,FALSE)',
    B2: porSentido('ida'),
    C2: porSentido('vuelta'),
    D2: '=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(' + fechas + ',A2:A,' + errores + ',"<>")))',
    E2: '=ARRAYFORMULA(IF(A2:A="",,(B2:B+C2:C)/' + filasEsperadas + '))',
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    franjaPara, debeMedir, franjasDelDia,
    construirUrl, limpiarMensaje, filaMedicion, filaError,
    normalizarCoordenada, validarConfig, leerContador, escribirContador,
    claveFranja, validarViaje, formulasCobertura,
  };
}
