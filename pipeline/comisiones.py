"""Comisiones de cada legislador desde su ficha de SILpy: bronze/silpy/fichas/ -> silver/{camara}/comisiones.csv.

Uso:
  python3 pipeline/comisiones.py descargar   # baja las fichas que faltan en bronze/ (requiere CONGRESOPY_CONTACTO)
  python3 pipeline/comisiones.py silver      # parsea las fichas de bronze/ a silver/{camara}/comisiones.csv

Fuente: {BASE}/legislador/{id}, pestaña «Comisiones», con dos tablas (Período, Cargo, Comisión):
  - Comisiones Asesoras: permanentes, se integran por año legislativo (2026-2027).
  - Comisiones Especiales: de investigación, de amistad parlamentaria, etc., por mandato (2023-2028).
Las tablas se identifican por el título de la pestaña, no por su id (los ids j_idtNNN los genera JSF y cambian).

Validación: la ficha tiene que ser la del legislador pedido (el <title> empieza con su nombre de la nómina) y
tener la pestaña «Comisiones». Una ficha que no cumple no entra en silver/ y el comando termina con código 1.
Un legislador sin filas (por ejemplo, recién asumido) es válido: queda con 0 comisiones.

Igual que con las votaciones: 1,5 s entre requests y nunca se vuelve a bajar una ficha que ya está en bronze/.
La fecha de descarga de cada ficha queda en silver/fichas.csv (el sitio la muestra como fecha de los datos).
Límite: es la composición que SILpy muestra hoy en la ficha; no trae fechas de alta o baja dentro de un período.
"""
import argparse
import csv
import re
import sys
import time
import unicodedata
from datetime import date
from pathlib import Path

import requests
from bs4 import BeautifulSoup

import config

TIPOS = {"Comisiones Asesoras": "asesora", "Comisiones Especiales": "especial"}
CAMPOS = ["id_legislador", "tipo", "periodo", "periodo_id", "id_comision", "comision", "cargo"]
# "2026-2027" -> id del período legislativo (config.PERIODOS usa "2026-27")
PERIODO_ID = {f"{v[:4]}-{v[:2]}{v[-2:]}": k for k, v in config.PERIODOS.items()}


def bronze_fichas() -> Path:
    return config.BRONZE / "fichas"


def ruta_registro() -> Path:
    """silver/fichas.csv: id_legislador y fecha en que se bajó su ficha (bronze/ no está en git; esto sí)."""
    return config.SILVER / "fichas.csv"


def leer_registro() -> dict[int, str]:
    f = ruta_registro()
    if not f.exists():
        return {}
    with open(f, encoding="utf-8") as fh:
        return {int(r["id_legislador"]): r["descargada"] for r in csv.DictReader(fh)}


def registrar(id_legislador: int, fecha: str):
    reg = leer_registro()
    reg[id_legislador] = fecha
    with open(ruta_registro(), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["id_legislador", "descargada"])
        w.writerows(sorted(reg.items()))


