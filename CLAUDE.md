# CLAUDE.md — congresopy

**Hesakã** (nombre público del sitio desde el 15/11/2026, con el subtítulo «Congreso del Paraguay · 2023–2028»; el
repo es `congresopy`): votaciones, asistencia y, más adelante, proyectos, con datos de SILpy (silpy.congreso.gov.py).
Nombres anteriores: «Monitoreo Congreso del Paraguay» (hasta el rediseño de noviembre de 2026) y «Votómetro» (del
rediseño al 15/11/2026). «Votómetro» sigue siendo el nombre del prototipo: `../VotometroCongresoPy/` y
`salidas/votometro/` (el dashboard heredado, que no se publica) no cambian de nombre. Responder en español, con voseo. Ser crítico y no complaciente.

Contexto y decisiones de producto: `docs/CONTINUAR.md`. Prototipo original (no tocar, sirve de referencia):
`../VotometroCongresoPy/`.

## Estructura

```
pipeline/   Python: adaptadores de fuentes -> silver/, y análisis. Rutas y constantes en pipeline/config.py
bronze/     datos crudos tal como se bajaron (fuera de git). bronze/silpy/{senado,diputados}/
silver/     CSV limpios y validados por cámara: el contrato de datos del proyecto
salidas/    productos del análisis que no se publican en el sitio (salidas/votometro/ = referencia de regresión)
site/       el sitio estático (lo que se despliega). Datos en site/datos/congreso/
tests/      pytest. tests/referencia/ guarda el JSON de referencia del prototipo
docs/       CONTINUAR.md; docs/referencia-datacp/ (capturas de datacp.ar/congreso) es solo local, fuera de git
```

## Comandos

Entorno (una vez): `uv venv -p 3.12 .venv && uv pip install -p .venv/bin/python -r requirements.txt`

Todo funciona desde cualquier directorio: las rutas salen de `pipeline/config.py`. `--camara` es `S` o `D`.

```bash
P=.venv/bin/python
# Reconstruir silver/ desde bronze/ (sin red). Tiene que terminar en "0 errores, 0 no cuadran con el sumario"
$P pipeline/silpy_votos.py reparsear --camara S
$P pipeline/silpy_votos.py reparsear --camara D
# Fechas y sesiones desde los listados guardados en bronze/ (sin red si ya están)
$P pipeline/silpy_votos.py fechas --camara S --periodos 100217 100237 100257 100267
# Codificación sugerida de la posición del Ejecutivo -> silver/{camara}/codificacion_sugerida.csv
$P pipeline/codificar.py S
$P pipeline/codificar.py D
# Análisis -> salidas/votometro/ (dashboard_data.json, votometro.html, {camara}/puntos_ideales.csv)
$P pipeline/analisis.py
# Datos del sitio -> site/datos/congreso/{senado,diputados}/{legisladores,votaciones,votos}.json + manifiesto.json
$P pipeline/exportar_sitio.py
# Probar el parser con un HTML guardado
$P pipeline/silpy_votos.py parsear-local bronze/silpy/senado/109395.html
```

Con red. El contacto del User-Agent no va en el código: sale de la variable `CONGRESOPY_CONTACTO`.
`config.requerir_contacto()` corta con un error si falta, y solo la llaman los comandos que descargan
(`listar`, `detalle` y `fechas` cuando el listado no está en bronze/). `reparsear`, `parsear-local`,
`codificar.py`, `analisis.py` y los tests andan sin la variable.

```bash
cp .env.example .env            # completar CONGRESOPY_CONTACTO (.env no se versiona)
set -a && . ./.env && set +a
# Actualizar el período abierto (config.PERIODO_ABIERTO): snapshot nuevo del listado, detalle de lo nuevo, fechas
$P pipeline/silpy_votos.py listar --camara S --periodo 100267 --refrescar > silver/senado/ids_100267.txt
$P pipeline/silpy_votos.py detalle --camara S --ids silver/senado/ids_100267.txt
$P pipeline/silpy_votos.py fechas --camara S --periodos 100217 100237 100257 100267
$P pipeline/silpy_votos.py reparsear --camara S
```

`listar` y `fechas` leen el listado guardado en bronze/ y solo descargan si no existe. Con `--refrescar`, y
solo para el período abierto, bajan un snapshot `listado_{S|D}_{periodo}_{AAAA-MM-DD}.html` (uno por día; nunca
pisa los anteriores) y desde ahí usan siempre el más reciente. En un período cerrado `--refrescar` se ignora.

