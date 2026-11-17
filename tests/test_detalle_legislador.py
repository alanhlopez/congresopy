"""Archivos por legislador (site/datos/congreso/{camara}/legisladores/{id}/): al día con silver/ y recalculados por un
camino independiente desde votos.json y votaciones.json."""
import csv
import hashlib
import io
import json
import statistics
import subprocess
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

import pytest

import config

RAIZ = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def exportado(tmp_path_factory):
    destino = tmp_path_factory.mktemp("datos")
    subprocess.run([sys.executable, str(RAIZ / "pipeline" / "exportar_sitio.py"), "--destino", str(destino)],
                   check=True, capture_output=True)
    return destino


def cargar(d, rel):
    return json.loads((d / rel).read_text(encoding="utf-8"))


def test_al_dia_y_en_el_manifiesto(exportado):
    """Lo publicado es exactamente lo que genera el pipeline hoy, y el manifiesto lo resume con su sha256."""
    lineas = []
    for carpeta in config.CAMARAS.values():
        gen = sorted(p.relative_to(exportado) for p in (exportado / carpeta / "legisladores").rglob("*") if p.is_file())
        pub = sorted(p.relative_to(config.SITE_DATOS) for p in (config.SITE_DATOS / carpeta / "legisladores").rglob("*") if p.is_file())
        assert gen == pub, f"{carpeta}/legisladores desactualizado: correr pipeline/exportar_sitio.py"
        for rel in gen:
            contenido = (exportado / rel).read_bytes()
            assert (config.SITE_DATOS / rel).read_bytes() == contenido, f"{rel} desactualizado"
            lineas.append(f"{rel.as_posix()}:{hashlib.sha256(contenido).hexdigest()}")
        ids = {str(r["id"]) for r in cargar(exportado, f"{carpeta}/legisladores.json")}
        assert {p.name for p in (exportado / carpeta / "legisladores").iterdir()} == ids
    m = cargar(exportado, "manifiesto.json")["por_legislador"]
    assert m["archivos"] == len(lineas)
    assert m["sha256"] == hashlib.sha256("\n".join(sorted(lineas)).encode()).hexdigest()


def preparar(exportado, carpeta):
    vots = cargar(exportado, f"{carpeta}/votaciones.json")
    votos = cargar(exportado, f"{carpeta}/votos.json")["legisladores"]
    leg = {str(r["id"]): r for r in cargar(exportado, f"{carpeta}/legisladores.json")}
    return vots, votos, leg


@pytest.mark.parametrize("carpeta", list(config.CAMARAS.values()))
def test_conteos_series_y_csv(exportado, carpeta):
    vots, votos, leg = preparar(exportado, carpeta)
    hasta = max(v["fecha"] for v in vots)
    h = date.fromisoformat(hasta)
    desde12 = (h.replace(year=h.year - 1) + timedelta(days=1)).isoformat()
    for lid, cad in votos.items():
        a = cargar(exportado, f"{carpeta}/legisladores/{lid}/analisis.json")
        claves = [p["clave"] for p in a["periodos"]]
        assert claves[:2] == ["mandato", "12m"] and set(claves[2:]) <= {str(k) for k in config.PERIODOS}
        for p in a["periodos"]:
            if p["clave"] == "mandato":
                idx = range(len(vots))
            elif p["clave"] == "12m":
                idx = [k for k, v in enumerate(vots) if desde12 <= v["fecha"] <= hasta]
            else:
                idx = [k for k, v in enumerate(vots) if str(v["periodo_id"]) == p["clave"]]
            c = Counter("M" if cad[k] in "123" else cad[k] for k in idx if cad[k] != "-")
            pp = a["por_periodo"][p["clave"]]
            assert pp["conteo"] == {**{x: c[x] for x in "SNAMVX"}, "posibles": sum(c.values())}
            # Cada serie suma el conteo del período; semana solo si dura 6 meses o menos
            dias = (date.fromisoformat(p["hasta"]) - date.fromisoformat(p["desde"])).days
            assert p["semana"] == (dias <= 183) == ("semana" in pp["series"])
            for serie in pp["series"].values():
                assert sum(t["posibles"] for t in serie) == pp["conteo"]["posibles"]
                assert sum(t["X"] for t in serie) == pp["conteo"]["X"]
        # Mandato coincide con legisladores.json
        cm = a["por_periodo"]["mandato"]["conteo"]
        l = leg[lid]
        assert cm["posibles"] == l["votaciones"] and cm["X"] == l["conteo"]["ausente"]
        # votos.csv: una fila por votación en el cargo, con el voto como lo registra SILpy
        filas = list(csv.DictReader(io.StringIO((exportado / f"{carpeta}/legisladores/{lid}/votos.csv").read_text(encoding="utf-8"))))
        assert len(filas) == cm["posibles"]
        por_id = {v["id"]: k for k, v in enumerate(vots)}
        codigos = {"SI": "S", "NO": "N", "ABSTENCIÓN/BLANCO": "A", "AUSENTE": "X", "NO VOTA": "V", "MOCIÓN 1": "1", "MOCIÓN 2": "2", "MOCIÓN 3": "3"}
        for f in filas:
            k = por_id[int(f["id_votacion"])]
            assert codigos[f["su_voto"]] == cad[k] and f["url"] == vots[k]["url"] and f["fecha"] == vots[k]["fecha"]
        r = cargar(exportado, f"{carpeta}/legisladores/{lid}/resumen.json")
        assert r["votaciones_en_el_cargo"] == cm["posibles"] and "CC BY-SA 4.0" in r["licencia"]


