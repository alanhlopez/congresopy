# CLAUDE.md — congresopy

**Monitoreo Congreso del Paraguay** (nombre público del sitio; el repo es `congresopy`): votaciones, asistencia y,
más adelante, proyectos, con datos de SILpy (silpy.congreso.gov.py). "Votómetro" es el nombre del prototipo y de su
dashboard heredado en `salidas/votometro/`; no se usa en el sitio. Responder en español, con voseo. Ser crítico y no complaciente.

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
docs/       CONTINUAR.md y docs/referencia-datacp/ (capturas de datacp.ar/congreso)
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

`legisladores.py` exige `--out` y no sobrescribe archivos. Nunca lo apuntes a `silver/{camara}/legisladores.csv`:
los dos tienen `nombre_corto` cargado a mano y el de Diputados se armó entero a mano.

Sitio en local: `python3 -m http.server -d site 8000`

## Tests

```bash
.venv/bin/python -m pytest          # ~1 min; el test de reparseo se saltea si no está bronze/
```

Los dos primeros tests corren `analisis.py` sobre silver/ y escriben en un directorio temporal vía
`CONGRESOPY_SALIDAS`, así que no pisan `salidas/`.

- `test_dashboard_byte_a_byte`: el sha256 del `dashboard_data.json` generado tiene que ser `SALIDA_SHA256`
  (= `salidas/votometro/dashboard_data.json` en git). Es igual en pandas 2.2/numpy 1.26, pandas 2.3/numpy
  2.3 y pandas 3.1/numpy 2.5. Si un cambio lo modifica a propósito, se actualiza el hash y se explica en el commit.
- `test_dashboard_igual_a_referencia`: compara con `tests/referencia/dashboard_data_votometro.json.gz`, el
  JSON original del prototipo. Exacto en todo. La matriz `heat` se compara como pares
  (legislador, legislador) -> valor, porque en el prototipo el orden de sus filas dependía de un empate en
  d1 (en Diputados, vista `resto`, tres legisladores que solo difieren en el 16.º decimal). Desde el commit
  "Orden determinístico de la matriz heat", `analisis.py` redondea d1 a 10 decimales y desempata por id.
- `test_codificar_reproduce_silver`: `codificar.py` regenera exactamente `codificacion_sugerida.csv`.
- `test_reparsear_reproduce_silver`: parsear bronze/ da las mismas filas que silver/ (sin importar el
  orden) y todas cuadran con el sumario.
- `test_listados.py`: política de listados (cerrado nunca se rebaja; abierto con snapshot fechado diario;
  sin contacto no hay request), con una sesión falsa, sin red.
- `test_validacion.py`: con un HTML real de SILpy (`tests/fixtures/silpy/104208.html`) y una copia con un voto
  alterado, verifica que la votación que no cuadra con el sumario no llega a silver/ y que `reparsear` falla.

## Reglas (no negociables)

### Sitio (convenciones Kalaguichi)

- HTML, CSS y JS (módulos ES) estáticos. Sin framework, sin bundler, sin paso de build, sin npm en runtime.
- CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`.
  Va en `<meta http-equiv="Content-Security-Policy">` en cada HTML y como header en `vercel.json`.
- Prohibido: `<script>` inline, `<style>` inline, atributos `style=""`, handlers `onclick`/`onX`, imágenes
  `data:` o `blob:`, CDNs, Google Fonts. Los estilos dinámicos van con clases o con CSSOM desde JS
  (`element.style.setProperty` está permitido).
- Las librerías se vendorizan en `site/assets/vendor/<lib>/` con versión fija (Chart.js 4.5.1 cuando haga falta).
- Fuente system-ui. Tema con `data-theme="light|dark"` en `<html>`, que respeta `prefers-color-scheme` y
  recuerda la elección en localStorage dentro de try/catch (ver `site/assets/js/congreso/main.js`).
- Estado de la página en `#hash` (filtros, legislador seleccionado), para que todo se pueda compartir con un link.
- Rutas siempre relativas: el sitio tiene que funcionar servido en `/` y también en `/instituciones/congreso/`.
- El menú se copia en cada HTML (no se inyecta).
- Los datos que consume el sitio viven en `site/datos/congreso/` como JSON con un `manifiesto.json`
  (archivo, fecha de generación, filas, sha256).
- Cada página muestra fuente, método y límites (por ejemplo, que en Diputados "NO VOTA" se registra como AUSENTE).
- Responsive desde 360 px, sin scroll horizontal.
- `docs/referencia-datacp/` es referencia de estructura y contenido, no de identidad visual: no copiar su
  logo, sus tipografías ni sus ilustraciones.

### Datos SILpy

- robots.txt de SILpy no autoriza automatización: mínimo 1,5 s entre requests (`config.DELAY`), User-Agent
  identificado con contacto (`config.USER_AGENT`, con el contacto desde `CONGRESOPY_CONTACTO`; nunca escribirlo
  en el código), y nunca volver a descargar algo que ya está en bronze/. Única excepción: el listado del
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
- No modificar nada en `../VotometroCongresoPy/`.

## Advertencias conocidas

- Los CSV de silver/ salen de `reparsear` en orden de id de votación. Los del prototipo estaban ordenados
  a mano por fecha; tienen las mismas filas.
- El listado guardado del período abierto (`listado_{S|D}_100267.html`) es del 21-22/10/2026. Para traer
  votaciones nuevas, usar `--refrescar` (ver Comandos). Cuando empiece un período nuevo, actualizar
  `config.PERIODO_ABIERTO` y `config.PERIODOS`.
- El parser busca `formMain:j_idt93:tabDetalle`, un id autogenerado por JSF que puede cambiar. Si no lo
  encuentra, usa la página entera; la validación contra el sumario lo detectaría.
- Diputados vota casi todo por unanimidad y no registra "no vota". Las muestras para el índice del
  Ejecutivo son chicas. Ver `docs/CONTINUAR.md` y el README del prototipo antes de presentar hallazgos.
