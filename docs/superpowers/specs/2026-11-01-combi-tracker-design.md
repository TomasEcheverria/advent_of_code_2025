# Combi Tracker — Diseño (fase 1: recolección de datos)

Fecha: 2026-11-01
Estado: aprobado por el usuario (2026-11-01)

## Intención

El usuario viaja casi todos los días hábiles entre La Plata y CABA en una
combi que tiene horarios fijos. Quiere saber qué salida conviene
tomar, sobre todo a la vuelta, para viajar más rápido y con menos tráfico. A
futuro quiere un aviso diario del tipo "hoy conviene la de las 17:30".

Para eso primero hacen falta semanas de datos de tráfico reales. La fase 1
construye solo el recolector: un proceso gratuito que mide el tiempo de viaje
en ambos sentidos cada pocos minutos y lo guarda en una planilla. El aviso
diario y el análisis son fases posteriores que leen esos mismos datos.

## Objetivos

- Medir el tiempo de viaje en auto con tráfico en vivo, ida y vuelta, cada
  20 minutos, de lunes a viernes, de 05:40 a 21:00 (hora de Argentina).
- Guardar cada medición como una fila en Google Sheets, con datos crudos
  suficientes para analizar después (tiempo con tráfico, sin tráfico,
  histórico, demora, distancia).
- Que los huecos y errores queden visibles: si una consulta falla, igual se
  escribe una fila con el error.
- Registrar viajes reales en la combi ("subí" y "bajé") para calibrar la
  diferencia entre el tiempo en auto y el tiempo real de la combi.
- Costo cero.

## No objetivos (fase 1)

- Aviso diario (mail o Telegram): fase 2.
- Análisis, gráficos y recomendaciones: fase 2 o 3.
- Medir fines de semana.
- Detectar feriados: se mide igual y el análisis los filtra después.
- Forzar el recorrido exacto de la combi con puntos intermedios.
- Google Maps, Waze o scraping de cualquier tipo.

## Anti-objetivos (fracaso aunque funcione)

- Que genere cualquier costo.
- Que la API key, la ubicación de casa o la del trabajo terminen en el repo:
  el repo `advent_of_code_2025` es **público**.
- Huecos silenciosos: días sin datos sin que se note en la planilla.

## Contexto y datos fijos

**Paradas** (dadas por el usuario):

- Ida: sube en una esquina de La Plata y baja frente a su trabajo, en CABA.
- Vuelta: sube en CABA (parada de la vuelta) y baja en la
  misma esquina de La Plata.

Las direcciones y coordenadas exactas **no se versionan**. Viven solo en las
Script Properties del proyecto Apps Script (ver Configuración).

Las coordenadas ya están resueltas: Claude las obtuvo de OpenStreetMap y se
las pasó al usuario en el chat para que confirme cada punto en un mapa. El
plan no necesita un paso de geocodificación. Durante la instalación el
usuario carga los valores confirmados en Script Properties.

Decisión de Claude: los puntos de CABA quedan sobre el mismo lado de la
avenida en que para la combi. Así TomTom no arma un
rodeo para cruzar la avenida.

**Horarios de la combi** (lunes a viernes; se guardan en el código para fases
posteriores, la fase 1 no los usa para decidir cuándo medir):

- Desde La Plata: 06:00, 06:15, 06:30, 07:00, 07:30, 08:00, 08:30, 09:00,
  10:00, 11:00, 12:30, 13:30, 14:30, 15:20, 16:15, 16:45, 17:30, 18:00, 18:45.
- Desde CABA: 06:30, 07:10, 07:30, 08:00, 08:45, 10:30, 12:00, 13:00, 14:00,
  15:00, 15:30, 16:00, 16:30, 17:00, 17:15, 17:30, 18:00, 18:15, 18:45, 19:30.

Las mediciones son cada 20 minutos, alineadas a la hora (:00, :20, :40), por
decisión del usuario. Las salidas en punto, como 17:00 o 18:00, quedan
medidas en su horario exacto. Las de :15, :30 y :45 caen entre dos
mediciones y el análisis las interpola. El intervalo es una constante del
código, así que se puede cambiar sin rediseñar nada.

## Enfoques considerados

| Enfoque | A favor | En contra | Decisión |
|---|---|---|---|
| **A. Apps Script + Google Sheets** | $0, sin servidor, activadores confiables, datos en el Drive del usuario, la fase 2 (MailApp o Telegram) sale del mismo script | JavaScript dentro de Google; la parte Google se prueba a mano | **Elegido por el usuario** |
| B. Python en GitHub Actions | Código y datos versionados | El repo tendría que ser privado y ~190 corridas/día superan los 2.000 min gratis; el cron se atrasa | Descartado |
| C. Python con cron en un equipo propio | Control total, confiable | Necesita un equipo prendido todo el día | **Respaldo** si A no funciona; el usuario tiene un equipo para esto |

