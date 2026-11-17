"""Votómetro: comportamiento de voto de toda la cámara -> site/datos/congreso/{camara}/votometro.json.

Lo llama exportar_sitio.py (usa numpy, como analisis.py). Secciones, por período (mandato y cada período
legislativo con datos suficientes para el mapa):
  disciplina   por legislador: % de votaciones en las que votó como la mayoría clara (>= 60 %) de su partido, entre
               las que él y su partido votaron Sí/No/Abstención (sin contar su propio voto); puesto dentro del partido
               y las votaciones en las que se apartó. Por partido: cohesión (índice de Rice) promedio y mensual.
  decisivas    votaciones en las que el resultado pudo cambiar con pocos votos: margen Sí−No de 3 o menos, o una
               mayoría calificada identificable (2/3 o absoluta según SILpy; mayoría absoluta para rechazar un veto)
               alcanzada o no por 3 votos o menos. Ranking de veces del lado ganador.
  mapa         MDS clásico (como el prototipo) sobre votaciones divididas: dimensiones 1 y 2, varianza explicada.
Y para todo el mandato:
  trayectoria  MDS en ventanas de 12 meses que avanzan cada 6 meses, con la posición normalizada (−1..1) para
               comparar ventanas; el eje se orienta para que la mayoría del ANR quede del lado positivo.

Partido: el actual de la nómina (el historial de bancadas no cubre el período).
"""
import math
import re
from collections import Counter, defaultdict

import numpy as np

import config

MINORIA_MIN = 0.025          # votación dividida: la minoría (Sí o No) tiene al menos el 2,5 %
MAYORIA_CLARA = 0.6          # disciplina: el partido votó al menos 60 % en un sentido
MINIMO_DISCIPLINA = 20       # votaciones con mayoría clara para entrar en el ranking
MARGEN_DECISIVO = 3          # votos
MAPA_MIN_LEGISLADORES = 10
MAPA_MIN_DIVIDIDAS = 15
MUESTRA_CHICA = 0.5          # aviso si el mapa cubre menos de la mitad de la cámara
SIGNO = {"S": 1, "N": -1, "1": 1, "2": -1}
RE_OBJECION = re.compile(r"objeci|SE OBJETA", re.I)
r4 = lambda x: None if x is None else round(float(x), 4)


def minimo_votos(n_divididas):
    """Como el prototipo: el 25 % de las votaciones divididas, entre 10 y 25."""
    return max(10, min(25, int(0.25 * n_divididas)))


def mds(cadenas, idx, ids):
    """MDS clásico sobre votaciones divididas de idx. Devuelve dict o None si no hay datos suficientes."""
    X = np.array([[SIGNO.get(cadenas[i][k], np.nan) for k in idx] for i in ids], dtype=float)
    if X.size == 0:
        return None
    si, no = (X == 1).sum(axis=0), (X == -1).sum(axis=0)
    total = np.maximum((~np.isnan(X)).sum(axis=0), 1)
    divididas = np.minimum(si, no) / total >= MINORIA_MIN
    X = X[:, divididas]
    n_div = int(divididas.sum())
    minimo = minimo_votos(n_div)
    filas = (~np.isnan(X)).sum(axis=1) >= minimo
    X = X[filas]
    quienes = [i for i, ok in zip(ids, filas) if ok]
    if len(quienes) < MAPA_MIN_LEGISLADORES or n_div < MAPA_MIN_DIVIDIDAS:
        return {"divididas": n_div, "minimo": minimo, "legisladores": len(quienes), "valido": False}
    n = len(quienes)
    A = np.full((n, n), np.nan)
    validos = ~np.isnan(X)
    for a in range(n):
        for b in range(a, n):
            ok = validos[a] & validos[b]
            if ok.sum() >= 10:
                A[a, b] = A[b, a] = (X[a][ok] == X[b][ok]).mean()
    A = np.where(np.isnan(A), np.nanmean(A), A)
    J = np.eye(n) - 1 / n
    B = -0.5 * J @ ((1 - A) ** 2) @ J
    w, V = np.linalg.eigh(B)
    o = w.argsort()[::-1]
    w, V = w[o], V[:, o]
    P = V[:, :2] * np.sqrt(np.clip(w[:2], 0, None))
    positivos = w[w > 0].sum()
    return {"divididas": n_div, "minimo": minimo, "legisladores": n, "valido": True, "ids": quienes,
            "d1": P[:, 0], "d2": P[:, 1], "var1": w[0] / positivos, "var2": w[1] / positivos}


