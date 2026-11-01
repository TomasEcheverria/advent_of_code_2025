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

if (typeof module !== 'undefined') {
  module.exports = { franjaPara, debeMedir, franjasDelDia };
}
