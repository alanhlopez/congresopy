"""
Listado de expedientes de SILpy (proyectos de ley, pedidos de informe, resoluciones, declaraciones...) con sus
autores, desde la búsqueda avanzada (`/web/expedientesavanzado`).

Uso:
  # 1) Bajar el listado del mandato (las dos cámaras, todos los tipos). Hace requests solo para lo que falta en
  #    el snapshot de hoy: si se corta, se vuelve a correr y sigue.
  python pipeline/silpy_expedientes.py listar

  # 2) Reconstruir silver/expedientes/ desde el snapshot más reciente, sin requests
  python pipeline/silpy_expedientes.py reparsear

Cómo busca:
  - La búsqueda pide cámara (S, D), rango de fechas de ingreso y tipo, y muestra hasta FILAS_POR_PAGINA filas.
    Se busca por tipo y por período legislativo; si un rango trae más filas que una página, se parte en dos
    mitades y se vuelve a buscar cada una, hasta que entre en una página.
  - Cada respuesta se valida: las filas leídas tienen que coincidir con el total que informa la tabla
    (rowCount). Si no, se corta con error y no se escribe nada.

Bronze (bronze/silpy/expedientes/{AAAA-MM-DD}/):
  - El listado cambia (estado y etapa de cada expediente), así que se guarda como snapshot fechado completo,
    uno por día como máximo. Dentro del snapshot de hoy no se vuelve a bajar ninguna búsqueda ya guardada.
  - `reparsear` lee el snapshot más reciente que esté completo (con `completo.txt`).

Silver (silver/expedientes/):
  expediente.csv : id_expediente, numero, camara, tipo, id_tipo, iniciativa, fecha_ingreso, estado, etapa,
                   origen, numero_ley, acapite
  autor.csv      : id_expediente, orden, id_autor   (ids de SILpy; los de legisladores son los de legisladores.csv)

Notas:
  - Datos publicados por el Congreso Nacional bajo CC BY 4.0: citar la fuente.
  - Mismas reglas que el resto del scraping (User-Agent con contacto), pero con 3 s entre requests: con 1,5 s la
    búsqueda avanzada respondió 403 después de unas 330 requests (21/11/2026). Ante un 403, parar y seguir otro día.
  - SILpy no dice en el listado quién es autor principal y quién cofirmante: `orden` es el orden de la lista.
"""
import argparse
import csv
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

import config

URL = f"{config.BASE}/expedientesavanzado"
# Más lento que el resto: la búsqueda avanzada respondió 403 después de ~330 requests a 1,5 s (21/11/2026)
DELAY = max(config.DELAY, 3.0)
FILAS_POR_PAGINA = 100
INICIO_MANDATO = date(2023, 7, 1)
CAMARAS = ("S", "D")

CAMPOS_EXPEDIENTE = ["id_expediente", "numero", "camara", "tipo", "id_tipo", "iniciativa", "fecha_ingreso",
                     "estado", "etapa", "origen", "numero_ley", "acapite"]
CAMPOS_AUTOR = ["id_expediente", "orden", "id_autor"]
# Columnas ocultas de la tabla de resultados (por su título, no por el id j_idtNNN de JSF)
COLUMNAS = {"Id del Expediente": "id_expediente", "Acápite": "acapite", "Número de Expediente": "numero",
            "Fecha Ingreso": "fecha_ingreso", "Estado Actual": "estado", "Tipo Expediente": "tipo",
            "Iniciativa": "iniciativa", "Etapa Actual": "etapa", "Origen": "origen", "Número de Ley": "numero_ley",
            "ID de autores/proyectivas": "autores"}


# Aviso de SILpy cuando la búsqueda no trae nada (en ese caso no hay tabla)
SIN_RESULTADOS = "No hay resultados... Por favor revise su criterio de búsqueda"


# Cámara de origen desde «Origen» (el prefijo del número no sirve: hay CPC-, CP-, SD-, «S–» con raya...)
ORIGEN = {"CAMARA DE SENADORES": "S", "CAMARA DE DIPUTADOS": "D"}


