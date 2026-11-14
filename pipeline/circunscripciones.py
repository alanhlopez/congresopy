"""Circunscripción de cada legislador desde su ficha de SILpy: bronze/silpy/fichas/ -> silver/{camara}/circunscripciones.csv.

Uso:
  python3 pipeline/circunscripciones.py      # sin red: lee las fichas que ya bajó pipeline/comisiones.py descargar

Fuente: el campo «Circunscripción» de la cabecera de {BASE}/legislador/{id} (<span title="Circunscripción">).
  - Senado: «NACIONAL» (circunscripción única) -> departamento vacío.
  - Diputados: «Departamental - CENTRAL» -> departamento «Central». Capital (Asunción) cuenta como una más.

Validación: la ficha tiene que ser la del legislador pedido (mismo control que comisiones.py); en el Senado el
valor tiene que ser NACIONAL y en Diputados uno de los 18 de DEPARTAMENTOS. Si algo no cumple, no se escribe
nada y el comando termina con código 1 (un valor nuevo de SILpy hay que mirarlo antes de publicarlo).
"""
import csv
import sys

from bs4 import BeautifulSoup

import config
from comisiones import FichaInvalida, bronze_fichas, leer_nomina, normalizar

CAMPOS = ["id_legislador", "circunscripcion", "departamento"]
# Valor de SILpy (sin «Departamental - ») -> nombre a mostrar, en el orden oficial de los departamentos
# (Capital primero; después del I Concepción al XVII Alto Paraguay).
DEPARTAMENTOS = {
    "CAPITAL": "Capital", "CONCEPCION": "Concepción", "SAN PEDRO": "San Pedro", "CORDILLERA": "Cordillera",
    "GUAIRA": "Guairá", "CAAGUAZU": "Caaguazú", "CAAZAPA": "Caazapá", "ITAPUA": "Itapúa", "MISIONES": "Misiones",
    "PARAGUARI": "Paraguarí", "ALTO PARANA": "Alto Paraná", "CENTRAL": "Central", "NEEMBUCU": "Ñeembucú",
    "AMAMBAY": "Amambay", "CANINDEYU": "Canindeyú", "PTE. HAYES": "Presidente Hayes", "BOQUERON": "Boquerón",
    "ALTO PARAGUAY": "Alto Paraguay",
}
ORDEN = list(DEPARTAMENTOS.values())


def clave(s: str) -> str:
    """Mayúsculas sin tildes (SILpy escribe «CONCEPCION» sin tilde e «ITAPÚA» con tilde)."""
    return normalizar(s).upper()


def parsear_circunscripcion(html: str, id_legislador: int, nombre: str, camara: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    titulo = soup.title.get_text(" ", strip=True) if soup.title else ""
    if not normalizar(titulo).startswith(normalizar(nombre)):
        raise FichaInvalida(f"el título {titulo[:60]!r} no empieza con {nombre!r}")
    span = soup.find("span", title="Circunscripción")
    if span is None:
        raise FichaInvalida("no tiene el campo Circunscripción")
    valor = span.get_text(" ", strip=True)
    if camara == "senado":
        if clave(valor) != "NACIONAL":
            raise FichaInvalida(f"senador con circunscripción {valor!r}")
        return {"id_legislador": id_legislador, "circunscripcion": "Nacional", "departamento": ""}
    tipo, _, depto = valor.partition(" - ")
    nombre_depto = {clave(k): v for k, v in DEPARTAMENTOS.items()}.get(clave(depto))
    if clave(tipo) != "DEPARTAMENTAL" or not nombre_depto:
        raise FichaInvalida(f"circunscripción desconocida {valor!r}")
    return {"id_legislador": id_legislador, "circunscripcion": "Departamental", "departamento": nombre_depto}


def a_silver(origen=None):
    """Escribe silver/{camara}/circunscripciones.csv. Devuelve ({camara: filas}, sin_ficha, invalidas).
    Si hay inválidas no escribe nada."""
    origen = origen or bronze_fichas()
    por_camara = {c: [] for c in config.CAMARAS.values()}
    sin_ficha, invalidas = [], []
    for lid, (letra, nombre) in sorted(leer_nomina().items()):
        f = origen / f"{lid}.html"
        if not f.exists():
            sin_ficha.append(lid)
            continue
        camara = config.CAMARAS[letra]
        try:
            por_camara[camara].append(parsear_circunscripcion(f.read_text(encoding="utf-8"), lid, nombre, camara))
        except FichaInvalida as e:
            invalidas.append((lid, str(e)))
            print(f"[NO SE ESCRIBE EN SILVER] {lid} {nombre}: {e}", file=sys.stderr)
    if invalidas:
        return por_camara, sin_ficha, invalidas
    for camara, filas in por_camara.items():
        with open(config.silver_dir(camara) / "circunscripciones.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=CAMPOS, lineterminator="\n")
            w.writeheader()
            w.writerows(filas)
    return por_camara, sin_ficha, invalidas


def main():
    por_camara, sin_ficha, invalidas = a_silver()
    for camara, filas in por_camara.items():
        deptos = {r["departamento"] for r in filas if r["departamento"]}
        print(f"{camara}: {len(filas)} legisladores, {len(deptos)} departamentos", file=sys.stderr)
    if sin_ficha:
        print(f"{len(sin_ficha)} sin ficha en bronze/ (bajarlas con comisiones.py descargar): {sin_ficha[:10]}",
              file=sys.stderr)
    if invalidas or sin_ficha:
        sys.exit(1)


if __name__ == "__main__":
    main()
