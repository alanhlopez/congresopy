"""Historial de bancadas a partir de fotos fechadas de la nómina de SILpy.

SILpy no publica los cambios de bancada con fecha: solo la nómina de hoy. Este adaptador guarda una foto de la
nómina cada vez que se corre (como máximo una por día y por cámara) y reconstruye el historial comparándolas.

Uso:
  python3 pipeline/bancadas.py foto          # baja la nómina de hoy (requiere CONGRESOPY_CONTACTO)
  python3 pipeline/bancadas.py historial     # silver/{camara}/bancadas_hist.csv desde silver/nomina/
  python3 pipeline/bancadas.py sincronizar   # partido/bancada/cargo/estado de legisladores.csv desde la última foto

Archivos:
  bronze/silpy/nomina/nomina_{S|D}_{AAAA-MM-DD}.html   HTML tal como se bajó (fuera de git)
  silver/nomina/{S|D}/{AAAA-MM-DD}.csv                 la foto parseada (en git: así el historial se acumula)
  silver/{camara}/bancadas_hist.csv                    un tramo por legislador y situación (partido, bancada,
                                                       cargo, estado): visto_desde, visto_hasta y cambio_detectado
                                                       (fecha de la primera foto que ya muestra otra cosa)
  silver/{camara}/correcciones_legisladores.csv        correcciones manuales (id_legislador, campo, valor, fuente)
                                                       que sincronizar aplica después de la foto

Límite: un cambio ocurrió en algún momento entre visto_hasta y cambio_detectado; no se sabe el día exacto.
"""
import argparse
import csv
import sys
import time
from datetime import date
from pathlib import Path

import requests

import config
from legisladores import CAMPOS, parsear_nomina

URL_NOMINA = {"S": f"{config.BASE}/legisladores", "D": f"{config.BASE}/legisladores/D/100536"}
MINIMO_ACTIVOS = {"S": 40, "D": 70}   # menos que esto en una foto = página incompleta o cambiada
CLAVE = ["partido", "bancada", "cargo_bancada", "estado"]
CAMPOS_HIST = ["id_legislador", "nombre", *CLAVE, "visto_desde", "visto_hasta", "cambio_detectado", "fotos"]
SINCRONIZADOS = ["nombre", "cargo", "periodo", "estado", "partido", "bancada", "cargo_bancada", "color"]


def bronze_nomina() -> Path:
    return config.BRONZE / "nomina"


def silver_nomina(letra: str) -> Path:
    return config.SILVER / "nomina" / letra


def guardar_foto(letra: str, html: str, fecha: str):
    """Parsea, valida y escribe la foto en silver/nomina/. Devuelve las filas."""
    filas = parsear_nomina(html)
    activos = sum(f["estado"] == "activos" for f in filas)
    if activos < MINIMO_ACTIVOS[letra]:
        raise SystemExit(f"nómina {letra} del {fecha}: solo {activos} activos (mínimo {MINIMO_ACTIVOS[letra]}); no se guarda")
    destino = silver_nomina(letra) / f"{fecha}.csv"
    destino.parent.mkdir(parents=True, exist_ok=True)
    with open(destino, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CAMPOS)
        w.writeheader()
        w.writerows(sorted(filas, key=lambda f: f["id_legislador"]))
    return filas


def foto(sess=None, hoy: str | None = None):
    hoy = hoy or date.today().isoformat()
    bronze_nomina().mkdir(parents=True, exist_ok=True)
    sess = sess or requests.Session()
    for letra, url in URL_NOMINA.items():
        f = bronze_nomina() / f"nomina_{letra}_{hoy}.html"
        if f.exists():
            print(f"{letra}: ya hay foto de hoy en bronze/, no se vuelve a bajar", file=sys.stderr)
        else:
            r = sess.get(url, headers=config.headers(), timeout=60)
            r.raise_for_status()
            f.write_text(r.text, encoding="utf-8")
            time.sleep(config.DELAY)
        filas = guardar_foto(letra, f.read_text(encoding="utf-8"), hoy)
        print(f"{letra}: {len(filas)} legisladores ({sum(x['estado'] == 'activos' for x in filas)} activos) -> "
              f"silver/nomina/{letra}/{hoy}.csv", file=sys.stderr)


def leer_fotos(letra: str):
    """[(fecha, {id: fila}, columnas_registradas)] ordenado por fecha. Una columna de CLAVE vacía en todas las
    filas de una foto se toma como no registrada (por ejemplo cargo_bancada en la primera foto de Diputados)."""
    fotos = []
    for f in sorted(silver_nomina(letra).glob("*.csv")):
        with open(f, encoding="utf-8") as fh:
            filas = {int(r["id_legislador"]): r for r in csv.DictReader(fh)}
        registradas = {c for c in CLAVE if any(r[c] for r in filas.values())}
        fotos.append((f.stem, filas, registradas))
    return fotos