Criterio para pasar a C: si después de una semana de recolección la cobertura
es menor al 90% de las filas esperadas por causas de Apps Script (activadores
que no corren, cuotas), se implementa C con el mismo formato de columnas.

## Lo decidido

### Fuente de datos: TomTom Routing API

- Plan gratuito: 2.500 consultas por día, sin tarjeta.
- Endpoint: `https://api.tomtom.com/routing/1/calculateRoute/{origen}:{destino}/json`
  con `origen` y `destino` como `lat,lon`.
- Parámetros: `key`, `traffic=true`, `departAt=now`,
  `computeTravelTimeFor=all`, `travelMode=car`, `routeType=fastest`,
  `maxAlternatives=0`.
- Campos usados de `routes[0].summary`: `travelTimeInSeconds`,
  `noTrafficTravelTimeInSeconds`, `historicTrafficTravelTimeInSeconds`,
  `liveTrafficIncidentsTravelTimeInSeconds`, `trafficDelayInSeconds`,
  `lengthInMeters`, `departureTime`, `arrivalTime`.
- Volumen: 47 franjas por día (de 05:40 a 21:00 inclusive, cada 20 minutos)
  por 2 sentidos = 94 consultas por día hábil, menos del 4% del cupo.

### Infraestructura: Apps Script vinculado a una planilla

- Planilla "Combi Tracker" en el Drive del usuario. La crea Claude con el MCP
  de Google Drive; queda privada.
- Script vinculado a esa planilla (Extensiones, Apps Script). El usuario pega
  el código una vez.
- Zona horaria del proyecto: `America/Argentina/Buenos_Aires` en
  `appsscript.json`.
- Un activador de tiempo **cada 5 minutos** ejecuta `tick()`. Cada franja de
  20 minutos se mide una sola vez, en su primera ejecución.
- Decisión de Claude: el activador no es de 20 minutos. Los activadores de
  Apps Script se corren algunos segundos o minutos, y uno de 20 minutos podría
  saltear una franja. Con uno de 5 minutos, cada franja se mide dentro de sus
  primeros ~5 minutos y no se pierde ninguna.
- `tick()` corre 24/7 pero sale enseguida si no hay nada que hacer. Uso
  estimado: menos de 10 minutos de ejecución por día, contra 90 de cuota
  gratuita.

### Comportamiento de `tick()`

1. Toma un lock del script sin esperar; si otra ejecución está corriendo,
   sale.
2. Calcula día de la semana, hora y minuto locales.
3. Calcula la `franja`: la hora local redondeada hacia abajo a múltiplo de
   20 minutos (`HH:MM`). Si es fin de semana o la franja está fuera de
   05:40–21:00 (inclusive), sale.
4. Si la franja de hoy ya se midió (se guarda `fecha franja` de la última
   medición en Script Properties), sale.
5. Revisa el contador diario de consultas (en Script Properties, por fecha).
   Si llegó al tope de seguridad de 1.000, escribe una fila de error y sale.
6. Para cada sentido (ida y vuelta), hace una consulta a TomTom con
   `muteHttpExceptions`, suma 1 al contador y agrega una fila.
7. Marca la franja como medida, aunque alguna consulta haya fallado: el error
   ya quedó escrito y reintentar arriesga duplicados.
8. Si la respuesta no es 200 o falla la lectura, la fila lleva el estado HTTP y
   un mensaje de error de hasta 200 caracteres; los campos numéricos quedan
   vacíos. No hay reintentos: la próxima franja es en 20 minutos.

### Hoja `mediciones`

Una fila por consulta. Columnas, en este orden:

| Columna | Contenido |
|---|---|
| `medido_en` | Fecha y hora real de la consulta, ISO 8601 con offset (`2026-11-03T17:31:12-03:00`) |
| `fecha` | `YYYY-MM-DD` local |
| `dia_semana` | 1 (lunes) a 5 (viernes) |
| `franja` | `HH:MM` local, redondeada hacia abajo a 20 minutos |
| `sentido` | `ida` o `vuelta` |
| `duracion_s` | `travelTimeInSeconds` |
| `sin_trafico_s` | `noTrafficTravelTimeInSeconds` |
| `historico_s` | `historicTrafficTravelTimeInSeconds` |
| `incidentes_s` | `liveTrafficIncidentsTravelTimeInSeconds` |
| `demora_s` | `trafficDelayInSeconds` |
| `distancia_m` | `lengthInMeters` (sirve para detectar cambios de recorrido) |
| `salida_api` | `departureTime` |
| `llegada_api` | `arrivalTime` |
| `estado_http` | Código HTTP, o vacío si no hubo respuesta |
| `error` | Vacío si salió bien |

