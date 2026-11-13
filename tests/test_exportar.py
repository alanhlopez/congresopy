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
    assert {a["archivo"] for a in m["archivos"]} == {
        f"{c}/{n}" for c in ("senado", "diputados") for n in ("legisladores.json", "votaciones.json", "votos.json")}
    for a in m["archivos"]:
        contenido = (exportado / a["archivo"]).read_bytes()
        assert hashlib.sha256(contenido).hexdigest() == a["sha256"]
        assert len(contenido) == a["bytes"]
        obj = json.loads(contenido)
        filas = len(obj["legisladores"]) if a["archivo"].endswith("votos.json") else len(obj)
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