def orientar(res, partido):
    """Invierte las dimensiones para que el promedio del ANR quede del lado positivo."""
    for d in ("d1", "d2"):
        anr = [v for i, v in zip(res["ids"], res[d]) if partido.get(i) == "ANR"]
        if anr and np.mean(anr) < 0:
            res[d] = -res[d]
    return res


def mayoria_clara(cuenta):
    total = sum(cuenta.values())
    if not total:
        return None
    opcion, n = cuenta.most_common(1)[0]
    return opcion if n / total >= MAYORIA_CLARA else None


def umbral_calificado(v, miembros):
    """(votos necesarios, descripción) si SILpy permite saber que hacía falta una mayoría calificada, o None."""
    texto = f"{v['resultado']} {v.get('observacion') or ''} {v.get('mocion') or ''}"
    if re.search(r"2/3|DOS TERCIOS", texto, re.I):
        return math.ceil(2 * miembros / 3), "dos tercios"
    if re.search(r"MAYOR[IÍ]A ABSOLUTA", texto, re.I):
        return miembros // 2 + 1, "mayoría absoluta"
    if RE_OBJECION.search(v.get("mocion") or ""):
        return miembros // 2 + 1, "mayoría absoluta para rechazar el veto"
    return None


def calcular(votaciones, cadenas, L, bancas):
    ids = sorted(cadenas, key=int)
    partido = {i: (L.get(i, {}).get("partido") or "") for i in ids}
    activos = {i for i in ids if L.get(i, {}).get("estado") == "activos"}
    todas = list(range(len(votaciones)))
    cron = sorted(todas, key=lambda k: (votaciones[k]["fecha"], votaciones[k]["id"]))

    periodos = [("mandato", "Todo el mandato", cron)]
    for pid, nombre in config.PERIODOS.items():
        idx = [k for k in cron if votaciones[k]["periodo_id"] == pid]
        if idx:
            periodos.append((str(pid), f"Período {nombre}", idx))

    salida_periodos, por_periodo = [], {}
    for clave, nombre, idx in periodos:
        mapa = mds(cadenas, idx, ids)
        if clave != "mandato" and not (mapa and mapa["valido"]):
            continue   # sin datos suficientes para el mapa: el período no se ofrece (B)
        orientar(mapa, partido)
        aviso = None
        if mapa["legisladores"] < MUESTRA_CHICA * bancas:
            aviso = (f"Solo {mapa['legisladores']} legisladores tienen votos suficientes en las {mapa['divididas']} votaciones "
                     f"divididas del período: el mapa es una muestra chica.")
        salida_periodos.append({"clave": clave, "nombre": nombre, "desde": votaciones[idx[0]]["fecha"],
                                "hasta": votaciones[idx[-1]]["fecha"], "votaciones": len(idx), "aviso": aviso})
        por_periodo[clave] = {
            "disciplina": disciplina(votaciones, cadenas, partido, idx, ids),
            "cohesion": cohesion(votaciones, cadenas, partido, idx, ids),
            "decisivas": decisivas(votaciones, cadenas, idx, ids, bancas),
            "mapa": {"divididas": mapa["divididas"], "minimo_votos": mapa["minimo"], "var1": r4(mapa["var1"]), "var2": r4(mapa["var2"]),
                     "puntos": [{"id": int(i), "d1": r4(a), "d2": r4(b), "voto": r4(voto_pct(cadenas[i], idx))}
                                for i, a, b in zip(mapa["ids"], mapa["d1"], mapa["d2"])]},
        }
    return {"periodos": salida_periodos, "por_periodo": por_periodo,
            "trayectoria": trayectoria(votaciones, cadenas, partido, ids, cron),
            "criterios": {"minoria_dividida": MINORIA_MIN, "mayoria_clara": MAYORIA_CLARA, "minimo_disciplina": MINIMO_DISCIPLINA,
                          "margen_decisivo": MARGEN_DECISIVO, "mapa_min_legisladores": MAPA_MIN_LEGISLADORES,
                          "mapa_min_divididas": MAPA_MIN_DIVIDIDAS, "bancas": bancas,
                          "partido": "partido actual según la nómina de SILpy (el historial de bancadas no cubre el período)"}}