Estimación: ~2.100 filas por mes (15 columnas, ~31.000 celdas). El límite de
Sheets es 10 millones de celdas: alcanza para años.

### Hoja `cobertura`

Hace visibles los huecos. Si el activador deja de correr, no hay filas nuevas
y la única señal es la ausencia; esta hoja la vuelve evidente.

- `setup()` la crea con una sola fórmula (sin código que la mantenga). Hay una
  fila por fecha, de la más reciente a la más vieja, con estas columnas:
  - `fecha`
  - filas `ok` de ida
  - filas `ok` de vuelta
  - filas con error
  - porcentaje de cobertura contra las 94 filas esperadas
- `ok` quiere decir que la columna `error` está vacía.
- Un día hábil sin datos se nota como una fecha que falta en la lista.
- Esta hoja es la que se usa para verificar el criterio de terminado.
- Decisión de Claude: un aviso activo cuando baja la cobertura (mail o
  similar) queda para la fase 2, junto con el aviso diario.

### Hoja `viajes` (calibración)

- El mismo script se publica como aplicación web: "ejecutar como yo", acceso
  "solo yo".
- La página muestra cuatro botones grandes, pensados para el celular: "Subí
  (ida)", "Bajé (ida)", "Subí (vuelta)", "Bajé (vuelta)".
- Cada toque agrega una fila con `medido_en`, `fecha`, `evento` (`subi` o
  `baje`) y `sentido`, y muestra una confirmación.
- El usuario guarda la URL como acceso directo en el celular.

### Configuración (Script Properties)

| Propiedad | Contenido |
|---|---|
| `TOMTOM_API_KEY` | API key de TomTom |
| `ORIGEN_LA_PLATA` | `lat,lon` de la esquina de La Plata |
| `DESTINO_CABA_IDA` | `lat,lon` del trabajo (bajada de la ida) |
| `ORIGEN_CABA_VUELTA` | `lat,lon` de la parada de la vuelta en CABA |

- Ida: `ORIGEN_LA_PLATA` → `DESTINO_CABA_IDA`.
- Vuelta: `ORIGEN_CABA_VUELTA` → `ORIGEN_LA_PLATA`.
- Si falta alguna propiedad, `tick()` escribe una fila de error que la nombra y
  no consulta TomTom.

### Instalación

- Una función `setup()` que el usuario ejecuta una vez desde el editor. Crea
  las hojas (`mediciones`, `cobertura`, `viajes`) y los encabezados si
  faltan, borra activadores previos de `tick` e instala uno nuevo cada
  5 minutos. Se puede volver a ejecutar sin duplicar nada.
- Un README en español con los pasos: crear la API key de TomTom, abrir la
  planilla, pegar los archivos, cargar las propiedades, ejecutar `setup()`,
  autorizar permisos y publicar la aplicación web.

### Código y pruebas

- Carpeta `combi-tracker/` dentro de este repo (se puede mover a un repo
  propio más adelante).
- La lógica pura (decidir si medir, calcular la franja, armar la URL,
  convertir la respuesta en fila, validar la configuración) va separada del
  código que toca servicios de Google. Así se prueba en local con `node --test`
  (Node 22), sin dependencias.
- Apps Script carga todos los archivos en un mismo ámbito global y no tiene
  módulos. Los archivos de lógica exportan con
  `if (typeof module !== 'undefined') module.exports = {...}` para que Node
  los pueda importar.
- La parte de Google (planilla, activador, aplicación web) se prueba a mano
  con una lista de verificación en el README.

## Criterio de terminado (fase 1)

- Las pruebas locales pasan.
- Instalado en la cuenta del usuario, durante 3 días hábiles seguidos la hoja
  `cobertura` muestra al menos el 95% de las 94 filas esperadas por día (47
  franjas distintas por sentido). No puede haber errores, salvo los que
  expliquen un problema real de TomTom.
- La aplicación web registra un viaje real desde el celular.

## Riesgos conocidos

- **TomTom puede elegir otro recorrido que la combi** (por ejemplo, Camino
  Centenario en vez de la autopista). `distancia_m` permite detectarlo. Si
  pasa seguido, una fase posterior agrega puntos intermedios para forzar el
  recorrido.
- **El tiempo en auto no es el tiempo de la combi**: paradas, subida de
  pasajeros. Se mide la diferencia con la hoja `viajes`.
- **Activadores de Apps Script**: pueden dispararse con algunos minutos de
  corrimiento o fallar en momentos puntuales. Se guarda la hora real y la
  franja; los huecos se ven como franjas faltantes.

## Queda a criterio del implementador

- Nombres internos de funciones y archivos, siempre que la lógica pura quede
  separada y probada.
- Diseño visual de la página de la aplicación web, mientras los botones sean
  grandes y se usen bien en el celular.
- Cómo se ordena el README, mientras cubra los pasos de Instalación.
