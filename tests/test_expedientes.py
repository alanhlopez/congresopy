"""Listado de expedientes desde la búsqueda avanzada de SILpy. Sin red: sesión falsa.
Fixtures reales (SILpy, CC BY 4.0, 21/11/2026): el formulario de búsqueda y el resultado de los pedidos de
informes ingresados en el Senado en julio de 2023."""
import csv
import re
from datetime import date
from pathlib import Path

import pytest

import config
import silpy_expedientes as se

FIX = Path(__file__).resolve().parent / "fixtures" / "silpy"
FORMULARIO = (FIX / "expedientesavanzado.html").read_text(encoding="utf-8")
RESULTADO = (FIX / "expedientes_S_224_2023-07.html").read_text(encoding="utf-8")


def test_formulario_por_etiquetas_no_por_ids_de_jsf():
    f = se.leer_formulario(FORMULARIO)
    assert f["camara"] == "formMain:j_idt56" and f["tipo"] == "formMain:j_idt66_input"
    assert f["tipos"][57] == "PROYECTO DE LEY" and 224 in f["tipos"] and len(f["tipos"]) == 19
    assert len(f["otros"]) == 3 and f["viewstate"]
    d = se.datos_busqueda(f, "D", 57, date(2023, 7, 1), date(2023, 7, 31))
    assert d["formMain:j_idt56"] == "D" and d["formMain:desde_input"] == "01/07/2023"
    assert d["formMain:hasta_input"] == "31/07/2023" and d["formMain:j_idt66_input"] == "57"


def test_resultado_real():
    exps, auts = se.parsear_resultado(RESULTADO, 224)
    assert len(exps) == se.total_filas(RESULTADO) == 47
    assert all(e["camara"] == "S" and e["numero"].startswith("S-") and e["tipo"].startswith("PEDIDO DE INFORMES") for e in exps)
    assert all("2023-07-01" <= e["fecha_ingreso"] <= "2023-07-31" for e in exps)
    assert all(len(e["acapite"]) > 40 for e in exps)
    # la etapa es la columna oculta, no la visible que repite estado y origen
    assert not any(e["etapa"].startswith(e["estado"]) for e in exps if e["estado"])
    assert len({e["id_expediente"] for e in exps}) == 47
    # autores: ids de legisladores en orden, numerados desde 1 por expediente
    por_exp = {}
    for a in auts:
        por_exp.setdefault(a["id_expediente"], []).append(a["orden"])
    assert all(o == list(range(1, len(o) + 1)) for o in por_exp.values())
    ids_leg = set()
    for cam in ("senado", "diputados"):
        with open(config.SILVER / cam / "legisladores.csv", encoding="utf-8") as f:
            ids_leg |= {int(r["id_legislador"]) for r in csv.DictReader(f)}
    assert {a["id_autor"] for a in auts} & ids_leg


def test_resultado_con_filas_faltantes_se_rechaza():
    roto = re.sub(r'<tr[^>]*data-ri="0".*?</tr>', '', RESULTADO, count=1, flags=re.S)   # falta una fila
    with pytest.raises(se.ListadoInvalido):
        se.parsear_resultado(roto, 224)
    with pytest.raises(se.ListadoInvalido):
        se.parsear_resultado("<html>error</html>", 57)
    # SILpy a veces informa los registros y manda la tabla vacía: no se acepta
    vacia = pagina(date(2023, 7, 1), date(2023, 7, 1), por_dia=0) + "<script>detail:\"5 registros recuperados\"</script>"
    with pytest.raises(se.ListadoInvalido):
        se.parsear_resultado(vacia, 57)


def test_busqueda_sin_resultados_es_cero():
    # SILpy responde el formulario con un aviso y sin tabla
    html = FORMULARIO + '<script>PrimeFaces.cw("Growl",{msgs:[{summary:"Aviso",detail:"' + se.SIN_RESULTADOS + '"}]});</script>'
    assert se.total_filas(html) == 0
    assert se.parsear_resultado(html, 154) == ([], [])


def test_periodos_legislativos():
    assert list(se.periodos(date(2024, 8, 15))) == [
        (date(2023, 7, 1), date(2024, 6, 30)), (date(2024, 7, 1), date(2024, 8, 15))]


# --- Descarga con sesión falsa ---

ENCABEZADO = "".join(f"<th>{t}</th>" for t in se.COLUMNAS) + "<th>Expediente</th><th>Etapa Actual</th>"


