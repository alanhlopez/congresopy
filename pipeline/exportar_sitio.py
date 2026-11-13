"""Genera los JSON que consume el sitio, desde silver/ (solo biblioteca estándar).

Uso: python3 pipeline/exportar_sitio.py [--destino DIR]
Salida (por defecto site/datos/congreso/):
  {senado,diputados}/legisladores.json  una fila por legislador que votó: datos y conteo de votos
  {senado,diputados}/votaciones.json    una fila por votación (más reciente primero): textos, totales, link a SILpy
  {senado,diputados}/votos.json         una cadena por legislador con su voto en cada votación, en el orden
                                        de votaciones.json (códigos en comun.CODIGO_VOTO; "-" = fuera del cargo)
  manifiesto.json                       por archivo: fecha de generación, filas, bytes, sha256

Lee solo votacion.csv, voto.csv, fechas.csv y legisladores.csv. NO lee codificacion_sugerida.csv:
el índice de alineamiento con el Ejecutivo no se publica en la Fase 1.

El contenido es determinístico. Un archivo cuyo sha256 no cambió conserva su fecha de generación
anterior en el manifiesto, para no producir cambios de ruido en git.
"""
import argparse
import csv
import hashlib
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import config
from comun import CODIGO_VOTO, titulo_corto

URL_VOTACION = "https://silpy.congreso.gov.py/web/votacion/{}"
NOMBRE_CAMARA = {"S": "Cámara de Senadores", "D": "Cámara de Diputados"}
# Clave corta de cada tipo de voto en los conteos de legisladores.json
CLAVE_CONTEO = {"SI": "si", "NO": "no", "ABSTENCIÓN/BLANCO": "abstencion", "AUSENTE": "ausente",
                "NO VOTA": "no_vota", "MOCIÓN 1": "mocion_1", "MOCIÓN 2": "mocion_2", "MOCIÓN 3": "mocion_3"}
TOTALES = ["total_si", "total_no", "total_abstencion", "total_ausente", "total_no_vota",
           "total_mocion_1", "total_mocion_2", "total_mocion_3", "total"]
NOTAS = [
    "Solo votaciones nominales y electrónicas publicadas en SILpy con el voto de cada legislador.",
    "Cada votación se validó contra el sumario de SILpy: la suma de los votos individuales coincide con los totales publicados.",
    "En Diputados, «no vota» se registra como «ausente». No comparar el ausentismo entre cámaras.",
    "La ausencia se mide en votaciones nominales, no en la asistencia a las sesiones.",
    "Partido y bancada son los que figuran hoy en SILpy, no los de la fecha de cada votación.",
]


def leer(path):
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def texto(x):
    return " ".join((x or "").split()) or None


def entero(x):
    return int(float(x)) if x not in (None, "") else None


