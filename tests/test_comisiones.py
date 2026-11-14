"""Comisiones desde la ficha de SILpy (pipeline/comisiones.py) y su exportación al sitio. Sin red.
Fixture: ficha real de un senador (tests/fixtures/silpy/legislador_101378.html, SILpy, CC BY 4.0)."""
import csv
import json
from collections import Counter
from pathlib import Path

import pytest

import comisiones as cm
import config
import exportar_sitio as ex

RAIZ = Path(__file__).resolve().parents[1]
FIXTURE = RAIZ / "tests" / "fixtures" / "silpy" / "legislador_101378.html"
NOMBRE = "Juan Eudes Afara Maciel"


def html():
    return FIXTURE.read_text(encoding="utf-8")


def test_ficha_real():
    filas = cm.parsear_ficha(html(), 101378, NOMBRE)
    tipos = Counter(f["tipo"] for f in filas)
    assert tipos["asesora"] > 0 and tipos["especial"] > 0
    assert {f["periodo"] for f in filas if f["tipo"] == "especial"} == {"2023-2028"}
    actuales = [f for f in filas if f["periodo"] == "2026-2027"]
    assert actuales and all(f["periodo_id"] == config.PERIODO_ABIERTO for f in actuales)
    assert all(not f["comision"][0].isdigit() for f in filas)          # sin el "1. " de la numeración
    assert ("Desarrollo Social", "Presidente/a") in {(f["comision"], f["cargo"]) for f in actuales}


def test_nombre_sin_tildes_ni_mayusculas_igual_valida():
    assert cm.parsear_ficha(html(), 101378, "JUAN EUDES AFARA MACIEL")


def test_ficha_de_otro_legislador_se_rechaza():
    with pytest.raises(cm.FichaInvalida, match="no empieza con"):
        cm.parsear_ficha(html(), 101358, "Eduardo Hirohito Nakayama Rojas")


def test_pagina_cambiada_se_rechaza():
    with pytest.raises(cm.FichaInvalida, match="pestaña Comisiones"):
        cm.parsear_ficha(html().replace("formMain:tabDetalle:tabComisionMiembro", "otra-cosa"), 101378, NOMBRE)


def test_columnas_inesperadas_se_rechazan():
    with pytest.raises(cm.FichaInvalida, match="columnas inesperadas"):
        cm.parsear_ficha(html().replace(">Cargo<", ">Rol<"), 101378, NOMBRE)


class SesionFalsa:
    def __init__(self, respuestas):
        self.respuestas, self.urls = respuestas, []

    def get(self, url, headers, timeout):
        assert "contacto:" in headers["User-Agent"]
        self.urls.append(url)
        codigo, texto = self.respuestas.pop(0)

        class R:
            status_code, text = codigo, texto
        return R()


def test_descargar_no_repite_y_rechaza(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CONTACTO", "prueba@example.org")
    monkeypatch.setattr(config, "DELAY", 0)
    (tmp_path / "1.html").write_text("ya estaba", encoding="utf-8")
    sess = SesionFalsa([(200, html()), (200, "<html>mantenimiento</html>"), (404, "")])
    bajadas, ya, errores = cm.descargar([1, 2, 3, 4], sess, tmp_path)
    assert bajadas == [2] and ya == 1
    assert [i for i, _ in errores] == [3, 4]
    assert sorted(f.name for f in tmp_path.iterdir()) == ["1.html", "2.html"]
    assert len(sess.urls) == 3 and not any(u.endswith("/1") for u in sess.urls)


def test_exportar_comisiones(tmp_path):
    filas = cm.parsear_ficha(html(), 101378, NOMBRE)
    with open(tmp_path / "comisiones.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cm.CAMPOS); w.writeheader(); w.writerows(filas)
    L = {"101378": {"nombre": NOMBRE, "nombre_corto": "Juan Afara", "partido": "ANR", "estado": "activos"}}
    out = ex.exportar_comisiones(tmp_path, L, {"101378"})
    json.dumps(out)
    assert out["legisladores"] == {"101378": {"nombre": "Juan Afara", "partido": "ANR", "estado": "activos", "con_votos": True}}
    assert out["periodos"][0] == "2026-2027"
    tipos = [c["tipo"] for c in out["comisiones"]]
    assert tipos == sorted(tipos, key=lambda t: t != "asesora")     # asesoras primero
    assert sum(len(c["integrantes"]) for c in out["comisiones"]) == len({(f["id_comision"], f["periodo"], f["cargo"]) for f in filas})
    ds = next(c for c in out["comisiones"] if c["nombre"] == "Desarrollo Social")
    assert ds["integrantes"][0] == [101378, "2026-2027", "Presidente/a"]   # período más reciente primero


def test_sin_csv_no_exporta(tmp_path):
    assert ex.exportar_comisiones(tmp_path, {}, set()) is None
