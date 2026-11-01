# Combi Tracker (fase 1: recolección de datos)

## 1. Qué hace

Mide cada 20 minutos, de lunes a viernes (de 05:40 a 21:00, hora de Argentina), cuánto tarda un auto con tráfico en vivo entre La Plata y CABA, en ida y vuelta, y guarda cada medición como una fila en una planilla de Google Sheets. También tiene una página para el celular con cuatro botones ("Subí" y "Bajé", ida y vuelta) que registra viajes reales en la combi. Todo corre gratis dentro de Google Apps Script, sin servidor propio.

Diseño completo: [`../docs/superpowers/specs/2026-11-01-combi-tracker-design.md`](../docs/superpowers/specs/2026-11-01-combi-tracker-design.md).

**Importante: este repo es público.** La API key y las coordenadas de las paradas viven **solo** en las Propiedades del script de Apps Script (paso 6). Nunca las escribas en un archivo del repo, en un commit, en un issue ni en un mensaje.

## 2. Crear la cuenta y la API key de TomTom (gratis)

1. Entrá a <https://developer.tomtom.com> y elegí "Register" / "Sign up".
2. Creá la cuenta con tu mail y confirmá el mail que te llega. No pide tarjeta.
3. Entrá al panel ("Dashboard") y abrí "Keys".
4. Usá la key que ya viene creada (o creá una nueva) y confirmá que tenga habilitada la **Routing API**.
5. Copiá la key. Alcanza con el plan Freemium (2.500 consultas por día; este proyecto usa 94 por día hábil).

## 3. Abrir el editor de Apps Script

1. Abrí la planilla **"Combi Tracker"** en tu Google Drive.
2. En el menú de la planilla: **Extensiones** → **Apps Script**. Se abre el editor en otra pestaña.

## 4. Pegar el manifiesto `appsscript.json`

1. En el editor, a la izquierda, tocá el engranaje **Configuración del proyecto**.
2. Activá la casilla **Mostrar el archivo de manifiesto "appsscript.json" en el editor**.
3. Volvé a **Editor** (ícono `<>`). Ahora aparece el archivo `appsscript.json` en la lista de archivos.
4. Abrilo, borrá todo su contenido y pegá el contenido de `combi-tracker/apps-script/appsscript.json` de este repo.
5. Guardá (Ctrl+S).

Este archivo fija la zona horaria `America/Argentina/Buenos_Aires` y la configuración de la aplicación web (ejecutar como vos, acceso solo para vos).

## 5. Pegar el código

Todos los archivos están en `combi-tracker/apps-script/`. Los nombres en el editor tienen que coincidir con estos, sin la extensión (el editor la agrega).

1. Creá el archivo `Code`: tocá **+** (junto a "Archivos") → **Secuencia de comandos**, nombralo `Code` y pegá el contenido de `Code.js`. Después borrá el archivo inicial `Código.gs` (menú de tres puntos del archivo → **Eliminar**).
2. Tocá **+** (junto a "Archivos") → **Secuencia de comandos**. Nombralo `Config` y pegá el contenido de `Config.js`.
3. Repetí con `Logic` y pegá el contenido de `Logic.js`.
4. Tocá **+** → **HTML**. Nombralo `Viajes` y pegá el contenido de `Viajes.html` (reemplazá todo lo que traiga por defecto).
5. Guardá todo (Ctrl+S en cada archivo). Al final la lista tiene: `appsscript.json`, `Code`, `Config`, `Logic`, `Viajes`.

## 6. Cargar las Propiedades del script

1. En **Configuración del proyecto**, bajá hasta **Propiedades de la secuencia de comandos**.
2. Tocá **Editar propiedades de la secuencia de comandos** → **Agregar propiedad de la secuencia de comandos**.
3. Cargá estas 4, con el nombre exacto (mayúsculas y guiones bajos):

| Propiedad | Valor |
|---|---|
| `TOMTOM_API_KEY` | la key que copiaste en el paso 2 |
| `ORIGEN_LA_PLATA` | `-34.000000,-57.000000` (esquina de La Plata donde subís) |
| `DESTINO_CABA_IDA` | `-34.000000,-58.000000` (frente a tu trabajo, donde bajás en la ida) |
| `ORIGEN_CABA_VUELTA` | `-34.000100,-58.000100` (parada donde subís en la vuelta) |

   Los valores de la tabla son **solo ejemplos de formato**. Reemplazalos por los reales (los que confirmaste en el mapa).

