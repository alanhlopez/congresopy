"""Utilidades compartidas por analisis.py y exportar_sitio.py (solo biblioteca estándar)."""
import re

# Un carácter por voto, para las cadenas compactas legislador x votación.
# "-" = la votación cae fuera de su período en el cargo (no figura en esa votación).
CODIGO_VOTO = {"SI": "S", "NO": "N", "ABSTENCIÓN/BLANCO": "A", "AUSENTE": "X", "NO VOTA": "V",
               "MOCIÓN 1": "1", "MOCIÓN 2": "2", "MOCIÓN 3": "3"}


def titulo_corto(acapite, largo=260):
    """Texto entre comillas del acápite (el nombre del proyecto); si no hay, el acápite entero."""
    a = " ".join(str(acapite or "").split())
    m = re.search(r"[“\"](.+?)[”\"]", a)
    t = m.group(1) if m and len(m.group(1)) > 15 else a
    return t if len(t) <= largo else t[:largo].rsplit(" ", 1)[0] + "…"
