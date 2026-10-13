import { computed, Injectable, signal } from '@angular/core';

export interface Checkpoint {
  id: string;
  etiqueta: string;
  anio: number | null;
  duracionMs: number; // lo que tarda el tramo que sale de este checkpoint
}

export const CHECKPOINTS: Checkpoint[] = [
  { id: 'presentacion', etiqueta: 'Inicio', anio: null, duracionMs: 2000 },
  { id: '1857', etiqueta: '1857', anio: 1857, duracionMs: 3000 },
  { id: '1907', etiqueta: '1907', anio: 1907, duracionMs: 2000 },
  { id: '1955', etiqueta: '1955', anio: 1955, duracionMs: 900 }, // el máximo de vía con trenes de pasajeros
  { id: '1961', etiqueta: '1961', anio: 1961, duracionMs: 2500 },
  { id: '1977', etiqueta: '1977', anio: 1977, duracionMs: 2500 },
  { id: '1993', etiqueta: '1993', anio: 1993, duracionMs: 3000 },
  { id: 'actualidad', etiqueta: 'Actualidad', anio: 2025, duracionMs: 2500 },
  { id: 'gente', etiqueta: 'La gente', anio: null, duracionMs: 6000 }, // la gente de cada censo y su acceso al tren
  // La barra de 2022 se parte en las provincias: el tramo que llega acá es largo para que se lea.
  { id: 'provincias', etiqueta: 'Provincias', anio: null, duracionMs: 2500 },
  // El usuario edita la red; el tramo que sale de acá hace zoom hasta donde se sacaron las fotos.
  { id: 'reconectar', etiqueta: 'Reconectar', anio: null, duracionMs: 3500 },
  { id: 'fin', etiqueta: 'Fin', anio: null, duracionMs: 0 },
];

// Todos los fundidos entre checkpoints usan esta ventana, así lo que aparece en un checkpoint
// aparece a la vez: en el último 30 % del tramo que llega a él, y se va en el primer 30 % del que
// sale.
export const ANCHO_FUNDIDO = 0.3; // fracción del tramo

// Lo que se ve sólo en el checkpoint `indice`.
export function opacidadEn(posicion: number, indice: number): number {
  return Math.max(0, 1 - Math.abs(posicion - indice) / ANCHO_FUNDIDO);
}

// Lo que se ve hasta el checkpoint `indice`.
export function opacidadHasta(posicion: number, indice: number): number {
  if (posicion <= indice) {
    return 1;
  }
  return Math.max(0, 1 - (posicion - indice) / ANCHO_FUNDIDO);
}

// Lo que se ve desde el checkpoint `indice` en adelante.
export function opacidadDesde(posicion: number, indice: number): number {
  if (posicion >= indice) {
    return 1;
  }
  return Math.max(0, 1 - (indice - posicion) / ANCHO_FUNDIDO);
}

// El último valor no nulo de `fuente`: así una ficha se desvanece mostrando lo que tenía.
export function ultimoNoNulo<T>(fuente: () => T | null) {
  let ultimo: T | null = null;
  return computed(() => {
    ultimo = fuente() ?? ultimo;
    return ultimo;
  });
}

// Estado global de la app. Todo sale de `posicion`, que va de 0 al último checkpoint: la parte
// entera es el tramo y la fracción cuánto se avanzó en él (2,5 es la mitad entre 1977 y 1993).
@Injectable({ providedIn: 'root' })
export class EstadoApp {
  readonly posicion = signal(0);

  // Qué categorías de vía se ven en el mapa y en el gráfico, por código de vias.json, y si se ven
  // las estaciones cerradas. Viven acá y no en los componentes para que sobrevivan si un
  // componente desaparece y vuelve a aparecer.
  readonly viasVisiblesMapa = signal([true, true, true, true]);
  readonly viasVisiblesGrafico = signal([true, true, true, true]);
  readonly cerradasVisibles = signal(true);
  // Qué categorías de censos.json se ven en las barras de los censos y en las de las provincias:
  // cada checkpoint recuerda las suyas.
  readonly categoriasVisiblesGente = signal([true, true, true, true]);
  readonly categoriasVisiblesProvincias = signal([true, true, true, true]);

  // La parte del gráfico de los censos que se eligió, que el mapa muestra por departamento: el
  // índice del censo y el de la categoría en censos.json. Null si no se eligió ninguna.
  readonly seleccionCenso = signal<{ censo: number; categoria: number } | null>(null);
  readonly yaEligioCenso = signal(false);
  // La categoría que el mapa de las provincias pinta, en el orden de censos.json.
  readonly categoriaProvincias = signal(0); // desde la primera elección, la indicación deja de latir
  // En Fin, la foto bajo el puntero y la que se tocó, por su archivo: el mapa marca dónde se sacó.
  readonly fotoApuntadaFin = signal<string | null>(null);
  readonly fotoElegidaFin = signal<string | null>(null);
  readonly fotoResaltadaFin = computed(() => this.fotoApuntadaFin() ?? this.fotoElegidaFin());

  readonly tramo = computed(() => Math.min(Math.floor(this.posicion()), CHECKPOINTS.length - 2));

  readonly progreso = computed(() => this.posicion() - this.tramo());

  // El checkpoint donde está parado el tren, o null si está entre dos.
  readonly checkpoint = computed(() => {
    const p = this.posicion();
    if (Number.isInteger(p)) {
      return CHECKPOINTS[p];
    }
    return null;
  });

  // Entre dos checkpoints con año, el año es continuo; en un tramo sin año no hay año.
  readonly anio = computed(() => {
    const desde = CHECKPOINTS[this.tramo()];
    const hasta = CHECKPOINTS[this.tramo() + 1];
    if (desde.anio === null || hasta.anio === null) {
      return this.checkpoint()?.anio ?? null;
    }
    return desde.anio + (hasta.anio - desde.anio) * this.progreso();
  });
}
