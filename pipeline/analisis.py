"""
Calcula los análisis de ambas cámaras y arma votometro.html.

Entradas (solo silver/, rutas en config.py):
  silver/senado/      voto.csv, votacion.csv, fechas.csv, legisladores.csv, codificacion_sugerida.csv
  silver/diputados/   ídem
  pipeline/dashboard_template.html

Uso: python3 pipeline/analisis.py
Salidas (salidas/votometro/): senado/puntos_ideales.csv, diputados/puntos_ideales.csv,
  dashboard_data.json, votometro.html
"""
import json
import warnings

import numpy as np
import pandas as pd

import config
from comun import CODIGO_VOTO, titulo_corto

warnings.simplefilter("ignore")

CAMARAS = config.CAMARAS   # carpetas de datos en silver/
INICIO_PENA = "2023-08-15"     # asunción de Santiago Peña: inicio del índice del Ejecutivo
MINORIA_MIN = 0.025            # votaciones con minoría < 2,5% no discriminan
FILTROS = {
    "leyes": ("Proyectos de ley", lambda t: t == "PROYECTO DE LEY"),
    "resto": ("Resoluciones, declaraciones, informes y otros", lambda t: t != "PROYECTO DE LEY"),
    "todas": ("Todas las votaciones", lambda t: True),
}
SIGNO = {"SI": 1, "NO": -1, "MOCIÓN 1": 1, "MOCIÓN 2": -1}
EMITIDOS = ["SI", "NO", "MOCIÓN 1", "MOCIÓN 2", "MOCIÓN 3"]


def grupo_fn(camara, L):
    def g(i):
        if i not in L.index:
            return "X"
        p, b = L.at[i, "partido"], str(L.at[i, "bancada"])
        if p == "ANR":
            es_a = b.endswith('(ANR) - "A"') if camara == "S" else "HONOR COLORADO" in b
            return "A" if es_a else "O"
        return "P" if p == "PLRA" else "X"
    return g


def coincidencias(X, min_comun=10):
    n = len(X)
    A = np.full((n, n), np.nan)
    for i in range(n):
        for j in range(i, n):
            ok = ~np.isnan(X[i]) & ~np.isnan(X[j])
            if ok.sum() >= min_comun:
                A[i, j] = A[j, i] = (X[i][ok] == X[j][ok]).mean()
    return A


def lista_votaciones(v, vt, cod):
    """Lista de votaciones (más reciente primero) y, por legislador, una cadena con su voto en cada una."""
    vt = vt.sort_values(["fecha", "id_votacion"], ascending=False)
    vetos = set(cod[cod.categoria == "objecion_pe"].id_votacion)
    votos = [dict(id=int(r.id_votacion), f=str(r.fecha.date()), t=titulo_corto(r.acapite),
                  m=" ".join(str(r.mocion or "").split())[:200], r=str(r.resultado or ""),
                  ley=r.tipo_proyecto == "PROYECTO DE LEY", veto=int(r.id_votacion) in vetos)
             for r in vt.itertuples()]
    pos = {d["id"]: k for k, d in enumerate(votos)}
    cadenas = {}
    for i, g in v.groupby("id_legislador"):
        c = ["-"] * len(votos)
        for r in g.itertuples():
            c[pos[r.id_votacion]] = CODIGO_VOTO.get(r.voto, "?")
        cadenas[int(i)] = "".join(c)
    return votos, cadenas


def num(x, k=100, r=1):
    return None if x is None or pd.isna(x) else round(float(x) * k, r)


