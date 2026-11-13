"""Rutas, constantes y User-Agent del pipeline, en un solo lugar.

Las rutas se calculan desde la raíz del repo, así que los scripts funcionan
desde cualquier directorio.

  bronze/silpy/{camara}/   HTML crudo de SILpy (fuera de git; nunca se vuelve a descargar)
  silver/{camara}/         CSV: el contrato de datos del proyecto
  salidas/votometro/       salidas de analisis.py (referencia de regresión)
"""
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PIPELINE = RAIZ / "pipeline"
BRONZE = RAIZ / "bronze" / "silpy"
SILVER = RAIZ / "silver"
# El test de regresión la redirige a un directorio temporal para no pisar la referencia.
SALIDAS = Path(os.environ.get("CONGRESOPY_SALIDAS", RAIZ / "salidas" / "votometro"))

CAMARAS = {"S": "senado", "D": "diputados"}
# IDs de período: compartidos por las dos cámaras.
PERIODOS = {100217: "2023-24", 100237: "2024-25", 100257: "2025-26", 100267: "2026-27"}

# --- SILpy ---
BASE = "https://silpy.congreso.gov.py/web"
DELAY = 1.5   # segundos entre requests. robots.txt de SILpy no autoriza automatización: no lo bajes.
CONTACTO = ""  # completar (email o URL del repo) antes de descargar nada
USER_AGENT = f"congresopy/0.1 (+contacto: {CONTACTO})" if CONTACTO else "congresopy/0.1"


def headers():
    """Headers para requests a SILpy. Sin contacto no se descarga nada."""
    if not CONTACTO:
        raise SystemExit("config.CONTACTO está vacío: completalo antes de hacer requests a SILpy "
                         "(los comandos que leen solo de bronze/ funcionan igual).")
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
