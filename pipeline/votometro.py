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
  posicion     dos medidas de posición en un eje: «anr» (coincidencia con la mayoría de los legisladores del ANR
               presentes en las votaciones divididas) y «mds» (dimensión 1 del escalamiento). Para cada una: filas por
               partido con su mediana y los «cruzados» (más cerca de la mediana de otro partido que de la del suyo).
  ausentismo   ausentismo selectivo: % de ausencia (ausente + no vota) en las votaciones sobre vetos del Ejecutivo
               contra el resto. Para rechazar un veto hace falta la mayoría absoluta de los miembros: no votar ayuda,
               en los hechos, a que el veto se mantenga. Se mide la presencia, no la dirección del voto.
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
GRUPO_MIN = 3                # integrantes para tener fila propia en el gráfico de posición (si no, «Otros»)
AUSENTISMO_MIN_VETOS = 8     # votaciones sobre vetos en el cargo para entrar en el gráfico
AUSENTISMO_MIN_RESTO = 20
RE_OBJECION = re.compile(r"objeci|SE OBJETA", re.I)
r4 = lambda x: None if x is None else round(float(x), 4)


def es_veto(v):
    """Votación sobre una objeción (veto) del Ejecutivo: misma regla que exportar_sitio.tema_pe (lo verifica un test)."""
    return bool(RE_OBJECION.search(v.get("mocion") or "") or RE_OBJECION.search((v.get("mociones") or {}).get("1", "")))


def ausentismo(votaciones, cadenas, idx, ids):
    vetos = [k for k in idx if es_veto(votaciones[k])]
    resto = [k for k in idx if k not in set(vetos)]
    filas = []
    for i in ids:
        cad = cadenas[i]
        nv = [k for k in vetos if cad[k] != "-"]
        nr = [k for k in resto if cad[k] != "-"]
        if len(nv) < AUSENTISMO_MIN_VETOS or len(nr) < AUSENTISMO_MIN_RESTO:
            continue
        av = sum(cad[k] in "XV" for k in nv) / len(nv)
        ar = sum(cad[k] in "XV" for k in nr) / len(nr)
        filas.append({"id": int(i), "objeciones": r4(av), "resto": r4(ar), "n_objeciones": len(nv), "n_resto": len(nr), "diferencia": r4(av - ar)})
    filas.sort(key=lambda f: (-f["diferencia"], f["id"]))
    return {"votaciones_objeciones": len(vetos), "votaciones_resto": len(resto), "puntos": filas,
            "minimos": {"objeciones": AUSENTISMO_MIN_VETOS, "resto": AUSENTISMO_MIN_RESTO}}


def minimo_votos(n_divididas):
    """Como el prototipo: el 25 % de las votaciones divididas, entre 10 y 25."""
    return max(10, min(25, int(0.25 * n_divididas)))


def mascara_divididas(X):
    """Votación dividida: la minoría (Sí o No, mociones incluidas) tiene al menos el 2,5 % de esos votos."""
    si, no = (X == 1).sum(axis=0), (X == -1).sum(axis=0)
    total = np.maximum((~np.isnan(X)).sum(axis=0), 1)
    return np.minimum(si, no) / total >= MINORIA_MIN


def divididas_de(cadenas, idx, ids):
    X = np.array([[SIGNO.get(cadenas[i][k], np.nan) for k in idx] for i in ids], dtype=float)
    return [k for k, ok in zip(idx, mascara_divididas(X)) if ok] if X.size else []


def coincidencia_anr(cadenas, partido, idx, ids, minimo=None):
    """Mínimo de votos: el mismo que el MDS (el 25 % de las divididas, entre 10 y 25; 25 en el mandato).
    % de votaciones divididas en las que votó igual que la mayoría de los legisladores del ANR presentes
    (solo Sí/No/Abstención; a un legislador del ANR no se lo cuenta en esa mayoría). Sin mayoría única: no cuenta."""
    div = divididas_de(cadenas, idx, ids)
    minimo = minimo_votos(len(div)) if minimo is None else minimo
    anr = {k: Counter(cadenas[i][k] for i in ids if partido[i] == "ANR" and cadenas[i][k] in "SNA") for k in div}
    out = {}
    for i in ids:
        igual = comun = 0
        for k in div:
            v = cadenas[i][k]
            if v not in "SNA":
                continue
            c = Counter(anr[k])
            if partido[i] == "ANR":
                c[v] -= 1
            c = +c
            if not c:
                continue
            (m, n1), *resto = c.most_common(2) + [(None, -1)]
            if resto[0][1] == n1:
                continue   # empate: no hay una mayoría
            comun += 1
            igual += v == m
        if comun >= minimo:
            out[i] = (igual / comun, comun)
    return out, len(div), minimo


def mediana(xs):
    return float(np.median(xs)) if xs else None


