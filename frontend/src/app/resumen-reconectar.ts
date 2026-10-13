import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CHECKPOINTS, EstadoApp, opacidadDesde, opacidadHasta } from './estado';
import { Reconexion } from './reconexion';

const INDICE_RECONECTAR = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'reconectar');
// ms: en cada cuadro un número recorre una parte de lo que le falta, y en ese tiempo el 63 %. Así sigue
// al trazo en vivo y frena al acercarse al valor real.
const TAU_PERSECUCION = 150;
const DT_MAXIMO = 100; // ms: con cuadros más largos que esto la animación se estira en vez de saltar
const LLEGADA = 0.5; // km o personas: más cerca que esto, el número ya es el real

function km(valor: number): string {
  return Math.round(valor).toLocaleString('es-AR');
}

// Del lado izquierdo, en Reconectar: la invitación y, a medida que el usuario edita el mapa, qué hizo
// y cuánta gente gana un tren de pasajeros cerca.
@Component({
  selector: 'app-resumen-reconectar',
  host: { class: 'pointer-events-none block @container' },
  template: `
    <div
      class="flex size-full flex-col justify-center-safe select-text"
      [style.opacity]="opacidad()"
      [class.pointer-events-auto]="opacidad() >= 0.5"
    >
      <!-- Un bloque común para que el título y el texto rodeen al sello. -->
      <div>
        <div class="hueco-sello"></div>
        <h2 class="estampado font-bold">Reconectá la Argentina</h2>
        <p class="texto">
          Pintá en el mapa las vías naranjas, que hoy solo llevan carga, y las rojas, que no tienen
          trenes, para que vuelvan a llevar pasajeros.
        </p>
        @if (resumen()) {
          <!-- Un boleto con su talón: a la izquierda los km pintados, a la derecha la gente. -->
          <div class="boleto">
            <div class="cuentas">
              <span>Carga que suma pasajeros</span>
              <b>{{ km(mostrado().kmMixtos) }} km</b>
              <span class="mt-3">Vías reactivadas</span>
              <b>{{ km(mostrado().kmReactivados) }} km</b>
            </div>
            <div class="troquel"></div>
            <div class="ganancia">
              <b class="numero"
                >{{ cifra() }} <span class="unidad">{{ unidad() }}</span></b
              >
              <span>que hoy no tienen un tren de pasajeros cerca pasarían a tenerlo.</span>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .hueco-sello {
      float: right;
      width: calc(var(--lado-sello, 0px) + var(--aire-sello, 0px));
      height: var(--lado-sello, 0px);
      shape-outside: circle(50% at 60% 50%);
    }
    /* Un bloque propio que se angosta al lado del sello y, si no entra, parte el título. */
    .estampado {
      display: flow-root;
      width: fit-content;
      padding: 0.1em 0.5em;
      border: 2.5px solid var(--color-violeta);
      outline: 1px solid var(--color-violeta);
      outline-offset: 2px;
      color: var(--color-violeta);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      rotate: -2deg;
      opacity: 0.85;
      font-size: 1.375rem;
    }
    .texto {
      margin-top: 1.25rem;
      font-size: 1.125rem;
      line-height: 1.6;
    }
    /* El cartón oscurecido del talón, transparente para que se vea el papel, con un borde suave. */
    .boleto {
      clear: both;
      margin-top: 1.5rem;
      display: grid;
      grid-template-columns: 1fr auto 1.3fr;
      gap: 1.25rem;
      padding: 1rem 1.25rem;
      background: rgb(215 201 181 / 0.35);
      border: 1px solid rgb(43 43 43 / 0.3);
      border-radius: 3px;
      font-size: 1.125rem;
      line-height: 1.35;
      position: relative;
    }
    /* Una muesca con borde en el medio de cada costado, como las fichas de los gráficos. Tapan el
       borde del talón con el cartón de la página. */
    .boleto::before,
    .boleto::after {
      content: '';
      position: absolute;
      top: 50%;
      width: 8px;
      height: 16px;
      translate: 0 -50%;
      background: var(--color-carton);
      border: 1px solid rgb(43 43 43 / 0.3);
    }
    .boleto::before {
      left: -1px;
      border-left: none;
      border-radius: 0 8px 8px 0;
    }
    .boleto::after {
      right: -1px;
      border-right: none;
      border-radius: 8px 0 0 8px;
    }
    .cuentas {
      display: flex;
      flex-direction: column;
      justify-content: center;
      font-size: 0.85em;
    }
    .cuentas b {
      font-size: 1.4em;
      white-space: nowrap;
    }
    /* La perforación llega a los bordes y en cada punta tiene una muesca. */
    .troquel {
      position: relative;
      margin: -1rem 0;
      border-left: 2px dashed rgb(43 43 43 / 0.3);
    }
    .troquel::before,
    .troquel::after {
      content: '';
      position: absolute;
      left: -9px;
      width: 16px;
      height: 8px;
      background: var(--color-carton);
      border: 1px solid rgb(43 43 43 / 0.3);
    }
    .troquel::before {
      top: -1px;
      border-top: none;
      border-radius: 0 0 8px 8px;
    }
    .troquel::after {
      bottom: -1px;
      border-bottom: none;
      border-radius: 8px 8px 0 0;
    }
    .ganancia {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0.4rem;
      font-size: 0.85em;
    }
    .numero {
      color: var(--color-via-pasajeros);
      font-size: 3rem;
      line-height: 1;
    }
    /* La unidad va al lado de la cifra; si no entra, abajo y pegada. */
    .numero {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: 0.25em;
    }
    .unidad {
      font-size: 0.4em;
      line-height: 1.15;
    }
    /* En escritorio, proporcional al ancho del sector, con techo en los de una ventana de 1.300 px. */
    @media (min-width: 1080px) {
      .estampado {
        font-size: clamp(1.25rem, 4cqw, 1.5625rem);
      }
      .texto,
      .boleto {
        font-size: clamp(0.9375rem, 3cqw, 1.1875rem);
        max-width: 72cqw;
      }
      .numero {
        font-size: clamp(2.5rem, 10cqw, 4rem);
      }
    }
  `,
})
export class ResumenReconectar {
  private readonly estado = inject(EstadoApp);
  private readonly reconexion = inject(Reconexion);
  protected readonly km = km;
  protected readonly resumen = this.reconexion.resumen;

