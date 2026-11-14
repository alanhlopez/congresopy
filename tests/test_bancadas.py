"""Historial de bancadas desde fotos de la nómina y sincronización de legisladores.csv (sin red)."""
import csv

import pytest

import bancadas
import config
from legisladores import CAMPOS


def foto(dir_, letra, fecha, filas):
    d = dir_ / "nomina" / letra
    d.mkdir(parents=True, exist_ok=True)
    with open(d / f"{fecha}.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CAMPOS)
        w.writeheader()
        for f in filas:
            w.writerow({c: "" for c in CAMPOS} | f)


def leg(i, partido="ANR", bancada="A", cargo_bancada="MIEMBRO", estado="activos", **kw):
    return {"id_legislador": i, "nombre": f"Legislador {i}", "partido": partido, "bancada": bancada,
            "cargo_bancada": cargo_bancada, "estado": estado, **kw}


@pytest.fixture
def silver(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SILVER", tmp_path)
    for c in config.CAMARAS.values():
        (tmp_path / c).mkdir()
    return tmp_path


def test_historial_detecta_cambios_altas_y_bajas(silver):
    foto(silver, "S", "2026-01-01", [leg(1), leg(2), leg(3)])
    foto(silver, "S", "2026-02-01", [leg(1), leg(2, bancada="B"), leg(4)])
    foto(silver, "S", "2026-03-01", [leg(1), leg(2, bancada="B"), leg(4)])
    tramos, fechas = bancadas.historial("S")
    por = {}
    for t in tramos:
        por.setdefault(t["id_legislador"], []).append(t)
    assert fechas == ["2026-01-01", "2026-02-01", "2026-03-01"]
    assert len(por[1]) == 1 and por[1][0]["visto_hasta"] == "2026-03-01" and por[1][0]["fotos"] == 3
    assert [(t["bancada"], t["visto_desde"], t["visto_hasta"], t["cambio_detectado"]) for t in por[2]] == [
        ("A", "2026-01-01", "2026-01-01", "2026-02-01"), ("B", "2026-02-01", "2026-03-01", "")]
    assert por[3][0]["cambio_detectado"] == "2026-02-01", "quien desaparece de la nómina cierra su tramo"
    assert por[4][0]["visto_desde"] == "2026-02-01"


def test_columna_no_registrada_no_es_cambio(silver):
    """Una foto sin cargo_bancada (vacío en todas las filas) no genera cambios falsos."""
    foto(silver, "D", "2026-01-01", [leg(1, cargo_bancada=""), leg(2, cargo_bancada="")])
    foto(silver, "D", "2026-02-01", [leg(1, cargo_bancada="LIDER"), leg(2, cargo_bancada="MIEMBRO", estado="inactivos")])
    tramos, _ = bancadas.historial("D")
    por = {}
    for t in tramos:
        por.setdefault(t["id_legislador"], []).append(t)
    assert len(por[1]) == 1 and por[1][0]["cargo_bancada"] == "LIDER"
    assert [t["estado"] for t in por[2]] == ["activos", "inactivos"]


def test_partido_vacio_no_es_cambio(silver):
    """Si SILpy deja vacío el partido de un legislador, se conserva el anterior; el cargo sí cambia."""
    foto(silver, "D", "2026-01-01", [leg(1, partido="IND", cargo_bancada=""), leg(2)])
    foto(silver, "D", "2026-02-01", [leg(1, partido="", cargo_bancada="LIDER"), leg(2)])
    foto(silver, "D", "2026-03-01", [leg(1, partido="", cargo_bancada="LIDER"), leg(2)])
    tramos, _ = bancadas.historial("D")
    uno = [t for t in tramos if t["id_legislador"] == 1]
    assert [(t["partido"], t["cargo_bancada"]) for t in uno] == [("IND", ""), ("IND", "LIDER")]


def test_sincronizar_conserva_lo_manual(silver):
    ruta = silver / "senado" / "legisladores.csv"
    cols = ["id_legislador", "nombre", "cargo", "periodo", "estado", "partido", "bancada", "cargo_bancada", "color", "nombre_corto"]
    with open(ruta, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        w.writerow({c: "" for c in cols} | leg(1) | {"nombre_corto": "Uno"})
        w.writerow({c: "" for c in cols} | leg(2, partido="IND") | {"nombre_corto": "Dos"})
        w.writerow({c: "" for c in cols} | leg(3, partido="PLRA") | {"nombre_corto": "Tres"})
    (silver / "senado" / "correcciones_legisladores.csv").write_text(
        "id_legislador,campo,valor,fuente\n3,partido,PLRA,prueba\n", encoding="utf-8")
    foto(silver, "S", "2026-02-01", [leg(1, bancada="Nueva"), leg(2, partido=""), leg(3, partido="IA"), leg(9)])
    cambios = bancadas.sincronizar("S")
    filas = {r["id_legislador"]: r for r in csv.DictReader(open(ruta, encoding="utf-8"))}
    assert filas["1"]["bancada"] == "Nueva" and filas["1"]["nombre_corto"] == "Uno"
    assert filas["2"]["partido"] == "IND", "un vacío en SILpy no borra el dato"
    assert filas["3"]["partido"] == "PLRA", "la corrección manual pisa a la foto"
    assert "9" in filas, "los nuevos se agregan"
    assert not any(c[0] == 3 and c[2] == "partido" for c in cambios), "la corrección no aparece como cambio"
    assert b"\r\n" not in ruta.read_bytes(), "se respeta el fin de línea del archivo"


def test_foto_rechaza_nomina_incompleta(silver, monkeypatch):
    monkeypatch.setattr(bancadas, "parsear_nomina", lambda html: [leg(i) for i in range(5)])
    with pytest.raises(SystemExit, match="activos"):
        bancadas.guardar_foto("S", "<html></html>", "2026-02-01")
    assert not (silver / "nomina" / "S" / "2026-02-01.csv").exists()
