const test = require('node:test');
const assert = require('node:assert/strict');
const { construirUrl, limpiarMensaje, filaMedicion, filaError } = require('../apps-script/Logic.js');

const ctx = { medidoEn: '2026-11-03T17:01:12-03:00', fecha: '2026-11-03', diaSemana: 2, franja: '17:00', sentido: 'vuelta' };
const ok = JSON.stringify({ routes: [{ summary: {
  lengthInMeters: 61000, travelTimeInSeconds: 4200, trafficDelayInSeconds: 900,
  noTrafficTravelTimeInSeconds: 3300, historicTrafficTravelTimeInSeconds: 4000,
  liveTrafficIncidentsTravelTimeInSeconds: 4150,
  departureTime: '2026-11-03T17:01:13-03:00', arrivalTime: '2026-11-03T18:11:13-03:00' } }] });

test('construirUrl', () => {
  assert.equal(construirUrl('-34.1,-57.2', '-34.6,-58.3', 'K Y'),
    'https://api.tomtom.com/routing/1/calculateRoute/-34.1,-57.2:-34.6,-58.3/json?key=K%20Y&traffic=true&departAt=now&computeTravelTimeFor=all&travelMode=car&routeType=fastest&maxAlternatives=0');
});

test('filaMedicion ok', () => {
  assert.deepEqual(filaMedicion(ctx, 200, ok, 'K'), ['2026-11-03T17:01:12-03:00', '2026-11-03', 2, '17:00', 'vuelta',
    4200, 3300, 4000, 4150, 900, 61000, '2026-11-03T17:01:13-03:00', '2026-11-03T18:11:13-03:00', 200, '']);
});

test('filaMedicion missing optional field → empty cell', () => {
  const body = JSON.parse(ok); delete body.routes[0].summary.historicTrafficTravelTimeInSeconds;
  assert.equal(filaMedicion(ctx, 200, JSON.stringify(body), 'K')[7], '');
});

test('filaMedicion http error uses TomTom message', () => {
  const r = filaMedicion(ctx, 403, JSON.stringify({ detailedError: { message: 'Forbidden key' } }), 'K');
  assert.equal(r[13], 403); assert.match(r[14], /Forbidden key/); assert.equal(r[5], '');
});

test('filaMedicion http error falls back to error.description then HTTP code', () => {
  assert.match(filaMedicion(ctx, 500, JSON.stringify({ error: { description: 'Boom' } }), 'K')[14], /Boom/);
  assert.equal(filaMedicion(ctx, 502, 'not json', 'K')[14], 'HTTP 502');
  assert.equal(filaMedicion(ctx, 502, '', 'K')[14], 'HTTP 502');
});

test('filaMedicion http error hides the key', () => {
  const r = filaMedicion(ctx, 403, JSON.stringify({ detailedError: { message: 'bad key SECRET' } }), 'SECRET');
  assert.ok(!r[14].includes('SECRET'));
});

test('filaMedicion invalid JSON / no routes', () => {
  assert.notEqual(filaMedicion(ctx, 200, 'not json', 'K')[14], '');
  assert.notEqual(filaMedicion(ctx, 200, '{"routes":[]}', 'K')[14], '');
  assert.notEqual(filaMedicion(ctx, 200, '{"routes":[{}]}', 'K')[14], '');
  assert.notEqual(filaMedicion(ctx, 200, 'null', 'K')[14], '');
});

test('filaMedicion 200 with bad body keeps estado_http 200 and empty numerics', () => {
  const r = filaMedicion(ctx, 200, 'not json', 'K');
  assert.equal(r.length, 15); assert.equal(r[13], 200); assert.equal(r[5], '');
});

test('limpiarMensaje hides key and truncates', () => {
  const m = limpiarMensaje('fail https://x/?key=SECRET&a=1 ' + 'x'.repeat(500), 'SECRET');
  assert.ok(!m.includes('SECRET')); assert.ok(m.includes('***')); assert.equal(m.length, 200);
});

test('limpiarMensaje hides URL-encoded key and every occurrence', () => {
  const m = limpiarMensaje('a K Y b K%20Y c K Y', 'K Y');
  assert.equal(m, 'a *** b *** c ***');
});

test('limpiarMensaje with empty/undefined key and non-string message', () => {
  assert.equal(limpiarMensaje('hola', ''), 'hola');
  assert.equal(limpiarMensaje('hola', undefined), 'hola');
  assert.equal(limpiarMensaje(404, 'K'), '404');
  assert.equal(limpiarMensaje(undefined, 'K'), 'undefined');
});

test('filaError shape', () => {
  const r = filaError(ctx, '', 'Timeout SECRET', 'SECRET');
  assert.equal(r.length, 15); assert.equal(r[13], ''); assert.equal(r[14], 'Timeout ***');
  assert.deepEqual(r.slice(0, 5), ['2026-11-03T17:01:12-03:00', '2026-11-03', 2, '17:00', 'vuelta']);
  assert.deepEqual(r.slice(5, 13), ['', '', '', '', '', '', '', '']);
});
