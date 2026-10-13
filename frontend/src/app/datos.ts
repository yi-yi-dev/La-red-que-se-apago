import { Injectable, signal } from '@angular/core';

// Los archivos que escribe el pipeline 3_ de DataWrangling, tal como los describe su primera
// sección. Coordenadas y distancias en hectómetros de EPSG:5346; las líneas vienen como
// [x0, y0, dx1, dy1, ...] y acá se pasan a [x0, y0, x1, y1, ...].

export interface Datos {
  meta: {
    alcance: number;
    celda_grilla: number;
    atribucion: string[];
  };
  vias: {
    categoria: number[];
    alta: number[];
    fin_pasajeros: (number | null)[];
    baja: (number | null)[];
    km: number[]; // el largo declarado por el IDE, o el medido en la vía de OSM
    estaciones: number[][];
    xy: number[][];
  };
  estaciones: { x: number[]; y: number[]; nivel: number[] };
  poblacion: { x: number[]; y: number[]; pob: number[]; dep: number[]; nivel: number[] };
  regiones: {
    departamentos: { codigo: string[]; x: number[]; y: number[] };
    provincias: { codigo: string[]; nombre: string[] };
  };
  mapa_base: { anillos: number[][] };
  serie: {
    anio: number[];
    cerradas: (number | null)[];
    km_pasajeros: number[];
    km_carga: number[];
    km_inactiva: number[];
    km_levantada: number[];
  };
  censos: { censo: number[]; personas: number[][] };
  censos_departamentos: {
    departamentos: { codigo: string[]; x: number[]; y: number[] };
    personas: number[][][]; // [censo][categoría][departamento]
  };
}

const ARCHIVOS = [
  'meta',
  'vias',
  'estaciones',
  'poblacion',
  'regiones',
  'mapa_base',
  'serie',
  'censos',
  'censos_departamentos',
];
const CARPETA = 'datos/'; // public/datos, que llena scripts/copiar_datos.sh

function deshacerDiferencias(xy: number[]): number[] {
  const absolutas = xy.slice();
  for (let k = 2; k < absolutas.length; k++) {
    absolutas[k] += absolutas[k - 2];
  }
  return absolutas;
}

@Injectable({ providedIn: 'root' })
export class CargaDatos {
  readonly datos = signal<Datos | null>(null); // null mientras se bajan

  constructor() {
    this.cargar();
  }

  // Los archivos se piden todos juntos: de a uno, cada uno esperaba la latencia del anterior.
  private async cargar() {
    const pedidos = [];
    for (const archivo of ARCHIVOS) {
      pedidos.push(fetch(`${CARPETA}${archivo}.json`).then((respuesta) => respuesta.json()));
    }
    const respuestas = await Promise.all(pedidos);
    const crudo: Record<string, any> = {};
    for (let i = 0; i < ARCHIVOS.length; i++) {
      crudo[ARCHIVOS[i]] = respuestas[i];
    }
    crudo['vias'].xy = crudo['vias'].xy.map(deshacerDiferencias);
    crudo['mapa_base'].anillos = crudo['mapa_base'].anillos.map(deshacerDiferencias);
    this.datos.set(crudo as Datos);
  }
}
