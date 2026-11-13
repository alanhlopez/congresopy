"""
Extractor de votaciones nominales/electrónicas de SILpy (Congreso del Paraguay).

Uso:
  # 1) Listar IDs de votación de un período (Senado = S, Diputados = D)
  python pipeline/silpy_votos.py listar --camara S --periodo 100267 > silver/senado/ids_100267.txt

  # 2) Descargar y parsear el detalle de cada votación
  python pipeline/silpy_votos.py detalle --camara S --ids silver/senado/ids_100267.txt

  # 3) Fechas y sesiones desde los listados por período
  python pipeline/silpy_votos.py fechas --camara S --periodos 100217 100237 100257 100267

  # 4) Reconstruir los CSV desde bronze/ sin hacer requests
  python pipeline/silpy_votos.py reparsear --camara S

  # 5) Probar el parser con un HTML guardado
  python pipeline/silpy_votos.py parsear-local bronze/silpy/senado/109395.html

Salida (CSV, en silver/{camara}/):
  votacion.csv : id_votacion, tipo_proyecto, expediente, acapite, sesion, camara,
                 resultado, observacion, mocion, total_si, total_no,
                 total_abstencion, total_ausente, total_no_vota, total
  voto.csv     : id_votacion, id_legislador, legislador, voto

Notas:
  - Datos publicados por el Congreso Nacional bajo CC BY 4.0: citar la fuente.
  - Rate limit conservador (DELAY segundos entre requests). No lo bajes.
  - Las descargas crudas se guardan en bronze/silpy/{camara}/ para no repetir requests.
  - Rutas, DELAY y User-Agent salen de config.py.
"""
import argparse
import csv
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

import config

BASE = config.BASE
DELAY = config.DELAY
VOTOS_BASE = {"SI", "NO", "ABSTENCIÓN/BLANCO", "AUSENTE", "NO VOTA"}
RE_MOCION = re.compile(r"^MOCIÓN \d+$")


def voto_valido(v):
    return v in VOTOS_BASE or bool(v and RE_MOCION.match(v))


def _txt(el):
    return " ".join(el.get_text(" ", strip=True).split()) if el else None


def parsear_detalle(html: str, id_votacion: int):
    soup = BeautifulSoup(html, "html.parser")

    # --- Cabecera ---
    exp = _txt(soup.find(id="formMain:expedienteCamara")) or ""
    m = re.search(r"([SD]-\d+)", exp)
    sesion_txt = ""
    camara = None
    for span in soup.select("span.font-bold"):
        t = _txt(span)
        if t and t.startswith("SESIÓN:"):
            sesion_txt = t.replace("SESIÓN:", "").replace("de la", "").strip()
            nxt = span.find_next_sibling("span")
            camara = _txt(nxt)
            break

    obs = soup.select("span.estiloObservacion.block")
    meta = {
        "id_votacion": id_votacion,
        "tipo_proyecto": _txt(soup.find(id="formMain:idTipoProyecto")),
        "expediente": m.group(1) if m else None,
        "acapite": _txt(soup.find(id="formMain:acapite")),
        "sesion": sesion_txt,
        "camara": camara,
        "resultado": _txt(soup.select_one("span.insignia.resultado-tramite")),
        "observacion": _txt(obs[0]) if obs else None,
        "mocion": _txt(soup.select_one("span.estiloDescripcion")),
    }

    # --- Sumario de votos (etiqueta seguida de su número) ---
    sumario = {}
    for div in soup.select("div.col-4"):
        etiqueta = _txt(div)
        if etiqueta and (voto_valido(etiqueta) or etiqueta == "TOTAL"):
            num = div.find_next_sibling("div")
            sumario[etiqueta] = int(_txt(num)) if num and _txt(num).isdigit() else None
    claves = {"SI": "total_si", "NO": "total_no", "ABSTENCIÓN/BLANCO": "total_abstencion",
              "AUSENTE": "total_ausente", "NO VOTA": "total_no_vota", "TOTAL": "total",
              "MOCIÓN 1": "total_mocion_1", "MOCIÓN 2": "total_mocion_2", "MOCIÓN 3": "total_mocion_3"}
    for k, v in sumario.items():
        if k in claves:
            meta[claves[k]] = v
    # Votación entre mociones alternativas: guardar qué significa cada una
    textos = {}
    for m_ in re.finditer(r"MOCIÓN (\d+):\s*([^<\n]+)", html):
        textos.setdefault(m_.group(1), " ".join(m_.group(2).split()))
    meta["tipo_votacion"] = "mociones" if any(RE_MOCION.match(k) for k in sumario) else "si_no"
    meta["mocion_1"] = textos.get("1")
    meta["mocion_2"] = textos.get("2")
    meta["mocion_3"] = textos.get("3")

    # --- Voto por legislador ---
    # Cada legislador: <a href=".../legislador/{id}" title="Ver Sen. Nombre">
    # Su voto está en el siguiente bloque "block lg:hidden" con el texto literal.
    votos = []
    panel = soup.find(id="formMain:j_idt93:tabDetalle") or soup
    for a in panel.select('a[href*="/legislador/"]'):
        lid = re.search(r"/legislador/(\d+)", a["href"]).group(1)
        nombre = re.sub(r"^Ver\s+(Sen\.|Dip\.)\s*", "", a.get("title", "")).strip()
        col_voto = a.find_parent("div", class_="col-9").find_next_sibling("div")
        voto_div = col_voto.select_one("div.block.lg\\:hidden div") if col_voto else None
        voto = _txt(voto_div)
        if not voto_valido(voto):
            raise ValueError(f"Voto no reconocido en votación {id_votacion}, legislador {lid}: {voto!r}")
        votos.append({"id_votacion": id_votacion, "id_legislador": int(lid),
                      "legislador": nombre, "voto": voto})

    # --- Validación: el detalle tiene que cuadrar con el sumario ---
    esperado = {k: v for k, v in sumario.items() if k != "TOTAL" and v is not None}
    conteo = {k: sum(1 for x in votos if x["voto"] == k) for k in set(esperado) | {x["voto"] for x in votos}}
    diffs = {k: (conteo.get(k, 0), esperado.get(k)) for k in conteo if conteo.get(k, 0) != esperado.get(k, 0)}
    if sumario.get("TOTAL") is not None and len(votos) != sumario["TOTAL"]:
        diffs["TOTAL"] = (len(votos), sumario["TOTAL"])
    meta["valida"] = not diffs
    if diffs:
        print(f"[WARN] votación {id_votacion}: detalle != sumario {diffs}", file=sys.stderr)

    return meta, votos