def normalizar(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return " ".join("".join(c for c in s if not unicodedata.combining(c)).lower().split())


def leer_nomina():
    """{id: (letra_camara, nombre)} de los legisladores.csv de las dos cámaras."""
    out = {}
    for letra, camara in config.CAMARAS.items():
        with open(config.silver_dir(camara) / "legisladores.csv", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                out[int(r["id_legislador"])] = (letra, r["nombre"])
    return out


class FichaInvalida(Exception):
    pass


def parsear_ficha(html: str, id_legislador: int, nombre: str):
    """Filas de comisiones de una ficha. FichaInvalida si no es la ficha de ese legislador o cambió la página."""
    soup = BeautifulSoup(html, "html.parser")
    titulo = soup.title.get_text(" ", strip=True) if soup.title else ""
    if not normalizar(titulo).startswith(normalizar(nombre)):
        raise FichaInvalida(f"el título {titulo[:60]!r} no empieza con {nombre!r}")
    if not soup.find(id="formMain:tabDetalle:tabComisionMiembro"):
        raise FichaInvalida("no tiene la pestaña Comisiones")
    filas = []
    for a in soup.select("ul.ui-tabs-nav li a"):
        tipo = TIPOS.get(a.get_text(strip=True))
        if not tipo:
            continue
        panel = soup.find(id=a.get("href", "").lstrip("#"))
        if panel is None:
            raise FichaInvalida(f"la pestaña {a.get_text(strip=True)!r} no tiene panel")
        encabezados = [th.get_text(" ", strip=True) for th in panel.select("thead th")]
        if encabezados and encabezados[:3] != ["Periodo", "Cargo", "Comisión"]:
            raise FichaInvalida(f"columnas inesperadas en {tipo}: {encabezados}")
        for tr in panel.select("tbody tr"):
            if "ui-datatable-empty-message" in (tr.get("class") or []):
                continue
            tds = tr.find_all("td", recursive=False)
            link = tr.find("a", href=re.compile(r"/comision/\d+"))
            if len(tds) < 3 or link is None:
                raise FichaInvalida(f"fila inesperada en {tipo}: {tr.get_text(' ', strip=True)[:80]!r}")
            periodo = tds[0].get_text(" ", strip=True)
            filas.append({
                "id_legislador": id_legislador,
                "tipo": tipo,
                "periodo": periodo,
                "periodo_id": PERIODO_ID.get(periodo, ""),
                "id_comision": int(re.search(r"/comision/(\d+)", link["href"]).group(1)),
                # SILpy numera las filas ("1. Hacienda y Presupuesto"): el número no es parte del nombre.
                "comision": re.sub(r"^\d+\.\s*", "", link.get_text(" ", strip=True)),
                "cargo": tds[1].get_text(" ", strip=True),
            })
    return filas


def descargar(ids, sess=None, destino: Path | None = None):
    """Baja las fichas que faltan. Devuelve (bajadas, ya_estaban, errores)."""
    destino = destino or bronze_fichas()
    destino.mkdir(parents=True, exist_ok=True)
    faltan = [i for i in ids if not (destino / f"{i}.html").exists()]
    if not faltan:
        return [], len(ids), []
    headers = config.headers()   # exige CONGRESOPY_CONTACTO antes de cualquier request
    sess = sess or requests.Session()
    bajadas, errores = [], []
    for n, i in enumerate(faltan, 1):
        try:
            r = sess.get(f"{config.BASE}/legislador/{i}", headers=headers, timeout=60)
            if r.status_code != 200 or "tabDetalle" not in r.text:
                errores.append((i, f"HTTP {r.status_code}" if r.status_code != 200 else "no parece una ficha"))
                print(f"[{n}/{len(faltan)}] {i} RECHAZADA: {errores[-1][1]}", file=sys.stderr)
            else:
                (destino / f"{i}.html").write_text(r.text, encoding="utf-8")
                if destino == bronze_fichas():
                    registrar(i, date.today().isoformat())
                bajadas.append(i)
                print(f"[{n}/{len(faltan)}] {i} ok ({len(r.text):,} caracteres)", file=sys.stderr)
        except requests.RequestException as e:
            errores.append((i, str(e)))
            print(f"[{n}/{len(faltan)}] {i} ERROR: {e}", file=sys.stderr)
        time.sleep(config.DELAY)
    return bajadas, len(ids) - len(faltan), errores


def a_silver(origen: Path | None = None):
    """Escribe silver/{camara}/comisiones.csv. Devuelve ({camara: filas}, sin_ficha, invalidas)."""
    origen = origen or bronze_fichas()
    nomina = leer_nomina()
    por_camara = {c: [] for c in config.CAMARAS.values()}
    sin_ficha, invalidas = [], []
    for lid, (letra, nombre) in sorted(nomina.items()):
        f = origen / f"{lid}.html"
        if not f.exists():
            sin_ficha.append(lid)
            continue
        try:
            filas = parsear_ficha(f.read_text(encoding="utf-8"), lid, nombre)
        except FichaInvalida as e:
            invalidas.append((lid, str(e)))
            print(f"[NO SE ESCRIBE EN SILVER] {lid} {nombre}: {e}", file=sys.stderr)
            continue
        por_camara[config.CAMARAS[letra]].extend(filas)
    for camara, filas in por_camara.items():
        filas.sort(key=lambda r: (r["id_legislador"], r["tipo"], r["periodo"], r["id_comision"], r["cargo"]))
        with open(config.silver_dir(camara) / "comisiones.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=CAMPOS, lineterminator="\n")
            w.writeheader()
            w.writerows(filas)
    return por_camara, sin_ficha, invalidas


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("comando", choices=["descargar", "silver"])
    args = ap.parse_args()
    if args.comando == "descargar":
        bajadas, ya, errores = descargar(sorted(leer_nomina()))
        print(f"{len(bajadas)} bajadas, {ya} ya estaban en bronze/, {len(errores)} con error", file=sys.stderr)
        if errores:
            sys.exit(1)
    else:
        por_camara, sin_ficha, invalidas = a_silver()
        for camara, filas in por_camara.items():
            print(f"{camara}: {len(filas)} filas, {len({r['id_legislador'] for r in filas})} legisladores con "
                  f"comisiones, {len({r['id_comision'] for r in filas})} comisiones", file=sys.stderr)
        if sin_ficha:
            print(f"{len(sin_ficha)} sin ficha en bronze/: {sin_ficha[:10]}", file=sys.stderr)
        if invalidas or sin_ficha:
            sys.exit(1)


if __name__ == "__main__":
    main()