`detalle` saltea las votaciones que ya están en `silver/votacion.csv` y las de `silver/{camara}/rechazadas.csv`
(bajadas cuyo detalle no cuadra con el sumario: no entran en silver/ y no se vuelven a bajar); termina con
código 1 si alguna nueva no cuadró o falló. `fechas` ordena por período e id, y para un período cerrado cuyo
listado no está en bronze/ reutiliza sus fechas de silver/ en vez de bajarlo. `reparsear` se niega a escribir
si silver/ tiene votaciones cuyo HTML no está en bronze/ (no las borra).

### Actualización automática (GitHub Actions)

`.github/workflows/votaciones.yml` corre martes y viernes: refresca los listados del período abierto, baja las
votaciones nuevas, regenera codificación, análisis y datos del sitio, corre los tests y commitea si cambió algo
(Vercel despliega desde ese push). En Actions bronze/ arranca vacío; los HTML que baja quedan 90 días como
artifact `bronze-votaciones`. Para tenerlos en local (antes de cualquier `reparsear`):

```bash
gh run list --workflow votaciones.yml --limit 5         # elegir la corrida
gh run download <run-id> -n bronze-votaciones -D bronze/silpy
```

Nunca pisa nada: los HTML de votaciones son los mismos que bajaría `detalle`, y los listados son snapshots
fechados. Si una corrida termina en rojo, mirar el paso de listados: o falló la red (se reintenta sola en la
próxima corrida) o una votación no cuadró con el sumario (queda en `rechazadas.csv`, revisarla a mano).
`nomina-semanal.yml` y `votaciones.yml` comparten el grupo de concurrencia `datos-silpy` y hacen
`git pull --rebase` antes del push: después de una corrida, hacé `git pull` en local antes de commitear.

Fotos (`pipeline/fotos.py`): `descargar` baja de `{BASE}/images/{id}.jpg` las que faltan en `bronze/silpy/fotos/`
(con contacto, 1,5 s entre requests, nunca repite, rechaza lo que no sea JPEG o PNG); `silver` guarda en
`silver/fotos/` una miniatura de 160 px de cada una (Pillow; el original queda en bronze/); `exportar_sitio.py` las publica en `site/datos/congreso/fotos/`, agrega `foto` en
`legisladores.json` y un resumen `fotos` en el manifiesto. Sin fotos, el sitio muestra iniciales.

```bash
$P pipeline/fotos.py descargar && $P pipeline/fotos.py silver && $P pipeline/exportar_sitio.py
```

Historial de bancadas (`pipeline/bancadas.py`): SILpy solo publica la nómina de hoy, así que se guardan fotos
fechadas y se comparan. `foto` baja la nómina de cada cámara (2 requests, una foto por día) a
`bronze/silpy/nomina/` y la parsea a `silver/nomina/{S|D}/{fecha}.csv` (en git); `historial` arma
`silver/{camara}/bancadas_hist.csv` (tramos con visto_desde, visto_hasta y cambio_detectado; una columna vacía en
toda una foto se toma como no registrada, y un partido vacío en una fila también: se conserva el anterior); `sincronizar` pasa partido, bancada, cargo y estado de la última foto
a `legisladores.csv`, conserva `nombre_corto`, no borra un dato que SILpy dejó vacío y aplica después
`silver/{camara}/correcciones_legisladores.csv` (id_legislador, campo, valor, fuente). Las primeras fotos son las
nóminas del prototipo (S 21/10/2026, D 22/10/2026; ver `silver/nomina/LEEME.md`). El workflow
`.github/workflows/nomina-semanal.yml` lo corre los lunes (necesita remoto y el secreto `CONGRESOPY_CONTACTO`).

```bash
$P pipeline/bancadas.py foto && $P pipeline/bancadas.py historial && $P pipeline/bancadas.py sincronizar
$P pipeline/analisis.py && $P pipeline/exportar_sitio.py
```

Comisiones (`pipeline/comisiones.py`): salen de la pestaña «Comisiones» de la ficha de cada legislador
(`{BASE}/legislador/{id}`), con dos tablas (Asesoras, por año legislativo; Especiales y de amistad, por mandato) que
se identifican por el título de la pestaña, no por el id `j_idtNNN` de JSF. `descargar` baja a `bronze/silpy/fichas/`
las que faltan (una request por legislador de la nómina, 1,5 s, nunca repite) y anota la fecha en
`silver/fichas.csv`; `silver` escribe `silver/{camara}/comisiones.csv` (id_legislador, tipo, periodo, periodo_id,
id_comision, comision, cargo). Una ficha cuyo `<title>` no empieza con el nombre de la nómina, o sin la pestaña,
no entra y el comando sale con 1. La composición cambia sobre todo al inicio de cada período (1 de julio):
volver a bajar las fichas para actualizarla es una excepción a la regla de bronze/ y hay que acordarla con el
responsable del proyecto antes (como se hizo con los snapshots del listado del período abierto).

