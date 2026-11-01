# Combi Tracker Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apps Script bound to a Google Sheet that measures La Plata ⇄ CABA car travel time with live traffic (TomTom) every 20 minutes on weekdays and logs it, plus a phone web page to log real combi trips.

**Architecture:** Pure logic (slots, URL building, response → row, validation) lives in `Logic.js` and `Config.js`, written as plain global functions that Apps Script loads and that Node can `require` through a guarded `module.exports`. `Code.js` is the thin Google glue (`tick`, `setup`, `doGet`, `registrarViaje`). Node tests cover the logic directly and the glue through a `vm` sandbox with fake Google services.

**Tech Stack:** Google Apps Script (V8), Google Sheets, TomTom Routing API v1, Node 22 `node:test` (no npm dependencies).

**Spec:** `docs/superpowers/specs/2026-11-01-combi-tracker-design.md`

## Global Constraints

- No npm dependencies. Tests run with `node --test` from `combi-tracker/` (Node 22).
- Repo is public: no API key, address or coordinate in any committed file. Those live only in Script Properties: `TOMTOM_API_KEY`, `ORIGEN_LA_PLATA`, `DESTINO_CABA_IDA`, `ORIGEN_CABA_VUELTA`.
- Time zone `America/Argentina/Buenos_Aires`; manifest `runtimeVersion` `V8`.
- Sampling: slot = local time floored to 20 minutes; measure only Monday–Friday and slots `05:40`–`21:00` inclusive (47 slots/day, 94 rows/day expected).
- Trigger: `tick` every 5 minutes; each slot measured once per date.
- Daily safety cap: 1000 TomTom requests.
- TomTom URL: `https://api.tomtom.com/routing/1/calculateRoute/{origen}:{destino}/json` with `key`, `traffic=true`, `departAt=now`, `computeTravelTimeFor=all`, `travelMode=car`, `routeType=fastest`, `maxAlternatives=0`.
- Sheet `mediciones` columns, exact order: `medido_en, fecha, dia_semana, franja, sentido, duracion_s, sin_trafico_s, historico_s, incidentes_s, demora_s, distancia_m, salida_api, llegada_api, estado_http, error`.
- Sheet `viajes` columns: `medido_en, fecha, evento, sentido`; `evento` ∈ `subi|baje`, `sentido` ∈ `ida|vuelta`.
- Sheet `cobertura`: formulas only, columns `fecha, ok_ida, ok_vuelta, errores, cobertura`.
- Error messages max 200 characters. No retries.
- Every Apps Script file ends with `if (typeof module !== 'undefined') module.exports = {...};`.
- User-facing text (README, web page, error messages) in Spanish.

## Review Focus

1. A `UrlFetchApp` exception message containing the request URL would leak the API key into the public-to-the-user sheet: the key must be replaced by `***` (Task 2, `limpiarMensaje`).
2. TomTom answers 200 but omits optional summary fields (e.g. `historicTrafficTravelTimeInSeconds`): the cell must be empty, never `undefined` or `NaN` (Task 2).
3. Coordinates typed with spaces (`-34.9, -57.9`) must be accepted and normalized; garbage (`abc`, missing comma, lat outside ±90) must produce one error row naming the property and no TomTom call (Task 3 and Task 4).
4. Day rollover: yesterday's counter must not count today, and yesterday's `17:00` slot must not block today's `17:00` (Task 3 and Task 4).
5. Window edges: `05:39` (slot `05:20`) skips, `05:40` measures, `21:19` (slot `21:00`) measures, `21:20` skips, Saturday `07:00` skips (Task 1).

---

## File Structure

```
combi-tracker/
  package.json            test script only
  README.md               Spanish install guide + manual checklist (Task 5)
  apps-script/
    appsscript.json       manifest (TZ, V8, webapp: execute as me, access myself)
    Config.js             constants: interval, window, cap, columns, schedules, property names
    Logic.js              pure functions
    Code.js               Google glue: tick, setup, doGet, registrarViaje
    Viajes.html           phone page with 4 buttons
  test/
    logic-franjas.test.js
    logic-tomtom.test.js
    logic-config.test.js
    code.test.js          vm sandbox with fake Google services
    helpers/sandbox.js    loads apps-script/*.js into a vm context with fakes
```

### Task 1: Scaffold, config and slot logic

**Files:**
- Create: `combi-tracker/package.json`, `combi-tracker/apps-script/appsscript.json`, `combi-tracker/apps-script/Config.js`, `combi-tracker/apps-script/Logic.js`
- Test: `combi-tracker/test/logic-franjas.test.js`

