"""Genera los JSON que consume el sitio, desde silver/ (solo biblioteca estándar).

Uso: python3 pipeline/exportar_sitio.py [--destino DIR]
Salida (por defecto site/datos/congreso/):
  {senado,diputados}/legisladores.json  una fila por legislador que votó: datos, departamento (Diputados) y conteo
  {senado,diputados}/votaciones.json    una fila por votación (más reciente primero): textos, totales, link a SILpy
  {senado,diputados}/votos.json         una cadena por legislador con su voto en cada votación, en el orden
                                        de votaciones.json (códigos en comun.CODIGO_VOTO; "-" = fuera del cargo)
  {senado,diputados}/asistencia.json    análisis de presencia de todo el mandato (página Asistencia; ver exportar_asistencia)
  {senado,diputados}/presencia.json     quienes menos votos registran en los últimos 12 meses (ver exportar_presencia)
  {senado,diputados}/comisiones.json    integrantes de cada comisión por período, desde la ficha de SILpy
                                        (solo si hay silver/{camara}/comisiones.csv; ver pipeline/comisiones.py)
  fotos/{id}.jpg                        fotos de legisladores copiadas de silver/fotos/ (si hay)
  manifiesto.json                       por archivo: fecha de generación, filas, bytes, sha256 (y resumen de fotos)

Lee votacion.csv, voto.csv, fechas.csv, legisladores.csv, bancadas_hist.csv, circunscripciones.csv y comisiones.csv. NO lee codificacion_sugerida.csv:
el índice de alineamiento con el Ejecutivo no se publica en la Fase 1.

El contenido es determinístico. Un archivo cuyo sha256 no cambió conserva su fecha de generación
anterior en el manifiesto, para no producir cambios de ruido en git.
"""
import argparse
import csv
import re
import hashlib
import json
import shutil
import statistics
import sys
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from fractions import Fraction
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


def fotos_disponibles():
    """{id_legislador: nombre_de_archivo} de silver/fotos/."""
    carpeta = config.SILVER / "fotos"
    if not carpeta.exists():
        return {}
    return {int(f.stem): f.name for f in sorted(carpeta.glob("*.*")) if f.stem.isdigit() and f.suffix in (".jpg", ".png")}


def exportar_camara(cam, fotos=None):
    fotos = fotos or {}
    silver = config.silver_dir(cam)
    vt = leer(silver / "votacion.csv")
    votos = leer(silver / "voto.csv")
    fechas = {r["id_votacion"]: r for r in leer(silver / "fechas.csv")}
    # Historial de bancadas (pipeline/bancadas.py): solo se publica para quien tiene más de un tramo.
    hist = {}
    if (silver / "bancadas_hist.csv").exists():
        for t in leer(silver / "bancadas_hist.csv"):
            hist.setdefault(t["id_legislador"], []).append(
                {k: texto(t[k]) for k in ("partido", "bancada", "cargo_bancada", "estado", "visto_desde", "visto_hasta", "cambio_detectado")})
    L = {r["id_legislador"]: r for r in leer(silver / "legisladores.csv")}
    # Departamento de cada diputado (pipeline/circunscripciones.py); en el Senado la circunscripción es nacional.
    depto = {}
    if (silver / "circunscripciones.csv").exists():
        depto = {r["id_legislador"]: texto(r["departamento"]) for r in leer(silver / "circunscripciones.csv")}

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
        foto = fotos.get(int(lid))
        legisladores.append({
            "id": int(lid),
            "nombre": texto(info.get("nombre")) or nombre_en_voto[lid],
            "nombre_corto": texto(info.get("nombre_corto")) or texto(info.get("nombre")) or nombre_en_voto[lid],
            "cargo": texto(info.get("cargo")),
            "estado": texto(info.get("estado")),
            "partido": texto(info.get("partido")),
            "bancada": texto(info.get("bancada")),
            "cargo_bancada": texto(info.get("cargo_bancada")),
            "departamento": depto.get(str(int(lid))),
            "en_nomina": bool(info),
            "votaciones": len(en_cargo),
            "primera": min(en_cargo),
            "ultima": max(en_cargo),
            "conteo": {k: cnt.get(k, 0) for k in CLAVE_CONTEO.values()},
        })
        if foto:
            legisladores[-1]["foto"] = f"fotos/{foto}"
        if len(hist.get(str(int(lid)), [])) > 1:
            legisladores[-1]["historial"] = sorted(hist[str(int(lid))], key=lambda t: t["visto_desde"])

    votos_json = {
        "orden": [d["id"] for d in votaciones],
        "codigos": {cod: voto for voto, cod in CODIGO_VOTO.items()} | {"-": "fuera del cargo"},
        "legisladores": {str(int(lid)): "".join(cadenas[lid]) for lid in sorted(cadenas, key=int)},
    }
    comisiones = exportar_comisiones(silver, L, {str(int(x)) for x in cadenas})
    cobertura = {"desde": min(d["fecha"] for d in votaciones), "hasta": max(d["fecha"] for d in votaciones),
                 "votaciones": len(votaciones), "votos": len(votos), "legisladores": len(legisladores)}
    salida = {"legisladores.json": (legisladores, len(legisladores)),
              "votaciones.json": (votaciones, len(votaciones)),
              "votos.json": (votos_json, len(votos_json["legisladores"]))}
    salida["presencia.json"] = (presencia := exportar_presencia(votaciones, cadenas, L), len(presencia["menor_presencia"]))
    salida["asistencia.json"] = (asistencia := exportar_asistencia(votaciones, cadenas, L), len(asistencia["legisladores"]))
    if comisiones:
        salida["comisiones.json"] = (comisiones, len(comisiones["comisiones"]))
    return salida, cobertura