@pytest.mark.parametrize("carpeta", list(config.CAMARAS.values()))
def test_mediana_de_la_camara_por_tramo(exportado, carpeta):
    vots, votos, _ = preparar(exportado, carpeta)
    lid = next(iter(votos))
    serie = cargar(exportado, f"{carpeta}/legisladores/{lid}/analisis.json")["por_periodo"]["mandato"]["series"]["anio"]
    for t in serie:
        idx = [k for k, v in enumerate(vots) if v["fecha"][:4] == t["p"]]
        pres = []
        for cad in votos.values():
            n = sum(cad[k] != "-" for k in idx)
            if n:
                pres.append(sum(cad[k] not in "-X" for k in idx) / n)
        assert abs(t["mediana"] - statistics.median(pres)) < 1e-4


@pytest.mark.parametrize("carpeta", list(config.CAMARAS.values()))
def test_similitud_y_bloques(exportado, carpeta):
    vots, votos, leg = preparar(exportado, carpeta)
    activos = {i for i, l in leg.items() if l["estado"] == "activos"}
    partido = {i: l["partido"] for i, l in leg.items()}
    for lid in list(votos)[:6]:
        a = cargar(exportado, f"{carpeta}/legisladores/{lid}/analisis.json")["por_periodo"]["mandato"]
        cad = votos[lid]
        esperado = {}
        for otro in activos - {lid}:
            c2 = votos[otro]
            comun = [k for k in range(len(vots)) if cad[k] in "SNA" and c2[k] in "SNA"]
            if len(comun) >= 20:
                esperado[int(otro)] = (sum(cad[k] == c2[k] for k in comun), len(comun))
        assert {s["id"]: (s["igual"], s["comun"]) for s in a["similitud"]} == esperado
        # Bloques: coincidencia con la mayoría (más de la mitad de los S/N/A) de cada partido, sin su propio voto
        for b in a["bloques"]:
            igual = comun = 0
            for k in range(len(vots)):
                if cad[k] not in "SNA":
                    continue
                cuenta = Counter(votos[o][k] for o in votos if o != lid and partido.get(o) == b["partido"] and votos[o][k] in "SNA")
                total = sum(cuenta.values())
                if not total:
                    continue
                opcion, n = cuenta.most_common(1)[0]
                if n * 2 <= total:
                    continue
                comun += 1
                igual += cad[k] == opcion
            assert (b["igual"], b["comun"]) == (igual, comun), (lid, b["partido"])


def test_leyes_clave_apagadas(exportado):
    """Con LEYES_CLAVE_PUBLICADAS = False, ningún archivo del sitio trae votaciones clave."""
    assert config.LEYES_CLAVE_PUBLICADAS is False
    for f in exportado.rglob("analisis.json"):
        assert "leyes_clave" not in json.loads(f.read_text(encoding="utf-8")), f


def test_leyes_clave_componente():
    """El componente (detrás de la bandera) calcula su voto, la posición de su partido y copia la del gobierno."""
    import detalle_legislador as dl
    vots = [{"id": 10, "fecha": "2026-01-01", "resultado": "APROBADO"}, {"id": 11, "fecha": "2026-01-02", "resultado": "RECHAZADO"}]
    cad = {"1": "SN", "2": "SS", "3": "NN", "4": "-S"}
    L = {"1": {"partido": "A"}, "2": {"partido": "A"}, "3": {"partido": "B"}, "4": {"partido": "A"}}
    lista = [{"id_votacion": "10", "titulo": "Ley X", "gobierno": "a favor", "fuente": "Mensaje N° 1"},
             {"id_votacion": "11", "titulo": "Ley Y", "gobierno": "en contra", "fuente": "Decreto N° 2"}]
    r = dl.leyes_clave(vots, cad, L, lista)
    assert [(f["titulo"], f["su_voto"], f["su_partido"], f["gobierno"]) for f in r["1"]] == [("Ley X", "SI", "a favor", "a favor"), ("Ley Y", "NO", "a favor", "en contra")]
    assert [f["titulo"] for f in r["4"]] == ["Ley Y"]               # no estaba en el cargo en la primera
    assert r["2"][1]["su_partido"] == "a favor"                    # partido A en Y: S, N, S -> a favor (2 de 3)
