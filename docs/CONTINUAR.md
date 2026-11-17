# CONTINUAR — Hesakã, Congreso del Paraguay (`congresopy`)

Archivo de traspaso. Si sos Claude (en el chat o en Claude Code), leé esto entero antes de hacer nada, y después
`CLAUDE.md`, que tiene los comandos, las reglas y las advertencias al día.
Responder en español (voseo), crítico y sin complacencia.

## Dónde estamos (14/11/2026)

**Fase 1 publicada.** Repo público en GitHub (`alanhlopez/congresopy`), desplegado en Vercel desde `main`.
El sitio se llama **Hesakã** («Congreso del Paraguay · 2023–2028») desde el 15/11/2026 (antes, «Votómetro» desde el rediseño de noviembre y «Monitoreo Congreso del Paraguay» al principio).

Hecho:
- **Datos (pipeline → silver/ → site/datos/congreso/):** votaciones nominales de las dos cámaras desde el
  30/06/2023, validadas contra el sumario de SILpy; nómina con partido, bancada y correcciones manuales
  documentadas; historial de bancadas por fotos semanales de la nómina; fotos de SILpy; comisiones (asesoras y
  especiales) y departamento de cada diputado, ambos desde la ficha de cada legislador.
- **Actualización automática (GitHub Actions):** votaciones martes y viernes, nómina los lunes, tests en cada push.
- **Sitio (10 páginas):** Inicio (con «Menos votos registrados» de los últimos 12 meses), Cámaras (hemiciclo y
  por bancada), Legisladores (lista con filtros por cámara, partido, departamento y estado), perfil (cómo votó,
  con quién vota, comisiones), Votaciones, detalle de votación, Asistencia (presencia del mandato: enjambre, por
  partido, mensual y mapa legislador × mes, consenso vs. reñidas, sala vacía), Comisiones, Proyectos (en
  preparación) y Datos abiertos.
- **Verificaciones de presencia (15/11/2026):** quien preside figura con su voto (no como ausente); Núñez y Rubín
  no tienen períodos fuera del cargo mal contados; las 2 votaciones de Diputados con más de la mitad «ausente»
  (19/05/2026) fueron en una sesión con quórum en sus otras 14 votaciones y sin votos en contra.
- **Rediseño visual (14/11/2026):** sistema de diseño en `congreso.css` (tokens, acento verde petróleo neutral,
  componentes), identidad propia (logotipo en SVG: un ojo con la bandera en el iris; hesakã = transparente, claro), serif del sistema solo en el hero de Inicio.
  Verificado con Playwright en las 9 páginas a 360, 768 y 1280 px, en los dos temas: sin errores de CSP ni
  scroll horizontal; contraste AA en los tokens. Las capturas se regeneran en `docs/capturas/` (fuera de git).
- **Tests:** 91 en verde (regresión del análisis contra el prototipo, reglas del sitio, pipeline sin red).

Pendiente:
- **Proyectos (fase 1b):** la API `datos.congreso.gov.py` da 502 en todos sus endpoints (13 y 14/11/2026).
  Alternativa en curso: una copia de SILpy que bajó un tercero. Hace falta: expedientes 2023-2028 de las dos
  cámaras (número, tipo, título, fecha, cámara de origen, materia, estado) y firmantes con id de legislador y
  rol (autor/cofirmante); el trámite, si está. Antes de usarla: formato, fecha, cobertura y permiso.
- **Disciplina de bloque por fecha:** necesita más fotos semanales de la nómina (se juntan solas).
- **Actualizar comisiones y fichas:** volver a bajar fichas es una excepción a la regla de bronze/; acordarla
  (por ejemplo, una vez por año después del 1 de julio).
- **Datos menores:** fotos de Da Silva y Esquivel (404 en SILpy); bancada de Nakayama («Liberal Independiente»
  en SILpy). Rubín se declara independiente; SILpy todavía no lo actualizó (corrección manual vigente).
- **Perfil: votaciones clave** preparadas detrás de `config.LEYES_CLAVE_PUBLICADAS = False`. Pendiente del
  responsable (16/11/2026: «lo analizo con más tiempo»). `docs/leyes_clave_propuesta.md` es un borrador automático
  difícil de leer (por cámara, con vetos menores y títulos de SILpy); la idea acordada es rehacerlo como 12–15 fichas
  editoriales por ley (qué hace, por qué es clave, posición del gobierno con fuente, votación que cuenta en cada
  cámara), en Markdown o en una página de revisión con «entra / no entra».
- **Fase futura: pestaña «Transparencia»** del perfil (viáticos y declaraciones juradas). Requiere datos que SILpy
  no publica: hay que pedirlos por la Ley 5282 de acceso a la información pública (Congreso y Contraloría). No
  crear una pestaña vacía mientras no estén.
