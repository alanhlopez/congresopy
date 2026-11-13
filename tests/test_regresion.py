"""Test de regresión de la LÓGICA de analisis.py: tiene que reproducir el votómetro del prototipo.

Insumos congelados: tests/referencia/silver_votometro.tar.gz, los CSV de silver/ que lee analisis.py tal
como quedaron al migrar el prototipo. El test corre analisis.py sobre esa copia, no sobre silver/ vivo:
así una corrección de datos o votaciones nuevas no rompen el test, y un cambio de lógica sí.
Referencia: tests/referencia/dashboard_data_votometro.json.gz, copia gzip del
dashboard_data.json de VotometroCongresoPy (sha256 en REF_SHA256).

La comparación es exacta en todo (votaciones, votos, personas, vc, métricas), con una
sola salvedad: la matriz de coincidencias (`heat`) se compara como pares
(legislador, legislador) -> valor, sin importar el orden de las filas. Ese orden sale de
ordenar por d1, y hay legisladores empatados en d1 (difieren en el 16.º decimal, ruido de
punto flotante que cambia con la versión de numpy). Ver CLAUDE.md, "Regresión".

Correr: .venv/bin/python -m pytest
"""
import csv
import gzip
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "pipeline"))
import config  # noqa: E402

REF = Path(__file__).parent / "referencia" / "dashboard_data_votometro.json.gz"
SILVER_CONGELADO = Path(__file__).parent / "referencia" / "silver_votometro.tar.gz"
REF_SHA256 = "984e0d7b21afb7895a6af0329bc45b8cf53d5fd387064c18ac531bcbea6b0115"
# sha256 del dashboard_data.json que genera analisis.py sobre los insumos congelados.
# Desde el desempate determinístico del orden de `heat` es igual byte a byte en cualquier versión
# de pandas/numpy probada. Si un cambio de lógica lo modifica a propósito, actualizalo y explicá por qué.
SALIDA_SHA256 = "e9e3846eed7aae3ddf422215868f602514cf140660300adf8b2b1b91c07e6291"


def normalizar(d):
    """Reemplaza cada matriz `heat` por su conjunto de ids y sus pares (i, j, valor)."""
    for cam in d["camaras"].values():
        for vista in cam["vistas"].values():
            h = vista["heat"]
            ids = h["ids"]
            vista["heat"] = {
                "ids": sorted(ids),
                "pares": sorted((ids[i], ids[j], h["m"][i][j])
                                for i in range(len(ids)) for j in range(len(ids))
                                if h["m"][i][j] is not None),
            }
    return d


def diferencias(a, b, ruta="", out=None, limite=20):
    out = [] if out is None else out
    if len(out) >= limite:
        return out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b), key=str):
            diferencias(a.get(k), b.get(k), f"{ruta}.{k}", out, limite)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            diferencias(x, y, f"{ruta}[{i}]", out, limite)
    elif a != b:
        out.append(f"{ruta}: referencia={str(a)[:80]} nuevo={str(b)[:80]}")
    return out


@pytest.fixture(scope="session")
def referencia():
    crudo = gzip.decompress(REF.read_bytes())
    assert hashlib.sha256(crudo).hexdigest() == REF_SHA256, "la copia de referencia cambió"
    return json.loads(crudo)


@pytest.fixture(scope="session")
def salida(tmp_path_factory):
    """Corre analisis.py sobre la copia congelada de silver/, escribiendo en un directorio temporal."""
    silver = tmp_path_factory.mktemp("silver_congelado")
    with tarfile.open(SILVER_CONGELADO) as t:
        t.extractall(silver, filter="data")
    destino = tmp_path_factory.mktemp("votometro")
    env = {**os.environ, "CONGRESOPY_SALIDAS": str(destino), "CONGRESOPY_SILVER": str(silver)}
    subprocess.run([sys.executable, str(RAIZ / "pipeline" / "analisis.py")],
                   env=env, check=True, capture_output=True)
    return (destino / "dashboard_data.json").read_bytes()


def test_dashboard_byte_a_byte(salida):
    assert hashlib.sha256(salida).hexdigest() == SALIDA_SHA256, (
        "dashboard_data.json cambió. Si es a propósito, actualizá SALIDA_SHA256 y explicá el cambio.")


def test_dashboard_igual_a_referencia(referencia, salida):
    ref, nuevo = normalizar(referencia), normalizar(json.loads(salida))
    difs = diferencias(ref, nuevo)
    assert not difs, "dashboard_data.json difiere de la referencia:\n" + "\n".join(difs)


@pytest.mark.parametrize("camara", ["S", "D"])
def test_codificar_reproduce_silver(camara, tmp_path):
    """codificar.py es determinístico: regenerarlo da el mismo archivo que hay en silver/."""
    origen = config.silver_dir(camara)
    actual = (origen / "codificacion_sugerida.csv").read_bytes()
    # Corre el script real sobre una copia de silver/ para no tocar el original.
    copia = tmp_path / "silver"
    destino = copia / config.camara_dir(camara)
    destino.mkdir(parents=True)
    for nombre in ("votacion.csv", "correcciones.csv"):
        if (origen / nombre).exists():
            (destino / nombre).write_bytes((origen / nombre).read_bytes())
    codigo = ("import sys, config; from pathlib import Path; config.SILVER = Path(sys.argv[1]); "
              "import codificar; sys.argv = ['codificar.py', sys.argv[2]]; codificar.main()")
    subprocess.run([sys.executable, "-c", codigo, str(copia), camara], cwd=RAIZ / "pipeline",
                   check=True, capture_output=True)
    assert (destino / "codificacion_sugerida.csv").read_bytes() == actual


@pytest.mark.parametrize("camara", ["S", "D"])
def test_reparsear_reproduce_silver(camara):
    """Parsear bronze/ da exactamente las filas de silver/ (sin importar el orden).

    Se saltea si bronze/ no está (no está en git, por ejemplo en CI)."""
    bronze = config.bronze_dir(camara)
    htmls = sorted(f for f in bronze.glob("*.html") if f.stem.isdigit()) if bronze.exists() else []
    if not htmls:
        pytest.skip(f"no hay HTML en {bronze}")
    import silpy_votos as sv
    metas, votos = [], []
    for f in htmls:
        m, v = sv.parsear_detalle(f.read_text(encoding="utf-8"), int(f.stem))
        assert m["valida"], f"{f.stem}: el detalle no cuadra con el sumario"
        metas.append(m)
        votos.extend(v)
    for nombre, filas, campos in [("votacion.csv", metas, sv.CAMPOS_VOTACION), ("voto.csv", votos, sv.CAMPOS_VOTO)]:
        buf = io.StringIO(newline="")
        w = csv.DictWriter(buf, fieldnames=campos, extrasaction="ignore")
        w.writeheader()
        w.writerows(filas)
        nuevo = buf.getvalue().splitlines()
        actual = (config.silver_dir(camara) / nombre).read_text(encoding="utf-8").splitlines()
        assert nuevo[0] == actual[0], f"{nombre}: cambió el encabezado"
        assert sorted(nuevo[1:]) == sorted(actual[1:]), f"{nombre}: las filas no coinciden con silver/"
