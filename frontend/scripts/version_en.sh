#!/bin/sh
# Arma la versión en inglés de la app compilada: la misma compilación sirve los dos idiomas, y la
# app elige el inglés cuando la URL termina en en/. Copia index.html a en/index.html con el idioma y
# el título en inglés (el base href es el mismo, así los archivos se siguen pidiendo a la raíz).
# Se corre después de ng build, con la carpeta de salida como argumento.
set -e
salida="${1:-dist/Frontend/browser}"
mkdir -p "$salida/en"
sed -e 's/<html lang="es"/<html lang="en"/' \
  -e 's|<title>La red que se apagó</title>|<title>The network that went dark</title>|' \
  "$salida/index.html" >"$salida/en/index.html"
ls "$salida/en"
