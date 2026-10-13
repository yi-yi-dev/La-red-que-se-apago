import { Component, computed, inject } from '@angular/core';
import { CargaDatos } from './datos';
import { EstadoApp, opacidadEn } from './estado';

// La portada, en el checkpoint del principio: el título y cuánta vía con trenes de pasajeros se
// perdió desde su máximo y cuánta queda, con los mismos colores que esas dos redes en el mapa.
// Se va en el tramo que llega al primer año.
@Component({
  selector: 'app-portada',
  // El contenedor no recibe el puntero, así no tapa al gráfico; sólo la portada visible lo recibe.
  host: { class: 'pointer-events-none block @container' },
  template: `
    @if (cifras(); as c) {
      <div
        class="portada"
        [style.opacity]="opacidad()"
        [class.pointer-events-auto]="opacidad() >= 0.5"
      >
        <!-- El bloque mide lo que el título: el gancho no aporta ancho y se estira hasta él. -->
        <div class="bloque">
          <h1 class="titulo font-bold tracking-tight">La red<br />que se apagó</h1>
          <p class="gancho">
            Desde {{ c.anioPico }} se perdieron
            <b class="text-via-inactiva">{{ c.kmPerdidos }} km</b>
            de vías con trenes de pasajeros en la Argentina. Hoy quedan solo
            <b class="text-via-pasajeros">{{ c.kmHoy }} km</b>.
          </p>
        </div>
      </div>
    }
  `,
  styles: `
    /* La portada se centra en el alto que queda debajo del sello (--lado-sello), un poco hacia
       arriba, así nunca lo toca. En escritorio los tamaños son
       proporcionales al ancho del sector, con techo en los de una ventana de 1.300 px. */
    .portada {
      display: flex;
      min-height: 100%;
      flex-direction: column;
      justify-content: center;
      padding-top: var(--lado-sello, 0px);
      padding-bottom: 10%;
    }
    .bloque {
      width: max-content;
      max-width: 100%;
    }
    .gancho {
      width: 0;
      min-width: 100%;
    }
    .titulo {
      /* En el celular, lo justo para que "que se apagó" entre en un renglón del ancho de la vista. */
      font-size: clamp(2rem, 13cqw, 3.25rem);
      white-space: nowrap;
      line-height: 0.95;
    }
    .gancho {
      margin-top: 2rem;
      font-size: 1.375rem;
      line-height: 1.4;
    }
    @media (min-width: 1080px) {
      .titulo {
        font-size: clamp(3rem, 12.5cqw, 4.9rem);
      }
      .gancho {
        margin-top: 2.5cqw;
        font-size: clamp(1.25rem, 4.15cqw, 1.625rem);
      }
    }
  `,
})
export class Portada {
  private readonly carga = inject(CargaDatos);
  private readonly estado = inject(EstadoApp);

  protected readonly opacidad = computed(() => opacidadEn(this.estado.posicion(), 0));

  protected readonly cifras = computed(() => {
    const datos = this.carga.datos();
    if (datos === null) {
      return null;
    }
    const serie = datos.serie;
    let k = 0;
    for (let i = 0; i < serie.anio.length; i++) {
      if (serie.km_pasajeros[i] > serie.km_pasajeros[k]) {
        k = i;
      }
    }
    const hoy = serie.km_pasajeros[serie.anio.length - 1];
    return {
      anioPico: serie.anio[k],
      kmPerdidos: Math.round(serie.km_pasajeros[k] - hoy).toLocaleString('es-AR'),
      kmHoy: Math.round(hoy).toLocaleString('es-AR'),
    };
  });
}
