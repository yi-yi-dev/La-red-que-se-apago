#!/bin/sh
# Trae a public/datos los JSON que escribe el pipeline 3_ de DataWrangling. Se corre desde la
# carpeta de Frontend cada vez que el 3_ cambia data/clean.
mkdir -p public/datos
cp ../DataWrangling/data/clean/*.json public/datos/
ls public/datos
