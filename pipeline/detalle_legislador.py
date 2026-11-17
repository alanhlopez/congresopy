"""Archivos por legislador para el perfil (pestañas Lista, Análisis y Datos abiertos) — solo biblioteca estándar.

Para cada legislador con votos, en site/datos/congreso/{camara}/legisladores/{id}/:
  analisis.json  por período (mandato, últimos 12 meses y cada período legislativo):
                 - conteo de votos (S N A M V X) y votaciones posibles (en el cargo);
                 - series por mes y año (y por semana si el período dura 6 meses o menos), con su presencia y la
                   mediana de presencia de la cámara en cada tramo;
                 - similitud de voto con cada legislador en ejercicio (votaciones en las que los dos votaron Sí, No o
                   Abstención; mínimo SIMILITUD_MINIMO en común);
                 - coincidencia con la mayoría de cada partido (partido actual de la nómina).
  votos.csv      una fila por votación en la que estaba en el cargo.
  resumen.json   datos del legislador, conteo del mandato, licencia y diccionario de columnas.

Mismo criterio de presencia que el resto del sitio: presente = no figurar como AUSENTE (X), entre las votaciones en
las que estaba en el cargo («-» no cuenta).
"""
import csv
import io
import statistics
from collections import Counter, defaultdict
from datetime import date, timedelta

import config
from comun import CODIGO_VOTO

SIMILITUD_MINIMO = 20
SEMANA_MAX_DIAS = 183           # granularidad semanal solo si el período dura 6 meses o menos
EMITIDOS_SNA = set("SNA")       # para similitud y bloques: Sí, No o Abstención (no mociones ni ausencias)
VOTO_TEXTO = {c: t for t, c in CODIGO_VOTO.items()}
CLAVES = ["S", "N", "A", "M", "V", "X"]
COLUMNAS_CSV = ["fecha", "id_votacion", "expediente", "su_voto", "resultado", "url"]
DICCIONARIO = {
    "fecha": "Fecha de la votación (AAAA-MM-DD).",
    "id_votacion": "Identificador de la votación en SILpy. El título, el tipo y los totales están en votaciones.json de la cámara.",
    "expediente": "Número de expediente en SILpy.",
    "su_voto": "Voto del legislador tal como lo registra SILpy: SI, NO, ABSTENCIÓN/BLANCO, AUSENTE, NO VOTA o MOCIÓN 1/2/3.",
    "resultado": "Resultado de la votación según SILpy.",
    "url": "Página de la votación en SILpy.",
}
LICENCIA = ("Datos derivados: CC BY-SA 4.0. Fuente: SILpy – Congreso Nacional del Paraguay (CC BY 4.0). "
            "Al reutilizarlos, citá al Congreso Nacional y a Hesakã.")


def un_anio_antes(d: date) -> date:
    try:
        return d.replace(year=d.year - 1)
    except ValueError:
        return d.replace(year=d.year - 1, day=28)


def periodos_de(votaciones):
    """[(clave, nombre, índices de votaciones del período)] en orden: mandato, 12 meses, períodos legislativos."""
    todas = list(range(len(votaciones)))
    hasta = max(v["fecha"] for v in votaciones)
    desde12 = (un_anio_antes(date.fromisoformat(hasta)) + timedelta(days=1)).isoformat()
    out = [("mandato", "Todo el mandato", todas),
           ("12m", "Últimos 12 meses", [k for k in todas if desde12 <= votaciones[k]["fecha"] <= hasta])]
    for pid, nombre in config.PERIODOS.items():
        idx = [k for k in todas if votaciones[k]["periodo_id"] == pid]
        if idx:
            out.append((str(pid), f"Período {nombre}", idx))
    return out


def tramo(fecha: str, granularidad: str) -> str:
    if granularidad == "anio":
        return fecha[:4]
    if granularidad == "mes":
        return fecha[:7]
    d = date.fromisoformat(fecha)
    return (d - timedelta(days=d.weekday())).isoformat()   # semana: el lunes que la empieza


def codigo(c):
    return "M" if c in "123" else c