def listar_ids(camara: str, periodo: int, sess: requests.Session):
    r = sess.get(f"{BASE}/votaciones/{camara}/{periodo}", headers=config.headers(), timeout=60)
    r.raise_for_status()
    ids = sorted({int(x) for x in re.findall(r"/votacion/(\d+)", r.text)})
    return ids


def descargar(id_votacion: int, raw_dir: Path, sess: requests.Session) -> str:
    f = raw_dir / f"{id_votacion}.html"
    if f.exists():
        return f.read_text(encoding="utf-8")
    r = sess.get(f"{BASE}/votacion/{id_votacion}", headers=config.headers(), timeout=60)
    r.raise_for_status()
    f.write_text(r.text, encoding="utf-8")
    time.sleep(DELAY)
    return r.text


def escribir_csv(path: Path, filas, campos):
    nuevo = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=campos, extrasaction="ignore")
        if nuevo:
            w.writeheader()
        w.writerows(filas)


CAMPOS_VOTACION = ["id_votacion", "tipo_proyecto", "expediente", "acapite", "sesion", "camara",
                   "resultado", "observacion", "mocion", "tipo_votacion", "mocion_1", "mocion_2", "mocion_3",
                   "total_si", "total_no", "total_mocion_1", "total_mocion_2", "total_mocion_3",
                   "total_abstencion", "total_ausente", "total_no_vota", "total", "valida"]