# Orden de los cargos dentro de una comisión; los que no están acá van después, en orden alfabético.
ORDEN_CARGOS = ["Presidente/a", "Vicepresidente/a", "Relator/a", "Secretario/a", "Titular", "Miembro"]


# Ranking de presencia (Inicio): quienes menos votos registran en votaciones nominales.
MESES_VENTANA = 12
MINIMO_POSIBLES = Fraction(1, 2)   # haber estado en el cargo en al menos la mitad de las votaciones de la ventana
PUESTOS = 3                        # se muestran los puestos 1 a 3, con todos los empatados


def un_anio_antes(d: date) -> date:
    try:
        return d.replace(year=d.year - 1)
    except ValueError:              # 29 de febrero
        return d.replace(year=d.year - 1, day=28)


def exportar_presencia(votaciones, cadenas, L):
    """Presencia en los últimos 12 meses hasta la última votación de la cámara.

    - Ventana: del día siguiente a (última votación - 1 año) hasta la última votación, inclusive.
    - Votaciones posibles de un legislador: las de la ventana en las que figura en el registro (estaba en el cargo).
    - Ausencias: las que figura como AUSENTE (código X). En Diputados «no vota» se registra como AUSENTE; en el
      Senado «presente, no vota» cuenta como presente. Quien preside figura con su voto, como el resto (verificado
      con la Mesa Directiva de SILpy, 15/11/2026), así que no se excluye a nadie por presidir.
    - Elegibles: en ejercicio según la nómina y con votaciones posibles >= MINIMO_POSIBLES de la ventana.
    - Puesto: menor presencia primero; misma presencia, mismo puesto (1, 2, 2, 4…). Dentro de un empate, primero
      quien tuvo más votaciones posibles. Se publican todos los de puesto <= PUESTOS.
    """
    hasta = max(v["fecha"] for v in votaciones)
    desde = (un_anio_antes(date.fromisoformat(hasta)) + timedelta(days=1)).isoformat()
    en_ventana = [k for k, v in enumerate(votaciones) if desde <= v["fecha"] <= hasta]
    n = len(en_ventana)
    filas = []
    for lid, cad in cadenas.items():
        info = L.get(lid, {})
        if info.get("estado") != "activos":
            continue
        posibles = sum(1 for k in en_ventana if cad[k] != "-")
        if not posibles or Fraction(posibles, n) < MINIMO_POSIBLES:
            continue
        ausencias = sum(1 for k in en_ventana if cad[k] == CODIGO_VOTO["AUSENTE"])
        filas.append({"id": int(lid), "presencia": 1 - Fraction(ausencias, posibles), "ausencias": ausencias, "posibles": posibles})
    filas.sort(key=lambda f: (f["presencia"], -f["posibles"], f["id"]))
    ranking = []
    for k, f in enumerate(filas):
        puesto = ranking[-1]["puesto"] if ranking and filas[k - 1]["presencia"] == f["presencia"] else k + 1
        if puesto > PUESTOS:
            break
        ranking.append({**f, "puesto": puesto})
    redondeo = lambda x: round(float(x), 4)
    return {
        "ventana": {"desde": desde, "hasta": hasta, "votaciones": n},
        "minimo_posibles": float(MINIMO_POSIBLES),
        "en_ejercicio": sum(1 for r in L.values() if r.get("estado") == "activos"),
        "elegibles": len(filas),
        "mediana": redondeo(statistics.median(f["presencia"] for f in filas)) if filas else None,
        "menor_presencia": [{"puesto": f["puesto"], "id": f["id"], "presencia": redondeo(f["presencia"]),
                             "ausencias": f["ausencias"], "posibles": f["posibles"]} for f in ranking],
    }


