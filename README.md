# congresopy

Monitor del Congreso del Paraguay: cómo vota y cuándo falta cada senador y cada diputado del período
2023-2028, votación por votación. Los datos salen de [SILpy](https://silpy.congreso.gov.py/), el Sistema de
Información Legislativa del Congreso Nacional.

Estado: **Fase 1, tarea 1.1**. Base del repo y pipeline migrados desde el prototipo `VotometroCongresoPy`.
El sitio todavía es una página vacía.

## Qué hay

| Carpeta | Contenido |
|---|---|
| `pipeline/` | Scraper y parser de SILpy, codificación del Ejecutivo y análisis. Rutas en `pipeline/config.py`. |
| `silver/{senado,diputados}/` | CSV validados: `votacion`, `voto`, `fechas`, `legisladores`, `codificacion_sugerida`, `ids_<período>.txt`. |
| `salidas/votometro/` | Dashboard del prototipo (`votometro.html`) y sus datos. Solo para uso interno y regresión: no se publica. |
| `site/` | Sitio estático que se despliega (HTML, CSS y JS sin build). |
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
.venv/bin/python -m pytest
python3 -m http.server -d site 8000                             # sitio en http://localhost:8000
```

Todos los comandos, las reglas del proyecto y las advertencias están en [`CLAUDE.md`](CLAUDE.md).

## Datos crudos

`bronze/` no se versiona por su tamaño. Sin él funcionan `codificar.py`, `analisis.py`, el sitio y casi todos
los tests: solo se saltea el de reparseo. Las descargas nuevas desde SILpy necesitan que se complete
`CONTACTO` en `pipeline/config.py`: el User-Agent tiene que identificar a quién contactar. SILpy no autoriza
la automatización en su robots.txt, así que el scraper espera 1,5 s entre requests y nunca vuelve a bajar
lo que ya está en `bronze/`.

## Licencias

- **Código:** [GNU AGPL-3.0](LICENSE).
- **Datos derivados** (`silver/`, `site/datos/`, `salidas/`): [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es).
- **Fuente:** SILpy – Congreso Nacional del Paraguay, publicado bajo
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.es). Al reutilizar estos datos, citá al
  Congreso Nacional como fuente original.
- `docs/referencia-datacp/` son capturas de datacp.ar, de sus autores, usadas solo como referencia interna.
  No están cubiertas por las licencias de arriba.
