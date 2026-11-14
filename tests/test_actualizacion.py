"""Actualización sin bronze/ completo (GitHub Actions): detalle no repite rechazadas, fechas reutiliza los
períodos cerrados que ya están en silver/ y reparsear no borra lo que falta en bronze/. Sin red."""
import csv
import subprocess
import sys
from pathlib import Path

import pytest

import config
import silpy_votos as sv

RAIZ = Path(__file__).resolve().parents[1]
FIXTURE = RAIZ / "tests" / "fixtures" / "silpy" / "104208.html"


def alterar_un_voto(html):
    from test_validacion import alterar_un_voto as f
    return f(html)


def correr(bronze, silver, *argv):
    codigo = ("import sys, config; from pathlib import Path; "
              "config.BRONZE = Path(sys.argv[1]); config.SILVER = Path(sys.argv[2]); config.CONTACTO = 'prueba@example.org'; "
              "import silpy_votos; silpy_votos.DELAY = 0; sys.argv = ['silpy_votos.py', *sys.argv[3:]]; silpy_votos.main()")
    return subprocess.run([sys.executable, "-c", codigo, str(bronze), str(silver), *argv],
                          cwd=RAIZ / "pipeline", capture_output=True, text=True)


@pytest.fixture
def dirs(tmp_path):
    bronze, silver = tmp_path / "bronze", tmp_path / "silver"
    (bronze / "senado").mkdir(parents=True)
    (silver / "senado").mkdir(parents=True)
    return bronze, silver


def ids_csv(f):
    with open(f, encoding="utf-8") as fh:
        return {int(r["id_votacion"]) for r in csv.DictReader(fh)}


def test_detalle_registra_rechazada_y_no_la_repite(dirs):
    bronze, silver = dirs
    html = FIXTURE.read_text(encoding="utf-8")
    # Ya "descargadas" en bronze/: detalle no hace requests.
    (bronze / "senado" / "104208.html").write_text(html, encoding="utf-8")
    (bronze / "senado" / "999999.html").write_text(alterar_un_voto(html), encoding="utf-8")
    ids = silver / "ids.txt"
    ids.write_text("104208\n999999\n")
    r = correr(bronze, silver, "detalle", "--camara", "S", "--ids", str(ids))
    assert r.returncode == 1, r.stderr
    assert ids_csv(silver / "senado" / "votacion.csv") == {104208}
    assert ids_csv(silver / "senado" / "rechazadas.csv") == {999999}
    # Segunda corrida sin bronze/ (como en GitHub Actions): no intenta bajar ninguna de las dos.
    (bronze / "senado" / "104208.html").unlink()
    (bronze / "senado" / "999999.html").unlink()
    r = correr(bronze, silver, "detalle", "--camara", "S", "--ids", str(ids))
    assert r.returncode == 0, r.stderr
    assert "0 votaciones nuevas" in r.stderr
    assert list((bronze / "senado").iterdir()) == []


def test_fechas_reutiliza_periodo_cerrado_sin_listado(dirs):
    bronze, silver = dirs
    cerrado = 100257
    with open(silver / "senado" / "fechas.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); w.writerow(["id_votacion", "periodo_id", "fecha", "sesion"])
        w.writerow([1, cerrado, "2025-01-01", "ORDINARIA 1"])
        w.writerow([2, config.PERIODO_ABIERTO, "2026-07-01", "ORDINARIA 1"])
    abierto = bronze / "senado" / f"listado_S_{config.PERIODO_ABIERTO}_2026-11-14.html"
    abierto.write_text('<a href="/web/votacion/3">x</a> 05/11/2026 SESIÓN ORDINARIA 9', encoding="utf-8")
    r = correr(bronze, silver, "fechas", "--camara", "S", "--periodos", str(cerrado), str(config.PERIODO_ABIERTO))
    assert r.returncode == 0, r.stderr
    with open(silver / "senado" / "fechas.csv", encoding="utf-8") as fh:
        filas = [(int(x["id_votacion"]), x["fecha"]) for x in csv.DictReader(fh)]
    assert filas == [(1, "2025-01-01"), (3, "2026-11-05")]
    assert sorted(f.name for f in (bronze / "senado").iterdir()) == [abierto.name]   # no bajó el cerrado


def test_reparsear_no_borra_lo_que_falta_en_bronze(dirs):
    bronze, silver = dirs
    (bronze / "senado" / "104208.html").write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
    vp = silver / "senado" / "votacion.csv"
    vp.write_text("id_votacion\n104208\n555555\n", encoding="utf-8")
    r = correr(bronze, silver, "reparsear", "--camara", "S")
    assert r.returncode != 0
    assert "[NO SE ESCRIBE]" in r.stderr and "555555" in r.stderr
    assert vp.read_text(encoding="utf-8") == "id_votacion\n104208\n555555\n"