# Votaciones sobre algo del Poder Ejecutivo (mensajes y objeciones/vetos), detectadas por el texto de SILpy con la
# misma regla que codificar.py usa para su `categoria`. Solo se usa la pertenencia, NUNCA la dirección del voto
# (el índice de alineamiento con el Ejecutivo no se publica en la Fase 1).
RE_OBJECION_PE = re.compile(r"objeci|SE OBJETA", re.I)
RE_MENSAJE_PE = re.compile(r"MENSAJE[^,]{0,40}PODER EJECUTIVO|PODER EJECUTIVO[^,]{0,10}MENSAJE", re.I)


def tema_pe(v):
    """"objecion", "mensaje" o None para una votación de votaciones.json."""
    if RE_OBJECION_PE.search(v.get("mocion") or "") or RE_OBJECION_PE.search((v.get("mociones") or {}).get("1", "")):
        return "objecion"
    if RE_MENSAJE_PE.search(v.get("acapite") or ""):
        return "mensaje"
    return None


# Agrupaciones que se mencionan si dominan la lista de «sala medio vacía» (por texto del título de SILpy)
TEMAS_SALA_VACIA = [("expropiaciones", r"EXPROPIA"), ("desafectaciones de bienes", r"DESAFECTA"),
                    ("pensiones graciables", r"PENSI[OÓ]N GRACIABLE")]


