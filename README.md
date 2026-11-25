# La red que se apagó — *The network that went dark*

An interactive, data-driven story about the rise and fall of Argentina's railway network, from
the first train in 1857 to today, and about the people it left without a train.

**🏅 Honorable mention, [Contar con Datos](https://www.udesa.edu.ar/contar-con-datos) 2026.**
Made for Contar con Datos, the national data-storytelling contest organized by Universidad de
San Andrés (UdeSA) and the Subsecretaría de Ciencia y Tecnología.

<p align="center">
  <a href="https://yi-yi-dev.github.io/La-red-que-se-apago/en/"><b>Open the app (English)</b></a>
  &nbsp; | &nbsp;
  <a href="https://yi-yi-dev.github.io/La-red-que-se-apago/"><b>Abrir la app (español)</b></a>
</p>

https://github.com/user-attachments/assets/bc997c9e-6c83-4cbb-bb61-d152109293fb

[Watch on YouTube](YOUTUBE_URL)

Sources and methodology:
[English](https://yi-yi-dev.github.io/La-red-que-se-apago/en/metodologia.html) ·
[Español](https://yi-yi-dev.github.io/La-red-que-se-apago/metodologia.html)

## Data sources

| Source | License |
|---|---|
| [IDE de Transporte](https://ide.transporte.gob.ar/) (Secretaría de Transporte de la Nación) | Declared free and unrestricted access |
| [OpenStreetMap](https://www.openstreetmap.org/) | [ODbL](https://www.openstreetmap.org/copyright) |
| [Wikidata](https://www.wikidata.org/) | CC0 |
| [INDEC](https://datos.gob.ar/dataset/radios-censales-censos-1991-a-2022) | CC BY 4.0 |
| [IGN](https://www.ign.gob.ar/) | [IGN terms of use](https://www.ign.gob.ar/descargas/tyc1.html) |
| [ONDaT](https://ondat.c3t-utn.ar/?p=1263) (UTN) | Not stated |

## Running it locally

**Data pipeline** (Python 3.14): the notebooks in `datasets_y_procesamiento_de_datos/` are
meant to be run in order. Then copy their output into the app.

```bash
cd datasets_y_procesamiento_de_datos
pip install -r requirements.txt
jupyter lab                         # run the notebooks
sh ../frontend/scripts/copiar_datos.sh
```

**App** (Node.js 24):

```bash
cd frontend
npm ci
npm start   # http://localhost:4200 (Spanish) · http://localhost:4200/en/ (English)
```
