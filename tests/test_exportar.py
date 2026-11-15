"""Datos del sitio (site/datos/congreso/): generados desde silver/, con manifiesto, sin el índice del Ejecutivo."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

import config

RAIZ = Path(__file__).resolve().parent.parent
PROHIBIDAS = ("ali", "dir_", "confianza", "categoria", "veto", "ejecutivo", "regla")


@pytest.fixture(scope="module")
def exportado(tmp_path_factory):
    destino = tmp_path_factory.mktemp("datos")
    subprocess.run([sys.executable, str(RAIZ / "pipeline" / "exportar_sitio.py"), "--destino", str(destino)],
                   check=True, capture_output=True)
    return destino


def cargar(d, rel):
    return json.loads((d / rel).read_text(encoding="utf-8"))


def test_manifiesto_coincide_con_los_archivos(exportado):
    m = cargar(exportado, "manifiesto.json")
    esperados = {f"{c}/{n}" for c in ("senado", "diputados")
                 for n in ("legisladores.json", "votaciones.json", "votos.json", "presencia.json")}
    # comisiones.json es opcional: sale solo si silver/{camara}/comisiones.csv existe
    esperados |= {f"{c}/comisiones.json" for c in ("senado", "diputados") if (config.silver_dir(c) / "comisiones.csv").exists()}
    assert {a["archivo"] for a in m["archivos"]} == esperados
    for a in m["archivos"]:
        contenido = (exportado / a["archivo"]).read_bytes()
        assert hashlib.sha256(contenido).hexdigest() == a["sha256"]
        assert len(contenido) == a["bytes"]
        obj = json.loads(contenido)
        filas = (len(obj["legisladores"]) if a["archivo"].endswith("votos.json")
                 else len(obj["comisiones"]) if a["archivo"].endswith("comisiones.json")
                 else len(obj["menor_presencia"]) if a["archivo"].endswith("presencia.json") else len(obj))
        assert filas == a["filas"]
        assert a["generado"].endswith("Z")


def test_site_datos_al_dia_con_silver(exportado):
    """Lo que está en site/datos/congreso/ es exactamente lo que genera exportar_sitio.py hoy."""
    m = cargar(exportado, "manifiesto.json")
    for a in m["archivos"]:
        assert (config.SITE_DATOS / a["archivo"]).read_bytes() == (exportado / a["archivo"]).read_bytes(), (
            f"{a['archivo']} desactualizado: correr pipeline/exportar_sitio.py")
    publicado = cargar(config.SITE_DATOS, "manifiesto.json")
    assert [(a["archivo"], a["sha256"]) for a in publicado["archivos"]] == [(a["archivo"], a["sha256"]) for a in m["archivos"]]


def test_votos_iguales_al_vc_del_analisis(exportado):
    """Las cadenas de votos.json coinciden con `vc` de dashboard_data.json, que analisis.py calcula aparte."""
    dash = json.loads((RAIZ / "salidas" / "votometro" / "dashboard_data.json").read_text(encoding="utf-8"))
    for cam, carpeta in config.CAMARAS.items():
        votos = cargar(exportado, f"{carpeta}/votos.json")
        d = dash["camaras"][cam]
        assert votos["orden"] == [x["id"] for x in d["votaciones"]]
        assert votos["legisladores"] == {str(p["id"]): p["vc"] for p in d["personas"]}


def test_conteos_consistentes(exportado):
    for carpeta in config.CAMARAS.values():
        L = cargar(exportado, f"{carpeta}/legisladores.json")
        votos = cargar(exportado, f"{carpeta}/votos.json")
        V = cargar(exportado, f"{carpeta}/votaciones.json")
        letra = {"si": "S", "no": "N", "abstencion": "A", "ausente": "X", "no_vota": "V",
                 "mocion_1": "1", "mocion_2": "2", "mocion_3": "3"}
        for p in L:
            cad = votos["legisladores"][str(p["id"])]
            assert sum(p["conteo"].values()) == p["votaciones"] == len(cad) - cad.count("-")
            assert all(cad.count(letra[k]) == n for k, n in p["conteo"].items())
        for k, v in enumerate(V):
            emitidos = sum(c[k] != "-" for c in votos["legisladores"].values())
            assert emitidos == v["totales"]["total"], v["id"]


def test_sin_indice_del_ejecutivo(exportado):
    """Fase 1: nada del índice de alineamiento con el Ejecutivo llega al sitio."""
    def claves(o):
        if isinstance(o, dict):
            for k, v in o.items():
                yield k
                yield from claves(v)
        elif isinstance(o, list):
            for v in o:
                yield from claves(v)
    for f in exportado.rglob("*.json"):
        if f.name == "votos.json":
            continue   # sus claves son ids de legisladores
        malas = {k for k in claves(cargar(exportado, f.relative_to(exportado))) if k.lower().startswith(PROHIBIDAS)}
        assert not malas, f"{f.name}: {malas}"


def test_presencia_recalculada_desde_votos(exportado):
    """presencia.json coincide con un cálculo independiente sobre votos.json y la nómina de silver/."""
    import csv
    import statistics
    from datetime import date, timedelta
    for carpeta in config.CAMARAS.values():
        p = cargar(exportado, f"{carpeta}/presencia.json")
        vots = cargar(exportado, f"{carpeta}/votaciones.json")
        votos = cargar(exportado, f"{carpeta}/votos.json")
        with open(config.silver_dir(carpeta) / "legisladores.csv", encoding="utf-8") as fh:
            activos = {int(r["id_legislador"]) for r in csv.DictReader(fh) if r["estado"] == "activos"}
        hasta = max(v["fecha"] for v in vots)
        h = date.fromisoformat(hasta)
        desde = (h.replace(year=h.year - 1) + timedelta(days=1)).isoformat()
        idx = [k for k, v in enumerate(vots) if desde <= v["fecha"] <= hasta]
        assert p["ventana"] == {"desde": desde, "hasta": hasta, "votaciones": len(idx)}
        assert p["en_ejercicio"] == len(activos)
        filas = []
        for lid, cad in votos["legisladores"].items():
            pos = sum(cad[k] != "-" for k in idx)
            if int(lid) in activos and pos * 2 >= len(idx):
                filas.append((1 - sum(cad[k] == "X" for k in idx) / pos, -pos, int(lid)))
        filas.sort()
        assert p["elegibles"] == len(filas)
        assert p["mediana"] == round(statistics.median(x for x, _, _ in filas), 4)
        # puestos: misma presencia, mismo puesto; se publican todos los de puesto <= 3
        esperado = [(x, i) for x, _, i in filas if sum(y < x - 1e-12 for y, _, _ in filas) < 3]
        assert [(r["id"]) for r in p["menor_presencia"]] == [i for _, i in esperado]
        for r in p["menor_presencia"]:
            assert r["puesto"] == 1 + sum(y < r["presencia"] - 1e-4 for y, _, _ in filas)
            assert r["id"] in activos and r["posibles"] * 2 >= len(idx)
            assert abs(r["presencia"] - (1 - r["ausencias"] / r["posibles"])) < 1e-4


def test_presencia_empates_y_minimo():
    """Empates comparten puesto y entran todos al 3.º; quien no llega a la mitad de las votaciones queda afuera."""
    import exportar_sitio as ex
    vots = [{"fecha": f"2026-01-{d:02d}"} for d in range(10, 0, -1)]   # 10 votaciones, la más reciente primero
    cad = {"1": "XXXXSSSSSS", "2": "XXXSSSSSSS", "3": "XXXSSSSSSS", "4": "XXXSSSSSSS", "5": "XSSSSSSSSS",
           "6": "XXXXXXXX--", "7": "------XXXX", "8": "XXXXXXXXXX"}
    L = {k: {"estado": "activos"} for k in cad} | {"8": {"estado": "inactivos"}}
    p = ex.exportar_presencia(vots, cad, L)
    assert p["ventana"]["votaciones"] == 10 and p["elegibles"] == 6   # 7 tiene 4 de 10; 8 no está en ejercicio
    assert [(r["puesto"], r["id"]) for r in p["menor_presencia"]] == [(1, 6), (2, 1), (3, 2), (3, 3), (3, 4)]
    assert p["menor_presencia"][0]["posibles"] == 8 and p["menor_presencia"][0]["ausencias"] == 8