def exportar_asistencia(votaciones, cadenas, L):
    """Presencia en votaciones nominales de todo el mandato, para la página Asistencia.

    Mismo criterio que exportar_presencia (Inicio): presente = no figurar como AUSENTE (X), entre las votaciones en
    las que la persona estaba en el cargo («-» no cuenta). En el Senado «no vota» cuenta como presente; en
    Diputados SILpy lo registra como AUSENTE. Quien preside figura con su voto. Partido: el actual de la nómina.
    """
    X = CODIGO_VOTO["AUSENTE"]
    cron = sorted(range(len(votaciones)), key=lambda k: (votaciones[k]["fecha"], votaciones[k]["id"]))
    meses = sorted({votaciones[k]["fecha"][:7] for k in cron})
    pos_mes = {m: i for i, m in enumerate(meses)}
    redondeo = lambda x: round(float(x), 4)
    info = lambda lid: L.get(lid, {})

    # --- por legislador: total, por mes, y por tipo de votación (consenso / reñida) ---
    tipo = {}
    n_tipo = Counter()
    for k, v in enumerate(votaciones):
        t = v["totales"]
        if v["tipo_votacion"] == "mociones":
            continue
        s, n = t.get("si", 0), t.get("no", 0)
        if s + n == 0:
            continue
        minoria = Fraction(min(s, n), s + n)
        if minoria < Fraction(config.ASISTENCIA_UMBRAL_CONSENSO).limit_denominator(1000):
            tipo[k] = "consenso"
        elif minoria >= Fraction(config.ASISTENCIA_UMBRAL_RENIDA).limit_denominator(1000):
            tipo[k] = "renida"
        if k in tipo:
            n_tipo[tipo[k]] += 1

    pe = {k: tema_pe(v) for k, v in enumerate(votaciones)}
    n_pe = Counter(t for t in pe.values() if t)
    legisladores, sin_datos, puntos, puntos_pe, por_mes = [], [], [], [], {}
    cam_mes = [[0, 0] for _ in meses]   # presentes, posibles de la cámara por mes
    for lid, cad in cadenas.items():
        posibles = sum(1 for c in cad if c != "-")
        presentes = sum(1 for c in cad if c not in ("-", X))
        mes = [[0, 0] for _ in meses]
        cuenta = {"consenso": [0, 0], "renida": [0, 0], "pe": [0, 0], "resto": [0, 0]}
        for k in cron:
            c = cad[k]
            if c == "-":
                continue
            i = pos_mes[votaciones[k]["fecha"][:7]]
            mes[i][1] += 1; cam_mes[i][1] += 1
            if c != X:
                mes[i][0] += 1; cam_mes[i][0] += 1
            if k in tipo:
                cuenta[tipo[k]][1] += 1
                cuenta[tipo[k]][0] += c != X
            grupo = "pe" if pe[k] else "resto"
            cuenta[grupo][1] += 1
            cuenta[grupo][0] += c != X
        if posibles < config.ASISTENCIA_MIN_POSIBLES:
            sin_datos.append({"id": int(lid), "posibles": posibles, "presentes": presentes})
            continue
        legisladores.append({"id": int(lid), "presencia": redondeo(Fraction(presentes, posibles)), "presentes": presentes,
                             "posibles": posibles, "partido": info(lid).get("partido") or "",
                             "en_ejercicio": info(lid).get("estado") == "activos"})
        por_mes[str(int(lid))] = [m if m[1] else None for m in mes]
        (pc, nc), (pr, nr) = cuenta["consenso"], cuenta["renida"]
        if nc >= config.ASISTENCIA_MIN_POR_TIPO and nr >= config.ASISTENCIA_MIN_POR_TIPO:
            puntos.append({"id": int(lid), "consenso": redondeo(Fraction(pc, nc)), "renidas": redondeo(Fraction(pr, nr)),
                           "n_consenso": nc, "n_renidas": nr, "diferencia": redondeo(Fraction(pr, nr) - Fraction(pc, nc))})
        (pp, npe), (pr2, nre) = cuenta["pe"], cuenta["resto"]
        if npe >= config.ASISTENCIA_MIN_POR_TIPO and nre >= config.ASISTENCIA_MIN_POR_TIPO:
            puntos_pe.append({"id": int(lid), "pe": redondeo(Fraction(pp, npe)), "resto": redondeo(Fraction(pr2, nre)),
                              "n_pe": npe, "n_resto": nre, "diferencia": redondeo(Fraction(pp, npe) - Fraction(pr2, nre))})
    legisladores.sort(key=lambda r: (r["presencia"], -r["posibles"], r["id"]))
    puntos_pe.sort(key=lambda r: (r["diferencia"], r["id"]))
    sin_datos.sort(key=lambda r: (-r["posibles"], r["id"]))
    puntos.sort(key=lambda r: (r["diferencia"], r["id"]))

    # --- indicadores ---
    pres = [Fraction(r["presentes"], r["posibles"]) for r in legisladores]
    aus_votacion = [Fraction(v["totales"].get("ausente", 0), v["totales"]["total"]) for v in votaciones if v["totales"].get("total")]
    maximo = max(legisladores, key=lambda r: (r["presencia"], r["posibles"])) if legisladores else None

    # --- partidos (actuales): mediana por partido; los de un solo integrante van a «Otros» ---
    grupos = {}
    for r in legisladores:
        grupos.setdefault(r["partido"], []).append(r)
    partidos, otros = [], []
    for p, xs in grupos.items():
        if len(xs) == 1:
            otros.extend(xs)
        else:
            partidos.append({"partido": p, "n": len(xs), "mediana": redondeo(statistics.median(Fraction(r["presentes"], r["posibles"]) for r in xs)),
                             "ids": [r["id"] for r in xs]})
    partidos.sort(key=lambda g: (-g["n"], g["partido"]))
    if otros:
        partidos.append({"partido": "", "otros": sorted({r["partido"] for r in otros}), "n": len(otros),
                         "mediana": redondeo(statistics.median(Fraction(r["presentes"], r["posibles"]) for r in otros)),
                         "ids": [r["id"] for r in otros]})

    # --- votaciones con la sala más vacía ---
    orden = sorted(votaciones, key=lambda v: (-Fraction(v["totales"].get("ausente", 0), v["totales"]["total"] or 1), v["fecha"], v["id"]))
    top = orden[:config.ASISTENCIA_SALA_VACIA]
    temas = []
    for nombre, patron in TEMAS_SALA_VACIA:
        n = sum(1 for v in top if re.search(patron, f"{v['titulo']} {v['acapite']}"))
        if n >= 3:
            temas.append({"tema": nombre, "n": n})

    return {
        "periodo": {"desde": min(v["fecha"] for v in votaciones), "hasta": max(v["fecha"] for v in votaciones), "votaciones": len(votaciones)},
        "criterios": {"minimo_posibles": config.ASISTENCIA_MIN_POSIBLES, "umbral_consenso": config.ASISTENCIA_UMBRAL_CONSENSO,
                      "umbral_renida": config.ASISTENCIA_UMBRAL_RENIDA, "minimo_por_tipo": config.ASISTENCIA_MIN_POR_TIPO},
        "indicadores": {
            "mediana": redondeo(statistics.median(pres)) if pres else None,
            "ausentes_votacion_tipica": redondeo(statistics.median(aus_votacion)) if aus_votacion else None,
            "bajo_50": sum(1 for x in pres if x < Fraction(1, 2)),
            "maximo": {"id": maximo["id"], "presencia": maximo["presencia"]} if maximo else None,
        },
        "legisladores": legisladores,
        "sin_datos": sin_datos,
        "partidos": partidos,
        "mensual": {
            "meses": meses,
            "camara": [{"mes": m, "presencia": redondeo(Fraction(p, n)) if n else None, "votaciones": sum(1 for v in votaciones if v["fecha"][:7] == m)}
                       for m, (p, n) in zip(meses, cam_mes)],
            "legisladores": por_mes,
        },
        "dispersion": {"votaciones_consenso": n_tipo["consenso"], "votaciones_renidas": n_tipo["renida"], "puntos": puntos},
        # Presencia en votaciones sobre mensajes y objeciones del Poder Ejecutivo frente al resto (sin dirección del voto)
        "poder_ejecutivo": {"votaciones": sum(n_pe.values()), "mensajes": n_pe["mensaje"], "objeciones": n_pe["objecion"],
                            "puntos": puntos_pe},
        "sala_vacia": {
            "menos_de_la_mitad": sum(1 for v in votaciones if v["totales"].get("total") and v["totales"].get("ausente", 0) * 2 > v["totales"]["total"]),
            "votaciones": [{"id": v["id"], "ausentes": v["totales"].get("ausente", 0), "total": v["totales"]["total"]} for v in top],
            "temas": temas,
        },
    }


