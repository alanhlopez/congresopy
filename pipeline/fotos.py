"""Fotos de legisladores desde SILpy: bronze/silpy/fotos/ -> silver/fotos/ (solo biblioteca estándar + requests).

Uso:
  python3 pipeline/fotos.py descargar   # baja las que faltan en bronze/ (requiere CONGRESOPY_CONTACTO)
  python3 pipeline/fotos.py silver      # copia a silver/fotos/ las de bronze/ que son imágenes válidas

URL: {BASE}/images/{id_legislador}.jpg (SILpy agrega ?pfdrid_c=false&uid=..., parámetros de la sesión de
PrimeFaces que no hacen falta). Igual que con las votaciones: 1,5 s entre requests y nunca se vuelve a bajar
una foto que ya está en bronze/. Una respuesta que no es una imagen JPEG o PNG no se guarda y se reporta.

Licencia: las fotos se publican en SILpy, que está bajo CC BY 4.0; se atribuyen como «Foto: SILpy – Congreso
Nacional». Ver docs/correcciones_manuales.md y CLAUDE.md antes de reemplazar alguna a mano.
"""
import argparse
import csv
import shutil
import sys
import time
from pathlib import Path

import requests

import config

BRONZE_FOTOS = config.BRONZE / "fotos"
TAMANIO_MAX = 2_000_000   # bytes: una foto de carnet más grande que esto es sospechosa


def silver_fotos() -> Path:
    return config.SILVER / "fotos"


def ids_legisladores():
    """Todos los legisladores de las dos cámaras: los de la nómina y los que aparecen votando."""
    ids = set()
    for cam in config.CAMARAS:
        s = config.silver_dir(cam)
        with open(s / "legisladores.csv", encoding="utf-8") as fh:
            ids |= {int(r["id_legislador"]) for r in csv.DictReader(fh)}
        with open(s / "voto.csv", encoding="utf-8") as fh:
            ids |= {int(r["id_legislador"]) for r in csv.DictReader(fh)}
    return sorted(ids)


def tipo_imagen(datos: bytes):
    if datos[:3] == b"\xff\xd8\xff":
        return "jpg"
    if datos[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    return None


def descargar(ids, sess=None, destino: Path | None = None):
    """Baja las fotos que faltan. Devuelve (bajadas, ya_estaban, rechazadas)."""
    destino = destino or BRONZE_FOTOS
    destino.mkdir(parents=True, exist_ok=True)
    faltan = [i for i in ids if not any((destino / f"{i}.{ext}").exists() for ext in ("jpg", "png"))]
    if not faltan:
        return [], len(ids), []
    headers = config.headers()   # exige CONGRESOPY_CONTACTO antes de cualquier request
    sess = sess or requests.Session()
    bajadas, rechazadas = [], []
    for n, i in enumerate(faltan, 1):
        try:
            r = sess.get(f"{config.BASE}/images/{i}.jpg", headers=headers, timeout=60)
            datos = r.content
            ext = tipo_imagen(datos) if r.status_code == 200 else None
            if not ext or len(datos) > TAMANIO_MAX:
                motivo = f"HTTP {r.status_code}" if r.status_code != 200 else (
                    "no es JPEG ni PNG" if not ext else f"{len(datos):,} bytes")
                rechazadas.append((i, motivo))
                print(f"[{n}/{len(faltan)}] {i} RECHAZADA: {motivo}", file=sys.stderr)
            else:
                (destino / f"{i}.{ext}").write_bytes(datos)
                bajadas.append(i)
                print(f"[{n}/{len(faltan)}] {i} ok ({len(datos):,} bytes)", file=sys.stderr)
        except requests.RequestException as e:
            rechazadas.append((i, str(e)))
            print(f"[{n}/{len(faltan)}] {i} ERROR: {e}", file=sys.stderr)
        time.sleep(config.DELAY)
    return bajadas, len(ids) - len(faltan), rechazadas


def a_silver(origen: Path | None = None, destino: Path | None = None):
    """Copia a silver/fotos/ las imágenes válidas de bronze/. Devuelve (copiadas, invalidas)."""
    origen = origen or BRONZE_FOTOS
    destino = destino or silver_fotos()
    destino.mkdir(parents=True, exist_ok=True)
    copiadas, invalidas = [], []
    for f in sorted(origen.glob("*.*")):
        if not f.stem.isdigit():
            continue
        ext = tipo_imagen(f.read_bytes()[:8])
        if ext is None or f.suffix != f".{ext}":
            invalidas.append(f.name)
            continue
        dst = destino / f.name
        if not dst.exists() or dst.read_bytes() != f.read_bytes():
            shutil.copyfile(f, dst)
        copiadas.append(f.name)
    return copiadas, invalidas


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("comando", choices=["descargar", "silver"])
    args = ap.parse_args()
    if args.comando == "descargar":
        bajadas, ya, rechazadas = descargar(ids_legisladores())
        print(f"{len(bajadas)} bajadas, {ya} ya estaban en bronze/, {len(rechazadas)} rechazadas", file=sys.stderr)
        if rechazadas:
            sys.exit(1)
    else:
        copiadas, invalidas = a_silver()
        print(f"{len(copiadas)} fotos en silver/fotos/, {len(invalidas)} inválidas: {invalidas[:10]}", file=sys.stderr)
        if invalidas:
            sys.exit(1)


if __name__ == "__main__":
    main()
