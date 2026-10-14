# Licencias

Este repositorio tiene partes con licencias distintas.

## Código

Los notebooks de `datasets_y_procesamiento_de_datos/` y el código de `frontend/` están bajo la
licencia MIT, en el archivo [LICENSE](LICENSE).

## Datos generados

Las tablas que generan los notebooks (`datasets_y_procesamiento_de_datos/data/pipeline/`,
`datasets_y_procesamiento_de_datos/data/clean/` y `frontend/public/datos/`) son una base de datos
derivada de OpenStreetMap. Por eso se publican bajo la
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/): se pueden usar,
copiar, modificar y redistribuir citando la fuente, y lo que se derive de ellas se comparte con la
misma licencia. Sus contenidos individuales están bajo la
[Database Contents License (DbCL) 1.0](https://opendatacommons.org/licenses/dbcl/1-0/).

Al usarlas hay que atribuir a este proyecto y a sus fuentes:

- © colaboradores de OpenStreetMap, ODbL ([openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)).
- Wikidata, CC0.
- Secretaría de Transporte de la Nación, IDE de Transporte.
- INDEC, radios censales de 1991 a 2022, CC BY 4.0.
- Instituto Geográfico Nacional (IGN).

Los archivos de `datasets_y_procesamiento_de_datos/data/raw/` son las fuentes tal como las publica
cada una, y siguen con su propia licencia.

## Imágenes

Las fotos de `frontend/public/fotos/` y los dibujos de `frontend/public/trenes/` son de autoría
propia, con todos los derechos reservados. Los mapas de terceros de las figuras
`frontend/public/metodologia/corredores_2026.webp` y `frontend/public/metodologia/mapa_2021.webp`
son de sus autores, enlazados en la página de metodología, y no quedan cubiertos por ninguna
licencia de este repositorio.

## De terceros

- La tipografía Courier Prime (`frontend/public/tipografia/`), bajo la SIL Open Font License 1.1:
  [licencias_de_terceros/Courier-Prime-OFL-1.1.txt](licencias_de_terceros/Courier-Prime-OFL-1.1.txt).
- Los íconos de Lucide (en `frontend/src/app/`), bajo la licencia ISC:
  [licencias_de_terceros/Lucide-ISC.txt](licencias_de_terceros/Lucide-ISC.txt).
- Las dependencias de npm y de Python se instalan aparte y traen sus propias licencias.