  // Sólo en Reconectar: Fin queda libre.
  protected readonly opacidad = computed(() =>
    Math.min(
      opacidadDesde(this.estado.posicion(), INDICE_RECONECTAR),
      opacidadHasta(this.estado.posicion(), INDICE_RECONECTAR),
    ),
  );

  // Lo que muestra el boleto, que persigue al resumen real.
  protected readonly mostrado = signal({ kmMixtos: 0, kmReactivados: 0, personasQueGanan: 0 });
  private cuadroPedido = false;

  constructor() {
    effect(() => {
      if (this.resumen() !== null) {
        untracked(() => this.perseguir());
      }
    });
  }

  private perseguir() {
    if (this.cuadroPedido) {
      return;
    }
    this.cuadroPedido = true;
    let anterior = performance.now();
    const paso = (ahora: number) => {
      const avance = 1 - Math.exp(-Math.min(DT_MAXIMO, ahora - anterior) / TAU_PERSECUCION);
      anterior = ahora;
      const real = this.resumen()!;
      const antes = this.mostrado();
      const despues = { ...antes };
      let llego = true;
      for (const clave of ['kmMixtos', 'kmReactivados', 'personasQueGanan'] as const) {
        despues[clave] = antes[clave] + (real[clave] - antes[clave]) * avance;
        if (Math.abs(real[clave] - despues[clave]) < LLEGADA) {
          despues[clave] = real[clave];
        } else {
          llego = false;
        }
      }
      this.mostrado.set(despues);
      if (llego) {
        this.cuadroPedido = false;
      } else {
        requestAnimationFrame(paso);
      }
    };
    requestAnimationFrame(paso);
  }

  // La gente que gana el tren: en millones con un decimal desde el millón, si no, entera.
  protected readonly cifra = computed(() => {
    const personas = this.mostrado().personasQueGanan;
    if (personas >= 1e6) {
      return (personas / 1e6).toFixed(1).replace('.', ',');
    }
    return Math.round(personas).toLocaleString('es-AR');
  });
  protected readonly unidad = computed(() =>
    this.mostrado().personasQueGanan >= 1e6 ? 'millones de personas' : 'personas',
  );
}
