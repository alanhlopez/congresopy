"""Parsea el HTML de https://silpy.congreso.gov.py/web/legisladores -> CSV
Uso: python pipeline/legisladores.py legisladores.html --out <archivo_nuevo.csv>

OJO: no apuntes --out a silver/{camara}/legisladores.csv. Los dos legisladores.csv de silver/
tienen nombre_corto cargado a mano (y el de Diputados se armó entero a mano); este script no
escribe nombre_corto. Generá un archivo aparte y pasá los cambios a mano. Por eso se niega
a sobrescribir un archivo existente."""
import argparse, csv, re, sys
from pathlib import Path
from bs4 import BeautifulSoup

ap = argparse.ArgumentParser()
ap.add_argument("html"); ap.add_argument("--out", required=True)
args = ap.parse_args()
salida = Path(args.out)
if salida.exists():
    sys.exit(f"{salida} ya existe: no lo sobrescribo (ver docstring).")
html = open(args.html, encoding="utf-8").read()
soup = BeautifulSoup(html, "html.parser")
filas = []
for estado in ("activos", "inactivos", "vitalicios"):
    panel = soup.find(id=f"formMain:tabEstadoLegislador:{estado}")
    if not panel:
        continue
    for card in panel.select("div.ui-card"):
        a = card.select_one('a[href*="/legislador/"]')
        if not a:
            continue
        spans = card.select("span.block")
        bancada_span = card.select_one('span[title*="de Bancada"]')
        partido = card.select_one("span.font-italic")
        color = re.search(r"border: 1px solid (#[0-9a-fA-F]{6})", card.get("style", ""))
        cargo_banc, bancada = "", ""
        if bancada_span:
            m = re.match(r"(\w+) de Bancada (.*)", bancada_span["title"])
            if m:
                cargo_banc, bancada = m.group(1), m.group(2).strip()
        filas.append({
            "id_legislador": int(re.search(r"/legislador/(\d+)", a["href"]).group(1)),
            "nombre": a.get_text(strip=True),
            "cargo": spans[0].get_text(strip=True) if spans else "",
            "periodo": spans[1].get_text(strip=True) if len(spans) > 1 else "",
            "estado": estado,
            "partido": partido.get_text(strip=True) if partido else "",
            "bancada": bancada,
            "cargo_bancada": cargo_banc,
            "color": color.group(1) if color else "",
        })
with open(salida, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(filas[0]))
    w.writeheader(); w.writerows(filas)
print(len(filas), "legisladores")