def pagina(desde: date, hasta: date, por_dia=3, camara="S", base=0):
    """Resultado sintético: `por_dia` expedientes por día del rango; muestra como mucho una página."""
    filas, total = [], 0
    d = desde
    while d <= hasta:
        for k in range(por_dia):
            total += 1
            if len(filas) < se.FILAS_POR_PAGINA:
                i = int(d.strftime("%Y%m%d")) * 1000 + base + k
                celdas = [i, "PROYECTO DE LEY X", f"{camara}-{i}", d.strftime("%d/%m/%Y"), "EN TRAMITE",
                          "PROYECTO DE LEY", "PARLAMENTARIA", "Primer trámite constitucional",
                          {"S": "CAMARA DE SENADORES", "D": "CAMARA DE DIPUTADOS"}[camara], "",
                          "101378,101352,", "", "", ""]
                filas.append(f'<tr data-ri="{len(filas)}">' + "".join(f"<td>{c}</td>" for c in celdas) + "</tr>")
        d = date.fromordinal(d.toordinal() + 1)
    return (f'<form id="formResult"><div id="formResult:dtExpediente"><table><thead><tr>{ENCABEZADO}</tr></thead>'
            f'<tbody>{"".join(filas)}</tbody></table></div><input name="jakarta.faces.ViewState" value="v{total}"/>'
            f'</form><script>PrimeFaces.cw("DataTable","w",{{id:"formResult:dtExpediente",paginator:{{rows:100,'
            f'rowCount:{total}}}}});</script>')


class SesionFalsa:
    def __init__(self):
        self.gets, self.posts = 0, []

    def _r(self, texto):
        class R:
            text = texto

            def raise_for_status(self):
                pass
        return R()

    def get(self, url, headers, timeout):
        assert "contacto:" in headers["User-Agent"]
        self.gets += 1
        return self._r(FORMULARIO)

    def post(self, url, data, headers, timeout):
        assert "contacto:" in headers["User-Agent"] and data["jakarta.faces.ViewState"]
        self.posts.append(data)
        dd = lambda s: date(int(s[6:]), int(s[3:5]), int(s[:2]))
        return self._r(pagina(dd(data["formMain:desde_input"]), dd(data["formMain:hasta_input"]),
                              camara=data["formMain:j_idt56"]))


@pytest.fixture
def bronze(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "BRONZE", tmp_path / "bronze")
    monkeypatch.setattr(config, "SILVER", tmp_path / "silver")
    monkeypatch.setattr(config, "CONTACTO", "prueba@example.org")
    monkeypatch.setattr(se, "DELAY", 0)
    return tmp_path


def test_rango_grande_se_parte_hasta_entrar_en_una_pagina(bronze):
    s = SesionFalsa()
    b = se.Buscador(s, bronze / "snap")
    hojas = b.rango("S", 57, date(2023, 7, 1), date(2023, 9, 30))   # 92 días x 3 = 276 filas
    assert s.gets == len(s.posts) == 7   # un formulario nuevo por búsqueda: 276 -> 138+138 -> 4 x 69
    exps = []
    for h in hojas:
        e, _ = se.parsear_resultado(h.read_text(encoding="utf-8"), 57)
        assert len(e) <= se.FILAS_POR_PAGINA
        exps += e
    assert len(exps) == len({e["id_expediente"] for e in exps}) == 276


def test_listar_completa_sin_repetir_y_reparsear_escribe_silver(bronze):
    s = SesionFalsa()
    carpeta = se.listar(s, hasta=date(2023, 7, 20), destino=bronze / "bronze" / "expedientes" / "2026-11-21")
    tipos = se.leer_formulario(FORMULARIO)["tipos"]
    assert len(s.posts) == s.gets == 2 * len(tipos)   # 20 días x 3 = 60 filas: una búsqueda por cámara y tipo
    assert (carpeta / "completo.txt").exists()
    # volver a correr el mismo día no hace requests: todo está en el snapshot
    s2 = SesionFalsa()
    se.listar(s2, hasta=date(2023, 7, 20), destino=carpeta)
    assert s2.gets == 0 and s2.posts == []
    exps, auts = se.reparsear()
    assert len(exps) == 60 and len(auts) == 120   # mismos ids en todos los tipos: sin duplicados
    with open(bronze / "silver" / "expedientes" / "expediente.csv", encoding="utf-8") as f:
        filas = list(csv.DictReader(f))
    assert list(filas[0]) == se.CAMPOS_EXPEDIENTE and len(filas) == 60