**Interfaces:**
- Produces (Config.js globals, exported): `ZONA_HORARIA = 'America/Argentina/Buenos_Aires'`, `INTERVALO_MIN = 20`, `PRIMERA_FRANJA = '05:40'`, `ULTIMA_FRANJA = '21:00'`, `TOPE_DIARIO = 1000`, `MAX_LARGO_ERROR = 200`, `COLUMNAS_MEDICIONES` (15 names above), `COLUMNAS_VIAJES`, `COLUMNAS_COBERTURA`, `PROPS = { apiKey: 'TOMTOM_API_KEY', origenLaPlata: 'ORIGEN_LA_PLATA', destinoCabaIda: 'DESTINO_CABA_IDA', origenCabaVuelta: 'ORIGEN_CABA_VUELTA' }`, `HORARIOS_COMBI = { ida: [...19], vuelta: [...20] }` (copy from spec).
- Produces (Logic.js): `franjaPara(hora: number, minuto: number, intervalo: number): string` → `'HH:MM'`; `debeMedir(diaSemana: number /*1=lun..7=dom*/, franja: string, primera: string, ultima: string): boolean`; `franjasDelDia(primera: string, ultima: string, intervalo: number): string[]`.

- [ ] **Step 1: Write `package.json`** with `"private": true`, `"scripts": { "test": "node --test" }`, no dependencies. Write `appsscript.json`: `timeZone` from constraints, `runtimeVersion: "V8"`, `exceptionLogging: "STACKDRIVER"`, `webapp: { "executeAs": "USER_DEPLOYING", "access": "MYSELF" }`.
- [ ] **Step 2: Write the failing tests**

```js
const { franjaPara, debeMedir, franjasDelDia } = require('../apps-script/Logic.js');
const C = require('../apps-script/Config.js');
test('franjaPara floors to interval', () => {
  assert.equal(franjaPara(17, 0, 20), '17:00');
  assert.equal(franjaPara(17, 19, 20), '17:00');
  assert.equal(franjaPara(17, 20, 20), '17:20');
  assert.equal(franjaPara(5, 39, 20), '05:20');
  assert.equal(franjaPara(0, 0, 20), '00:00');
});
test('debeMedir window edges', () => {
  const m = (d, f) => debeMedir(d, f, C.PRIMERA_FRANJA, C.ULTIMA_FRANJA);
  assert.equal(m(1, '05:20'), false);
  assert.equal(m(1, '05:40'), true);
  assert.equal(m(5, '21:00'), true);
  assert.equal(m(5, '21:20'), false);
  assert.equal(m(6, '07:00'), false);
  assert.equal(m(7, '07:00'), false);
});
test('franjasDelDia gives 47 slots', () => {
  const f = franjasDelDia(C.PRIMERA_FRANJA, C.ULTIMA_FRANJA, C.INTERVALO_MIN);
  assert.equal(f.length, 47);
  assert.equal(f[0], '05:40');
  assert.equal(f[46], '21:00');
});
test('config sanity', () => {
  assert.equal(C.COLUMNAS_MEDICIONES.length, 15);
  assert.equal(C.HORARIOS_COMBI.ida.length, 19);
  assert.equal(C.HORARIOS_COMBI.vuelta.length, 20);
});
```

- [ ] **Step 3: Run** `cd combi-tracker && npm test` — expected FAIL (module not found).
- [ ] **Step 4: Implement** Config.js and the three Logic.js functions. Compare `HH:MM` strings lexicographically (zero-padded).
- [ ] **Step 5: Run** `npm test` — expected PASS.
- [ ] **Step 6: Commit** `feat(combi-tracker): scaffold, config and slot logic`.

### Task 2: TomTom request and response → row

**Files:**
- Modify: `combi-tracker/apps-script/Logic.js`
- Test: `combi-tracker/test/logic-tomtom.test.js`

**Interfaces:**
- Consumes: `MAX_LARGO_ERROR`, `COLUMNAS_MEDICIONES` from Task 1.
- Produces:
  - `construirUrl(origen: string, destino: string, apiKey: string): string` — `origen`/`destino` already normalized `lat,lon`; key passed through `encodeURIComponent`.
  - `limpiarMensaje(mensaje: string, apiKey: string): string` — every occurrence of the key (raw and URL-encoded) → `***`, then truncate to 200.
  - `filaMedicion(ctx: Contexto, estadoHttp: number, cuerpo: string, apiKey: string): Array` — 15 values in column order.
  - `filaError(ctx: Contexto, estadoHttp: number|'', mensaje: string, apiKey: string): Array` — numeric/API columns `''`.
  - `Contexto = { medidoEn: string, fecha: string, diaSemana: number, franja: string, sentido: 'ida'|'vuelta'|'' }`.