def historial(letra: str):
    """Tramos consecutivos con la misma situación (partido, bancada, cargo, estado) por legislador."""
    fotos = leer_fotos(letra)
    fechas = [f for f, _, _ in fotos]
    tramos = []
    abiertos = {}   # id -> tramo en curso
    ultimo_partido = {}   # id -> último partido no vacío
    for k, (fecha, filas, registradas) in enumerate(fotos):
        for lid, r in filas.items():
            # Todo legislador tiene partido (o IND): un partido vacío en una foto es un dato que SILpy no
            # registró, no un cambio. Se conserva el último conocido (mismo criterio que sincronizar).
            # Con la bancada y el cargo no se hace: pueden quedar vacíos de verdad.
            if not r["partido"] and ultimo_partido.get(lid):
                r = {**r, "partido": ultimo_partido[lid]}
            elif r["partido"]:
                ultimo_partido[lid] = r["partido"]
            t = abiertos.get(lid)
            if t and t["_ultima"] == k - 1:
                # Solo se comparan las columnas registradas en las dos fotos; las que faltaban se completan.
                comunes = registradas & t["_registradas"]
                if all(t[c] == r[c] for c in comunes):
                    for c in registradas - t["_registradas"]:
                        t[c] = r[c]
                    t["_registradas"] = t["_registradas"] | registradas
                    t["visto_hasta"], t["_ultima"] = fecha, k
                    t["fotos"] += 1
                    continue
            if t:
                t["cambio_detectado"] = fecha
            nuevo = {"id_legislador": lid, "nombre": r["nombre"], **{c: r[c] for c in CLAVE}, "visto_desde": fecha,
                     "visto_hasta": fecha, "cambio_detectado": "", "fotos": 1, "_registradas": set(registradas),
                     "_ultima": k}
            tramos.append(nuevo)
            abiertos[lid] = nuevo
        # quien no aparece en esta foto: su tramo se corta acá
        for lid, t in abiertos.items():
            if lid not in filas and t["_ultima"] == k - 1 and not t["cambio_detectado"]:
                t["cambio_detectado"] = fecha
    for t in tramos:
        t.pop("_registradas"); t.pop("_ultima")
    tramos.sort(key=lambda t: (t["id_legislador"], t["visto_desde"]))
    return tramos, fechas


def escribir_historial():
    for letra, camara in config.CAMARAS.items():
        tramos, fechas = historial(letra)
        destino = config.silver_dir(camara) / "bancadas_hist.csv"
        with open(destino, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=CAMPOS_HIST)
            w.writeheader()
            w.writerows(tramos)
        cambios = sum(1 for t in tramos if t["cambio_detectado"])
        print(f"{camara}: {len(fechas)} fotos ({fechas[0] if fechas else '-'} a {fechas[-1] if fechas else '-'}), "
              f"{len(tramos)} tramos, {cambios} cambios detectados", file=sys.stderr)


def leer_correcciones(camara: str):
    f = config.silver_dir(camara) / "correcciones_legisladores.csv"
    if not f.exists():
        return []
    with open(f, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def sincronizar(letra: str):
    """Actualiza legisladores.csv con la última foto, conserva nombre_corto y aplica las correcciones manuales.
    Devuelve la lista de cambios [(id, nombre, campo, antes, después)]."""
    camara = config.CAMARAS[letra]
    fotos = leer_fotos(letra)
    if not fotos:
        raise SystemExit(f"{camara}: no hay fotos en silver/nomina/{letra}/")
    _, ultima, _ = fotos[-1]
    ruta = config.silver_dir(camara) / "legisladores.csv"
    fin_de_linea = "\r\n" if b"\r\n" in ruta.read_bytes() else "\n"   # se respeta el del archivo
    with open(ruta, encoding="utf-8") as fh:
        lector = csv.DictReader(fh)
        columnas = lector.fieldnames
        filas = list(lector)
    por_id = {int(r["id_legislador"]): r for r in filas}
    # Las correcciones manuales pisan a la foto antes de comparar: así no aparecen como cambio en cada corrida.
    correcciones = {}
    for corr in leer_correcciones(camara):
        correcciones.setdefault(int(corr["id_legislador"]), {})[corr["campo"]] = corr["valor"]
    cambios = []
    for lid, nueva in ultima.items():
        nueva = {**nueva, **correcciones.get(lid, {})}
        if lid not in por_id:
            fila = {c: "" for c in columnas}
            fila["id_legislador"] = str(lid)
            filas.append(fila)
            por_id[lid] = fila
            cambios.append((lid, nueva["nombre"], "(nuevo)", "", nueva["estado"]))
        fila = por_id[lid]
        for c in SINCRONIZADOS:
            if c in columnas and fila[c] != nueva[c]:
                if not nueva[c]:
                    # SILpy dejó el campo vacío: no se borra lo que ya hay; se informa para revisarlo a mano.
                    cambios.append((lid, nueva["nombre"], c, fila[c], "(vacío en SILpy: se conserva)"))
                    continue
                cambios.append((lid, nueva["nombre"], c, fila[c], nueva[c]))
                fila[c] = nueva[c]
    with open(ruta, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=columnas, lineterminator=fin_de_linea)
        w.writeheader()
        w.writerows(filas)
    return cambios


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("comando", choices=["foto", "historial", "sincronizar"])
    args = ap.parse_args()
    if args.comando == "foto":
        foto()
    elif args.comando == "historial":
        escribir_historial()
    else:
        for letra, camara in config.CAMARAS.items():
            cambios = sincronizar(letra)
            print(f"{camara}: {len(cambios)} cambios en legisladores.csv", file=sys.stderr)
            for lid, nombre, campo, antes, despues in cambios:
                print(f"   {lid} {nombre}: {campo}: {antes!r} -> {despues!r}", file=sys.stderr)


if __name__ == "__main__":
    main()
