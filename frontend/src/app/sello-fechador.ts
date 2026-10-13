import { Component, computed, inject } from '@angular/core';
import { CHECKPOINTS, EstadoApp } from './estado';

const ANCHO_MAXIMO_TEXTO = 66; // en unidades del sello (mide 100): un nombre largo se comprime a esto
const ANCHO_CRUCE = 0.5; // fracción del tramo: dos nombres seguidos se cruzan justo en la mitad

// El sello fechador del boleto: el año de la escena o, en las secciones sin año, su nombre.
@Component({
  selector: 'app-sello-fechador',
  host: { class: 'block' },
  template: `
    <svg viewBox="0 0 100 100" class="sello size-full" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="3" />
      <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="1.2" />
      @for (capa of capas(); track capa.texto) {
        <text
          x="50"
          y="50"
          text-anchor="middle"
          dominant-baseline="central"
          font-weight="700"
          fill="currentColor"
          [attr.opacity]="capa.opacidad"
          [attr.font-size]="capa.esAnio ? 16 : 11"
          [attr.textLength]="capa.esAnio ? null : ANCHO_MAXIMO_TEXTO"
          lengthAdjust="spacingAndGlyphs"
        >
          {{ capa.texto }}
        </text>
      }
    </svg>
  `,
  styles: `
    .sello {
      color: var(--color-violeta);
      opacity: 0.3;
      mix-blend-mode: multiply;
      transform: rotate(10deg);
    }
  `,
})
export class SelloFechador {
  private readonly estado = inject(EstadoApp);
  protected readonly ANCHO_MAXIMO_TEXTO = ANCHO_MAXIMO_TEXTO;

  // Los textos que se ven a la vez, cada uno con su opacidad, así un cambio de texto se funde en
  // vez de saltar. Los nombres (Inicio, Actualidad) se ven cerca de su checkpoint; en un tramo con
  // años, el resto lo ocupa el año, que corre continuo; en un tramo sin años, la etiqueta del
  // checkpoint con año más cercano.
  protected readonly capas = computed(() => {
    const posicion = this.estado.posicion();
    const anio = this.estado.anio();
    const capas: { texto: string; esAnio: boolean; opacidad: number }[] = [];
    let opacidadNombres = 0;
    for (let i = 0; i < CHECKPOINTS.length; i++) {
      const etiqueta = CHECKPOINTS[i].etiqueta;
      const esAnio = !Number.isNaN(Number(etiqueta));
      if (esAnio && anio !== null) {
        continue;
      }
      const opacidad = Math.max(0, 1 - Math.abs(posicion - i) / ANCHO_CRUCE);
      if (opacidad > 0) {
        capas.push({ texto: etiqueta.toUpperCase(), esAnio, opacidad });
        if (!esAnio) {
          opacidadNombres += opacidad;
        }
      }
    }
    if (anio !== null && opacidadNombres < 1) {
      capas.push({ texto: String(Math.round(anio)), esAnio: true, opacidad: 1 - opacidadNombres });
    }
    return capas;
  });
}