def analizar(camara, v_all, vt_all, cod, L, filtro, sin_vetos=False):
    g = grupo_fn(camara, L)
    keep = set(vt_all[vt_all.tipo_proyecto.map(FILTROS[filtro][1])].id_votacion)
    if sin_vetos:   # vista alternativa: sin las votaciones sobre objeciones del Poder Ejecutivo
        keep -= set(cod[cod.categoria == "objecion_pe"].id_votacion)
    vt = vt_all[vt_all.id_votacion.isin(keep)]
    v = v_all[v_all.id_votacion.isin(keep)].copy()

    # 1. Puntos ideales
    M = v.assign(x=v.voto.map(SIGNO)).pivot_table(index="id_legislador", columns="id_votacion", values="x")
    minoria = M.apply(lambda c: min((c == 1).sum(), (c == -1).sum()) / max(c.notna().sum(), 1))
    M = M.loc[:, minoria >= MINORIA_MIN]
    n_inf = M.shape[1]
    min_votos = max(10, min(25, int(0.25 * n_inf)))
    M = M[M.notna().sum(axis=1) >= min_votos]
    A = coincidencias(M.values)
    A = np.where(np.isnan(A), np.nanmean(A), A)
    n = len(A)
    J = np.eye(n) - 1 / n
    B = -0.5 * J @ ((1 - A) ** 2) @ J
    w, V = np.linalg.eigh(B)
    o = w.argsort()[::-1]
    w, V = w[o], V[:, o]
    P = V[:, :2] * np.sqrt(np.clip(w[:2], 0, None))
    pi = pd.DataFrame(P, index=M.index, columns=["d1", "d2"])
    pi["g"] = [g(i) for i in pi.index]
    if pi[pi.g.isin(["A", "O"])].d1.mean() < pi[pi.g.isin(["P", "X"])].d1.mean():
        pi["d1"] *= -1
    var1 = float(w[0] / w[w > 0].sum())

    # 2. Ejecutivo
    c = cod[cod.confianza.isin(["alta", "media"])].set_index("id_votacion")

    def direccion(r):
        if r.id_votacion not in c.index:
            return np.nan
        k = c.loc[r.id_votacion]
        if r.voto == "SI":
            return k.dir_si
        if r.voto == "NO":
            return -k.dir_si if pd.notna(k.dir_si) else np.nan
        if r.voto.startswith("MOCIÓN"):
            return k.get("dir_mocion_" + r.voto[-1])
        return np.nan

    v["dir"] = v.apply(direccion, axis=1)
    pe = v[v.id_votacion.isin(c.index) & (v.fecha >= INICIO_PENA)]
    vetos = set(cod[cod.categoria == "objecion_pe"].id_votacion) & keep

    def indice(d):
        d2 = d[d.dir.notna()]
        # Ausencia en un veto: para rechazarlo hace falta mayoría absoluta de los miembros,
        # así que faltar ayuda mecánicamente a que el veto se mantenga (a favor del Ejecutivo).
        aus_veto = int((d.ausente & d.id_votacion.isin(vetos)).sum())
        den_pro = len(d2) + aus_veto
        return pd.Series({"ali": (d2.dir > 0).mean() if len(d2) else np.nan, "n": len(d2),
                          "ali_aus": (d.dir > 0).sum() / len(d) if len(d) else np.nan,
                          "ali_pro": ((d2.dir > 0).sum() + aus_veto) / den_pro if den_pro else np.nan})
    E = pe.groupby("id_legislador").apply(indice) if len(pe) else pd.DataFrame(columns=["ali", "n", "ali_aus"])
    pev = pe[pe.id_votacion.isin(vetos)]
    EV = pev.groupby("id_legislador").apply(indice) if len(pev) else pd.DataFrame(columns=["ali", "n", "ali_aus"])
    pem = pe[~pe.id_votacion.isin(vetos)]   # sólo mensajes del Poder Ejecutivo
    EM = pem.groupby("id_legislador").apply(indice) if len(pem) else pd.DataFrame(columns=["ali", "n", "ali_aus"])

    # 3. Coincidencia con la mayoría de la bancada A
    A_ids = [i for i in L.index if g(i) == "A"]
    cast = v[v.voto.isin(EMITIDOS)].copy()

    def mayoria(s):
        vc = s.value_counts()
        return vc.index[0] if vc.iloc[0] > len(s) / 2 else None
    may = cast[cast.id_legislador.isin(A_ids)].groupby("id_votacion").voto.agg(mayoria)
    cast["mayA"] = cast.id_votacion.map(may)
    cast = cast[cast.mayA.notna()]
    cast["conA"] = cast.voto == cast.mayA
    lealA = cast.groupby("id_legislador").conA.mean()
    cast["semestre"] = cast.fecha.dt.year.astype(str) + np.where(cast.fecha.dt.month <= 6, "-1", "-2")
    S = cast.groupby(["id_legislador", "semestre"]).conA.agg(["mean", "size"]).reset_index()

    # 4. Ausentismo
    aus_v = v[v.id_votacion.isin(vetos) & (v.fecha >= INICIO_PENA)].groupby("id_legislador").ausente.mean()
    aus_r = v[~v.id_votacion.isin(vetos)].groupby("id_legislador").ausente.mean()

    # 5. Matriz (todas las votaciones del filtro con Sí/No)
    M2 = v.assign(x=v.voto.map(SIGNO)).pivot_table(index="id_legislador", columns="id_votacion", values="x")
    # Orden por d1 con desempate determinístico: hay legisladores empatados en d1 que solo
    # difieren en el ~16.º decimal (ruido de numpy/BLAS), así que se redondea y se desempata por id.
    orden = list(pi.assign(_d1=pi.d1.round(10), _id=pi.index).sort_values(["_d1", "_id"]).index)
    H = coincidencias(M2.reindex(orden).values)

    part = v.groupby("id_legislador").emitido.mean()

    # 6. Ausencias mes a mes (no votó = ausente o, en el Senado, presente sin votar)
    v["mes"] = v.fecha.dt.strftime("%Y-%m")
    meses = sorted(v.mes.unique())
    AM = v.groupby(["id_legislador", "mes"]).ausente.agg(["mean", "size"])
    sen = []
    for i in sorted(set(v.id_legislador)):
        tot = v[v.id_legislador == i]
        sen.append(dict(
            id=int(i), d1=num(pi.d1.get(i), 1, 3), part=num(part.get(i)), nv=int(len(tot)),
            nemit=int(tot.emitido.sum()), ali=num(E.ali.get(i)) if len(E) else None,
            nali=int(E.n.get(i, 0)) if len(E) else 0, ali_aus=num(E.ali_aus.get(i)) if len(E) else None, ali_pro=num(E.ali_pro.get(i)) if len(E) and "ali_pro" in E else None,
            aliV=num(EV.ali.get(i)) if len(EV) else None, naliV=int(EV.n.get(i, 0)) if len(EV) else 0,
            aliV_aus=num(EV.ali_aus.get(i)) if len(EV) else None, aliV_pro=num(EV.ali_pro.get(i)) if len(EV) and "ali_pro" in EV else None,
            aliM=num(EM.ali.get(i)) if len(EM) else None, naliM=int(EM.n.get(i, 0)) if len(EM) else 0,
            aliM_aus=num(EM.ali_aus.get(i)) if len(EM) else None, aliM_pro=num(EM.ali_pro.get(i)) if len(EM) and "ali_pro" in EM else None,
            lealA=num(lealA.get(i)), ausV=num(aus_v.get(i)), ausR=num(aus_r.get(i)),
            am=[[round(AM.at[(i, m_), "mean"] * 100), int(AM.at[(i, m_), "size"])] if (i, m_) in AM.index else None for m_ in meses],
            serie={r.semestre: [round(r["mean"] * 100, 1), int(r["size"])] for _, r in S[S.id_legislador == i].iterrows()}))
    meta = dict(nvot=int(len(vt)), ninf=int(n_inf), nsen=int(n), var1=round(var1, 3), minvotos=min_votos,
                desde=str(vt.fecha.min().date()), hasta=str(vt.fecha.max().date()),
                npe=int(pe.id_votacion.nunique()), nvetos=int(len(vetos & set(pe.id_votacion))))
    return dict(sen=sen, sems=sorted(S.semestre.unique()), meses=meses, meta=meta,
                heat=dict(ids=[int(x) for x in orden], m=[[None if np.isnan(x) else round(x * 100) for x in row] for row in H])), pi