def voto_pct(cad, idx):
    """% de las votaciones del período en el cargo en las que emitió un voto (Sí, No, Abstención o moción)."""
    en = [cad[k] for k in idx if cad[k] != "-"]
    return sum(c in "SNA123" for c in en) / len(en) if en else None


def disciplina(votaciones, cadenas, partido, idx, ids):
    # Votos S/N/A de cada partido en cada votación (se cuentan una vez; a cada legislador se le resta el suyo)
    por_voto = {k: Counter((partido[i], cadenas[i][k]) for i in ids if partido[i] and cadenas[i][k] in "SNA") for k in idx}
    filas, aparto = [], {}
    for i in ids:
        p = partido[i]
        if not p:
            continue
        igual = comun = 0
        se_aparto = []
        for k in idx:
            v = cadenas[i][k]
            if v not in ("S", "N", "A"):
                continue
            c = por_voto[k]
            cuenta = Counter({o: c[(p, o)] - (1 if o == v else 0) for o in "SNA"})
            m = mayoria_clara(+cuenta)
            if m is None:
                continue
            comun += 1
            if v == m:
                igual += 1
            else:
                se_aparto.append([votaciones[k]["id"], v, m])
        if comun >= MINIMO_DISCIPLINA:
            filas.append({"id": int(i), "partido": p, "igual": igual, "comun": comun, "pct": r4(igual / comun)})
            aparto[str(int(i))] = sorted(se_aparto, key=lambda x: -x[0])
    # puesto dentro del partido (más disciplinado primero; mismo porcentaje, mismo puesto)
    por_partido = defaultdict(list)
    for f in filas:
        por_partido[f["partido"]].append(f)
    for xs in por_partido.values():
        xs.sort(key=lambda f: (-f["igual"] / f["comun"], f["id"]))
        for n, f in enumerate(xs):
            f["puesto"] = xs[n - 1]["puesto"] if n and xs[n - 1]["pct"] == f["pct"] else n + 1
            f["de"] = len(xs)
    filas.sort(key=lambda f: (f["partido"], f["puesto"], f["id"]))
    return {"legisladores": filas, "se_aparto": aparto}


def cohesion(votaciones, cadenas, partido, idx, ids):
    """Índice de Rice por partido y votación: |Sí − No| / (Sí + No), con al menos 2 votos del partido."""
    por = defaultdict(list)
    mensual = defaultdict(lambda: defaultdict(list))
    for k in idx:
        cuenta = defaultdict(Counter)
        for i in ids:
            c = cadenas[i][k]
            if c in "SN" and partido[i]:
                cuenta[partido[i]][c] += 1
        for p, c in cuenta.items():
            n = c["S"] + c["N"]
            if n >= 2:
                rice = abs(c["S"] - c["N"]) / n
                por[p].append(rice)
                mensual[p][votaciones[k]["fecha"][:7]].append(rice)
    miembros = Counter(partido[i] for i in ids if partido[i])
    salida = []
    for p, xs in por.items():
        if miembros[p] < 2:
            continue
        salida.append({"partido": p, "rice": r4(sum(xs) / len(xs)), "votaciones": len(xs), "integrantes": miembros[p],
                       "mensual": [{"mes": m, "rice": r4(sum(v) / len(v)), "votaciones": len(v)} for m, v in sorted(mensual[p].items())]})
    return sorted(salida, key=lambda x: (-x["integrantes"], x["partido"]))