- **Decisiones de producto:** votaciones clave frente al gobierno (pendiente 1, abajo) y el dataset de Kalaguichi.
  Asistencia ya tiene «¿Y cuando se vota algo del Poder Ejecutivo?» (presencia en mensajes y vetos frente al
  resto, sin dirección del voto); «falta cuando la votación es a favor del Ejecutivo» depende del pendiente 1.

Contexto que sigue valiendo:
- **Prototipo:** `../VotometroCongresoPy/` (carpeta hermana). Referencia; no se modifica.
- **Kalaguichi** procesa con OCR unas 275.000 páginas de PDFs del Congreso. Sirve para proyectos, discursos y
  textos (fases siguientes). No reemplaza los votos nominales.
- **Referencia visual:** `docs/referencia-datacp/` (15 capturas de datacp.ar/congreso) es material de terceros:
  queda solo en local (en `.gitignore`). Se toma estructura y patrones, no identidad.

---

Lo que sigue es el prompt original de la tarea 1.1 (ejecutado el 31/10/2026). Se conserva como registro de las
decisiones iniciales; el estado actual es el de arriba y el de `CLAUDE.md`.

## Prompt 1.1 (histórico, ya ejecutado)

````text
Vamos a crear un proyecto nuevo, `congresopy`: un monitor del Congreso paraguayo (votaciones, asistencia y después proyectos) a partir de los datos de SILpy (silpy.congreso.gov.py). Es la tarea 1.1 de la Fase 1: armar la base del repo y migrar lo que ya existe. Todavía no hay que construir páginas.

## Contexto
- La fuente es `./VotometroCongresoPy/`. Es un prototipo que ya funciona: los scripts están en `scripts/` (silpy_votos.py, legisladores.py, codificar.py, analisis.py, dashboard_template.html), los datos en `senado/` y `diputados/` (votacion.csv, voto.csv, fechas.csv, legisladores.csv, codificacion_sugerida.csv, puntos_ideales.csv, ids_*.txt) y el HTML crudo de SILpy en `senado/raw/` (64 MB) y `diputados/raw/` (294 MB). Leé primero su README.md y su CONTINUAR.md enteros.
- NO modifiques nada dentro de `VotometroCongresoPy/`. Copiá, no muevas. Queda como referencia.
- El repo nuevo va en `./congresopy/`, al lado.
- El sitio tiene que poder copiarse más adelante a kalaguichi.com sin reescribirlo. Por eso sigue sus convenciones desde el día uno (ver las reglas abajo). Por ahora se despliega solo, en Vercel.
- La referencia de producto es datacp.ar/congreso (Argentina). Las capturas están en `VotometroCongresoPy/docs/referencia-datacp/`: copialas a `congresopy/docs/referencia-datacp/` junto con la sección "Referencia visual" de CONTINUAR.md. En esta tarea no se usan. (Después se decidió dejarlas fuera de git porque el repo es público.)

## Estructura objetivo
congresopy/
  CLAUDE.md
  README.md
  LICENSE              (AGPL-3.0 para el código; README aclara que los datos derivados son CC BY-SA 4.0 y que la fuente es SILpy, con atribución CC BY 4.0)
  .gitignore           (bronze/, __pycache__, .DS_Store, node_modules, .venv)
  vercel.json          (outputDirectory "site", sin build, headers con la CSP de abajo)
  docs/referencia-datacp/
  pipeline/            (Python, solo biblioteca estándar salvo que sea imprescindible)
    silpy_votos.py, legisladores.py, codificar.py, analisis.py, config.py (rutas y constantes en un solo lugar)
  bronze/silpy/{senado,diputados}/   (HTML crudo copiado de raw/, fuera de git)
  silver/{senado,diputados}/         (los CSV de hoy)
  salidas/votometro/                 (el votometro.html y el dashboard_data.json actuales, generados por analisis.py: es la referencia de regresión)
  site/
    index.html
    assets/css/congreso.css
    assets/js/congreso/main.js
    datos/congreso/                  (vacío por ahora, con .gitkeep)
  tests/
    test_regresion.py
  .github/workflows/                 (vacío por ahora, con .gitkeep)

