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
    estadoHttp, '',
  ];
}

if (typeof module !== 'undefined') {
  module.exports = {
    franjaPara, debeMedir, franjasDelDia,
    construirUrl, limpiarMensaje, filaMedicion, filaError,
  };
}
