import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { CargaDatos } from './datos';
import { ModeloReconectar } from './modelo-reconectar';

export type Herramienta = 'pintar' | 'borrar';

// El modelo de Reconectar, compartido entre el mapa, donde se edita, y el resumen del lado
// izquierdo. `versionGente` sube en cada cuadro de un trazo y `version` sólo al terminarlo o al
// deshacer, porque rearmar la red entera en cada cuadro traba.
@Injectable({ providedIn: 'root' })
export class Reconexion {
  private readonly carga = inject(CargaDatos);
  readonly modelo = signal<ModeloReconectar | null>(null);
  readonly version = signal(0);
  readonly versionGente = signal(0);
  readonly herramienta = signal<Herramienta>('pintar');

  readonly resumen = computed(() => {
    this.versionGente();
    return this.modelo()?.resumen() ?? null;
  });

  constructor() {
    effect(() => {
      const datos = this.carga.datos();
      if (datos !== null && this.modelo() === null) {
        this.modelo.set(new ModeloReconectar(datos));
      }
    });
  }

  empezarTrazo() {
    this.modelo()?.empezarTrazo(this.herramienta() === 'pintar');
  }

  // Pinta o borra las partes que toca el tramo nuevo y devuelve las que cambiaron.
  sumarAlTrazo(tramo: number[], radio: number): number[] {
    const modelo = this.modelo();
    if (modelo === null) {
      return [];
    }
    const nuevas = modelo.sumarAlTrazo(modelo.partesBajoTrazo(tramo, radio));
    if (nuevas.length > 0) {
      modelo.recalcular();
      this.versionGente.update((v) => v + 1);
    }
    return nuevas;
  }

  terminarTrazo() {
    this.modelo()?.terminarTrazo();
    this.version.update((v) => v + 1);
  }

  deshacer() {
    const modelo = this.modelo();
    if (modelo === null || modelo.ediciones.length === 0) {
      return;
    }
    modelo.deshacer();
    modelo.recalcular();
    this.version.update((v) => v + 1);
    this.versionGente.update((v) => v + 1);
  }
}
