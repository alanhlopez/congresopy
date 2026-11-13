"""Política de listados: los períodos cerrados nunca se vuelven a bajar; el período abierto se puede
refrescar con un snapshot fechado (uno por día) que no pisa los anteriores. Sin red: sesión falsa."""
from datetime import date

import pytest

import config
import silpy_votos as sv

HTML = '<a href="/web/votacion/111">x</a> <a href="/web/votacion/222">y</a>'


class SesionFalsa:
    def __init__(self, html=HTML):
        self.urls, self.html = [], html

    def get(self, url, headers, timeout):
        assert "contacto:" in headers["User-Agent"]
        self.urls.append(url)
        sesion = self

        class R:
            text = sesion.html

            def raise_for_status(self):
                pass
        return R()


@pytest.fixture
def bronze(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "BRONZE", tmp_path)
    monkeypatch.setattr(config, "CONTACTO", "prueba@example.org")
    monkeypatch.setattr(sv, "DELAY", 0)
    (tmp_path / "senado").mkdir()
    return tmp_path / "senado"


def test_periodo_cerrado_guardado_no_se_baja(bronze):
    (bronze / "listado_S_100217.html").write_text(HTML, encoding="utf-8")
    s = SesionFalsa()
    assert sv.listar_ids("S", 100217, s) == [111, 222]
    assert sv.listar_ids("S", 100217, s, refrescar=True) == [111, 222]   # cerrado: se ignora --refrescar
    assert s.urls == []


def test_periodo_sin_listado_se_baja_una_vez(bronze):
    s = SesionFalsa()
    sv.listar_ids("S", 100237, s)
    sv.listar_ids("S", 100237, s)
    assert len(s.urls) == 1 and s.urls[0].endswith("/votaciones/S/100237")
    assert (bronze / "listado_S_100237.html").exists()   # período cerrado: sin fecha en el nombre


def test_refrescar_periodo_abierto_guarda_snapshot_fechado(bronze):
    abierto = config.PERIODO_ABIERTO
    original = bronze / f"listado_S_{abierto}.html"
    original.write_text('<a href="/web/votacion/111">x</a>', encoding="utf-8")
    s = SesionFalsa()
    assert sv.listar_ids("S", abierto, s) == [111]            # sin --refrescar: usa lo guardado
    assert s.urls == []
    assert sv.listar_ids("S", abierto, s, refrescar=True) == [111, 222]
    assert sv.listar_ids("S", abierto, s, refrescar=True) == [111, 222]   # mismo día: no repite
    assert len(s.urls) == 1
    snap = bronze / f"listado_S_{abierto}_{date.today().isoformat()}.html"
    assert snap.exists() and original.exists()                # no pisa el original
    assert sv.listado_guardado("S", abierto) == snap          # se lee el más reciente
    assert sv.listar_ids("S", abierto, s) == [111, 222]


def test_descargar_sin_contacto_corta(bronze, monkeypatch):
    monkeypatch.setattr(config, "CONTACTO", "")
    s = SesionFalsa()
    with pytest.raises(SystemExit, match="CONGRESOPY_CONTACTO"):
        sv.listar_ids("S", 100257, s)
    assert s.urls == []


def test_user_agent_ascii(monkeypatch):
    """SILpy rechaza (HTTP 400) headers con caracteres no ASCII."""
    import importlib
    monkeypatch.setenv("CONGRESOPY_CONTACTO", "investigación@ejemplo.org")
    c = importlib.reload(config)
    try:
        assert c.USER_AGENT.isascii()
        assert "investigacion civica" in c.USER_AGENT and "investigacion@ejemplo.org" in c.USER_AGENT
    finally:
        monkeypatch.delenv("CONGRESOPY_CONTACTO")
        importlib.reload(config)