def exportar_camara(cam):
    silver = config.silver_dir(cam)
    vt = leer(silver / "votacion.csv")
    votos = leer(silver / "voto.csv")
    fechas = {r["id_votacion"]: r for r in leer(silver / "fechas.csv")}
    L = {r["id_legislador"]: r for r in leer(silver / "legisladores.csv")}

    sin_fecha = [r["id_votacion"] for r in vt if not fechas.get(r["id_votacion"], {}).get("fecha")]
    if sin_fecha:
        sys.exit(f"{config.camara_dir(cam)}: votaciones sin fecha en fechas.csv: {sin_fecha[:10]}")
    invalidas = [r["id_votacion"] for r in vt if r.get("valida") not in ("True", "true", "1")]
    if invalidas:
        sys.exit(f"{config.camara_dir(cam)}: votacion.csv tiene votaciones no validadas: {invalidas[:10]}")

    # --- votaciones (más reciente primero, como en el votómetro) ---
    vt.sort(key=lambda r: (fechas[r["id_votacion"]]["fecha"], int(r["id_votacion"])), reverse=True)
    votaciones = []
    for r in vt:
        i = int(r["id_votacion"])
        d = {
            "id": i,
            "fecha": fechas[r["id_votacion"]]["fecha"],
            "periodo_id": int(fechas[r["id_votacion"]]["periodo_id"]),
            "sesion": texto(r["sesion"]),
            "tipo_proyecto": texto(r["tipo_proyecto"]),
            "es_ley": r["tipo_proyecto"] == "PROYECTO DE LEY",
            "expediente": texto(r["expediente"]),
            "titulo": titulo_corto(r["acapite"]),
            "acapite": texto(r["acapite"]),
            "mocion": texto(r["mocion"]),
            "tipo_votacion": r["tipo_votacion"],
            "resultado": texto(r["resultado"]),
            "observacion": texto(r["observacion"]),
            "totales": {k.replace("total_", ""): entero(r[k]) for k in TOTALES if entero(r.get(k)) is not None},
            "url": URL_VOTACION.format(i),
        }
        if r["tipo_votacion"] == "mociones":
            d["mociones"] = {n: texto(r[f"mocion_{n}"]) for n in ("1", "2", "3") if texto(r[f"mocion_{n}"])}
        votaciones.append(d)
    pos = {d["id"]: k for k, d in enumerate(votaciones)}

    # --- votos: cadena por legislador ---
    cadenas, conteos, nombre_en_voto = {}, {}, {}
    for v in votos:
        lid = v["id_legislador"]
        c = cadenas.setdefault(lid, ["-"] * len(votaciones))
        k = pos[int(v["id_votacion"])]
        if c[k] != "-":
            sys.exit(f"voto duplicado: legislador {lid} en votación {v['id_votacion']}")
        if v["voto"] not in CODIGO_VOTO:
            sys.exit(f"voto desconocido {v['voto']!r} (legislador {lid}, votación {v['id_votacion']})")
        c[k] = CODIGO_VOTO[v["voto"]]
        conteos.setdefault(lid, Counter())[CLAVE_CONTEO[v["voto"]]] += 1
        nombre_en_voto.setdefault(lid, v["legislador"])

    # Control: la suma de votos individuales por votación coincide con los totales publicados
    por_votacion = Counter((int(v["id_votacion"]), CLAVE_CONTEO[v["voto"]]) for v in votos)
    for d in votaciones:
        for clave, total in d["totales"].items():
            if clave != "total" and por_votacion[(d["id"], clave)] != total:
                sys.exit(f"votación {d['id']}: {clave} individual {por_votacion[(d['id'], clave)]} != total {total}")

    # --- legisladores (los que votaron al menos una vez), en el orden de legisladores.csv (por apellido,
    #     como la nómina de SILpy); los que no están en la nómina van al final ---
    orden_nomina = {lid: k for k, lid in enumerate(L)}
    legisladores = []
    for lid in sorted(cadenas, key=lambda x: (orden_nomina.get(x, len(orden_nomina)), int(x))):
        info = L.get(lid, {})
        cad = "".join(cadenas[lid])
        en_cargo = [votaciones[k]["fecha"] for k, ch in enumerate(cad) if ch != "-"]
        cnt = conteos[lid]
        legisladores.append({
            "id": int(lid),
            "nombre": texto(info.get("nombre")) or nombre_en_voto[lid],
            "nombre_corto": texto(info.get("nombre_corto")) or texto(info.get("nombre")) or nombre_en_voto[lid],
            "cargo": texto(info.get("cargo")),
            "estado": texto(info.get("estado")),
            "partido": texto(info.get("partido")),
            "bancada": texto(info.get("bancada")),
            "cargo_bancada": texto(info.get("cargo_bancada")),
            "en_nomina": bool(info),
            "votaciones": len(en_cargo),
            "primera": min(en_cargo),
            "ultima": max(en_cargo),
            "conteo": {k: cnt.get(k, 0) for k in CLAVE_CONTEO.values()},
        })

    votos_json = {
        "orden": [d["id"] for d in votaciones],
        "codigos": {cod: voto for voto, cod in CODIGO_VOTO.items()} | {"-": "fuera del cargo"},
        "legisladores": {str(int(lid)): "".join(cadenas[lid]) for lid in sorted(cadenas, key=int)},
    }
    cobertura = {"desde": min(d["fecha"] for d in votaciones), "hasta": max(d["fecha"] for d in votaciones),
                 "votaciones": len(votaciones), "votos": len(votos), "legisladores": len(legisladores)}
    return {"legisladores.json": (legisladores, len(legisladores)),
            "votaciones.json": (votaciones, len(votaciones)),
            "votos.json": (votos_json, len(votos_json["legisladores"]))}, cobertura


def serializar(obj):
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--destino", default=str(config.SITE_DATOS))
    destino = Path(ap.parse_args().destino)
    destino.mkdir(parents=True, exist_ok=True)

    previo = {}
    mp = destino / "manifiesto.json"
    if mp.exists():
        previo = {a["archivo"]: a for a in json.loads(mp.read_text(encoding="utf-8")).get("archivos", [])}
    ahora = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    archivos, camaras = [], {}
    for cam in config.CAMARAS:
        datos, cobertura = exportar_camara(cam)
        carpeta = config.camara_dir(cam)
        camaras[carpeta] = {"nombre": NOMBRE_CAMARA[cam], **cobertura}
        (destino / carpeta).mkdir(exist_ok=True)
        for nombre, (obj, filas) in datos.items():
            rel = f"{carpeta}/{nombre}"
            contenido = serializar(obj)
            sha = hashlib.sha256(contenido).hexdigest()
            ant = previo.get(rel)
            generado = ant["generado"] if ant and ant.get("sha256") == sha else ahora
            (destino / rel).write_bytes(contenido)
            archivos.append({"archivo": rel, "generado": generado, "filas": filas,
                             "bytes": len(contenido), "sha256": sha})
            print(f"{rel:28} {filas:5} filas {len(contenido):9,} bytes{'  (sin cambios)' if generado != ahora else ''}")

    manifiesto = {
        "proyecto": "Monitoreo Congreso del Paraguay",
        "generado": max(a["generado"] for a in archivos),
        "fuente": {"nombre": "SILpy – Sistema de Información Legislativa, Congreso Nacional del Paraguay",
                   "url": "https://silpy.congreso.gov.py/", "licencia": "CC BY 4.0"},
        "licencia": "CC BY-SA 4.0",
        "camaras": camaras,
        "notas": NOTAS,
        "archivos": archivos,
    }
    mp.write_text(json.dumps(manifiesto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"manifiesto.json: {len(archivos)} archivos")


if __name__ == "__main__":
    main()