class ListadoInvalido(Exception):
    pass


def _txt(el):
    return " ".join(el.get_text(" ", strip=True).split()) if el else ""


def _fecha(s: str) -> str:
    return datetime.strptime(s, "%d/%m/%Y").date().isoformat()


def _iso_a_silpy(d: date) -> str:
    return d.strftime("%d/%m/%Y")


# --- Formulario ---

def leer_formulario(html: str) -> dict:
    """Nombres de los campos (los ids de JSF cambian entre versiones de SILpy), tipos y ViewState."""
    s = BeautifulSoup(html, "html.parser")
    form = s.find("form", id="formMain")
    if form is None:
        raise ListadoInvalido("no está el formulario de búsqueda (formMain)")
    radio = form.find("input", attrs={"type": "radio", "aria-label": "SENADO"})
    tipo = form.find("select", attrs={"aria-label": "Tipo"})
    otros = [x["name"] for x in form.find_all("select") if x is not tipo]
    if radio is None or tipo is None:
        raise ListadoInvalido("cambió el formulario de búsqueda: no se encuentran «En» o «Tipo»")
    tipos = {int(o["value"]): _txt(o) for o in tipo.find_all("option") if o.get("value")}
    return {"camara": radio["name"], "tipo": tipo["name"], "otros": otros, "tipos": tipos,
            "boton": form.find("button", id=re.compile(r"cmdBuscar$"))["name"], "viewstate": viewstate(html)}


def viewstate(html: str) -> str:
    m = re.search(r'name="jakarta\.faces\.ViewState"[^>]*value="([^"]+)"', html)
    if not m:
        raise ListadoInvalido("respuesta sin ViewState")
    return m.group(1)


def datos_busqueda(form: dict, camara: str, tipo: int, desde: date, hasta: date) -> dict:
    d = {"formMain": "formMain", form["camara"]: camara, "formMain:desde_input": _iso_a_silpy(desde),
         "formMain:hasta_input": _iso_a_silpy(hasta), form["tipo"]: str(tipo), "formMain:txtCriterio": "",
         form["boton"]: "", "jakarta.faces.ViewState": form["viewstate"]}
    for nombre in form["otros"]:
        d[nombre] = ""
    return d


TABLA = "formResult:dtExpediente"


def datos_pagina(form: dict, camara: str, tipo: int, desde: date, hasta: date, pagina: int) -> dict:
    """Búsqueda y salto de página en un mismo request AJAX. Hace falta así: SILpy no guarda el resultado entre
    requests, y la paginación sola llega vacía (probado el 21/11/2026). Responde solo las filas de la página."""
    d = datos_busqueda(form, camara, tipo, desde, hasta)
    d.update({"jakarta.faces.partial.ajax": "true", "jakarta.faces.source": form["boton"],
              "jakarta.faces.partial.execute": "formMain formResult", "jakarta.faces.partial.render": TABLA,
              "formResult": "formResult", TABLA + "_pagination": "true", TABLA + "_encodeFeature": "true",
              TABLA + "_first": str(pagina * FILAS_POR_PAGINA), TABLA + "_rows": str(FILAS_POR_PAGINA)})
    return d


# --- Resultado ---

def total_filas(html: str) -> int:
    """Total de filas que informa la tabla de resultados (rowCount del DataTable de PrimeFaces). Tiene que
    coincidir con el aviso «N registros recuperados», si está: una tabla vacía con registros es un error."""
    m = re.search(r'id:"formResult:dtExpediente".*?rowCount:(\d+)', html, re.S)
    if not m and SIN_RESULTADOS in html:
        return 0
    if not m:
        raise ListadoInvalido("la respuesta no tiene la tabla de resultados")
    total = int(m.group(1))
    aviso = re.search(r"(\d+) registros recuperados", html)
    if aviso and int(aviso.group(1)) != total:
        raise ListadoInvalido(f"la tabla trae {total} filas y SILpy informa {aviso.group(1)} registros")
    return total