def exportar_comisiones(silver, L, con_votos):
    """comisiones.json: una entrada por comisión con sus integrantes [id, periodo, cargo]. None si no hay CSV."""
    f = silver / "comisiones.csv"
    if not f.exists():
        return None
    filas = leer(f)
    nombres, tipos, integrantes = {}, {}, {}
    for r in filas:
        cid = int(r["id_comision"])
        nombres.setdefault(cid, Counter())[r["comision"]] += 1
        tipos.setdefault(cid, set()).add(r["tipo"])
        integrantes.setdefault(cid, set()).add((int(r["id_legislador"]), r["periodo"], r["cargo"]))
    rango = {c: k for k, c in enumerate(ORDEN_CARGOS)}
    comisiones = []
    for cid in nombres:
        if len(tipos[cid]) != 1:
            sys.exit(f"comisión {cid}: figura como {sorted(tipos[cid])} en distintas fichas")
        # Si SILpy la nombra distinto en distintas fichas, se usa el nombre más frecuente.
        nombre = sorted(nombres[cid].items(), key=lambda x: (-x[1], x[0]))[0][0]
        comisiones.append({
            "id": cid, "nombre": nombre, "tipo": next(iter(tipos[cid])),
            "url": f"https://silpy.congreso.gov.py/web/comision/{cid}",
            "integrantes": [list(x) for x in sorted(integrantes[cid], key=lambda x: (
                [-int(p) for p in x[1].split("-") if p.isdigit()], rango.get(x[2], len(rango)), x[2], x[0]))],
        })
    comisiones.sort(key=lambda c: (c["tipo"] != "asesora", c["nombre"].lower(), c["id"]))
    ids = sorted({x[0] for c in comisiones for x in c["integrantes"]})
    periodos = sorted({x[1] for c in comisiones for x in c["integrantes"]}, reverse=True)
    salida = {
        "campos_integrante": ["id_legislador", "periodo", "cargo"],
        "periodos": periodos,
        # Nombre y partido de cada integrante, para no depender de legisladores.json (que solo tiene a quienes
        # votaron). con_votos: tiene perfil en el sitio.
        "legisladores": {str(i): {"nombre": texto(L.get(str(i), {}).get("nombre_corto")) or texto(L.get(str(i), {}).get("nombre")),
                                  "partido": texto(L.get(str(i), {}).get("partido")),
                                  "estado": texto(L.get(str(i), {}).get("estado")),
                                  "con_votos": str(i) in con_votos} for i in ids},
        "comisiones": comisiones,
    }
    # Fecha de las fichas de SILpy de esta cámara (pipeline/comisiones.py, silver/fichas.csv)
    registro = config.SILVER / "fichas.csv"
    if registro.exists():
        fechas = [r["descargada"] for r in leer(registro) if r["id_legislador"] in L]
        if fechas:
            salida["fichas"] = {"desde": min(fechas), "hasta": max(fechas)}
    return salida


