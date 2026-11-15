"""Rutas, constantes y User-Agent del pipeline, en un solo lugar.

Las rutas se calculan desde la raíz del repo, así que los scripts funcionan
desde cualquier directorio.

  bronze/silpy/{camara}/   HTML crudo de SILpy (fuera de git; nunca se vuelve a descargar)
  silver/{camara}/         CSV: el contrato de datos del proyecto
  salidas/votometro/       salidas de analisis.py (referencia de regresión)
"""
import os
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PIPELINE = RAIZ / "pipeline"
BRONZE = RAIZ / "bronze" / "silpy"
# Redirigible para el test de regresión, que corre analisis.py sobre una copia congelada de silver/.
SILVER = Path(os.environ.get("CONGRESOPY_SILVER", RAIZ / "silver"))
# El test de regresión la redirige a un directorio temporal para no pisar la referencia.
SALIDAS = Path(os.environ.get("CONGRESOPY_SALIDAS", RAIZ / "salidas" / "votometro"))
# Datos que consume el sitio (los genera exportar_sitio.py desde silver/).
SITE_DATOS = RAIZ / "site" / "datos" / "congreso"

CAMARAS = {"S": "senado", "D": "diputados"}
# IDs de período: compartidos por las dos cámaras.
PERIODOS = {100217: "2023-24", 100237: "2024-25", 100257: "2025-26", 100267: "2026-27"}
# Período en curso: su listado de votaciones sigue creciendo. Es el único que se puede refrescar
# (silpy_votos.py --refrescar), y cada refresco se guarda como snapshot fechado en bronze/.
PERIODO_ABIERTO = 100267

# --- SILpy ---
BASE = "https://silpy.congreso.gov.py/web"
# Página Asistencia (exportar_sitio.exportar_asistencia): umbrales del análisis de presencia.
ASISTENCIA_MIN_POSIBLES = 50       # votaciones en el cargo para entrar en los gráficos
ASISTENCIA_UMBRAL_CONSENSO = 0.05  # consenso: la minoría (entre Sí y No) sacó menos de esto
ASISTENCIA_UMBRAL_RENIDA = 0.25    # reñida: la minoría sacó esto o más
ASISTENCIA_MIN_POR_TIPO = 15       # votaciones de consenso y reñidas que hacen falta para el gráfico de dispersión
ASISTENCIA_SALA_VACIA = 10         # votaciones con más ausentes que se listan

DELAY = 1.5   # segundos entre requests. robots.txt de SILpy no autoriza automatización: no lo bajes.
# El contacto no va en el código: sale de la variable de entorno CONGRESOPY_CONTACTO (ver .env.example).
CONTACTO = os.environ.get("CONGRESOPY_CONTACTO", "").strip()
# Solo ASCII: SILpy responde HTTP 400 a cualquier request con caracteres no ASCII en los headers
# (probado el 13/11/2026: «investigación cívica» -> 400; «investigacion civica» -> 200).
USER_AGENT = unicodedata.normalize("NFKD", (
    f"congresopy/0.1 (investigacion civica sin fines de lucro; contacto: {CONTACTO}; "
    "+https://github.com/alanhlopez/congresopy)")).encode("ascii", "ignore").decode("ascii")


def requerir_contacto():
    """Corta con un error claro si no hay contacto. Solo la llaman los comandos que descargan de SILpy."""
    if not CONTACTO:
        raise SystemExit(
            "Falta CONGRESOPY_CONTACTO: SILpy no autoriza la automatización y el User-Agent tiene que "
            "identificar a quién contactar.\n"
            "  Copiá .env.example a .env, completalo y cargalo:  set -a && . ./.env && set +a\n"
            "  (reparsear, parsear-local, codificar, analisis y los tests no lo necesitan).")


def headers():
    """Headers para requests a SILpy. Exige contacto: es la última barrera antes de cualquier request."""
    requerir_contacto()
    return {"User-Agent": USER_AGENT}


def camara_dir(camara: str) -> str:
    """'S'/'D' (o 'senado'/'diputados') -> nombre de carpeta."""
    c = camara.strip()
    if c.upper() in CAMARAS:
        return CAMARAS[c.upper()]
    if c.lower() in CAMARAS.values():
        return c.lower()
    raise SystemExit(f"Cámara desconocida: {camara!r} (usar S o D)")


def bronze_dir(camara: str) -> Path:
    return BRONZE / camara_dir(camara)


def silver_dir(camara: str) -> Path:
    return SILVER / camara_dir(camara)


def salidas_dir(camara: str | None = None) -> Path:
    return SALIDAS / camara_dir(camara) if camara else SALIDAS