CAMPOS_VOTO = ["id_votacion", "id_legislador", "legislador", "voto"]


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("listar"); a.add_argument("--camara", default="S"); a.add_argument("--periodo", type=int, required=True)
    b = sub.add_parser("detalle"); b.add_argument("--ids", required=True); b.add_argument("--camara", required=True)
    c = sub.add_parser("parsear-local"); c.add_argument("html")
    f_ = sub.add_parser("fechas", help="Fecha y sesión de cada votación, desde los listados por período")
    f_.add_argument("--camara", default="S"); f_.add_argument("--periodos", type=int, nargs="+", required=True)
    r_ = sub.add_parser("reparsear", help="Reconstruye los CSV desde bronze/silpy/{camara} sin hacer requests")
    r_.add_argument("--camara", required=True)
    args = p.parse_args()

    if args.cmd == "parsear-local":
        html = Path(args.html).read_text(encoding="utf-8")
        m = re.search(r"/votacion/(\d+)", html)
        meta, votos = parsear_detalle(html, int(m.group(1)) if m else 0)
        for k, v in meta.items():
            print(f"{k:18} {str(v)[:90]}")
        print(f"\n{len(votos)} legisladores")
        for v in votos[:5]:
            print(v)
        return

    if args.cmd == "fechas":
        out = config.silver_dir(args.camara); raw = config.bronze_dir(args.camara); raw.mkdir(parents=True, exist_ok=True)
        sess = requests.Session(); filas = []
        for per in args.periodos:
            f = raw / f"listado_{args.camara}_{per}.html"
            if not f.exists():
                r = sess.get(f"{BASE}/votaciones/{args.camara}/{per}", headers=config.headers(), timeout=60)
                r.raise_for_status(); f.write_text(r.text, encoding="utf-8"); time.sleep(DELAY)
            html = f.read_text(encoding="utf-8")
            # Cada fila: link a /votacion/{id}, luego la fecha dd/mm/aaaa y el nombre de la sesión
            hits = [(m.start(), int(m.group(1))) for m in re.finditer(r"/votacion/(\d+)", html)]
            vistos = []
            for pos, i in hits:
                if not vistos or vistos[-1][1] != i:
                    vistos.append((pos, i))
            for k, (pos, i) in enumerate(vistos):
                fin = vistos[k + 1][0] if k + 1 < len(vistos) else len(html)
                texto = BeautifulSoup(html[pos:fin], "html.parser").get_text(" ", strip=True)
                fecha = re.search(r"(\d{2})/(\d{2})/(\d{4})", texto)
                ses = re.search(r"SESI[OÓ]N\s+([A-ZÁÉÍÓÚ ]+?\s+\d+)", texto)
                filas.append({"id_votacion": i, "periodo_id": per,
                              "fecha": f"{fecha.group(3)}-{fecha.group(2)}-{fecha.group(1)}" if fecha else "",
                              "sesion": " ".join(ses.group(1).split()) if ses else ""})
        with (out / "fechas.csv").open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=["id_votacion", "periodo_id", "fecha", "sesion"])
            w.writeheader(); w.writerows(filas)
        sin = sum(1 for x in filas if not x["fecha"])
        print(f"{len(filas)} votaciones con fecha ({sin} sin fecha)", file=sys.stderr)
        return

    if args.cmd == "reparsear":
        out = config.silver_dir(args.camara)
        metas, todos, errores = [], [], 0
        for f in sorted(config.bronze_dir(args.camara).glob("*.html")):
            if not f.stem.isdigit():   # listado_*.html son los listados por período, no votaciones
                continue
            try:
                meta, votos = parsear_detalle(f.read_text(encoding="utf-8"), int(f.stem))
                metas.append(meta); todos.extend(votos)
            except Exception as e:
                errores += 1
                print(f"{f.stem} ERROR: {e}", file=sys.stderr)
        for path, filas, campos in [(out / "votacion.csv", metas, CAMPOS_VOTACION), (out / "voto.csv", todos, CAMPOS_VOTO)]:
            with path.open("w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=campos, extrasaction="ignore"); w.writeheader(); w.writerows(filas)
        n_inv = sum(1 for m in metas if not m["valida"])
        print(f"{len(metas)} votaciones, {len(todos)} votos, {errores} errores, {n_inv} no cuadran con el sumario", file=sys.stderr)
        return

    sess = requests.Session()
    if args.cmd == "listar":
        for i in listar_ids(args.camara, args.periodo, sess):
            print(i)
        return

    out = config.silver_dir(args.camara); raw = config.bronze_dir(args.camara); raw.mkdir(parents=True, exist_ok=True)
    ids = [int(x) for x in Path(args.ids).read_text().split()]
    hechos = set()
    vp = out / "votacion.csv"
    if vp.exists():
        hechos = {int(r["id_votacion"]) for r in csv.DictReader(vp.open(encoding="utf-8"))}
    for n, i in enumerate(ids, 1):
        if i in hechos:
            continue
        try:
            meta, votos = parsear_detalle(descargar(i, raw, sess), i)
            escribir_csv(vp, [meta], CAMPOS_VOTACION)
            escribir_csv(out / "voto.csv", votos, CAMPOS_VOTO)
            print(f"[{n}/{len(ids)}] {i} ok ({len(votos)} votos)", file=sys.stderr)
        except Exception as e:
            print(f"[{n}/{len(ids)}] {i} ERROR: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
