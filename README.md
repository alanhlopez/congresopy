# congresopy — Monitoreo Congreso del Paraguay

**Monitoreo Congreso del Paraguay** es el nombre público del sitio. Muestra cómo vota y cuándo falta cada senador y cada diputado del período
2023-2028, votación por votación. Los datos salen de [SILpy](https://silpy.congreso.gov.py/), el Sistema de
Información Legislativa del Congreso Nacional.

Estado: **Fase 1**. Pipeline migrado desde el prototipo `VotometroCongresoPy` y sitio con las páginas de
Cámaras, Legisladores (listado y perfil), Votaciones (listado y detalle) y Datos abiertos. Proyectos queda
para la fase 1b.

## Qué hay

| Carpeta | Contenido |
|---|---|
| `pipeline/` | Scraper y parser de SILpy, codificación del Ejecutivo y análisis. Rutas en `pipeline/config.py`. |
| `silver/{senado,diputados}/` | CSV validados: `votacion`, `voto`, `fechas`, `legisladores`, `codificacion_sugerida`, `ids_<período>.txt`. |
| `salidas/votometro/` | Dashboard del prototipo (`votometro.html`) y sus datos. Solo para uso interno y regresión: no se publica. |
| `site/` | Sitio estático que se despliega (HTML, CSS y JS sin build). |
| `site/datos/congreso/` | Datos abiertos que usa el sitio: JSON por cámara (legisladores, votaciones, votos) y `manifiesto.json` con sha256. Los genera `pipeline/exportar_sitio.py`. |
| `tests/` | Test de regresión contra el prototipo. |
| `docs/` | Notas de traspaso (`CONTINUAR.md`) y capturas de referencia de datacp.ar/congreso. |
| `bronze/` | HTML crudo de SILpy (~360 MB). **No está en git.** |

Cobertura actual: Senado, 300 votaciones (30/06/2023 a 14/10/2026). Diputados, 865 votaciones (05/07/2023 a 22/09/2026).

## Uso

```bash
uv venv -p 3.12 .venv && uv pip install -p .venv/bin/python -r requirements.txt
.venv/bin/python pipeline/silpy_votos.py reparsear --camara S   # silver/ desde bronze/, sin red
.venv/bin/python pipeline/codificar.py S
.venv/bin/python pipeline/analisis.py                           # salidas/votometro/
.venv/bin/python pipeline/exportar_sitio.py                     # site/datos/congreso/
.venv/bin/python -m pytest
python3 -m http.server -d site 8000                             # sitio en http://localhost:8000
```

Todos los comandos, las reglas del proyecto y las advertencias están en [`CLAUDE.md`](CLAUDE.md).

## Datos crudos

`bronze/` no se versiona por su tamaño. Sin él funcionan `codificar.py`, `analisis.py`, el sitio y casi todos
los tests: solo se saltea el de reparseo. Para descargar de SILpy hace falta la variable de entorno
`CONGRESOPY_CONTACTO`, porque el User-Agent tiene que identificar a quién contactar. No se escribe en el código:

```bash
cp .env.example .env      # completá CONGRESOPY_CONTACTO (.env no se versiona)
set -a && . ./.env && set +a
```

Sin la variable, los comandos que descargan (`listar`, `detalle` y `fechas` si le falta un listado) cortan con
un error. El resto del pipeline y los tests funcionan igual. SILpy no autoriza
la automatización en su robots.txt, así que el scraper espera 1,5 s entre requests y nunca vuelve a bajar
lo que ya está en `bronze/`.

Las votaciones nuevas se traen solas: `.github/workflows/votaciones.yml` corre martes y viernes (2 requests
por corrida más 1 por votación nueva) y la nómina se fotografía los lunes (`nomina-semanal.yml`). Ver CLAUDE.md,
«Actualización automática», para traer a `bronze/` local los HTML que bajan esos workflows.

## Licencias

- **Código:** [GNU AGPL-3.0](LICENSE).
- **Datos derivados** (`silver/`, `site/datos/`, `salidas/`): [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es).
- **Fuente:** SILpy – Congreso Nacional del Paraguay, publicado bajo
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.es). Al reutilizar estos datos, citá al
  Congreso Nacional como fuente original.
- Las capturas de datacp.ar que usamos como referencia de estructura son de sus autores: quedan solo en local
  (`docs/referencia-datacp/`, en `.gitignore`) y no se publican.