def test_sin_contacto_no_hay_requests(bronze, monkeypatch):
    monkeypatch.setattr(config, "CONTACTO", "")
    s = SesionFalsa()
    with pytest.raises(SystemExit):
        se.Buscador(s, bronze / "snap").buscar("S", 57, date(2023, 7, 1), date(2023, 7, 2))
    assert s.gets == 0 and s.posts == []


def filas_xml(d: date, desde: int, hasta: int):
    """Respuesta de paginación sintética: filas `desde`..`hasta`-1 del día `d` (partial-response de JSF)."""
    html = pagina(d, d, por_dia=hasta)
    trs = re.findall(r'<tr data-ri="\d+">.*?</tr>', html)[desde:hasta] if hasta <= se.FILAS_POR_PAGINA else None
    if trs is None:   # pagina() corta en 100: se arman las filas a mano
        trs = []
        for k in range(desde, hasta):
            i = int(d.strftime("%Y%m%d")) * 1000 + k
            celdas = [i, "PEDIDO X", f"D-{i}", d.strftime("%d/%m/%Y"), "CONTESTADO", "PEDIDO DE INFORMES",
                      "PARLAMENTARIA", "Tramitación terminada", "CAMARA DE DIPUTADOS", "", "101378,", "", "", ""]
            trs.append(f'<tr data-ri="{k}">' + "".join(f"<td>{c}</td>" for c in celdas) + "</tr>")
    return ("<?xml version='1.0' encoding='UTF-8'?><partial-response><changes><update id=\"formResult:dtExpediente\">"
            f"<![CDATA[{''.join(trs)}]]></update></changes></partial-response>")


class SesionDiaLleno(SesionFalsa):
    """Un solo día con 180 expedientes, como Diputados el 25/08/2023 (pedidos de informes)."""
    TOTAL = 180

    def post(self, url, data, headers, timeout):
        self.posts.append(data)
        d = date(2023, 8, 25)
        if data.get("jakarta.faces.partial.ajax"):
            assert headers["Faces-Request"] == "partial/ajax" and data["formMain:j_idt56"] == "D"
            first = int(data["formResult:dtExpediente_first"])
            return self._r(filas_xml(d, first, min(first + se.FILAS_POR_PAGINA, self.TOTAL)))
        return self._r(pagina(d, d, por_dia=self.TOTAL, camara="D"))


def test_dia_con_mas_de_una_pagina_se_pagina(bronze):
    s = SesionDiaLleno()
    d = date(2023, 8, 25)
    b = se.Buscador(s, bronze / "snap")
    hojas = b.rango("D", 224, d, d)
    assert len(s.posts) == 2 and s.posts[1]["formResult:dtExpediente_first"] == "100"
    assert [h.name for h in hojas] == ["D_224_2023-08-25_2023-08-25.html"]
    assert (bronze / "snap" / "D_224_2023-08-25_2023-08-25_p1.xml").exists()
    html = hojas[0].read_text(encoding="utf-8")
    exps, _ = se.parsear_resultado(html, 224, se.paginas_guardadas(bronze / "snap", hojas[0].name, 180))
    assert len(exps) == len({e["id_expediente"] for e in exps}) == 180
    assert {e["camara"] for e in exps} == {"D"}
    # sin la segunda página no cuadra con el total
    with pytest.raises(se.ListadoInvalido):
        se.parsear_resultado(html, 224)
    # volver a correr no repite nada
    s2 = SesionDiaLleno()
    se.Buscador(s2, bronze / "snap").rango("D", 224, d, d)
    assert s2.posts == [] and s2.gets == 0


def test_pagina_vacia_o_corrida_se_rechaza(bronze):
    d = date(2023, 8, 25)
    with pytest.raises(se.ListadoInvalido):   # SILpy perdió la búsqueda: la página llega vacía
        se.filas_de_pagina(filas_xml(d, 100, 100), 1)
    with pytest.raises(se.ListadoInvalido):   # trae la primera página en vez de la segunda
        se.filas_de_pagina(filas_xml(d, 0, 50), 1)
    assert len(se.filas_de_pagina(filas_xml(d, 100, 180), 1)) == 80
