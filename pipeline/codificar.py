"""
Sugiere la dirección del Poder Ejecutivo en cada votación.

Uso: python3 pipeline/codificar.py S  |  python3 pipeline/codificar.py D
  Lee silver/{camara}/votacion.csv (y correcciones.csv, si existe)
  y escribe silver/{camara}/codificacion_sugerida.csv

Convención: dir_si = +1 votar SÍ es votar con el Ejecutivo; -1 es votar en contra.
confianza: alta / media / revisar / vacío (ver README).
Si ya revisaste la codificación a mano, guardala con otro nombre antes de correr esto.
"""
import csv
import re
import sys

import config

RE_OBJ = re.compile(r"objeci|SE OBJETA", re.I)
RE_RECHAZO = re.compile(r"\brechaz", re.I)
RE_ACEPTA = re.compile(r"\b(acept|aprob)", re.I)
RE_MENSAJE_PE = re.compile(r"MENSAJE[^,]{0,40}PODER EJECUTIVO|PODER EJECUTIVO[^,]{0,10}MENSAJE", re.I)
RE_APRUEBA_S = re.compile(r"(aprobaci[oó]n del (proyecto|acuerdo)|proyecto de ley( en general)?\.?$|acuerdo constitucional|pedido de acuerdo)", re.I)
RE_COMPLICADO = re.compile(r"rechaz|ratific|modific|reconsider|cap[ií]tulo|art[ií]culo", re.I)


def dir_mocion_objecion(texto):
    if not texto:
        return ""
    if RE_RECHAZO.search(texto):
        return -1
    if RE_ACEPTA.search(texto):
        return 1
    return ""


def codificar(r, camara):
    mocion = r["mocion"] or ""
    out = {"categoria": "otro", "dir_si": "", "dir_mocion_1": "", "dir_mocion_2": "",
           "dir_mocion_3": "", "confianza": "", "regla": ""}

    # ---- Vetos (objeciones del Poder Ejecutivo) ----
    if RE_OBJ.search(mocion) or RE_OBJ.search(r["mocion_1"] or ""):
        out["categoria"] = "objecion_pe"
        if r["tipo_votacion"] == "mociones":
            for n in (1, 2, 3):
                out[f"dir_mocion_{n}"] = dir_mocion_objecion(r[f"mocion_{n}"])
            out["confianza"], out["regla"] = "alta", "moción de rechazo de veto = -1"
        elif RE_RECHAZO.search(mocion) and not re.search(r"SE OBJETA", mocion):
            out["dir_si"], out["confianza"], out["regla"] = -1, "alta", "SÍ al rechazo del veto = contra el PE"
        elif camara == "D" and re.search(r"SE OBJETA", mocion, re.I):
            # En Diputados se vota el decreto de objeción: SÍ = aceptar el veto.
            # Verificado: en las 52 votaciones con observación explícita, SÍ ganó ⇔ "se acepta".
            out["dir_si"], out["confianza"], out["regla"] = 1, "alta", "Diputados: se vota el decreto; SÍ = acepta el veto"
        else:
            # Votación "sobre la objeción": la redacción no dice qué significa SÍ.
            # Para rechazar un veto hace falta mayoría absoluta (Senado 23, Diputados 41).
            # Si el resultado sólo es compatible con una lectura, se usa esa (confianza alta).
            out["dir_si"], out["confianza"], out["regla"] = 1, "media", "SÍ a la objeción = acepta el veto (supuesto)"
            mayoria = 23 if camara == "S" else 41
            obs = (r["observacion"] or "").lower()
            si, no = int(float(r["total_si"] or 0)), int(float(r["total_no"] or 0))
            if "rechaza" in obs and si >= mayoria:
                out["dir_si"], out["confianza"], out["regla"] = -1, "alta", f"se rechazó el veto con {si} votos SÍ: SÍ = rechazar"
            elif "rechaza" in obs and no >= mayoria:
                out["dir_si"], out["confianza"], out["regla"] = 1, "alta", f"se rechazó el veto con {no} votos NO: SÍ = aceptar"
            elif "acepta" in obs and si >= mayoria:
                out["dir_si"], out["confianza"], out["regla"] = 1, "alta", f"se aceptó el veto con {si} votos SÍ: SÍ = aceptar"
        return out

    # ---- Mensajes del Poder Ejecutivo ----
    if RE_MENSAJE_PE.search(r["acapite"] or ""):
        out["categoria"] = "mensaje_pe"
        if r["tipo_votacion"] != "si_no":
            out["confianza"], out["regla"] = "revisar", "mensaje del PE votado entre mociones"
            return out
        if camara == "S":
            if RE_APRUEBA_S.search(mocion.strip()) and not RE_COMPLICADO.search(mocion):
                out["dir_si"], out["confianza"], out["regla"] = 1, "alta", "SÍ a aprobar un mensaje del PE"
            else:
                out["confianza"], out["regla"] = "revisar", "mensaje del PE: dirección depende del contenido"
        else:
            sin_comillas = re.sub(r"“.*?”|\".*?\"", "", mocion)
            si_txt = re.search(r"\(S[ií]\)\s*([^()]+)", sin_comillas)
            if si_txt and re.match(r"aprobaci[oó]n", si_txt.group(1).strip(), re.I):
                out["dir_si"], out["confianza"], out["regla"] = 1, "alta", "(Sí) Aprobación de un mensaje del PE"
            elif not si_txt and re.match(r"\W*(consideraci[oó]n del )?proyecto de ley", sin_comillas.strip(), re.I) \
                    and not RE_COMPLICADO.search(sin_comillas):
                out["dir_si"], out["confianza"], out["regla"] = 1, "media", "consideración de un mensaje del PE; se asume SÍ = aprobar"
            else:
                out["confianza"], out["regla"] = "revisar", "mensaje del PE: dirección depende del contenido"
    return out