4. Formato de las coordenadas: `lat,lon` en decimales con punto, una coma en el medio y **sin espacios** (por ejemplo `-34.000000,-57.000000`).
5. Tocá **Guardar propiedades de la secuencia de comandos**.

**Nunca subas estos valores al repo.** El código no los contiene a propósito: los lee de las propiedades en cada ejecución.

## 7. Ejecutar `setup` una vez

1. En el editor abrí el archivo `Code`.
2. En la barra superior elegí la función **`setup`** en el desplegable y tocá **Ejecutar**.
3. La primera vez Google pide permisos: **Revisar permisos** → elegí tu cuenta → si aparece "Google no verificó esta app", tocá **Configuración avanzada** → **Ir a Combi Tracker (no seguro)** → **Permitir**. Es tu propio script.
4. `setup()` crea las hojas `mediciones`, `cobertura` y `viajes` con sus encabezados, deja `fecha` y `franja` como texto en `mediciones`, y borra e instala de nuevo un disparador que ejecuta `tick` cada 5 minutos. Se puede volver a ejecutar sin duplicar nada.

## 8. Publicar la aplicación web (botones del celular)

1. Arriba a la derecha: **Implementar** → **Nueva implementación**.
2. Al lado de "Seleccionar tipo", el engranaje → **Aplicación web**.
3. Configurá:
   - **Ejecutar como**: yo (tu cuenta).
   - **Quién tiene acceso**: solo yo.
4. Tocá **Implementar** y copiá la **URL de la aplicación web**.
5. Abrí esa URL en el navegador del celular (con tu cuenta de Google) y guardala como acceso directo en la pantalla de inicio (en Chrome: menú de tres puntos → **Agregar a la pantalla de inicio**).

Si más adelante cambiás el código, usá **Implementar** → **Administrar implementaciones** → lápiz → **Versión nueva**, para conservar la misma URL.

## 9. Checklist de verificación manual

Primeras comprobaciones (el mismo día de la instalación):

- [ ] En la planilla aparecen las 3 hojas: `mediciones`, `cobertura`, `viajes`.
- [ ] En el editor, en **Activadores** (reloj, a la izquierda), hay uno para `tick`, "Según el tiempo", cada 5 minutos.
- [ ] Esperá una franja hábil (lunes a viernes entre 05:40 y 21:00). Aparecen **2 filas** en `mediciones` (`ida` y `vuelta`), con `error` vacío. Cada franja nueva suma 2 filas más.
- [ ] `cobertura` muestra la fecha de hoy. Mientras no exista la primera fila de `mediciones`, `cobertura!A2` muestra `#N/A`: es normal.
- [ ] En la página del celular, tocá un botón: aparece el mensaje "Registrado: ..." y una fila nueva en `viajes`.
- [ ] En el editor, **Ejecuciones** (a la izquierda): las ejecuciones de `tick` y `setup` figuran como "Completada", sin errores.

Después del **primer día medido completo**:

- [ ] En `cobertura`, `ok_ida` y `ok_vuelta` **no son 0** cuando `mediciones` tiene filas. Si dan 0, las fechas no coinciden por tipo de dato (la fórmula compara fechas como texto).
- [ ] En `mediciones`, las columnas `fecha` (por ejemplo `2026-11-03`) y `franja` (por ejemplo `17:00`) siguen como **texto**: alineadas a la izquierda y sin convertirse en fecha ni en hora.
- [ ] En una fila real, `medido_en` termina en `-03:00` y `dia_semana` es `1` si la medición fue un lunes (1 = lunes ... 5 = viernes).
- [ ] Hay unas 94 filas por día en `mediciones` (47 franjas por 2 sentidos) y `cobertura` muestra al menos 95%.
- [ ] La columna `error` está vacía en todas, salvo problemas reales de TomTom. Si una fila de error dice "Faltan o son inválidas: ...", revisá esas propiedades en el paso 6.

Criterio de terminado de la fase 1: 3 días hábiles seguidos con cobertura de al menos 95% y un viaje real registrado desde el celular.

## 10. Desarrollo local

La lógica pura se prueba en la compu con Node 22, sin dependencias:

```
cd combi-tracker && npm test
```

La parte que usa servicios de Google (planilla, disparador, aplicación web) se prueba a mano con el checklist del paso 9.

## 11. Plan B (opción C del diseño)

Si después de una semana de recolección la cobertura queda por debajo del 90% por causas de Apps Script (disparadores que no corren, cuotas), se pasa a un script en un equipo propio que mida con el mismo formato de columnas. Los datos ya cargados siguen sirviendo.