- [ ] **Step 1: Write the failing tests**

```js
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
test('filaMedicion invalid JSON / no routes', () => {
  assert.notEqual(filaMedicion(ctx, 200, 'not json', 'K')[14], '');
  assert.notEqual(filaMedicion(ctx, 200, '{"routes":[]}', 'K')[14], '');
});
test('limpiarMensaje hides key and truncates', () => {
  const m = limpiarMensaje('fail https://x/?key=SECRET&a=1 ' + 'x'.repeat(500), 'SECRET');
  assert.ok(!m.includes('SECRET')); assert.ok(m.includes('***')); assert.equal(m.length, 200);
});
test('filaError shape', () => {
  const r = filaError(ctx, '', 'Timeout SECRET', 'SECRET');
  assert.equal(r.length, 15); assert.equal(r[13], ''); assert.equal(r[14], 'Timeout ***');
});
```

- [ ] **Step 2: Run** `npm test` — expected FAIL (functions not defined).
- [ ] **Step 3: Implement** the four functions. For HTTP errors, take the message from `detailedError.message`, else `error.description`, else `HTTP <code>`; pass every error message through `limpiarMensaje`. Missing summary fields → `''`.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** `feat(combi-tracker): TomTom url and response parsing`.

### Task 3: Configuration, counters and trip validation

**Files:**
- Modify: `combi-tracker/apps-script/Logic.js`
- Test: `combi-tracker/test/logic-config.test.js`

**Interfaces:**
- Consumes: `PROPS` from Task 1.
- Produces:
  - `normalizarCoordenada(texto: string): string|null` — trims, removes spaces, requires `lat,lon` numbers with |lat| ≤ 90 and |lon| ≤ 180; returns `'lat,lon'` or `null`.
  - `validarConfig(props: Object<string,string>): { ok: boolean, faltantes: string[], apiKey: string, rutas: { ida: {origen, destino}, vuelta: {origen, destino} } }` — `faltantes` lists property names that are missing or invalid; ida = `ORIGEN_LA_PLATA`→`DESTINO_CABA_IDA`; vuelta = `ORIGEN_CABA_VUELTA`→`ORIGEN_LA_PLATA`.
  - `leerContador(valorGuardado: string|null, fecha: string): number` — format `'YYYY-MM-DD|n'`; other date or null → 0.
  - `escribirContador(fecha: string, n: number): string`.
  - `claveFranja(fecha: string, franja: string): string` → `'YYYY-MM-DD HH:MM'`.
  - `validarViaje(evento: string, sentido: string): boolean`.

- [ ] **Step 1: Write the failing tests**

```js
const P = { TOMTOM_API_KEY: 'K', ORIGEN_LA_PLATA: '-34.9, -57.9', DESTINO_CABA_IDA: '-34.6,-58.3', ORIGEN_CABA_VUELTA: '-34.61,-58.38' };
test('normalizarCoordenada', () => {
  assert.equal(normalizarCoordenada(' -34.9 , -57.9 '), '-34.9,-57.9');
  for (const bad of ['abc', '-34.9', '-95,-57', '-34,-190', '', null]) assert.equal(normalizarCoordenada(bad), null);
});
test('validarConfig ok builds routes', () => {
  const c = validarConfig(P);
  assert.equal(c.ok, true);
  assert.deepEqual(c.rutas.ida, { origen: '-34.9,-57.9', destino: '-34.6,-58.3' });
  assert.deepEqual(c.rutas.vuelta, { origen: '-34.61,-58.38', destino: '-34.9,-57.9' });
});
test('validarConfig lists missing and invalid', () => {
  const c = validarConfig({ ...P, TOMTOM_API_KEY: '', DESTINO_CABA_IDA: 'x' });
  assert.equal(c.ok, false);
  assert.deepEqual(c.faltantes.sort(), ['DESTINO_CABA_IDA', 'TOMTOM_API_KEY']);
});
test('contador resets on new day', () => {
  assert.equal(leerContador(null, '2026-11-03'), 0);
  assert.equal(leerContador('2026-11-02|57', '2026-11-03'), 0);
  assert.equal(leerContador(escribirContador('2026-11-03', 12), '2026-11-03'), 12);
});
test('claveFranja includes date', () => {
  assert.notEqual(claveFranja('2026-11-02', '17:00'), claveFranja('2026-11-03', '17:00'));
});
test('validarViaje', () => {
  assert.equal(validarViaje('subi', 'ida'), true);
  assert.equal(validarViaje('baje', 'vuelta'), true);
  assert.equal(validarViaje('otro', 'ida'), false);
  assert.equal(validarViaje('subi', 'x'), false);
});
```

