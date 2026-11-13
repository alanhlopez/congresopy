# Correcciones manuales a silver/

Cambios hechos a mano sobre los CSV de `silver/` que no salen de SILpy (o que corrigen lo que publica SILpy).
Cada uno con fecha, archivo, qué cambió y de dónde sale el dato. Después de cada corrección se vuelven a
correr `pipeline/analisis.py` y `pipeline/exportar_sitio.py`.

`legisladores.csv` de las dos cámaras ya tenía `nombre_corto` cargado a mano, y el de Diputados se armó
entero a mano desde la nómina de SILpy (ver README del prototipo).

| Fecha | Archivo | Cambio | Fuente |
|---|---|---|---|
| 2026-11-13 | `silver/senado/legisladores.csv` | Eduardo Nakayama (101358): `partido` IA → PLRA. La `bancada` queda como figura en SILpy («Liberal Independiente») hasta confirmar si también cambió. | Indicación del responsable del proyecto: volvió al PLRA en 2026. |