def main():
    camara = sys.argv[1].upper()
    carpeta = config.silver_dir(camara)
    votaciones = list(csv.DictReader(open(f"{carpeta}/votacion.csv", encoding="utf-8")))
    campos = ["id_votacion", "sesion", "expediente", "tipo_proyecto", "categoria",
              "dir_si", "dir_mocion_1", "dir_mocion_2", "dir_mocion_3", "confianza", "regla",
              "mocion", "tipo_votacion", "mocion_1", "mocion_2", "mocion_3",
              "resultado", "observacion", "total_si", "total_no", "total_ausente", "total_no_vota",
              "acapite", "nota"]
    filas = []
    for r in votaciones:
        f = {k: r.get(k, "") for k in campos}
        f.update(codificar(r, camara))
        f["acapite"] = (r["acapite"] or "")[:400]
        f["nota"] = ""
        filas.append(f)
    # Correcciones manuales: silver/{camara}/correcciones.csv con columnas
    # id_votacion, dir_si, dir_mocion_1, dir_mocion_2, dir_mocion_3, confianza, nota
    # Lo que pongas ahí pisa la sugerencia automática y sobrevive a cada corrida.
    try:
        corr = {r["id_votacion"]: r for r in csv.DictReader(open(f"{carpeta}/correcciones.csv", encoding="utf-8-sig"))}
    except FileNotFoundError:
        corr = {}
    for f in filas:
        c = corr.get(f["id_votacion"])
        if c:
            for k in ("dir_si", "dir_mocion_1", "dir_mocion_2", "dir_mocion_3", "confianza", "nota"):
                if c.get(k, "") != "":
                    f[k] = c[k]
            f["regla"] = "corrección manual"
    orden = {"objecion_pe": 0, "mensaje_pe": 1, "otro": 2}
    filas.sort(key=lambda f: (orden[f["categoria"]], int(f["id_votacion"])))
    with open(f"{carpeta}/codificacion_sugerida.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=campos)
        w.writeheader()
        w.writerows(filas)
    from collections import Counter
    for k, n in sorted(Counter((f["categoria"], f["confianza"] or "sin codificar") for f in filas).items()):
        print(f"{k[0]:12} {k[1]:14} {n}")


if __name__ == "__main__":
    main()
