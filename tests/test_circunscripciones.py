"""Departamento de cada diputado desde la ficha de SILpy (pipeline/circunscripciones.py) y su exportación. Sin red.
Fixtures: fichas reales de un senador y un diputado (tests/fixtures/silpy/legislador_{101378,101431}.html, SILpy, CC BY 4.0)."""
import csv
import json
from collections import Counter
from pathlib import Path

import pytest

import circunscripciones as cc
import config
from comisiones import FichaInvalida

RAIZ = Path(__file__).resolve().parents[1]
FIX = RAIZ / "tests" / "fixtures" / "silpy"
SENADOR = (FIX / "legislador_101378.html", 101378, "Juan Eudes Afara Maciel")
DIPUTADO = (FIX / "legislador_101431.html", 101431, "Ruben Isaac Rubin Orrego")


def leer(f):
    return f.read_text(encoding="utf-8")


def test_senador_nacional():
    f, i, n = SENADOR
    assert cc.parsear_circunscripcion(leer(f), i, n, "senado") == \
        {"id_legislador": i, "circunscripcion": "Nacional", "departamento": ""}


def test_diputado_departamento():
    f, i, n = DIPUTADO
    assert cc.parsear_circunscripcion(leer(f), i, n, "diputados")["departamento"] == "Central"


def test_ficha_de_otro_legislador_se_rechaza():
    f, _, _ = DIPUTADO
    with pytest.raises(FichaInvalida, match="no empieza con"):
        cc.parsear_circunscripcion(leer(f), 101378, SENADOR[2], "diputados")


def test_valor_desconocido_se_rechaza():
    f, i, n = DIPUTADO
    html = leer(f).replace("Departamental - CENTRAL", "Departamental - ATLANTIDA")
    with pytest.raises(FichaInvalida, match="desconocida"):
        cc.parsear_circunscripcion(html, i, n, "diputados")


def test_senador_con_departamento_se_rechaza():
    f, i, n = DIPUTADO
    with pytest.raises(FichaInvalida, match="senador"):
        cc.parsear_circunscripcion(leer(f), i, n, "senado")


def test_concepcion_sin_tilde_en_silpy():
    f, i, n = DIPUTADO
    html = leer(f).replace("Departamental - CENTRAL", "Departamental - CONCEPCION")
    assert cc.parsear_circunscripcion(html, i, n, "diputados")["departamento"] == "Concepción"


def test_silver_cubre_las_80_bancas():
    """Los diputados activos de la nómina tienen departamento: suman 80 y están los 18."""
    estado = {r["id_legislador"]: r["estado"] for r in csv.DictReader(open(config.silver_dir("D") / "legisladores.csv", encoding="utf-8"))}
    filas = list(csv.DictReader(open(config.silver_dir("D") / "circunscripciones.csv", encoding="utf-8")))
    assert {r["id_legislador"] for r in filas} == set(estado)
    activos = Counter(r["departamento"] for r in filas if estado[r["id_legislador"]] == "activos")
    assert sum(activos.values()) == 80 and set(activos) == set(cc.ORDEN)


def test_publicado_en_el_sitio():
    """Cada diputado publicado (los que votaron) tiene departamento; el Senado no tiene."""
    d = json.loads((config.SITE_DATOS / "diputados" / "legisladores.json").read_text(encoding="utf-8"))
    assert all(l["departamento"] in cc.ORDEN for l in d)
    s = json.loads((config.SITE_DATOS / "senado" / "legisladores.json").read_text(encoding="utf-8"))
    assert all(l["departamento"] is None for l in s)