```bash
$P pipeline/comisiones.py descargar && $P pipeline/comisiones.py silver && $P pipeline/exportar_sitio.py
```

Circunscripciones (`pipeline/circunscripciones.py`, sin red): el campo «Circunscripción» de las mismas fichas da
`silver/{camara}/circunscripciones.csv` (id_legislador, circunscripcion, departamento). Senado: siempre Nacional,
departamento vacío. Diputados: uno de los 18 de `DEPARTAMENTOS` (Capital incluida); un valor desconocido no escribe
nada y sale con 1. `exportar_sitio.py` lo publica como `departamento` en `legisladores.json` (null en el Senado).
Un legislador nuevo necesita su ficha (`comisiones.py descargar`) antes de correrlo.

```bash
$P pipeline/circunscripciones.py && $P pipeline/exportar_sitio.py
```

`legisladores.py` exige `--out` y no sobrescribe archivos (su parser, `parsear_nomina`, lo usa bancadas.py). Nunca lo apuntes a `silver/{camara}/legisladores.csv`:
los dos tienen `nombre_corto` cargado a mano y el de Diputados se armó entero a mano.

Sitio en local: `python3 -m http.server -d site 8000`

## Sitio

| Página | Qué muestra | Estado en el #hash |
|---|---|---|
| `index.html` | Resumen de cada cámara y últimas votaciones | — |
| `camaras.html` | Composición actual: hemiciclo por partido o agrupado por bancada | `camara`, `vista` |
| `legisladores.html` | Listado de las dos cámaras con búsqueda y filtros | `q`, `camara`, `partido`, `departamento`, `estado`, `orden` |
| `legislador.html` | Perfil: presencia, conteo de votos, votos por año, similitud de voto, historial | `camara`, `id`, `q`, `voto`, `tipo`, `anio` |
| `votaciones.html` | Votaciones de una cámara con buscador y filtros | `camara`, `q`, `tipo`, `anio`, `res` |
| `votacion.html` | Detalle: textos, totales, hemiciclo por voto, votos por partido y lista nominal | `camara`, `id` |
| `asistencia.html` | Presencia en votaciones nominales del mandato: buscador de legisladores (resalta a la persona en todos los gráficos), indicadores y enjambre, por partido, mensual y mapa legislador × mes, consenso vs. reñidas y mensajes/vetos del Ejecutivo, sala vacía | `camara`, `orden`, `seleccionado` |
| `proyectos.html` | En preparación (fase 1b: expedientes y autoría) | — |
| `datos.html` | Datos abiertos: archivos del manifiesto, formato y licencia | — |
| `acerca.html` | Qué es el proyecto, fuentes, metodología resumida, crédito a datacp.ar y licencia | — |

JS en `site/assets/js/congreso/`: `main.js` (tema y fecha de datos, en todas las páginas), `lib/` (módulos
compartidos: `dom.js` arma nodos sin HTML como texto, `estado.js` el #hash, `datos.js` la carga de JSON,
`formato.js` formatos y catálogos de votos y partidos, `hemiciclo.js` el SVG, `componentes.js` piezas comunes)
y `paginas/<pagina>.js` (uno por página). Colores: cada clase `.p-*` (partido) y `.v-*` (voto) define `--c`, y
los componentes solo leen `--c`; los valores por tema están en los tokens de `congreso.css`. Los partidos usan
los colores oficiales de la nómina de SILpy (columna `color`), ajustados solo donde el original no se ve contra
el fondo (PEN y PDP más oscuros y PPC gris en tema claro; Cruzada Nacional negro con borde fino en los dos temas).

- El menú está copiado igual en las 11 páginas entre `<!-- MENU: ... -->` y `<!-- /MENU -->`. Si se cambia, se
  cambia en todas (lo verifica `test_menu_identico_en_cada_pagina`).
- Decisiones: fotos de SILpy (CC BY 4.0) con aro del color del partido, o iniciales si no hay; la
  «presencia» es no figurar como AUSENTE en votaciones nominales (en el Senado «no vota» cuenta como presente);
  el hemiciclo ordena oposición a la izquierda y ANR a la derecha. No se publica nada del índice del Ejecutivo
  ni la disciplina de bloque (pendiente: historial de bancadas con fechas).