def main():
    out = {"camaras": {}, "filtros": {k: v[0] for k, v in FILTROS.items()}}
    for cam, carpeta in CAMARAS.items():
        silver = config.silver_dir(cam)
        v = pd.read_csv(silver / "voto.csv")
        vt = pd.read_csv(silver / "votacion.csv")
        f = pd.read_csv(silver / "fechas.csv", parse_dates=["fecha"])
        cod = pd.read_csv(silver / "codificacion_sugerida.csv", encoding="utf-8-sig")
        L = pd.read_csv(silver / "legisladores.csv").set_index("id_legislador")
        vt = vt.merge(f[["id_votacion", "fecha"]], on="id_votacion", how="left")
        assert vt.fecha.notna().all(), f"{carpeta}: hay votaciones sin fecha"
        v = v.merge(vt[["id_votacion", "fecha"]], on="id_votacion")
        v["emitido"] = ~v.voto.isin(["AUSENTE", "NO VOTA"])
        v["ausente"] = ~v.emitido
        g = grupo_fn(cam, L)
        personas = []
        for i in sorted(set(v.id_legislador)):
            personas.append(dict(
                id=int(i), nombre=L.at[i, "nombre"] if i in L.index else str(i),
                corto=(L.at[i, "nombre_corto"] if "nombre_corto" in L.columns and i in L.index and pd.notna(L.at[i, "nombre_corto"]) else (L.at[i, "nombre"] if i in L.index else str(i))),
                g=g(i), partido=L.at[i, "partido"] if i in L.index else "",
                bancada=str(L.at[i, "bancada"]) if i in L.index and pd.notna(L.at[i, "bancada"]) else "",
                estado=L.at[i, "estado"] if i in L.index else ""))
        vistas = {}
        for fk, sv in [(f, s) for f in FILTROS for s in (False, True)]:
            data, pi = analizar(cam, v, vt, cod, L, fk, sv)
            if sv:
                vistas[fk + "_sv"] = data
                continue
            vistas[fk] = data
            if fk == "leyes":
                config.salidas_dir(cam).mkdir(parents=True, exist_ok=True)
                pi.join(L[["nombre", "partido", "bancada", "estado"]]).to_csv(config.salidas_dir(cam) / "puntos_ideales.csv")
            m = data["meta"]
            print(f"{carpeta:10} {fk:6} votaciones {m['nvot']:4} · informativas {m['ninf']:4} · legisladores {m['nsen']:3} "
                  f"· dim1 {m['var1']:.2f} · Ejecutivo {m['npe']} ({m['nvetos']} vetos)")
        lv, cadenas = lista_votaciones(v, vt, cod)
        for p_ in personas:
            p_["vc"] = cadenas.get(p_["id"], "")
        out["camaras"][cam] = dict(
            votaciones=lv,
            nombre="Senado" if cam == "S" else "Diputados", personas=personas, vistas=vistas,
            grupoA='ANR bancada "A"' if cam == "S" else 'ANR "Honor Colorado"',
            sin_novota=bool((v.voto == "NO VOTA").sum() == 0))
    config.SALIDAS.mkdir(parents=True, exist_ok=True)
    json.dump(out, open(config.SALIDAS / "dashboard_data.json", "w", encoding="utf-8"), ensure_ascii=False)
    html = open(config.PIPELINE / "dashboard_template.html", encoding="utf-8").read().replace("__DATA__", json.dumps(out, ensure_ascii=False))
    open(config.SALIDAS / "votometro.html", "w", encoding="utf-8").write(html)
    print("Listo: dashboard_data.json, votometro.html")


if __name__ == "__main__":
    main()
