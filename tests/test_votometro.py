"""Votómetro (votometro.json): recalculado por caminos independientes desde votos.json, votaciones.json y la nómina."""
import json
import math
import subprocess
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

import config
from analisis import coincidencias

RAIZ = Path(__file__).resolve().parent.parent
CAMARAS = list(config.CAMARAS.values())


@pytest.fixture(scope="module")
def exportado(tmp_path_factory):
    destino = tmp_path_factory.mktemp("datos")
    subprocess.run([sys.executable, str(RAIZ / "pipeline" / "exportar_sitio.py"), "--destino", str(destino)], check=True, capture_output=True)
    return destino


def cargar(d, rel):
    return json.loads((d / rel).read_text(encoding="utf-8"))


def datos(exportado, cam):
    vm = cargar(exportado, f"{cam}/votometro.json")
    vots = cargar(exportado, f"{cam}/votaciones.json")
    votos = cargar(exportado, f"{cam}/votos.json")["legisladores"]
    leg = {r["id"]: r for r in cargar(exportado, f"{cam}/legisladores.json")}
    return vm, vots, votos, leg


@pytest.mark.parametrize("cam", CAMARAS)
def test_periodos(exportado, cam):
    vm, vots, _, _ = datos(exportado, cam)
    claves = [p["clave"] for p in vm["periodos"]]
    assert claves[0] == "mandato" and set(claves[1:]) <= {str(k) for k in config.PERIODOS}
    assert str(config.PERIODO_ABIERTO) not in claves   # 2026-27: pocas votaciones divididas, no se ofrece
    assert vm["periodos"][0]["votaciones"] == len(vots)


@pytest.mark.parametrize("cam", CAMARAS)
def test_mapa_igual_al_metodo_del_prototipo(exportado, cam):
    """La varianza explicada del mandato coincide con el MDS de analisis.py (coincidencias + MDS clásico)."""
    vm, _, votos, leg = datos(exportado, cam)
    signo = {"S": 1, "N": -1, "1": 1, "2": -1}
    ids = sorted(votos, key=int)
    X = np.array([[signo.get(c, np.nan) for c in votos[i]] for i in ids], dtype=float)
    si, no = (X == 1).sum(0), (X == -1).sum(0)
    X = X[:, np.minimum(si, no) / np.maximum((~np.isnan(X)).sum(0), 1) >= 0.025]
    minimo = max(10, min(25, int(0.25 * X.shape[1])))
    filas = (~np.isnan(X)).sum(1) >= minimo
    X = X[filas]
    A = coincidencias(X)
    A = np.where(np.isnan(A), np.nanmean(A), A)
    n = len(A)
    J = np.eye(n) - 1 / n
    w = np.linalg.eigvalsh(-0.5 * J @ ((1 - A) ** 2) @ J)[::-1]
    m = vm["por_periodo"]["mandato"]["mapa"]
    assert abs(m["var1"] - w[0] / w[w > 0].sum()) < 1e-3
    assert {p["id"] for p in m["puntos"]} == {int(i) for i, ok in zip(ids, filas) if ok}
    # orientación: el promedio del ANR del lado positivo, en cada período y en cada ventana
    for pp in vm["por_periodo"].values():
        anr = [p["d1"] for p in pp["mapa"]["puntos"] if leg.get(p["id"], {}).get("partido") == "ANR"]
        assert np.mean(anr) > 0
    claves = [v["clave"] for v in vm["trayectoria"]["ventanas"]]
    for k, c in enumerate(claves):
        anr = [s[k] for i, s in vm["trayectoria"]["posiciones"].items() if s[k] is not None and leg.get(int(i), {}).get("partido") == "ANR"]
        assert np.mean(anr) > 0, c


@pytest.mark.parametrize("cam", CAMARAS)
def test_ventanas_de_12_meses_cada_6(exportado, cam):
    vm, _, _, _ = datos(exportado, cam)
    vs = vm["trayectoria"]["ventanas"]
    assert vs[0]["desde"] == "2023-07"
    for v in vs:
        y, m = map(int, v["desde"].split("-"))
        assert v["hasta"] == f"{y + 1}-{m:02d}" and m in (1, 7)
        assert v["legisladores"] >= 10 and v["divididas"] >= 15
    for i, serie in vm["trayectoria"]["posiciones"].items():
        assert len(serie) == len(vs) and all(x is None or -1 <= x <= 1 for x in serie)


@pytest.mark.parametrize("cam", CAMARAS)
def test_disciplina_y_cohesion(exportado, cam):
    vm, vots, votos, leg = datos(exportado, cam)
    partido = {i: leg.get(int(i), {}).get("partido") or "" for i in votos}
    d = vm["por_periodo"]["mandato"]["disciplina"]
    for f in d["legisladores"][:8]:
        i = str(f["id"])
        igual = comun = 0
        for k in range(len(vots)):
            v = votos[i][k]
            if v not in "SNA" or v == "-":
                continue
            c = Counter(votos[o][k] for o in votos if o != i and partido[o] == f["partido"] and votos[o][k] in "SNA" and votos[o][k] != "-")
            t = sum(c.values())
            if not t:
                continue
            op, n = c.most_common(1)[0]
            if n / t < 0.6:
                continue
            comun += 1
            igual += v == op
        assert (f["igual"], f["comun"]) == (igual, comun)
        assert len(d["se_aparto"][i]) == comun - igual
    # Rice del partido más grande: promedio de |S−N|/(S+N) por votación con al menos 2 votos
    g = vm["por_periodo"]["mandato"]["cohesion"][0]
    rices = []
    for k in range(len(vots)):
        c = Counter(votos[o][k] for o in votos if partido[o] == g["partido"] and votos[o][k] in "SN")
        if c["S"] + c["N"] >= 2:
            rices.append(abs(c["S"] - c["N"]) / (c["S"] + c["N"]))
    assert abs(g["rice"] - sum(rices) / len(rices)) < 1e-4 and g["votaciones"] == len(rices)


@pytest.mark.parametrize("cam", CAMARAS)
def test_decisivas(exportado, cam):
    vm, vots, votos, _ = datos(exportado, cam)
    dec = vm["por_periodo"]["mandato"]["decisivas"]
    por_id = {v["id"]: (k, v) for k, v in enumerate(vots)}
    incluidas = {f["id"] for f in dec["votaciones"]}
    # toda votación Sí/No con margen 1 a 3 está (por margen o por umbral)
    for v in vots:
        t = v["totales"]
        if v["tipo_votacion"] != "mociones" and t.get("si", 0) != t.get("no", 0) and abs(t.get("si", 0) - t.get("no", 0)) <= 3:
            assert v["id"] in incluidas, v["id"]
    bancas = vm["criterios"]["bancas"]
    for f in dec["votaciones"]:
        k, v = por_id[f["id"]]
        if f["tipo"] == "margen":
            assert f["margen"] == abs(f["si"] - f["no"]) <= 3 and f["para_dar_vuelta"] == f["margen"] + 1
        else:
            assert f["umbral"] in (bancas // 2 + 1, math.ceil(2 * bancas / 3))
            dif = f["diferencia"]
            assert (0 <= dif <= 2) or (-3 <= dif < 0)
        assert sorted(f["lado_ganador"]) == sorted(int(i) for i in votos if votos[i][k] == f["ganador"])
    cuenta = Counter(i for f in dec["votaciones"] for i in f["lado_ganador"])
    assert {r["id"]: r["veces"] for r in dec["ranking"]} == dict(cuenta)
