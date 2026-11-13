"""Regla: cada votación se valida contra el sumario; si no cuadra, no se escribe en silver/ y se reporta.

Fixture: tests/fixtures/silpy/104208.html, una votación real del Senado guardada de SILpy
(CC BY 4.0, Congreso Nacional). Para simular un detalle que no cuadra se cambia el voto de un legislador.
"""
import csv
import re
import subprocess
import sys
from pathlib import Path

import silpy_votos as sv

RAIZ = Path(__file__).resolve().parent.parent
FIXTURE = Path(__file__).parent / "fixtures" / "silpy" / "104208.html"


def alterar_un_voto(html):
    """Cambia SI<->NO en el primer voto individual: el detalle deja de cuadrar con el sumario."""
    i = html.find("block lg:hidden")
    m = re.compile(r">\s*(SI|NO)\s*<").search(html, i)
    assert m, "no encontré un voto SI/NO para alterar"
    return html[:m.start(1)] + ("NO" if m.group(1) == "SI" else "SI") + html[m.end(1):]


def test_fixture_valida():
    meta, votos = sv.parsear_detalle(FIXTURE.read_text(encoding="utf-8"), 104208)
    assert meta["valida"] and meta["diferencias"] == {}
    assert len(votos) == meta["total"]
    assert sum(v["voto"] == "SI" for v in votos) == meta["total_si"]


def test_voto_alterado_se_rechaza(tmp_path):
    bueno = tmp_path / "104208.html"
    bueno.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
    malo = tmp_path / "999999.html"
    malo.write_text(alterar_un_voto(FIXTURE.read_text(encoding="utf-8")), encoding="utf-8")
    metas, votos, rechazadas, errores = sv.parsear_bronze([bueno, malo])
    assert [m["id_votacion"] for m in metas] == [104208]
    assert {v["id_votacion"] for v in votos} == {104208}
    assert [m["id_votacion"] for m in rechazadas] == [999999]
    assert set(rechazadas[0]["diferencias"]) == {"SI", "NO"}
    assert errores == []


def test_reparsear_no_escribe_rechazadas_y_falla(tmp_path):
    """El comando reparsear escribe solo las válidas, reporta la rechazada y termina con código 1."""
    bronze, silver = tmp_path / "bronze", tmp_path / "silver"
    (bronze / "senado").mkdir(parents=True)
    (silver / "senado").mkdir(parents=True)
    html = FIXTURE.read_text(encoding="utf-8")
    (bronze / "senado" / "104208.html").write_text(html, encoding="utf-8")
    (bronze / "senado" / "999999.html").write_text(alterar_un_voto(html), encoding="utf-8")
    codigo = ("import sys, config; from pathlib import Path; "
              "config.BRONZE = Path(sys.argv[1]); config.SILVER = Path(sys.argv[2]); "
              "import silpy_votos; sys.argv = ['silpy_votos.py', 'reparsear', '--camara', 'S']; silpy_votos.main()")
    r = subprocess.run([sys.executable, "-c", codigo, str(bronze), str(silver)],
                       cwd=RAIZ / "pipeline", capture_output=True, text=True)
    assert r.returncode == 1
    assert "[NO SE ESCRIBE EN SILVER] votación 999999" in r.stderr
    ids = {row["id_votacion"] for row in csv.DictReader(open(silver / "senado" / "votacion.csv", encoding="utf-8"))}
    assert ids == {"104208"}
    ids_voto = {row["id_votacion"] for row in csv.DictReader(open(silver / "senado" / "voto.csv", encoding="utf-8"))}
    assert ids_voto == {"104208"}