def posicion(valores, partido):
    """Filas por partido (ANR, PLRA y los de al menos GRUPO_MIN integrantes; el resto en «Otros»), mediana de cada
    una y los «cruzados»: quien queda más cerca de la mediana de otra fila de partido que de la del suyo."""
    cuenta = Counter(partido[i] for i in valores)
    grupo = {i: (partido[i] if partido[i] in ("ANR", "PLRA") or cuenta[partido[i]] >= GRUPO_MIN else "Otros") for i in valores}
    nombres = sorted(set(grupo.values()), key=lambda g: (g == "Otros", g != "ANR", g != "PLRA", -cuenta.get(g, 0), g))
    filas = []
    for g in nombres:
        xs = [valores[i] for i in valores if grupo[i] == g]
        filas.append({"grupo": g, "partidos": sorted({partido[i] for i in valores if grupo[i] == g}), "integrantes": len(xs), "mediana": r4(mediana(xs))})
    med = {f["grupo"]: f["mediana"] for f in filas if f["grupo"] != "Otros"}
    cruzados = []
    for i, x in valores.items():
        g = grupo[i]
        if g == "Otros" or len(med) < 2:
            continue
        otro = min((h for h in med if h != g), key=lambda h: abs(x - med[h]))
        if abs(x - med[otro]) < abs(x - med[g]):
            cruzados.append({"id": int(i), "grupo": g, "cerca_de": otro})
    por_id = {int(i): x for i, x in valores.items()}
    cruzados.sort(key=lambda c: (c["grupo"], por_id[c["id"]]))
    return {"filas": filas, "grupo": {str(int(i)): g for i, g in grupo.items()}, "cruzados": cruzados}


def correlacion(a, b):
    comunes = [i for i in a if i in b]
    if len(comunes) < 3:
        return None
    return r4(float(np.corrcoef([a[i] for i in comunes], [b[i] for i in comunes])[0, 1]))


def mds(cadenas, idx, ids):
    """MDS clásico sobre votaciones divididas de idx. Devuelve dict o None si no hay datos suficientes."""
    X = np.array([[SIGNO.get(cadenas[i][k], np.nan) for k in idx] for i in ids], dtype=float)
    if X.size == 0:
        return None
    divididas = mascara_divididas(X)
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
        coin, n_div, minimo_coin = coincidencia_anr(cadenas, partido, idx, ids)
        val_anr = {i: c for i, (c, _) in coin.items()}
        val_mds = {i: float(d) for i, d in zip(mapa["ids"], mapa["d1"])}
        pos = {
            "correlacion": correlacion(val_anr, val_mds),
            "anr": {"divididas": n_div, "minimo_votos": minimo_coin,
                    "puntos": [{"id": int(i), "valor": r4(c), "n": n, "voto": r4(voto_pct(cadenas[i], idx))} for i, (c, n) in coin.items()],
                    **posicion(val_anr, partido)},
            "mds": {"divididas": mapa["divididas"], "minimo_votos": mapa["minimo"],
                    "puntos": [{"id": int(i), "valor": r4(v), "voto": r4(voto_pct(cadenas[i], idx))} for i, v in val_mds.items()],
                    **posicion(val_mds, partido)},
        }
        por_periodo[clave] = {
            "posicion": pos,
            "ausentismo": ausentismo(votaciones, cadenas, idx, ids),
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
    """Por ventana: dimensión 1 del MDS normalizada a −1..1 («mds») y coincidencia con la mayoría del ANR («anr»,
    con el mismo mínimo de votos que el MDS de esa ventana)."""
    salida_v, posiciones, pos_anr = [], defaultdict(dict), defaultdict(dict)
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
        for i, (c, _) in coincidencia_anr(cadenas, partido, idx, ids, res["minimo"])[0].items():
            pos_anr[i][clave] = r4(c)
    claves = [v["clave"] for v in salida_v]

    def series(pp):
        puntos, movimiento = {}, []
        for i, pos in pp.items():
            serie = [pos.get(c) for c in claves]
            puntos[str(int(i))] = serie
            presentes = [x for x in serie if x is not None]
            if len(presentes) >= 2:
                movimiento.append({"id": int(i), "rango": r4(max(presentes) - min(presentes)), "ventanas": len(presentes)})
        movimiento.sort(key=lambda x: (-x["rango"], x["id"]))
        return {"posiciones": puntos, "movimiento": movimiento}
    anr = series(pos_anr)
    anr["zonas"] = zonas(pos_anr, partido)
    return {"ventanas": salida_v, "mds": series(posiciones), "anr": anr}


def zonas(pos, partido):
    """Franjas de fondo de la animación «¿Cómo se lee?»: rango intercuartílico (P25–P75) de la coincidencia con la
    mayoría del ANR, de los legisladores del ANR y del resto, juntando todas las ventanas."""
    def iqr(xs):
        return [r4(np.percentile(xs, 25)), r4(np.percentile(xs, 75))] if xs else None
    anr = [v for i, s in pos.items() for v in s.values() if partido.get(i) == "ANR"]
    resto = [v for i, s in pos.items() for v in s.values() if partido.get(i) != "ANR"]
    return {"anr": iqr(anr), "resto": iqr(resto)}
