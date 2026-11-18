"""Reglas del sitio (CLAUDE.md, convenciones Kalaguichi) verificadas sobre los archivos de site/."""
import re
from html.parser import HTMLParser
from pathlib import Path

import pytest

SITE = Path(__file__).resolve().parent.parent / "site"
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; "
       "font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'")
PAGINAS = sorted(SITE.glob("*.html"))
JS = sorted((SITE / "assets" / "js").rglob("*.js"))
CSS = sorted((SITE / "assets" / "css").rglob("*.css"))


class Analizador(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.etiquetas = []      # (tag, attrs)
        self.script_inline = False
        self._en_script = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.etiquetas.append((tag, a))
        if tag == "script":
            self._en_script = "src" not in a

    def handle_endtag(self, tag):
        if tag == "script":
            self._en_script = False

    def handle_data(self, data):
        if self._en_script and data.strip():
            self.script_inline = True


def analizar(p):
    a = Analizador()
    a.feed(p.read_text(encoding="utf-8"))
    return a


def test_hay_paginas():
    nombres = {p.name for p in PAGINAS}
    assert {"index.html", "camaras.html", "legisladores.html", "legislador.html", "votaciones.html",
            "votacion.html", "proyectos.html", "datos.html", "comisiones.html", "asistencia.html", "acerca.html"} <= nombres


@pytest.mark.parametrize("pagina", PAGINAS, ids=lambda p: p.name)
def test_csp_y_nada_inline(pagina):
    a = analizar(pagina)
    metas = [x for t, x in a.etiquetas if t == "meta" and x.get("http-equiv", "").lower() == "content-security-policy"]
    assert len(metas) == 1 and metas[0]["content"] == CSP
    assert not a.script_inline, "hay <script> inline"
    for tag, attrs in a.etiquetas:
        assert tag != "style", "hay <style> inline"
        assert "style" not in attrs, f"atributo style en <{tag}>"
        assert not [k for k in attrs if k.startswith("on")], f"handler inline en <{tag}>"
        if tag == "script":
            assert attrs.get("type") == "module", "los scripts son módulos ES"
        for k in ("src", "href"):
            v = attrs.get(k) or ""
            assert not v.startswith(("data:", "blob:", "javascript:")), f"{k}={v[:30]}"
            if tag in ("script", "link", "img") and v:
                assert not re.match(r"^(https?:)?//", v), f"recurso externo: {v}"
                assert not v.startswith("/"), f"ruta absoluta: {v}"


@pytest.mark.parametrize("pagina", PAGINAS, ids=lambda p: p.name)
def test_rutas_locales_existen(pagina):
    for tag, attrs in analizar(pagina).etiquetas:
        for k in ("src", "href"):
            v = attrs.get(k)
            if not v or re.match(r"^(https?:|mailto:|#)", v):
                continue
            assert not v.startswith("/"), f"ruta absoluta en {pagina.name}: {v}"
            destino = (pagina.parent / v.split("#")[0]).resolve()
            assert destino.exists(), f"{pagina.name}: {v} no existe"


def bloque_menu(p):
    s = p.read_text(encoding="utf-8")
    m = re.search(r"<!-- MENU:.*?<!-- /MENU -->", s, re.S)
    assert m, f"{p.name} no tiene el bloque de menú"
    return m.group(0)


def test_menu_identico_en_cada_pagina():
    menus = {p.name: bloque_menu(p) for p in PAGINAS}
    sin_actual = {n: m.replace(' aria-current="page"', "") for n, m in menus.items()}
    assert len(set(sin_actual.values())) == 1, "el menú difiere entre páginas"
    for n, m in menus.items():
        if n in ("legislador.html", "votacion.html"):
            continue   # páginas de detalle: no son un ítem del menú
        if n == "index.html":
            # Inicio no está en el menú: lo cubre el logotipo, que en Inicio lleva aria-current
            assert '<a class="marca" href="index.html" aria-label="Hesakã, inicio" aria-current="page">' in (SITE / n).read_text(encoding="utf-8")
            continue
        # en la navegación de escritorio y en el panel móvil
        assert m.count(f'href="{n}" aria-current="page"') == 2, f"{n}: falta aria-current en su ítem"
    for p in PAGINAS:
        marca = re.search(r'<a class="marca"[^>]*>', p.read_text(encoding="utf-8")).group(0)
        assert ("aria-current" in marca) == (p.name == "index.html"), f"{p.name}: aria-current del logotipo"


@pytest.mark.parametrize("pagina", PAGINAS, ids=lambda p: p.name)
def test_fuente_metodo_limites(pagina):
    s = pagina.read_text(encoding="utf-8")
    assert 'class="metodo"' in s and "Fuente" in s and "Método" in s and "Límites" in s
    assert "SILpy" in s and "CC BY 4.0" in s


@pytest.mark.parametrize("js", JS, ids=lambda p: str(p.relative_to(SITE)))
def test_js_sin_html_inseguro_ni_externo(js):
    s = js.read_text(encoding="utf-8")
    for prohibido in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function",
                      'setAttribute("style"', ".style.cssText", "localStorage.setItem(", "localStorage.getItem("):
        if prohibido.startswith("localStorage"):
            continue   # se revisa abajo: solo dentro de try/catch
        assert prohibido not in s, f"{js.name} usa {prohibido}"
    assert not re.search(r"""import[^;]*from\s+["'](https?:)?//""", s), "import externo"
    assert not re.search(r"""fetch\(\s*["'`](https?:)?//""", s), "fetch externo"
    for m in re.finditer(r"localStorage\.(get|set)Item", s):
        previo = s[max(0, m.start() - 120):m.start()]
        assert "try" in previo, f"{js.name}: localStorage fuera de try/catch"


@pytest.mark.parametrize("css", CSS, ids=lambda p: p.name)
def test_css_sin_recursos_externos(css):
    s = css.read_text(encoding="utf-8")
    assert "@import" not in s
    assert not re.search(r"url\(\s*['\"]?(data:|blob:|https?:|//)", s)
    assert "system-ui" in s
