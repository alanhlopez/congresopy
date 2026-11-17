"""Verificación visual del sitio con Playwright: capturas por página, ancho y tema, y control de errores.

Para cada combinación reporta errores de consola (incluidas las violaciones de CSP) y scroll horizontal de página,
y guarda una captura de página completa. Termina con código 1 si encontró algún problema.

Uso (desde la raíz del repo; requiere `pip install -r requirements-dev.txt` y Chrome instalado):
  python3 tools/capturas.py                                  # todas las páginas, sirviendo site/ en local
  python3 tools/capturas.py --base https://congresopy.vercel.app      # el sitio publicado
  python3 tools/capturas.py "legislador.html#camara=senado&id=101378&sub=analisis" asistencia.html
  python3 tools/capturas.py --anchos 360,1280 --temas light --alto 1500 index.html

Las capturas van a docs/capturas/ (fuera de git). El nombre incluye la página y los valores del #hash.
"""
import argparse
import functools
import http.server
import re
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
# Todas las páginas, con un legislador y una votación de ejemplo para las de detalle
PAGINAS = ["index.html", "camaras.html", "legisladores.html", "legislador.html#camara=senado&id=101378",
           "votaciones.html", "votacion.html#camara=diputados&id=109395", "asistencia.html",
           "comisiones.html", "proyectos.html", "datos.html", "acerca.html"]


def nombre_archivo(pagina: str, ancho: int, tema: str) -> str:
    base, _, hash_ = pagina.partition("#")
    partes = [base.replace(".html", "")] + [v for _, v in (p.split("=", 1) for p in hash_.split("&") if "=" in p)]
    limpio = re.sub(r"[^A-Za-z0-9_-]+", "-", "-".join(partes)).strip("-")
    return f"{limpio}-{ancho}-{'claro' if tema == 'light' else 'oscuro'}.png"


def servir_sitio():
    """Sirve site/ en un puerto libre de localhost y devuelve la URL base."""
    manejador = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(RAIZ / "site"))
    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    servidor = http.server.ThreadingHTTPServer(("127.0.0.1", 0), manejador)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{servidor.server_address[1]}"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("paginas", nargs="*", help="páginas con su #hash (por defecto, todas)")
    ap.add_argument("--base", help="URL base del sitio (por defecto se sirve site/ en local)")
    ap.add_argument("--destino", default=str(RAIZ / "docs" / "capturas"))
    ap.add_argument("--anchos", default="360,768,1280")
    ap.add_argument("--temas", default="light,dark")
    ap.add_argument("--alto", type=int, default=0, help="recortar la captura a este alto (0 = página completa)")
    args = ap.parse_args()
    base = (args.base or servir_sitio()).rstrip("/")
    destino = Path(args.destino)
    destino.mkdir(parents=True, exist_ok=True)
    anchos = [int(x) for x in args.anchos.split(",")]
    temas = args.temas.split(",")
    problemas = 0
    with sync_playwright() as pw:
        nav = pw.chromium.launch(channel="chrome")
        for pagina in args.paginas or PAGINAS:
            for tema in temas:
                for ancho in anchos:
                    ctx = nav.new_context(viewport={"width": ancho, "height": 900}, color_scheme=tema)
                    page = ctx.new_page()
                    errores = []
                    page.on("console", lambda m, e=errores: e.append(m.text) if m.type in ("error", "warning") else None)
                    page.on("pageerror", lambda x, e=errores: e.append(str(x)))
                    respuesta = page.goto(f"{base}/{pagina}", wait_until="networkidle")
                    page.wait_for_timeout(400)
                    ancho_doc, ancho_vista = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
                    f = destino / nombre_archivo(pagina, ancho, tema)
                    opciones = {"path": str(f), "full_page": True}
                    if args.alto:
                        opciones["clip"] = {"x": 0, "y": 0, "width": ancho, "height": args.alto}
                    page.screenshot(**opciones)
                    estado = []
                    if respuesta is None or respuesta.status >= 400:
                        estado.append(f"HTTP {respuesta.status if respuesta else '?'}")
                    if ancho_doc > ancho_vista:
                        estado.append(f"scroll horizontal {ancho_doc}>{ancho_vista}")
                    if errores:
                        estado.append(f"errores: {errores[:3]}")
                    problemas += bool(estado)
                    print(f"{f.name}: {'; '.join(estado) or 'ok'}")
                    ctx.close()
        nav.close()
    print(f"{problemas} con problemas", file=sys.stderr)
    sys.exit(1 if problemas else 0)


if __name__ == "__main__":
    main()