def _posiciones(tabla) -> dict:
    titulos = [_txt(th) for th in tabla.select("thead th")]
    faltan = set(COLUMNAS) - set(titulos)
    if faltan:
        raise ListadoInvalido(f"faltan columnas en la tabla: {sorted(faltan)}")
    pos = {}
    for i, t in enumerate(titulos):   # «Etapa Actual» se repite: vale la primera (la oculta, sin estado ni origen)
        if t in COLUMNAS:
            pos.setdefault(COLUMNAS[t], i)
    return pos


def _filas(trs, pos: dict, id_tipo: int):
    expedientes, autores = [], []
    for tr in trs:
        celdas = tr.find_all("td", recursive=False)
        v = {k: _txt(celdas[i]) for k, i in pos.items()}
        if not v["id_expediente"].isdigit():
            raise ListadoInvalido(f"id de expediente inválido: {v['id_expediente']!r}")
        id_exp = int(v["id_expediente"])
        expedientes.append({
            "id_expediente": id_exp, "numero": v["numero"], "camara": ORIGEN.get(v["origen"], ""),
            "tipo": v["tipo"], "id_tipo": id_tipo, "iniciativa": v["iniciativa"],
            "fecha_ingreso": _fecha(v["fecha_ingreso"]) if v["fecha_ingreso"] else "",
            "estado": v["estado"], "etapa": v["etapa"], "origen": v["origen"], "numero_ley": v["numero_ley"],
            "acapite": v["acapite"]})
        ids = [x for x in v["autores"].split(",") if x.strip()]
        if any(not x.strip().isdigit() for x in ids):
            raise ListadoInvalido(f"autores inválidos en {id_exp}: {v['autores']!r}")
        autores += [{"id_expediente": id_exp, "orden": k, "id_autor": int(x)} for k, x in enumerate(ids, 1)]
    return expedientes, autores


def filas_de_pagina(xml: str, pagina: int):
    """Las <tr> de una respuesta de paginación (partial-response de JSF), validando que empiecen en su fila."""
    m = re.search(r'<update id="formResult:dtExpediente"><!\[CDATA\[(.*?)\]\]></update>', xml, re.S)
    if not m or "<error" in xml:
        raise ListadoInvalido(f"la página {pagina} no trae filas")
    trs = BeautifulSoup(f"<table><tbody>{m.group(1)}</tbody></table>", "html.parser").select("tbody > tr[data-ri]")
    esperado = list(range(pagina * FILAS_POR_PAGINA, pagina * FILAS_POR_PAGINA + len(trs)))
    if not trs or [int(tr["data-ri"]) for tr in trs] != esperado:
        raise ListadoInvalido(f"la página {pagina} no empieza en la fila {pagina * FILAS_POR_PAGINA}")
    return trs


def parsear_resultado(html: str, id_tipo: int, paginas=()):
    """Primera página de resultados (más las siguientes, si las hay) -> (expedientes, autores).
    Valida contra rowCount: tienen que estar todas las filas."""
    s = BeautifulSoup(html, "html.parser")
    tabla = s.find(id=TABLA)
    if tabla is None and total_filas(html) == 0:
        return [], []
    if tabla is None:
        raise ListadoInvalido("la respuesta no tiene la tabla de resultados")
    pos = _posiciones(tabla)
    trs = tabla.select("tbody > tr[data-ri]")
    for k, xml in enumerate(paginas, 1):
        trs += filas_de_pagina(xml, k)
    expedientes, autores = _filas(trs, pos, id_tipo)
    total = total_filas(html)
    if total == 0 and not expedientes:
        return [], []
    if len(expedientes) != total:
        raise ListadoInvalido(f"se leyeron {len(expedientes)} filas y la tabla informa {total}")
    return expedientes, autores


# --- Descarga ---

def snapshot_dir(fecha: str | None = None) -> Path:
    return config.BRONZE / "expedientes" / (fecha or date.today().isoformat())


