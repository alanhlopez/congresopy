"""Fotos: descarga sin repetir, validación de imagen, paso a silver/ y al sitio. Sin red (sesión falsa)."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import config
import fotos

RAIZ = Path(__file__).resolve().parent.parent
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200 + b"\xff\xd9"
HTML = b"<!doctype html><html>error</html>"


class SesionFalsa:
    def __init__(self, respuestas):
        self.respuestas, self.urls = respuestas, []

    def get(self, url, headers, timeout):
        assert "contacto:" in headers["User-Agent"]
        self.urls.append(url)
        i = int(url.rsplit("/", 1)[1].split(".")[0])
        estado, datos = self.respuestas[i]

        class R:
            status_code, content = estado, datos
        return R()


@pytest.fixture
def con_contacto(monkeypatch):
    monkeypatch.setattr(config, "CONTACTO", "prueba@example.org")
    monkeypatch.setattr(config, "DELAY", 0)


def test_descarga_valida_y_no_repite(tmp_path, con_contacto):
    (tmp_path / "1.jpg").write_bytes(JPEG)   # ya estaba: no se pide
    s = SesionFalsa({2: (200, JPEG), 3: (200, HTML), 4: (404, b"")})
    bajadas, ya, rechazadas = fotos.descargar([1, 2, 3, 4], s, tmp_path)
    assert bajadas == [2] and ya == 1
    assert [i for i, _ in rechazadas] == [3, 4]
    assert all(u.endswith(("/images/2.jpg", "/images/3.jpg", "/images/4.jpg")) for u in s.urls) and len(s.urls) == 3
    assert (tmp_path / "2.jpg").read_bytes() == JPEG
    assert not (tmp_path / "3.jpg").exists(), "una respuesta HTML no se guarda como foto"


def test_sin_contacto_no_hay_requests(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CONTACTO", "")
    s = SesionFalsa({5: (200, JPEG)})
    with pytest.raises(SystemExit, match="CONGRESOPY_CONTACTO"):
        fotos.descargar([5], s, tmp_path)
    assert s.urls == []


def test_a_silver_descarta_invalidas(tmp_path):
    origen, destino = tmp_path / "bronze", tmp_path / "silver"
    origen.mkdir()
    (origen / "10.jpg").write_bytes(JPEG)
    (origen / "11.jpg").write_bytes(HTML)
    copiadas, invalidas = fotos.a_silver(origen, destino)
    assert copiadas == ["10.jpg"] and invalidas == ["11.jpg"]
    assert sorted(f.name for f in destino.iterdir()) == ["10.jpg"]


def test_exportar_publica_fotos(tmp_path):
    """Con fotos en silver/fotos/, legisladores.json trae `foto` y el manifiesto su resumen."""
    silver = tmp_path / "silver"
    for c in config.CAMARAS.values():
        shutil.copytree(config.SILVER / c, silver / c)
    (silver / "fotos").mkdir()
    (silver / "fotos" / "101378.jpg").write_bytes(JPEG)
    destino = tmp_path / "datos"
    subprocess.run([sys.executable, str(RAIZ / "pipeline" / "exportar_sitio.py"), "--destino", str(destino)],
                   env={**os.environ, "CONGRESOPY_SILVER": str(silver)}, check=True, capture_output=True)
    L = {l["id"]: l for l in json.loads((destino / "senado" / "legisladores.json").read_text(encoding="utf-8"))}
    assert L[101378]["foto"] == "fotos/101378.jpg"
    assert sum("foto" in l for l in L.values()) == 1
    assert (destino / "fotos" / "101378.jpg").read_bytes() == JPEG
    m = json.loads((destino / "manifiesto.json").read_text(encoding="utf-8"))
    assert m["fotos"]["archivos"] == 1 and m["fotos"]["bytes"] == len(JPEG)