## Tests

```bash
.venv/bin/python -m pytest          # ~1 min; el test de reparseo se saltea si no está bronze/
```

CI: `.github/workflows/tests.yml` corre la misma suite en cada push (sin bronze/, así que se saltean los 2 tests
de reparseo; en `votaciones.yml`, con bronze/ parcial, también). Ningún test hace requests a SILpy.

Los dos primeros tests prueban la LÓGICA de `analisis.py`: lo corren sobre una copia congelada de los insumos
(`tests/referencia/silver_votometro.tar.gz`, el silver/ de la migración) vía `CONGRESOPY_SILVER`, y escriben en
un directorio temporal vía `CONGRESOPY_SALIDAS`. Así, corregir datos o sumar votaciones en silver/ no los
rompe; cambiar la lógica sí. Los datos vivos (`salidas/`, `site/datos/`) se regeneran y se commitean aparte.

- `test_dashboard_byte_a_byte`: el sha256 del `dashboard_data.json` generado sobre los insumos congelados tiene
  que ser `SALIDA_SHA256`. Es igual en pandas 2.2/numpy 1.26, pandas 2.3/numpy
  2.3 y pandas 3.1/numpy 2.5. Si un cambio lo modifica a propósito, se actualiza el hash y se explica en el commit.
- `test_dashboard_igual_a_referencia`: compara con `tests/referencia/dashboard_data_votometro.json.gz`, el
  JSON original del prototipo. Exacto en todo. La matriz `heat` se compara como pares
  (legislador, legislador) -> valor, porque en el prototipo el orden de sus filas dependía de un empate en
  d1 (en Diputados, vista `resto`, tres legisladores que solo difieren en el 16.º decimal). Desde el commit
  "Orden determinístico de la matriz heat", `analisis.py` redondea d1 a 10 decimales y desempata por id.
- `test_codificar_reproduce_silver`: `codificar.py` regenera exactamente `codificacion_sugerida.csv`.
- `test_reparsear_reproduce_silver`: parsear bronze/ da las mismas filas que silver/ (sin importar el
  orden) y todas cuadran con el sumario.
- `test_exportar.py`: `site/datos/congreso/` está al día con silver/, el manifiesto coincide con los archivos
  (sha256, bytes, filas), las cadenas de `votos.json` son idénticas al `vc` de `analisis.py`, los conteos
  cierran con los totales y ningún JSON del sitio trae campos del índice del Ejecutivo.
- `test_exportar.py` también recalcula `presencia.json` y `asistencia.json` desde `votos.json` y la nómina
  (con el mismo criterio entre los dos), y prueba empates y mínimo de elegibilidad con datos sintéticos.
- `test_bancadas.py`: historial (cambios, altas, bajas, columnas no registradas), sincronizar (conserva
  nombre_corto, no borra vacíos, aplica correcciones, respeta el fin de línea) y rechazo de nóminas incompletas.
- `test_fotos.py`: descarga sin repetir, rechazo de respuestas que no son imágenes, sin contacto no hay requests,
  paso a silver/ y publicación en el sitio con su resumen en el manifiesto (sin red).
- `test_sitio.py`: reglas del sitio sobre cada archivo de `site/`: CSP exacta en cada HTML; nada inline (script,
  style, `style=""`, `onX`), nada externo y nada `data:`/`blob:`; rutas locales que existen; menú idéntico en
  todas las páginas; bloque de fuente, método y límites; JS sin `innerHTML`/`eval`/imports o fetch externos y
  localStorage solo dentro de try/catch; CSS sin `@import` ni `url()` externos.
- `test_listados.py`: política de listados (cerrado nunca se rebaja; abierto con snapshot fechado diario;
  sin contacto no hay request), con una sesión falsa, sin red.
- `test_validacion.py`: con un HTML real de SILpy (`tests/fixtures/silpy/104208.html`) y una copia con un voto
  alterado, verifica que la votación que no cuadra con el sumario no llega a silver/ y que `reparsear` falla.
- `test_circunscripciones.py`: con fichas reales de un senador y un diputado, el departamento se lee bien (Concepción
  sin tilde en SILpy incluida), se rechazan la ficha de otro legislador y un valor desconocido, silver/ cubre las 80
  bancas en los 18 departamentos y el sitio lo publica (null en el Senado).
