# Fotos de la nómina de SILpy

Una foto por cámara y fecha (`S` Senado, `D` Diputados), parseada de `https://silpy.congreso.gov.py/web/legisladores`
(Senado) y `/web/legisladores/D/100536` (Diputados) con `pipeline/bancadas.py foto`. Los valores son los de SILpy,
sin correcciones manuales (esas están en `silver/{camara}/correcciones_legisladores.csv`).

Primeras fotos: `S/2026-10-21.csv` y `D/2026-10-22.csv` salen del `legisladores.csv` del prototipo
VotometroCongresoPy, armado desde la nómina de SILpy en esas fechas (el de Diputados, a mano). En Diputados esa
primera foto no tiene `cargo_bancada` ni `color`. Las fotos desde el 13/11/2026 salen directo de SILpy.