def leer_leyes_clave(camara):
    """Lista editorial de silver/{camara}/leyes_clave.csv, o [] si la bandera está apagada."""
    if not config.LEYES_CLAVE_PUBLICADAS:
        return []
    f = config.silver_dir(camara) / "leyes_clave.csv"
    with open(f, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def leyes_clave(votaciones, cadenas, L, lista):
    """{lid: [fila por ley]} con su voto, la posición de su partido (mayoría de sus S/N/A) y la del gobierno."""
    pos = {v["id"]: k for k, v in enumerate(votaciones)}
    sentido = {"S": "a favor", "N": "en contra", "A": "abstención"}
    salida = {}
    for lid, cad in cadenas.items():
        p = L.get(lid, {}).get("partido") or ""
        filas = []
        for ley in lista:
            k = pos.get(int(ley["id_votacion"]))
            if k is None or cad[k] == "-":
                continue
            cuenta = Counter(cadenas[o][k] for o in cadenas if (L.get(o, {}).get("partido") or "") == p and cadenas[o][k] in EMITIDOS_SNA)
            total = sum(cuenta.values())
            opcion, n = cuenta.most_common(1)[0] if total else ("", 0)
            v = votaciones[k]
            filas.append({"id": v["id"], "titulo": ley["titulo"], "fecha": v["fecha"], "resultado": v["resultado"],
                          "su_voto": VOTO_TEXTO[cad[k]], "su_partido": sentido[opcion] if n * 2 > total else "dividido",
                          "gobierno": ley["gobierno"], "fuente": ley["fuente"]})
        salida[lid] = filas
    return salida


def calcular(votaciones, cadenas, L, camara=None):
    """Devuelve {lid: {"analisis": obj, "resumen": obj, "votos_csv": str}} para cada legislador con votos."""
    X = CODIGO_VOTO["AUSENTE"]
    periodos = periodos_de(votaciones)
    ids = sorted(cadenas, key=int)
    activos = {lid for lid in ids if L.get(lid, {}).get("estado") == "activos"}
    partido = {lid: L.get(lid, {}).get("partido") or "" for lid in ids}
    # período legislativo de cada votación (para sumar pares una sola vez) y si está en la ventana de 12 meses
    per_leg = {k: str(v["periodo_id"]) for k, v in enumerate(votaciones)}
    en_12m = set(next(idx for c, _, idx in periodos if c == "12m"))

    # --- similitud por pares y coincidencia con la mayoría de cada partido, acumuladas por período legislativo y 12m ---
    par = defaultdict(lambda: [0, 0])          # (clave_periodo, a, b) -> [igual, comun], a < b
    bloque = defaultdict(lambda: [0, 0])       # (clave_periodo, lid, partido) -> [igual, comun]
    for k in range(len(votaciones)):
        emit = [(lid, cadenas[lid][k]) for lid in ids if cadenas[lid][k] in EMITIDOS_SNA]
        claves = [per_leg[k]] + (["12m"] if k in en_12m else [])
        for i in range(len(emit)):
            a, va = emit[i]
            for j in range(i + 1, len(emit)):
                b, vb = emit[j]
                for cp in claves:
                    t = par[(cp, a, b)]
                    t[1] += 1
                    t[0] += va == vb
        # mayoría de cada partido (sin contar el voto propio): opción con más de la mitad de los emitidos S/N/A
        por_partido = defaultdict(Counter)
        for lid, v in emit:
            por_partido[partido[lid]][v] += 1
        for lid, v in emit:
            for p, cuenta in por_partido.items():
                if not p:
                    continue
                c = cuenta.copy()
                if partido[lid] == p:
                    c[v] -= 1
                total = sum(c.values())
                if not total:
                    continue
                opcion, n = c.most_common(1)[0]
                if n * 2 <= total:
                    continue   # partido dividido en esa votación: no se cuenta
                for cp in claves:
                    t = bloque[(cp, lid, p)]
                    t[1] += 1
                    t[0] += v == opcion

    def similitud(cp, lid):
        filas = []
        for otro in activos - {lid}:
            if cp == "mandato":
                igual = comun = 0
                for c, _, _ in periodos:
                    if c not in ("mandato", "12m"):
                        t = par.get((c, *sorted((lid, otro), key=int)))
                        if t:
                            igual += t[0]; comun += t[1]
            else:
                t = par.get((cp, *sorted((lid, otro), key=int)), [0, 0])
                igual, comun = t
            if comun >= SIMILITUD_MINIMO:
                filas.append({"id": int(otro), "igual": igual, "comun": comun})
        return sorted(filas, key=lambda f: (-f["igual"] / f["comun"], f["id"]))

    def bloques(cp, lid):
        filas = []
        for p in sorted({x for x in partido.values() if x}):
            if cp == "mandato":
                igual = sum(bloque.get((c, lid, p), [0, 0])[0] for c, _, _ in periodos if c not in ("mandato", "12m"))
                comun = sum(bloque.get((c, lid, p), [0, 0])[1] for c, _, _ in periodos if c not in ("mandato", "12m"))
            else:
                igual, comun = bloque.get((cp, lid, p), [0, 0])
            if comun >= SIMILITUD_MINIMO:
                filas.append({"partido": p, "igual": igual, "comun": comun})
        return sorted(filas, key=lambda f: (-f["igual"] / f["comun"], f["partido"]))

    # --- medianas de presencia de la cámara por tramo (por período y granularidad) ---
    def granularidades(idx):
        fechas = sorted(votaciones[k]["fecha"] for k in idx)
        dias = (date.fromisoformat(fechas[-1]) - date.fromisoformat(fechas[0])).days
        return ["semana", "mes", "anio"] if dias <= SEMANA_MAX_DIAS else ["mes", "anio"]

    medianas = {}
    for cp, _, idx in periodos:
        for g in granularidades(idx):
            pres = defaultdict(dict)   # tramo -> lid -> [presentes, posibles]
            for k in idx:
                t = tramo(votaciones[k]["fecha"], g)
                for lid in ids:
                    c = cadenas[lid][k]
                    if c == "-":
                        continue
                    pp = pres[t].setdefault(lid, [0, 0])
                    pp[1] += 1
                    pp[0] += c != X
            medianas[(cp, g)] = {t: statistics.median(p / n for p, n in d.values()) for t, d in pres.items()}

    claves_editoriales = leyes_clave(votaciones, cadenas, L, leer_leyes_clave(camara)) if camara else {}
    r4 = lambda x: round(x, 4)
    salida = {}
    cron = sorted(range(len(votaciones)), key=lambda k: (votaciones[k]["fecha"], votaciones[k]["id"]))
    for lid in ids:
        cad = cadenas[lid]
        por_periodo, lista_periodos = {}, []
        for cp, nombre, idx in periodos:
            idx_c = sorted(idx, key=lambda k: (votaciones[k]["fecha"], votaciones[k]["id"]))
            conteo = Counter(codigo(cad[k]) for k in idx_c if cad[k] != "-")
            posibles = sum(conteo.values())
            series = {}
            for g in granularidades(idx):
                tramos = {}
                for k in idx_c:
                    t = tramo(votaciones[k]["fecha"], g)
                    fila = tramos.setdefault(t, Counter())
                    fila["_votaciones"] += 1
                    if cad[k] != "-":
                        fila[codigo(cad[k])] += 1
                lista = []
                for t, f in tramos.items():
                    pos = sum(f[c] for c in CLAVES)
                    lista.append({"p": t, **{c: f[c] for c in CLAVES}, "posibles": pos,
                                  "presencia": r4(1 - f["X"] / pos) if pos else None,
                                  "mediana": r4(medianas[(cp, g)][t]) if t in medianas[(cp, g)] else None})
                series[g] = lista
            fechas = [votaciones[k]["fecha"] for k in idx_c]
            lista_periodos.append({"clave": cp, "nombre": nombre, "desde": fechas[0], "hasta": fechas[-1],
                                   "votaciones": len(idx_c), "semana": "semana" in series})
            por_periodo[cp] = {
                "conteo": {**{c: conteo[c] for c in CLAVES}, "posibles": posibles},
                "series": series,
                "similitud": similitud(cp, lid) if posibles else [],
                "bloques": bloques(cp, lid) if posibles else [],
            }
        info = L.get(lid, {})
        mandato = por_periodo["mandato"]["conteo"]
        # votos.csv
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(COLUMNAS_CSV)
        for k in cron:
            if cad[k] == "-":
                continue
            v = votaciones[k]
            w.writerow([v["fecha"], v["id"], v["expediente"] or "", VOTO_TEXTO[cad[k]],
                        v["resultado"] or "", v["url"]])
        salida[lid] = {
            "analisis": {"id": int(lid), "periodos": lista_periodos, "por_periodo": por_periodo,
                         **({"leyes_clave": claves_editoriales[lid]} if claves_editoriales.get(lid) else {}),
                         "criterios": {"similitud_minimo": SIMILITUD_MINIMO, "semana_max_dias": SEMANA_MAX_DIAS,
                                       "partido": "partido actual según la nómina de SILpy"}},
            "resumen": {
                "id": int(lid), "nombre": info.get("nombre") or "", "partido": info.get("partido") or "",
                "bancada": info.get("bancada") or "", "estado": info.get("estado") or "",
                "votaciones_en_el_cargo": mandato["posibles"],
                "presencia": r4(1 - mandato["X"] / mandato["posibles"]) if mandato["posibles"] else None,
                "conteo": {c: mandato[c] for c in CLAVES},
                "codigos": {"S": "Sí", "N": "No", "A": "Abstención", "M": "Moción (1, 2 o 3)", "V": "Presente, no vota",
                            "X": "Ausente"},
                "archivos": {"votos.csv": DICCIONARIO, "analisis.json": "Series, similitud y coincidencia con partidos por período."},
                "licencia": LICENCIA,
            },
            "votos_csv": buf.getvalue(),
        }
    return salida