- `test_actualizacion.py`: sin bronze/ completo (como en Actions), `detalle` registra la rechazada y no la
  vuelve a bajar, `fechas` no baja un período cerrado que ya está en silver/ y `reparsear` no borra lo que falta.

## Reglas (no negociables)

### Sitio (convenciones Kalaguichi)

- HTML, CSS y JS (módulos ES) estáticos. Sin framework, sin bundler, sin paso de build, sin npm en runtime.
- CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`.
  Va en `<meta http-equiv="Content-Security-Policy">` en cada HTML y como header en `vercel.json`.
- Prohibido: `<script>` inline, `<style>` inline, atributos `style=""`, handlers `onclick`/`onX`, imágenes
  `data:` o `blob:`, CDNs, Google Fonts. Los estilos dinámicos van con clases o con CSSOM desde JS
  (`element.style.setProperty` está permitido).
- Las librerías se vendorizan en `site/assets/vendor/<lib>/` con versión fija (Chart.js 4.5.1 cuando haga falta).
- Fuente system-ui. Única excepción, decidida en el rediseño: el h1 del hero de Inicio usa la pila serif del
  sistema (`--fuente-serif`: Iowan Old Style, Charter, Georgia…; nada se descarga). Sistema de diseño: tokens
  en `:root` de `congreso.css` (escalas tipográfica y de espaciado, radios 8/16, dos sombras, acento verde
  petróleo sin relación con ningún partido). Los colores de partido se usan solo para datos. Tema con `data-theme="light|dark"` en `<html>`, que respeta `prefers-color-scheme` y
  recuerda la elección en localStorage dentro de try/catch (ver `site/assets/js/congreso/main.js`).
- Estado de la página en `#hash` (filtros, legislador seleccionado), para que todo se pueda compartir con un link.
- Rutas siempre relativas: el sitio tiene que funcionar servido en `/` y también en `/instituciones/congreso/`.
- El menú se copia en cada HTML (no se inyecta).
- Los datos que consume el sitio viven en `site/datos/congreso/` como JSON con un `manifiesto.json`
  (archivo, fecha de generación, filas, sha256). Los genera solo `pipeline/exportar_sitio.py`, desde silver/;
  no se editan a mano. Después de cambiar silver/, volver a correrlo y commitear el resultado (lo verifica
  `test_site_datos_al_dia_con_silver`). Formato:
  - `{camara}/votaciones.json`: lista, más reciente primero (fecha, sesión, expediente, título, acápite,
    moción, resultado, totales, `url` a SILpy).
  - `{camara}/votos.json`: `orden` (ids de votación, en el orden de votaciones.json), `codigos` y, por id de
    legislador, una cadena con un carácter por votación (S N A X V 1 2 3; `-` = fuera del cargo).
  - `{camara}/legisladores.json`: datos de la nómina y `conteo` de votos por tipo.
  - `{camara}/asistencia.json`: página Asistencia (todo el mandato). Lo calcula `exportar_asistencia()` con
    el mismo criterio de presencia que Inicio; umbrales en `config.py` (`ASISTENCIA_*`: mínimo 50 votaciones
    posibles, consenso < 5 %, reñida >= 25 %, 15 de cada tipo, 10 votaciones con más ausentes). El bloque
    `poder_ejecutivo` compara la presencia en votaciones sobre mensajes y vetos del Ejecutivo con el resto:
    `tema_pe()` usa la misma regla de texto que la `categoria` de `codificar.py` (lo verifica un test), pero
    NO la dirección del voto, que sigue sin publicarse.
  - `{camara}/presencia.json`: ranking de menor presencia de Inicio (últimos 12 meses hasta la última votación
    de la cámara; solo en ejercicio y con al menos la mitad de las votaciones posibles; puestos 1 a 3 con
    empates; mediana). Lo calcula `exportar_presencia()`; quien preside figura con su voto (verificado con la
    Mesa Directiva de SILpy), así que no se excluye a nadie.
- Cada página muestra fuente, método y límites (por ejemplo, que en Diputados "NO VOTA" se registra como AUSENTE).
- Responsive desde 360 px, sin scroll horizontal.
- Crédito a datacp.ar: en el pie de todas las páginas, al final de Inicio y en `acerca.html` («Idea y estructura
  inspiradas en el Monitor de Actividad del Congreso de datacp.ar», con link). Sin su logo ni su nombre como marca.
- `docs/referencia-datacp/` es referencia de estructura y contenido, no de identidad visual: no copiar su
  logo, sus tipografías ni sus ilustraciones.