## Qué hacer, en orden
1. Leé el README de la fuente y los 5 scripts. Antes de crear archivos, mostrame un plan corto: qué rutas cambian en cada script y cualquier cosa que te parezca rota o riesgosa. Esperá mi OK.
2. Creá la estructura y copiá datos y scripts. En los scripts cambiá SOLO las rutas, que pasan a salir de config.py: raw/ → bronze/silpy/{camara}/, CSV → silver/{camara}/, salidas de analisis.py → salidas/votometro/. No cambies lógica ni nombres de columnas. Ojo: legisladores.py sobrescribe nombre_corto, y el legisladores.csv de diputados se armó a mano, así que no lo regeneres.
3. Verificación: corré `reparsear` (o el comando equivalente que use solo caché, sin red), codificar y analisis para las dos cámaras, y compará el dashboard_data.json nuevo con `VotometroCongresoPy/dashboard_data.json`. Tienen que ser idénticos (votaciones, votos, personas, todas las métricas). Si hay diferencias, mostrámelas antes de seguir; no las "arregles".
4. Dejá esa comparación como test en tests/test_regresion.py (pytest; guardá en tests/ el hash o una copia del JSON de referencia).
5. Escribí site/index.html como página vacía pero ya conforme a las reglas: menú de navegación placeholder (Inicio, Cámaras, Legisladores, Votaciones, Proyectos, Datos abiertos), un título, un pie con "Fuente: SILpy – Congreso Nacional (CC BY 4.0)", el botón de tema claro/oscuro funcionando desde main.js y la CSP en <meta>. Servilo con `python3 -m http.server -d site 8000` y comprobá en la consola del navegador que no haya violaciones de CSP.
6. Escribí CLAUDE.md con las reglas de abajo, más los comandos del pipeline y cómo correr los tests.
7. `git init`, primer commit. No crees remoto ni hagas push todavía.

## Reglas para el CLAUDE.md (no negociables)
Sitio (convenciones Kalaguichi):
- HTML, CSS y JS (módulos ES) estáticos. Sin framework, sin bundler, sin paso de build, sin npm en runtime.
- CSP: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'.
- Prohibido: <script> inline, <style> inline, atributos style="", handlers onclick/onX, imágenes data: o blob:, CDNs, Google Fonts. Los estilos dinámicos van con clases o con CSSOM desde JS (element.style.setProperty está permitido).
- Las librerías se vendorizan en site/assets/vendor/<lib>/ con versión fija (Chart.js 4.5.1 cuando haga falta).
- Fuente system-ui. Tema con data-theme="light|dark" en <html>, que respeta prefers-color-scheme y recuerda la elección en localStorage dentro de try/catch.
- Estado de la página en #hash (filtros, legislador seleccionado), para que todo se pueda compartir con un link.
- Rutas siempre relativas: el sitio tiene que funcionar servido en / y también en /instituciones/congreso/.
- El menú se copia en cada HTML (no se inyecta).
- Los datos que consume el sitio viven en site/datos/congreso/ como JSON con un manifiesto.json (archivo, fecha de generación, filas, sha256).
- Cada página muestra fuente, método y límites (por ejemplo que en Diputados "NO VOTA" se registra como AUSENTE).
- Responsive desde 360 px, sin scroll horizontal.
- docs/referencia-datacp/ es referencia de estructura y contenido, no de identidad visual: no copiar su logo, sus tipografías ni sus ilustraciones.
Datos SILpy:
- robots.txt de SILpy no autoriza automatización: mínimo 1,5 s entre requests, User-Agent identificado con contacto, y nunca volver a descargar algo que ya está en bronze/.
- Cada votación parseada se valida contra el sumario (suma de votos por tipo == totales publicados). Si no coincide, no se escribe en silver/ y se reporta.
- Los IDs de período son compartidos por las dos cámaras: 100217=2023-24, 100237=2024-25, 100257=2025-26, 100267=2026-27.
- silver/ es el contrato de datos del proyecto. Hoy se alimenta scrapeando SILpy, pero en el futuro puede venir de datasets que publique kalaguichi.com (por ejemplo, texto de documentos procesados desde PDF). Cada fuente nueva entra como su propio adaptador en pipeline/ que escribe al mismo formato de silver/. El sitio y analisis.py solo leen de silver/ y nunca dependen de cómo se obtuvieron los datos.
- El índice de alineamiento con el Ejecutivo NO se publica en la Fase 1 (queda solo en salidas/votometro).
Trabajo:
- Cambios de lógica del pipeline siempre con el test de regresión en verde, o con una explicación explícita de por qué cambia la referencia.
- Commits chicos y descriptivos.

Al terminar, dame: el árbol final (sin bronze/), el resultado de la comparación del paso 3, la salida de pytest y cualquier duda o decisión que hayas tomado sola.
````

Antes de correrlo: en `scripts/silpy_votos.py`, reemplazá `contacto: completar` del User-Agent por tu email o la URL del repo. Si no, no se puede volver a descargar nada de SILpy.

---

## Referencia visual: datacp.ar/congreso → Paraguay