def serializar(obj):
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def copiar_fotos(fotos, destino):
    """Sincroniza destino/fotos/ con silver/fotos/ y devuelve el resumen para el manifiesto."""
    carpeta = destino / "fotos"
    if not fotos:
        if carpeta.exists():
            shutil.rmtree(carpeta)
        return None
    carpeta.mkdir(exist_ok=True)
    vigentes = set(fotos.values())
    for f in carpeta.iterdir():
        if f.name not in vigentes:
            f.unlink()
    lineas, total = [], 0
    for nombre in sorted(vigentes):
        contenido = (config.SILVER / "fotos" / nombre).read_bytes()
        if not (carpeta / nombre).exists() or (carpeta / nombre).read_bytes() != contenido:
            (carpeta / nombre).write_bytes(contenido)
        total += len(contenido)
        lineas.append(f"{nombre}:{hashlib.sha256(contenido).hexdigest()}")
    print(f"fotos/                       {len(vigentes):5} fotos {total:9,} bytes")
    return {"carpeta": "fotos/", "archivos": len(vigentes), "bytes": total,
            # sha256 de las líneas "archivo:sha256" ordenadas: cambia si cambia cualquier foto
            "sha256": hashlib.sha256("\n".join(lineas).encode()).hexdigest(),
            "fuente": "SILpy – Congreso Nacional del Paraguay (CC BY 4.0)"}


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

    fotos = fotos_disponibles()
    archivos, camaras = [], {}
    for cam in config.CAMARAS:
        datos, cobertura = exportar_camara(cam, fotos)
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

    resumen_fotos = copiar_fotos(fotos, destino)

    manifiesto = {
        "proyecto": "Hesaka · Congreso del Paraguay",
        "generado": max(a["generado"] for a in archivos),
        "fuente": {"nombre": "SILpy – Sistema de Información Legislativa, Congreso Nacional del Paraguay",
                   "url": "https://silpy.congreso.gov.py/", "licencia": "CC BY 4.0"},
        "licencia": "CC BY-SA 4.0",
        "camaras": camaras,
        "notas": NOTAS,
        "archivos": archivos,
    }
    if resumen_fotos:
        manifiesto["fotos"] = resumen_fotos
    mp.write_text(json.dumps(manifiesto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"manifiesto.json: {len(archivos)} archivos")


if __name__ == "__main__":
    main()