### Datos SILpy

- robots.txt de SILpy no autoriza automatización: mínimo 1,5 s entre requests (`config.DELAY`), User-Agent
  identificado con contacto (`config.USER_AGENT`, con el contacto desde `CONGRESOPY_CONTACTO`; nunca escribirlo
  en el código; solo ASCII, porque SILpy responde HTTP 400 a headers con tildes), y nunca volver a descargar algo que ya está en bronze/. Única excepción: el listado del
  período abierto (`config.PERIODO_ABIERTO`), que se refresca a pedido con `--refrescar` como snapshot fechado
  nuevo, uno por día como máximo. El detalle de una votación ya guardada no se vuelve a bajar nunca.
- Cada votación parseada se valida contra el sumario (suma de votos por tipo == totales publicados). Si no
  coincide, no se escribe en silver/ y se reporta. Implementado en `silpy_votos.parsear_bronze()`:
  `reparsear` escribe solo las válidas, lista las rechazadas en stderr y termina con código 1; `detalle` las
  deja en bronze/ sin pasarlas a silver/. La columna `valida` de `votacion.csv` queda siempre en True.
- Los IDs de período son compartidos por las dos cámaras: 100217=2023-24, 100237=2024-25,
  100257=2025-26, 100267=2026-27.
- silver/ es el contrato de datos del proyecto. Hoy se alimenta scrapeando SILpy, pero en el futuro puede
  venir de datasets que publique kalaguichi.com (por ejemplo, texto de documentos procesados desde PDF).
  Cada fuente nueva entra como su propio adaptador en `pipeline/` que escribe al mismo formato de silver/.
  El sitio y `analisis.py` solo leen de silver/ y nunca dependen de cómo se obtuvieron los datos.
- El índice de alineamiento con el Ejecutivo NO se publica en la Fase 1 (queda solo en `salidas/votometro`).
  `salidas/votometro/votometro.html` además carga CDNs y Google Fonts: nunca se copia a `site/`.

### Trabajo

- Cambios de lógica del pipeline siempre con el test de regresión en verde, o con una explicación explícita
  de por qué cambia la referencia.
- Commits chicos y descriptivos.
- Toda corrección a mano en silver/ se anota en `docs/correcciones_manuales.md` (fecha, archivo, cambio, fuente)
  y va seguida de `analisis.py` + `exportar_sitio.py`.
- No modificar nada en `../VotometroCongresoPy/`.

## Advertencias conocidas

- Los CSV de silver/ salen de `reparsear` en orden de id de votación. Los del prototipo estaban ordenados
  a mano por fecha; tienen las mismas filas.
- El listado guardado del período abierto (`listado_{S|D}_100267.html`) es del 21-22/10/2026. Para traer
  votaciones nuevas, usar `--refrescar` (ver Comandos). Cuando empiece un período nuevo, actualizar
  `config.PERIODO_ABIERTO` y `config.PERIODOS`.
- El parser busca `formMain:j_idt93:tabDetalle`, un id autogenerado por JSF que puede cambiar. Si no lo
  encuentra, usa la página entera; la validación contra el sumario lo detectaría.
- Proyectos (fase 1b): SILpy enlaza desde cada ficha a la API `http://datos.congreso.gov.py/v2/api/legislador/{id}/expedientes`
  (y `/v2/api/votacion/{id}`). Solo responde por http; por https da 404. El 13/11/2026 respondía 502 Proxy Error (y el 14/11 toda la API, incluida la raíz y `/votacion/{id}`),
  también en un reintento un minuto después: el servidor de atrás no contesta. La pestaña «Expedientes/Proyectos»
  de la ficha se carga por AJAX de PrimeFaces y, reproducida, devolvió «No hay expedientes» incluso para
  legisladores con proyectos. Exploración guardada en `bronze/silpy/exploracion/` y `bronze/datoscongreso/exploracion/`.
- SILpy no publica el historial de bancadas con fecha (la pestaña «Trayectoria Legislativa» solo da el partido
  por período de 5 años): se reconstruye con fotos de la nómina (ver Comandos). Un cambio se ubica entre dos
  fotos, no en un día exacto. `analisis.py` todavía usa la bancada actual; la disciplina de bloque por fecha
  queda para cuando haya varias fotos.
- Diputados vota casi todo por unanimidad y no registra "no vota". Las muestras para el índice del
  Ejecutivo son chicas. Ver `docs/CONTINUAR.md` y el README del prototipo antes de presentar hallazgos.