Capturas en `docs/referencia-datacp/`. Qué tomamos y qué se puede hacer con lo que hay:

| # | Pieza de datacp | Paraguay | Fase | Nota |
|---|---|---|---|---|
| 01 | Portada "Monitor de Actividad del Congreso" | Sí | 1 | Sin ilustración copiada; identidad propia o la de Kalaguichi |
| 02-03 | Cámaras: hemiciclo por bloque + vista por bloque | Sí | 1 | 45 senadores, 80 diputados. Hemiciclo en SVG propio (d3 vendorizado o SVG a mano) |
| 04 | Listado: foto, nombre, distrito, bloque, mandato, "Ver perfil" | Sí | 1 | Distrito: Senado = nacional, Diputados = departamento. Fotos: ver pendiente 2 |
| 05 | Perfil: cabecera + presentismo + 4 pestañas (votó / propuso / dijo / viajó) | Parcial | 1 | Votó: sí. Propuso: sí, con scraper de expedientes. Dijo y viajó: fases 2-3 |
| 05 | Tarjetas Afirmativos / Negativos / Abstenciones / Ausencias | Sí | 1 | Ya calculado (`vc`) |
| 06 | Historial de votaciones con búsqueda y filtros | Sí | 1 | Ya existe en el votómetro (lista por legislador con link a SILpy) |
| 07 | Votaciones por año (barras apiladas) | Sí | 1 | Trivial con `vc` + fechas |
| 08 | Similitud de voto: % de coincidencia con cada legislador, agrupado por bloque | Sí | 1 | Ya existe la matriz de coincidencia; cambia la visualización (beeswarm por bloque) |
| 09 | Votaciones clave vs. gobierno, presidencia por presidencia | Ver pendiente 1 | ? | Choca con "no publicar índice Ejecutivo en Fase 1" |
| 10 | Disciplina de bloque por año + "las veces que se apartó" | Sí | 1 | Ya existe `lealA`; falta por año, el listado de desvíos y bancadas que no son la A |
| 11 | Puesto dentro del bloque (ranking de disciplina) | Sí | 1 | Derivado de lo anterior |
| 12 | Qué propuso: lista por tipo, rol autor/cofirmante, temas, PDF | Sí | 1b | `/web/expedientes` + autoría. Temas: SILpy tiene "materia"; verificar |
| 13 | Evolución mensual de proyectos + perfil vs. promedio de cámara | Sí | 1b | Con autoría scrapeada |
| 14-15 | Cofirmas: por bloque, mapa de red, ranking | Sí | 1b | Requiere lista completa de firmantes por expediente |
| — | "Datos abiertos" por legislador (descargas) | Sí | 1 | CSV por legislador desde datos/congreso |

**Diferencias que no se pueden copiar tal cual (por las convenciones de Kalaguichi):**
- Tipografías propias (serif de títulos, sans redondeada): Kalaguichi usa system-ui y no permite Google Fonts.
- Fotos de legisladores: con `img-src 'self'` hay que descargarlas y servirlas localmente. Revisar licencia y peso.
- Las descargas de PNG de cada gráfico (botón ⤓) no pueden usar `data:` ni `blob:` como imagen. Ofrecer el CSV, o resolver la exportación de otra forma.

## Decisiones pendientes

1. **"Votaciones clave vs. gobierno" (captura 09).** Es lo más atractivo del perfil de datacp y es esencialmente nuestro índice de alineamiento con el Ejecutivo, que decidimos no publicar en Fase 1. Opciones: (a) seguir sin publicarlo; (b) publicarlo solo para una lista editorial chica de leyes clave, con la posición del gobierno documentada a mano por ley, como hace datacp, y no como índice automático. La (b) es más defendible metodológicamente.
2. ~~**Fotos.**~~ Resuelto: fotos de SILpy (CC BY 4.0), servidas desde el sitio; iniciales si no hay.
3. ~~**Presentismo.**~~ Resuelto: se rotula «presencia en votaciones nominales» y cada página lo aclara.
4. **Bloques:** la disciplina tiene que computarse con la bancada vigente en cada fecha (`bancadas_hist.csv`), no con la actual. Espera a tener más fotos de la nómina.

## Preguntas para Kalaguichi (sobre su dataset de PDFs)

- ¿Qué documentos son (proyectos, dictámenes, diarios de sesiones) y de qué períodos?
- ¿Guarda el **ID de expediente de SILpy** por documento? Es la clave para cruzar con votos. Si no se guarda ahora, después es difícil de recuperar.
- ¿En qué formato lo va a publicar (parquet, JSON, CSV), con qué licencia y con qué frecuencia de actualización?