def decisivas(votaciones, cadenas, idx, ids, bancas):
    filas, ganadores = [], Counter()
    for k in idx:
        v = votaciones[k]
        if v["tipo_votacion"] == "mociones":
            continue
        t = v["totales"]
        si, no, aus = t.get("si", 0), t.get("no", 0), t.get("ausente", 0)
        if si + no == 0:
            continue
        motivo = None
        calif = umbral_calificado(v, bancas)
        if calif:
            necesarios, tipo = calif
            # Para un veto, SILpy no dice qué lado necesitaba la mayoría absoluta: se toma el más cercano al umbral.
            lado = "si" if "veto" not in tipo or abs(si - necesarios) <= abs(no - necesarios) else "no"
            dif = (si if lado == "si" else no) - necesarios          # >= 0: se alcanzó
            # decisiva si con 3 votos menos no se alcanzaba (dif <= 2) o con 3 más se alcanzaba (faltaron <= 3)
            if (dif >= 0 and dif + 1 <= MARGEN_DECISIVO) or (dif < 0 and -dif <= MARGEN_DECISIVO):
                motivo = {"tipo": "umbral", "umbral": necesarios, "descripcion": tipo, "lado": lado, "diferencia": dif}
        if motivo is None and si != no and abs(si - no) <= MARGEN_DECISIVO:
            motivo = {"tipo": "margen", "margen": abs(si - no)}
        if motivo is None:
            continue
        if motivo["tipo"] == "margen":
            ganador = "S" if si > no else "N"
            para_dar_vuelta = abs(si - no) + 1                    # votos que, del lado perdedor, daban vuelta el resultado
            con_ausentes = aus >= para_dar_vuelta
        else:
            alcanzo = motivo["diferencia"] >= 0
            a_favor = "S" if motivo["lado"] == "si" else "N"
            ganador = a_favor if alcanzo else ("N" if a_favor == "S" else "S")
            para_dar_vuelta = motivo["diferencia"] + 1 if alcanzo else -motivo["diferencia"]
            # si no se alcanzó, los ausentes podían sumar los votos que faltaban; si se alcanzó, dependía de quienes votaron
            con_ausentes = None if alcanzo else aus >= para_dar_vuelta
        lado_ganador = [int(i) for i in ids if cadenas[i][k] == ganador]
        for i in lado_ganador:
            ganadores[i] += 1
        filas.append({"id": v["id"], "si": si, "no": no, "ausentes": aus, **motivo, "ganador": ganador,
                      "para_dar_vuelta": para_dar_vuelta, "alcanzaba_con_ausentes": con_ausentes,
                      "lado_ganador": lado_ganador})
    filas.sort(key=lambda f: -f["id"])
    ranking = [{"id": i, "veces": n} for i, n in sorted(ganadores.items(), key=lambda x: (-x[1], x[0]))]
    return {"votaciones": filas, "ranking": ranking}


def ventanas(cron, votaciones):
    """Ventanas de 12 meses que avanzan cada 6, desde el inicio del mandato (julio del primer período legislativo:
    la sesión preparatoria del 30 de junio no abre una ventana propia)."""
    ultima = votaciones[cron[-1]]["fecha"]
    y, m = int(next(iter(config.PERIODOS.values()))[:4]), 7
    out = []
    while f"{y}-{m:02d}" <= ultima[:7]:
        fin_y, fin_m = y + 1, m
        out.append((f"{y}-{m:02d}", f"{fin_y}-{fin_m:02d}"))
        y, m = (y, 7) if m == 1 else (y + 1, 1)
    return out


def trayectoria(votaciones, cadenas, partido, ids, cron):
    salida_v, posiciones = [], defaultdict(dict)
    for ini, fin in ventanas(cron, votaciones):
        idx = [k for k in cron if ini <= votaciones[k]["fecha"][:7] < fin]
        res = mds(cadenas, idx, ids)
        if not res or not res["valido"]:
            continue
        orientar(res, partido)
        escala = max(abs(res["d1"]).max(), 1e-9)
        clave = ini
        salida_v.append({"clave": clave, "desde": ini, "hasta": fin, "divididas": res["divididas"], "minimo_votos": res["minimo"],
                         "legisladores": res["legisladores"], "var1": r4(res["var1"])})
        for i, d in zip(res["ids"], res["d1"]):
            posiciones[i][clave] = r4(d / escala)
    claves = [v["clave"] for v in salida_v]
    puntos, movimiento = {}, []
    for i, pos in posiciones.items():
        serie = [pos.get(c) for c in claves]
        puntos[str(int(i))] = serie
        presentes = [x for x in serie if x is not None]
        if len(presentes) >= 2:
            movimiento.append({"id": int(i), "rango": r4(max(presentes) - min(presentes)), "ventanas": len(presentes)})
    movimiento.sort(key=lambda x: (-x["rango"], x["id"]))
    return {"ventanas": salida_v, "posiciones": puntos, "movimiento": movimiento}
