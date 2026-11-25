#!/bin/sh
# Trae a public/datos los JSON que escribe el notebook 3_ en data/clean. Se puede correr desde
# cualquier carpeta, cada vez que el 3_ cambia data/clean.
set -e
frontend="$(cd "$(dirname "$0")/.." && pwd)"
origen="$frontend/../datasets_y_procesamiento_de_datos/data/clean"
mkdir -p "$frontend/public/datos"
cp "$origen"/*.json "$frontend/public/datos/"
ls "$frontend/public/datos"