def nombre_busqueda(camara: str, tipo: int, desde: date, hasta: date) -> str:
    return f"{camara}_{tipo}_{desde.isoformat()}_{hasta.isoformat()}.html"


def nombre_pagina(base: str, pagina: int) -> str:
    return base.removesuffix(".html") + f"_p{pagina}.xml"


def paginas_guardadas(carpeta: Path, base: str, total: int) -> list[str]:
    n = -(-total // FILAS_POR_PAGINA)
    return [(carpeta / nombre_pagina(base, k)).read_text(encoding="utf-8") for k in range(1, n)]


def periodos(hasta: date):
    """Rangos de los períodos legislativos (1/7 al 30/6) desde el inicio del mandato hasta `hasta`."""
    a = INICIO_MANDATO
    while a <= hasta:
        b = min(date(a.year + 1, 6, 30), hasta)
        yield a, b
        a = b + timedelta(days=1)


class Buscador:
    """Sesión con SILpy: por cada búsqueda, un GET del formulario (vista nueva) y un POST. Reusar la vista de una
    búsqueda anterior no sirve: SILpy responde la tabla vacía aunque informe los registros (probado el 21/11/2026)."""

    def __init__(self, sess=None, destino: Path | None = None):
        self.sess = sess or requests.Session()
        self.destino = destino or snapshot_dir()
        self.form = None
        self.requests = 0

    def _formulario(self, nuevo=False):
        if self.form is None or nuevo:
            config.requerir_contacto()
            r = self.sess.get(URL, headers=config.headers(), timeout=60)
            r.raise_for_status()
            self.requests += 1
            self.destino.mkdir(parents=True, exist_ok=True)
            (self.destino / "formulario.html").write_text(r.text, encoding="utf-8")
            self.form = leer_formulario(r.text)
            time.sleep(DELAY)
        return self.form

    def tipos_form(self) -> dict:
        """El formulario guardado en el snapshot (o uno nuevo si todavía no hay)."""
        f = self.destino / "formulario.html"
        if self.form is None and f.exists():
            return leer_formulario(f.read_text(encoding="utf-8"))
        return self._formulario()

    def tipos(self) -> dict:
        return self.tipos_form()["tipos"]

    def buscar(self, camara: str, tipo: int, desde: date, hasta: date) -> str:
        f = self.destino / nombre_busqueda(camara, tipo, desde, hasta)
        if f.exists():
            return f.read_text(encoding="utf-8")
        form = self._formulario(nuevo=self.form is not None and self.form.get("usado", False))
        form["usado"] = True
        r = self.sess.post(URL, data=datos_busqueda(form, camara, tipo, desde, hasta),
                           headers=config.headers(), timeout=120)
        r.raise_for_status()
        self.requests += 1
        time.sleep(DELAY)
        try:
            total_filas(r.text)   # que sea una página de resultados válida antes de guardarla
        except ListadoInvalido:
            (self.destino / f"error_{f.name}").write_text(r.text, encoding="utf-8")
            raise
        f.write_text(r.text, encoding="utf-8")
        return r.text

    def pagina(self, camara: str, tipo: int, desde: date, hasta: date, pagina: int) -> str:
        f = self.destino / nombre_pagina(nombre_busqueda(camara, tipo, desde, hasta), pagina)
        if f.exists():
            return f.read_text(encoding="utf-8")
        form = self._formulario(nuevo=self.form is not None and self.form.get("usado", False))
        form["usado"] = True
        r = self.sess.post(URL, data=datos_pagina(form, camara, tipo, desde, hasta, pagina),
                           headers={**config.headers(), "Faces-Request": "partial/ajax",
                                    "X-Requested-With": "XMLHttpRequest"}, timeout=120)
        r.raise_for_status()
        self.requests += 1
        time.sleep(DELAY)
        filas_de_pagina(r.text, pagina)   # que traiga las filas de esa página antes de guardarla
        f.write_text(r.text, encoding="utf-8")
        return r.text

    def rango(self, camara: str, tipo: int, desde: date, hasta: date):
        """Archivos de búsqueda que cubren [desde, hasta]. Si el rango trae más de una página, se parte en mitades;
        un solo día con más de una página se pagina (búsqueda y salto de página en el mismo request)."""
        html = self.buscar(camara, tipo, desde, hasta)
        total = total_filas(html)
        base = self.destino / nombre_busqueda(camara, tipo, desde, hasta)
        if total <= FILAS_POR_PAGINA:
            return [base]
        if desde == hasta:
            for k in range(1, -(-total // FILAS_POR_PAGINA)):
                self.pagina(camara, tipo, desde, hasta, k)
            parsear_resultado(html, tipo, paginas_guardadas(self.destino, base.name, total))   # están todas
            return [base]
        medio = desde + (hasta - desde) // 2
        return self.rango(camara, tipo, desde, medio) + self.rango(camara, tipo, medio + timedelta(days=1), hasta)


def listar(sess=None, hasta: date | None = None, destino: Path | None = None) -> Path:
    """Baja (o completa) el snapshot de hoy y lo marca como completo. Devuelve la carpeta."""
    hasta = hasta or date.today()
    b = Buscador(sess, destino)
    hojas = []
    tipos = b.tipos()
    for camara in CAMARAS:
        for tipo in sorted(tipos):
            for a, z in periodos(hasta):
                hojas += b.rango(camara, tipo, a, z)
    (b.destino / "completo.txt").write_text(
        "\n".join(p.name for p in hojas) + "\n", encoding="utf-8")
    print(f"snapshot {b.destino.name}: {len(hojas)} búsquedas, {b.requests} requests", file=sys.stderr)
    return b.destino


# --- Silver ---

def ultimo_snapshot() -> Path | None:
    completos = sorted(p.parent for p in (config.BRONZE / "expedientes").glob("*/completo.txt"))
    return completos[-1] if completos else None


def parsear_snapshot(carpeta: Path):
    """Lee las búsquedas listadas en completo.txt -> (expedientes, autores), sin duplicados, por id."""
    expedientes, autores = {}, {}
    for nombre in (carpeta / "completo.txt").read_text(encoding="utf-8").split():
        tipo = int(nombre.split("_")[1])
        html = (carpeta / nombre).read_text(encoding="utf-8")
        exps, auts = parsear_resultado(html, tipo, paginas_guardadas(carpeta, nombre, total_filas(html)))
        for e in exps:
            expedientes[e["id_expediente"]] = e
        for a in auts:
            autores[(a["id_expediente"], a["orden"])] = a
    return ([expedientes[k] for k in sorted(expedientes)],
            [autores[k] for k in sorted(autores)])


def escribir(expedientes, autores, destino: Path | None = None):
    destino = destino or config.SILVER / "expedientes"
    destino.mkdir(parents=True, exist_ok=True)
    for nombre, filas, campos in (("expediente.csv", expedientes, CAMPOS_EXPEDIENTE),
                                  ("autor.csv", autores, CAMPOS_AUTOR)):
        with open(destino / nombre, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=campos)
            w.writeheader()
            w.writerows(filas)


def reparsear(carpeta: Path | None = None):
    carpeta = carpeta or ultimo_snapshot()
    if carpeta is None:
        raise SystemExit("No hay ningún snapshot completo en bronze/silpy/expedientes/. Correr `listar` primero.")
    expedientes, autores = parsear_snapshot(carpeta)
    escribir(expedientes, autores)
    print(f"{carpeta.name}: {len(expedientes)} expedientes, {len(autores)} autorías", file=sys.stderr)
    return expedientes, autores


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("listar", help="Baja o completa el snapshot de hoy y reconstruye silver/expedientes/")
    sub.add_parser("reparsear", help="Reconstruye silver/expedientes/ desde el último snapshot completo")
    a = p.parse_args()
    if a.cmd == "listar":
        reparsear(listar())
    else:
        reparsear()


if __name__ == "__main__":
    main()