- [ ] **Step 2: Run** `npm test` — expected FAIL.
- [ ] **Step 3: Implement** the six functions.
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** `feat(combi-tracker): config validation, counters, trip validation`.

### Task 4: Google glue, coverage sheet and phone page

**Files:**
- Create: `combi-tracker/apps-script/Code.js`, `combi-tracker/apps-script/Viajes.html`, `combi-tracker/test/helpers/sandbox.js`
- Modify: `combi-tracker/apps-script/Logic.js` (add `formulasCobertura`)
- Test: `combi-tracker/test/code.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces:
  - Logic.js: `formulasCobertura(filasEsperadas: number): { A2: string, B2: string, C2: string, D2: string, E2: string }` — A2 `SORT(UNIQUE(FILTER(...)),1,FALSE)` of `mediciones!B2:B` non-empty; B2/C2 `ARRAYFORMULA(IF(A2:A="",,COUNTIFS(mediciones!B2:B,A2:A,mediciones!E2:E,"ida"|"vuelta",mediciones!O2:O,"")))`; D2 same with `mediciones!O2:O,"<>"` and no sentido; E2 `ARRAYFORMULA(IF(A2:A="",,(B2:B+C2:C)/<filasEsperadas>))`. Each string starts with `=`.
  - Code.js: `tick(): void`, `setup(): void`, `doGet(e): HtmlOutput`, `registrarViaje(evento: string, sentido: string): string`, helper `contextoAhora_(fecha: Date, sentido): Contexto` using `Utilities.formatDate(d, ZONA_HORARIA, "yyyy-MM-dd'T'HH:mm:ssXXX")`, `'yyyy-MM-dd'`, `'u'` (1=Monday), `'H'`, `'m'`.
  - sandbox.js: `crearSandbox({ ahora: Date, props: Object, respuestas: Array<{codigo, cuerpo}|Error>, lockLibre?: boolean }) → { ctx, hojas: {nombre: rows[][]}, fetches: string[], triggers: Array, props }` — loads `Config.js`, `Logic.js`, `Code.js` with `vm.runInContext`, faking `SpreadsheetApp.getActive()` (getSheetByName/insertSheet/appendRow/getRange().setValues/setFormula/setNumberFormat), `PropertiesService.getScriptProperties()`, `UrlFetchApp.fetch` (returns next `respuestas` item; throws it if Error), `LockService.getScriptLock().tryLock/releaseLock`, `ScriptApp` (getProjectTriggers/deleteTrigger/newTrigger().timeBased().everyMinutes().create()), `HtmlService`, and `Utilities.formatDate` (implemented with `Intl.DateTimeFormat` in the given TZ; offset fixed `-03:00`, Argentina has no DST).

`tick()` order (from spec): lock (tryLock(0), exit if busy) → local time → `franjaPara` → `debeMedir` else exit → `claveFranja` equals property `ULTIMA_FRANJA_MEDIDA` → exit → `validarConfig` (if not ok: append one `filaError` with sentido `''` and message `Faltan o son inválidas: <names>`, mark slot, exit) → counter (`CONSULTAS` property) ≥ `TOPE_DIARIO` → one error row, mark slot, exit → for `ida`, `vuelta`: fetch with `{ muteHttpExceptions: true }`, counter+1, append `filaMedicion`; on thrown error append `filaError(ctx,'',e.message,key)` → save counter, mark slot → release lock in `finally`.

`setup()`: create missing sheets `mediciones`, `cobertura`, `viajes`; write headers in row 1 when empty; `setNumberFormat('@')` on `mediciones` columns B and D and on `viajes` column B; write `COLUMNAS_COBERTURA` headers and `formulasCobertura(2 * franjasDelDia(...).length)` into `cobertura`; delete every trigger whose handler is `tick`; create `tick` every 5 minutes.

`registrarViaje`: reject invalid input (throw `Error('Viaje inválido')`); append `[medidoEn, fecha, evento, sentido]` to `viajes`; return `'Registrado: <evento> (<sentido>) HH:MM'`.

`Viajes.html`: mobile viewport, four large buttons (`Subí (ida)`, `Bajé (ida)`, `Subí (vuelta)`, `Bajé (vuelta)`) calling `google.script.run.withSuccessHandler(show).withFailureHandler(show).registrarViaje(evento, sentido)`; shows the returned text. `doGet` serves it with title `Combi` and viewport meta tag.

- [ ] **Step 1: Write the failing tests** (`code.test.js`, using `crearSandbox`; `TUE_1701 = new Date('2026-11-03T20:01:12Z')` = 17:01 local)

```js
test('tick measures both directions once per slot', () => {
  const s = crearSandbox({ ahora: TUE_1701, props: P, respuestas: [okResp, okResp] });
  s.ctx.setup(); s.ctx.tick(); s.ctx.tick();
  const rows = s.hojas.mediciones.slice(1);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r[4]), ['ida', 'vuelta']);
  assert.equal(rows[0][3], '17:00'); assert.equal(rows[0][2], 2);
  assert.equal(s.fetches.length, 2);
});
test('same HH:MM yesterday does not block today', () => { /* props.ULTIMA_FRANJA_MEDIDA = '2026-11-02 17:00' → 2 rows */ });
test('outside window or weekend: no fetch', () => { /* 05:39 local, Saturday 07:00 → fetches 0, rows 0 */ });
test('invalid config: one error row naming props, no fetch', () => { /* ORIGEN_LA_PLATA: 'abc' → 1 row, r[14] includes 'ORIGEN_LA_PLATA', fetches 0 */ });
test('daily cap reached: one error row, no fetch', () => { /* CONSULTAS: '2026-11-03|1000' */ });
test('fetch throws: error row without key', () => { /* respuestas [new Error('Address unavailable: ...key=K...'), okResp] → row0 error has '***', no 'K' key text; row1 ok */ });
test('lock busy: nothing happens', () => { /* lockLibre: false → fetches 0 */ });
test('setup is idempotent', () => { /* setup twice → 1 tick trigger, header row once, cobertura!E2 contains '/94' */ });
test('registrarViaje', () => { /* valid → viajes has 1 row ['…','2026-11-03','subi','vuelta'], returns /Registrado/; invalid → throws */ });
```

Fill each commented test with concrete assertions matching its comment; use a `P` with a key value like `'APIKEY123'` so the leak assertion is meaningful.

- [ ] **Step 2: Run** `npm test` — expected FAIL.
- [ ] **Step 3: Implement** `formulasCobertura`, `sandbox.js`, `Code.js`, `Viajes.html`.
- [ ] **Step 4: Run** `npm test` — expected PASS (all files).
- [ ] **Step 5: Commit** `feat(combi-tracker): apps script glue, coverage sheet, trip page`.

### Task 5: README and install checklist

**Files:**
- Create: `combi-tracker/README.md`

**Interfaces:**
- Consumes: file names from Tasks 1–4, property names from `PROPS`, functions `setup`, `tick`, `doGet`.

- [ ] **Step 1: Write README in Spanish** covering, in order:
  1. Qué hace (2–3 líneas) y link al diseño.
  2. Crear cuenta y API key gratis en developer.tomtom.com (plan Freemium, sin tarjeta).
  3. Abrir la planilla "Combi Tracker" → Extensiones → Apps Script.
  4. Configuración del proyecto → activar "Mostrar el archivo de manifiesto appsscript.json"; pegar `appsscript.json`.
  5. Crear y pegar `Config.js`, `Logic.js`, `Code.js` (borrar `Código.gs` inicial) y el archivo HTML `Viajes`.
  6. Configuración del proyecto → Propiedades del script: cargar las 4 propiedades (formato `lat,lon`, sin espacios), sin subirlas nunca al repo.
  7. Ejecutar `setup` una vez y aceptar permisos.
  8. Implementar → Nueva implementación → Aplicación web (ejecutar como yo, acceso solo yo) → guardar la URL como acceso directo en el celular.
  9. Checklist manual: aparecen las 3 hojas; esperar una franja hábil y ver 2 filas en `mediciones`; `cobertura` muestra la fecha; tocar un botón y ver la fila en `viajes`; revisar Ejecuciones en el editor sin errores.
  10. Desarrollo local: `cd combi-tracker && npm test`.
  11. Plan B (opción C del diseño): si la cobertura de una semana queda < 90% por Apps Script, se pasa a un script en un equipo propio con las mismas columnas.
- [ ] **Step 2: Verify** every file name and property in the README exists: `grep -oE '(Config|Logic|Code)\.js|Viajes|appsscript\.json|TOMTOM_API_KEY|ORIGEN_LA_PLATA|DESTINO_CABA_IDA|ORIGEN_CABA_VUELTA' combi-tracker/README.md | sort -u` lists all 9.
- [ ] **Step 3: Commit** `docs(combi-tracker): install guide`.
