// Constantes del proyecto. Se declaran con `var` para que en Apps Script (ámbito
// global compartido) y en un sandbox de vm queden como propiedades de globalThis.
// No poner claves, direcciones ni coordenadas acá: viven en Script Properties.

var ZONA_HORARIA = 'America/Argentina/Buenos_Aires';
var INTERVALO_MIN = 20;
var PRIMERA_FRANJA = '05:40';
var ULTIMA_FRANJA = '21:00';
var TOPE_DIARIO = 1000;
var MAX_LARGO_ERROR = 200;

var COLUMNAS_MEDICIONES = [
  'medido_en', 'fecha', 'dia_semana', 'franja', 'sentido',
  'duracion_s', 'sin_trafico_s', 'historico_s', 'incidentes_s', 'demora_s',
  'distancia_m', 'salida_api', 'llegada_api', 'estado_http', 'error',
];
var COLUMNAS_VIAJES = ['medido_en', 'fecha', 'evento', 'sentido'];
var COLUMNAS_COBERTURA = ['fecha', 'ok_ida', 'ok_vuelta', 'errores', 'cobertura'];

// Nombres de las Script Properties.
var PROPS = {
  apiKey: 'TOMTOM_API_KEY',
  origenLaPlata: 'ORIGEN_LA_PLATA',
  destinoCabaIda: 'DESTINO_CABA_IDA',
  origenCabaVuelta: 'ORIGEN_CABA_VUELTA',
};

// Horarios de la combi (lunes a viernes). La fase 1 no los usa para decidir cuándo medir.
var HORARIOS_COMBI = {
  ida: [
    '06:00', '06:15', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00',
    '10:00', '11:00', '12:30', '13:30', '14:30', '15:20', '16:15', '16:45',
    '17:30', '18:00', '18:45',
  ],
  vuelta: [
    '06:30', '07:10', '07:30', '08:00', '08:45', '10:30', '12:00', '13:00',
    '14:00', '15:00', '15:30', '16:00', '16:30', '17:00', '17:15', '17:30',
    '18:00', '18:15', '18:45', '19:30',
  ],
};

if (typeof module !== 'undefined') {
  module.exports = {
    ZONA_HORARIA, INTERVALO_MIN, PRIMERA_FRANJA, ULTIMA_FRANJA, TOPE_DIARIO,
    MAX_LARGO_ERROR, COLUMNAS_MEDICIONES, COLUMNAS_VIAJES, COLUMNAS_COBERTURA,
    PROPS, HORARIOS_COMBI,
  };
}
