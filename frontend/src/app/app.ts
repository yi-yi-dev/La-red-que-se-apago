import { afterNextRender, Component, computed, ElementRef, inject, viewChild } from '@angular/core';
import { ANCHO_TALON, Diseno } from './diseno';
import { CHECKPOINTS, EstadoApp } from './estado';
import { Homenaje } from './homenaje';
import { MapaArgentina } from './mapa-argentina';
import { MapaFin } from './mapa-fin';
import { MapaReconectar } from './mapa-reconectar';
import { SelloFechador } from './sello-fechador';
import { Portada } from './portada';
import { Relato } from './relato';
import { ResumenReconectar } from './resumen-reconectar';
import { SerieCensos } from './serie-censos';
import { SerieRed } from './serie-red';
import { SliderVias } from './slider-vias';

const MARGEN_CONTENIDO = 0.03; // fracción del ancho entre el talón lateral y el contenido
const MARGEN_MAPA = 0.025; // fracción del ancho entre el mapa y el troquel o el filete
const ANCHO_BOLETO_SELLO_GRANDE = 1200; // px: desde este ancho de boleto el sello es grande
const LADO_SELLO = { celular: 112, chico: 128, grande: 176 }; // px; el del celular es el size-28 de la plantilla
const AIRE_SELLO = 24; // px entre el texto y el sello

const INDICE_GENTE = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'gente');

function ultimoAnioDeLosCheckpoints(): number | null {
  let ultimo: number | null = null;
  for (const checkpoint of CHECKPOINTS) {
    if (checkpoint.anio !== null) {
      ultimo = checkpoint.anio;
    }
  }
  return ultimo;
}

@Component({
  selector: 'app-root',
  imports: [
    SliderVias,
    MapaArgentina,
    MapaReconectar,
    MapaFin,
    Homenaje,
    SelloFechador,
    SerieRed,
    SerieCensos,
    Relato,
    Portada,
    ResumenReconectar,
  ],
  host: {
    // El recorte va acá y no en el boleto: las piezas del borde se salen unos px del boleto, y
    // recortarlas dentro del boleto arruina el filtro que las gasta.
    // Fija a la ventana: achicada, su caja sin escalar no hace scroll.
    // Alta como el área que se ve con la barra del navegador del celular a la vista: si la barra se
    // esconde, debajo queda mesa y nada se mueve.
    class: 'fixed top-0 left-0 block h-svh w-full overflow-hidden bg-mesa md:p-6',
    // Achicada, la app se dibuja con el alto necesario y una escala la lleva al tamaño de la ventana.
    // Es transform y no zoom: con zoom, Firefox estira los trazos de las vías.
    '[style.width.px]': 'diseno.escala() < 1 ? diseno.anchoVentana() / diseno.escala() : null',
    '[style.height.px]': 'diseno.escala() < 1 ? diseno.altoVentana() / diseno.escala() : null',
    '[style.transform]': 'diseno.escala() < 1 ? "scale(" + diseno.escala() + ")" : null',
  },
  template: `
    <!-- El filtro que gasta los bordes: desplaza cada píxel unos pocos px según un ruido. El ruido
         se suaviza antes, así el borde forma curvas y no escalones, y el resultado se desenfoca
         un píxel para que no se vean los dientes. Se aplica a cada pieza del borde y no a toda la
         pantalla, porque es caro: hay una copia por forma de pieza, con la región justa para que el
         desplazamiento pueda salirse unos px de una franja fina. -->
    <svg class="absolute size-0" aria-hidden="true">
      <filter id="gastado-horizontal" x="-5%" y="-150%" width="110%" height="400%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.06"
          numOctaves="2"
          seed="4"
          result="ruido"
        />
        <feGaussianBlur in="ruido" stdDeviation="2.5" result="ruidoSuave" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="ruidoSuave"
          scale="13"
          xChannelSelector="R"
          yChannelSelector="G"
        />
        <feGaussianBlur stdDeviation="1" />
      </filter>
      <filter id="gastado-vertical" x="-150%" y="-5%" width="400%" height="110%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.06"
          numOctaves="2"
          seed="4"
          result="ruido"
        />
        <feGaussianBlur in="ruido" stdDeviation="2.5" result="ruidoSuave" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="ruidoSuave"
          scale="13"
          xChannelSelector="R"
          yChannelSelector="G"
        />
        <feGaussianBlur stdDeviation="1" />
      </filter>
      <filter id="gastado-circulo" x="-25%" y="-25%" width="150%" height="150%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.06"
          numOctaves="2"
          seed="4"
          result="ruido"
        />
        <feGaussianBlur in="ruido" stdDeviation="2.5" result="ruidoSuave" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="ruidoSuave"
          scale="13"
          xChannelSelector="R"
          yChannelSelector="G"
        />
        <feGaussianBlur stdDeviation="1" />
      </filter>
    </svg>

    <!-- El boleto, apoyado sobre la mesa: las muescas son agujeros recortados con una máscara, así
         por ellos se ve la mesa y la sombra los rodea. La máscara también recorta lo que se sale del
         boleto; con overflow-hidden, Chrome recortaría las piezas gastadas antes de filtrarlas. -->
    <div
      #boleto
      class="boleto papel relative flex h-full flex-col bg-carton font-boleto text-tinta"
      [style.--x-troquel]="diseno.xTroquel() * 100 + '%'"
    >
      <main class="relative flex-1">
        <!-- El celular lleva el talón de arriba, el borde y las muescas de las esquinas; el resto de
             los acentos, sólo el escritorio. -->
        <div class="absolute inset-x-0 top-0 h-12 bg-talon/50 md:hidden">
          <div class="absolute inset-x-0 bottom-0 h-px bg-tinta/45"></div>
          <!-- Las dos vistas del celular, centradas entre el borde oscuro (12 px) y la línea de abajo. -->
          <div
            class="pestanas absolute top-[30px] left-1/2 flex -translate-x-1/2 -translate-y-1/2"
            role="tablist"
          >
            <button
              class="pestana"
              role="tab"
              [class.activa]="diseno.vistaCelular() === 'informacion'"
              [attr.aria-selected]="diseno.vistaCelular() === 'informacion'"
              (click)="diseno.vistaCelular.set('informacion')"
            >
              Información
            </button>
            <button
              class="pestana"
              role="tab"
              [class.activa]="diseno.vistaCelular() === 'mapa'"
              [attr.aria-selected]="diseno.vistaCelular() === 'mapa'"
              (click)="diseno.vistaCelular.set('mapa')"
            >
              Mapa
            </button>
          </div>
        </div>
        <div
          class="papel absolute inset-y-0 right-0 hidden bg-carton-mapa md:block"
          [style.left.%]="diseno.xTroquel() * 100"
        ></div>

        <div
          class="absolute inset-y-0 left-0 hidden bg-talon/50 md:block"
          [style.width.%]="ANCHO_TALON * 100"
        >
          <div class="absolute inset-y-0 right-0 w-0.5 bg-tinta/25"></div>
          <!-- Centrado entre el borde oscuro (18 px) y la línea del borde derecho del talón. -->
          <!-- Las tres partes del boleto: un punto entre las dos primeras y una línea punteada antes
               de los años, así los separadores no se repiten. -->
          <span
            class="absolute top-1/2 left-[calc(50%+8.5px)] flex -translate-x-1/2 -translate-y-1/2 -rotate-90 items-center gap-4 text-xs tracking-[0.3em] whitespace-nowrap uppercase opacity-60"
          >
            Boleto
            <span class="size-1.5 rounded-full bg-tinta"></span>
            Ida
            <span class="w-8 border-t-2 border-dotted border-tinta"></span>
            {{ primerAnio }} – {{ ultimoAnio }}
          </span>
        </div>
        <div
          class="troquel absolute inset-y-0 hidden -translate-x-1/2 md:block"
          [style.left.%]="diseno.xTroquel() * 100"
        ></div>
        <!-- El borde derecho, entre el filete y el canto, lleva una franja de color. -->
        <div
          class="absolute inset-y-0 right-0 hidden bg-oxido/45 md:block"
          [style.width.%]="ANCHO_TALON * 100"
        >
          <!-- Centrado entre el filete y el borde oscuro (18 px), y leído de arriba hacia abajo. -->
          <a
            class="absolute top-1/2 left-[calc(50%-9px)] -translate-x-1/2 -translate-y-1/2 text-xs font-bold tracking-[0.3em] whitespace-nowrap uppercase underline underline-offset-4 opacity-70 [writing-mode:vertical-rl] hover:opacity-100"
            href="metodologia.html"
            target="_blank"
            rel="noopener"
            >Fuentes y Metodología</a
          >
        </div>
        <!-- El filete queda tan lejos del borde derecho como la línea del talón del izquierdo. -->
        <div
          class="absolute inset-y-0 hidden w-[7px] border-x border-l-2 border-tinta/50 md:block"
          [style.right.%]="ANCHO_TALON * 100"
        ></div>

        <!-- En escritorio, el mapa va en el panel derecho. En el celular ocupa el área grande y está
             siempre dibujado: la información queda a su izquierda, fuera de la pantalla, y la
             pestaña corre las dos un ancho de pantalla. Abajo deja 48 px para el tren. -->
        <app-mapa-argentina
          class="lamina absolute top-[6%] bottom-12 max-md:inset-x-4 max-md:top-16"
          [style.translate]="corrimientoMapa()"
          [attr.inert]="corrimientoMapa() === null ? null : ''"
          [style.left.%]="diseno.esCelular() ? null : (diseno.xTroquel() + MARGEN_MAPA) * 100"
          [style.right.%]="diseno.esCelular() ? null : (ANCHO_TALON + MARGEN_MAPA) * 100"
        />
        <!-- La capa de Reconectar, del mismo tamaño y en el mismo lugar que el mapa. -->
        <app-mapa-reconectar
          class="lamina absolute top-[6%] bottom-12 max-md:inset-x-4 max-md:top-16"
          [style.translate]="corrimientoMapa()"
          [attr.inert]="corrimientoMapa() === null ? null : ''"
          [style.left.%]="diseno.esCelular() ? null : (diseno.xTroquel() + MARGEN_MAPA) * 100"
          [style.right.%]="diseno.esCelular() ? null : (ANCHO_TALON + MARGEN_MAPA) * 100"
        />
        <!-- El mapa de Fin, también en el mismo lugar: arranca con el mismo encuadre y hace zoom. -->
        <app-mapa-fin
          class="lamina absolute top-[6%] bottom-12 max-md:inset-x-4 max-md:top-16"
          [style.translate]="corrimientoMapa()"
          [attr.inert]="corrimientoMapa() === null ? null : ''"
          [style.left.%]="diseno.esCelular() ? null : (diseno.xTroquel() + MARGEN_MAPA) * 100"
          [style.right.%]="diseno.esCelular() ? null : (ANCHO_TALON + MARGEN_MAPA) * 100"
        />

        <!-- El sello, arriba a la derecha del sector izquierdo (en el celular, de la vista de
             información). -->
        <app-sello-fechador
          class="lamina absolute top-[5%] max-md:top-16 max-md:right-4 max-md:size-28"
          [style.translate]="corrimientoInformacion()"
          [attr.inert]="corrimientoInformacion() === null ? null : ''"
          [style.right.%]="diseno.esCelular() ? null : (1 - diseno.xTroquel() + MARGEN_MAPA) * 100"
          [style.width.px]="diseno.esCelular() ? null : ladoSello()"
          [style.height.px]="diseno.esCelular() ? null : ladoSello()"
        />

        <!-- La serie de km y estaciones cerradas, en la mitad de abajo del sector izquierdo. En
             escritorio arranca en el borde del boleto, así su eje x se calcula con las mismas
             fracciones que los checkpoints del slider; abajo deja pasar al tren. -->
        <app-serie-red
          class="lamina absolute top-[40%] bottom-0 left-0 max-md:inset-x-10 max-md:top-auto max-md:bottom-12 max-md:h-[42%]"
          [style.width.%]="diseno.esCelular() ? null : diseno.xTroquel() * 100"
          [style.translate]="corrimientoInformacion()"
          [attr.inert]="corrimientoInformacion() === null ? null : ''"
        />
        <!-- En el checkpoint de la gente, el gráfico de los censos toma el mismo lugar; en el celular,
             con más alto, porque su texto es corto. -->
        <app-serie-censos
          class="lamina absolute top-[40%] bottom-0 left-0 max-md:inset-x-10 max-md:top-auto max-md:bottom-12 max-md:h-[60%]"
          [style.width.%]="diseno.esCelular() ? null : diseno.xTroquel() * 100"
          [style.translate]="corrimientoInformacion()"
          [attr.inert]="corrimientoInformacion() === null ? null : ''"
        />

        <!-- En escritorio, el texto de cada checkpoint ocupa el 40 % de arriba del sector izquierdo
             y el gráfico el 60 % de abajo; el texto arranca en el mismo margen que el del gráfico,
             rodea al sello (--lado-sello y --aire-sello) y puede seguir por debajo de él. -->
        <app-portada
          class="lamina absolute top-[6%] bottom-14 max-md:inset-x-8 max-md:top-16 max-md:bottom-14"
          [style.translate]="corrimientoInformacion()"
          [attr.inert]="corrimientoInformacion() === null ? null : ''"
          [style.left.%]="diseno.esCelular() ? null : izquierdaContenido"
          [style.right.%]="diseno.esCelular() ? null : (1 - diseno.xTroquel() + MARGEN_MAPA) * 100"
          [style.--lado-sello]="ladoSello() + 'px'"
        />
        <app-relato
          class="lamina absolute top-0 bottom-[60%] max-md:inset-x-10 max-md:top-16 max-md:bottom-[calc(42%+3.5rem)]"
          [style.translate]="corrimientoInformacion()"
          [attr.inert]="corrimientoInformacion() === null ? null : ''"
          [style.left.px]="diseno.esCelular() ? null : diseno.bordeTextoSerie()"
          [style.right.%]="diseno.esCelular() ? null : (1 - diseno.xTroquel() + MARGEN_MAPA) * 100"
          [style.--lado-sello]="ladoSello() + 'px'"
          [style.--aire-sello]="AIRE_SELLO + 'px'"
          [style.bottom]="diseno.esCelular() && enGente() ? 'calc(60% + 3.5rem)' : null"
        />

        <!-- En Reconectar, el resumen ocupa todo el sector izquierdo, con el mismo margen que el texto
             de cada checkpoint. -->
        <app-resumen-reconectar
          class="lamina absolute top-0 bottom-28 max-md:inset-x-10 max-md:top-16 max-md:bottom-14"
          [style.translate]="corrimientoInformacion()"
          [attr.inert]="corrimientoInformacion() === null ? null : ''"
          [style.left.px]="diseno.esCelular() ? null : diseno.bordeTextoSerie()"
          [style.right.%]="diseno.esCelular() ? null : (1 - diseno.xTroquel() + MARGEN_MAPA) * 100"
          [style.--lado-sello]="ladoSello() + 'px'"
          [style.--aire-sello]="AIRE_SELLO + 'px'"
        />

        <!-- En Fin, la dedicatoria y las fotos, en el mismo lugar que el resumen de Reconectar. -->
        <app-homenaje
          class="lamina absolute top-0 bottom-28 max-md:inset-x-10 max-md:top-16 max-md:bottom-14"
          [style.translate]="corrimientoInformacion()"
          [attr.inert]="corrimientoInformacion() === null ? null : ''"
          [style.left.px]="diseno.esCelular() ? null : diseno.bordeTextoSerie()"
          [style.right.%]="diseno.esCelular() ? null : (1 - diseno.xTroquel() + MARGEN_MAPA) * 100"
          [style.--lado-sello]="ladoSello() + 'px'"
          [style.--aire-sello]="AIRE_SELLO + 'px'"
        />
      </main>
      <app-slider-vias />

      <!-- Con el celular acostado no hay alto para el mapa ni para el gráfico: se pide girarlo. -->
      <div class="girar papel fixed inset-0 z-50 place-items-center bg-carton px-[15%] text-center">
        <p class="text-xl leading-snug font-bold">Girá el teléfono para seguir el viaje</p>
      </div>

      <!-- Manchas de humedad que entran desde las esquinas. -->
      <div class="manchas pointer-events-none absolute inset-0 z-20"></div>

      <!-- El borde oscuro del boleto: franjas de 18 px (12 en el celular), gastadas, y alrededor de
           cada agujero un círculo de su radio más el borde. Los círculos no se gastan: desplazados,
           se les abría un hueco junto al agujero. Las piezas son negras y se superponen; la
           transparencia va en el contenedor, que se compone como una sola capa. -->
      <div class="pointer-events-none absolute inset-0 z-30 opacity-[0.07]">
        <div class="gastado-horizontal absolute inset-x-0 top-0 h-3 bg-black md:h-[18px]"></div>
        <div class="gastado-horizontal absolute inset-x-0 bottom-0 h-3 bg-black md:h-[18px]"></div>
        <div class="gastado-vertical absolute inset-y-0 left-0 w-3 bg-black md:w-[18px]"></div>
        <div class="gastado-vertical absolute inset-y-0 right-0 w-3 bg-black md:w-[18px]"></div>
        <div
          class="absolute -top-[40px] -left-[40px] size-[80px] rounded-full bg-black md:-top-[62px] md:-left-[62px] md:size-[124px]"
        ></div>
        <div
          class="absolute -top-[40px] -right-[40px] size-[80px] rounded-full bg-black md:-top-[62px] md:-right-[62px] md:size-[124px]"
        ></div>
        <div
          class="absolute -bottom-[40px] -left-[40px] size-[80px] rounded-full bg-black md:-bottom-[62px] md:-left-[62px] md:size-[124px]"
        ></div>
        <div
          class="absolute -right-[40px] -bottom-[40px] size-[80px] rounded-full bg-black md:-right-[62px] md:-bottom-[62px] md:size-[124px]"
        ></div>
        <div
          class="absolute -top-[50px] hidden size-[100px] -translate-x-1/2 rounded-full bg-black md:block"
          [style.left.%]="diseno.xTroquel() * 100"
        ></div>
        <div
          class="absolute -bottom-[50px] hidden size-[100px] -translate-x-1/2 rounded-full bg-black md:block"
          [style.left.%]="diseno.xTroquel() * 100"
        ></div>
      </div>

      <!-- El troquel sigue en el suelo, debajo de la vía (la vía ocupa sus primeros 12 px). -->
      <div
        class="troquel pointer-events-none absolute bottom-0 z-30 hidden h-[100px] -translate-x-1/2 md:block"
        [style.left.%]="diseno.xTroquel() * 100"
      ></div>

      <!-- El canto gastado: un contorno fino del color de la mesa, pasado por el mismo filtro, que se
           come el borde del papel y de los agujeros (3 px más que su radio). Las franjas salen 8 px
           del boleto (la máscara las recorta) para que el filtro no traiga transparencia al canto. -->
      <div class="pointer-events-none absolute inset-0 z-40">
        <div class="gastado-horizontal absolute -inset-x-2 -top-2 h-[13px] bg-mesa"></div>
        <div class="gastado-horizontal absolute -inset-x-2 -bottom-2 h-[13px] bg-mesa"></div>
        <div class="gastado-vertical absolute -inset-y-2 -left-2 w-[13px] bg-mesa"></div>
        <div class="gastado-vertical absolute -inset-y-2 -right-2 w-[13px] bg-mesa"></div>
        <div
          class="gastado-circulo absolute -top-[31px] -left-[31px] size-[62px] rounded-full bg-mesa md:-top-[47px] md:-left-[47px] md:size-[94px]"
        ></div>
        <div
          class="gastado-circulo absolute -top-[31px] -right-[31px] size-[62px] rounded-full bg-mesa md:-top-[47px] md:-right-[47px] md:size-[94px]"
        ></div>
        <div
          class="gastado-circulo absolute -bottom-[31px] -left-[31px] size-[62px] rounded-full bg-mesa md:-bottom-[47px] md:-left-[47px] md:size-[94px]"
        ></div>
        <div
          class="gastado-circulo absolute -right-[31px] -bottom-[31px] size-[62px] rounded-full bg-mesa md:-right-[47px] md:-bottom-[47px] md:size-[94px]"
        ></div>
        <div
          class="gastado-circulo absolute -top-[35px] hidden size-[70px] -translate-x-1/2 rounded-full bg-mesa md:block"
          [style.left.%]="diseno.xTroquel() * 100"
        ></div>
        <div
          class="gastado-circulo absolute -bottom-[35px] hidden size-[70px] -translate-x-1/2 rounded-full bg-mesa md:block"
          [style.left.%]="diseno.xTroquel() * 100"
        ></div>
      </div>
    </div>
  `,
  styles: `
    :host {
      filter: drop-shadow(0 18px 28px rgb(0 0 0 / 0.45));
      transform-origin: 0 0;
    }

    /* Los agujeros de las muescas: en las esquinas, 28 px de radio en el celular y 44 en
       escritorio; los dos del troquel, 32. La máscara se queda con lo que todas las capas dejan ver. */
    .boleto {
      --esquina: 28px;
      mask:
        radial-gradient(
          circle at 0 0,
          transparent var(--esquina),
          #000 calc(var(--esquina) + 0.5px)
        ),
        radial-gradient(
          circle at 100% 0,
          transparent var(--esquina),
          #000 calc(var(--esquina) + 0.5px)
        ),
        radial-gradient(
          circle at 0 100%,
          transparent var(--esquina),
          #000 calc(var(--esquina) + 0.5px)
        ),
        radial-gradient(
          circle at 100% 100%,
          transparent var(--esquina),
          #000 calc(var(--esquina) + 0.5px)
        );
      mask-composite: intersect;
    }
    /* 1080 px es el breakpoint md, redefinido en styles.css. */
    @media (min-width: 1080px) {
      .boleto {
        --esquina: 44px;
        --troquel: 32px;
        mask:
          radial-gradient(
            circle at 0 0,
            transparent var(--esquina),
            #000 calc(var(--esquina) + 0.5px)
          ),
          radial-gradient(
            circle at 100% 0,
            transparent var(--esquina),
            #000 calc(var(--esquina) + 0.5px)
          ),
          radial-gradient(
            circle at 0 100%,
            transparent var(--esquina),
            #000 calc(var(--esquina) + 0.5px)
          ),
          radial-gradient(
            circle at 100% 100%,
            transparent var(--esquina),
            #000 calc(var(--esquina) + 0.5px)
          ),
          radial-gradient(
            circle at var(--x-troquel) 0,
            transparent var(--troquel),
            #000 calc(var(--troquel) + 0.5px)
          ),
          radial-gradient(
            circle at var(--x-troquel) 100%,
            transparent var(--troquel),
            #000 calc(var(--troquel) + 0.5px)
          );
        mask-composite: intersect;
      }
    }

    .girar {
      display: none;
    }
    /* 500 px es ALTO_CELULAR_ACOSTADO, en diseno.ts. */
    @media (max-width: 1079px) and (orientation: landscape) and (max-height: 500px) {
      .girar {
        display: grid;
      }
    }

    /* El deslizamiento entre información y mapa en el celular; en escritorio no hay corrimiento. */
    .lamina {
      transition: translate 450ms ease-in-out;
    }
    @media (prefers-reduced-motion: reduce) {
      .lamina {
        transition: none;
      }
    }

    .gastado-horizontal {
      filter: url(#gastado-horizontal);
    }
    .gastado-vertical {
      filter: url(#gastado-vertical);
    }
    .gastado-circulo {
      filter: url(#gastado-circulo);
    }

    .manchas {
      mix-blend-mode: multiply;
      background:
        radial-gradient(circle at 0 0, rgb(160 120 60 / 0.18), transparent 30%),
        radial-gradient(circle at 100% 100%, rgb(160 120 60 / 0.16), transparent 28%),
        radial-gradient(circle at 100% 0, rgb(160 120 60 / 0.1), transparent 22%);
    }

    /* Las pestañas del celular: dos tarjetas superpuestas, la activa adelante y levantada, la otra
       atrás, más chica y del color del talón. */
    .pestana {
      padding: 2px 14px;
      border: 1.5px solid rgb(43 43 43 / 0.4);
      border-radius: 3px;
      background: var(--color-talon);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: rgb(43 43 43 / 0.55);
      transform: scale(0.92);
      cursor: pointer;
    }
    .pestana:last-child {
      margin-left: -6px;
    }
    .pestana.activa {
      position: relative;
      z-index: 1;
      border-color: var(--color-tinta);
      background: var(--color-carton);
      color: var(--color-tinta);
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgb(0 0 0 / 0.2);
    }

    /* Una fila de agujeros sobre el pliegue del cartón: una línea de sombra a un lado y una de
       luz al otro. Los agujeros van claros para que la división no compita con el contenido. */
    .troquel {
      width: 8px;
      border-left: 1px solid rgb(0 0 0 / 0.08);
      border-right: 1px solid rgb(255 255 255 / 0.45);
      background: radial-gradient(circle, rgb(47 42 38 / 0.35) 1.8px, transparent 2.4px) center
        top / 6px 9px repeat-y;
    }
  `,
})
export class App {
  protected readonly diseno = inject(Diseno);
  private readonly estado = inject(EstadoApp);
  protected readonly ANCHO_TALON = ANCHO_TALON;
  protected readonly MARGEN_MAPA = MARGEN_MAPA;
  protected readonly AIRE_SELLO = AIRE_SELLO;

  // Desde la mitad del tramo que llega al checkpoint de la gente.
  protected readonly enGente = computed(() => this.estado.posicion() > INDICE_GENTE - 0.5);

  // El viaje del boleto: del primer checkpoint con año al último.
  protected readonly primerAnio = CHECKPOINTS.find((checkpoint) => checkpoint.anio !== null)!.anio;
  protected readonly ultimoAnio = ultimoAnioDeLosCheckpoints();

  // En un boleto angosto el sello se achica para dejarle lugar al texto de la izquierda.
  protected readonly ladoSello = computed(() => {
    if (this.diseno.esCelular()) {
      return LADO_SELLO.celular;
    }
    return this.diseno.anchoBoleto() >= ANCHO_BOLETO_SELLO_GRANDE
      ? LADO_SELLO.grande
      : LADO_SELLO.chico;
  });
  protected readonly izquierdaContenido = (ANCHO_TALON + MARGEN_CONTENIDO) * 100; // en %

  // En el celular, la información queda a la izquierda del mapa: cada vista se corre un ancho del
  // boleto (no de pantalla: achicada, la app es más ancha que la ventana) para dejarle lugar a la
  // otra. La que queda afuera es inerte para el teclado.
  protected readonly corrimientoInformacion = computed(() => {
    if (this.diseno.esCelular() && this.diseno.vistaCelular() === 'mapa') {
      return `${-this.diseno.anchoBoleto()}px 0`;
    }
    return null;
  });
  protected readonly corrimientoMapa = computed(() => {
    if (this.diseno.esCelular() && this.diseno.vistaCelular() === 'informacion') {
      return `${this.diseno.anchoBoleto()}px 0`;
    }
    return null;
  });

  private readonly boleto = viewChild.required<ElementRef<HTMLElement>>('boleto');

  // El troquel y la vía dependen del ancho del boleto (el panel del mapa tiene un mínimo).
  constructor() {
    afterNextRender(() => {
      const observador = new ResizeObserver((entradas) =>
        this.diseno.anchoBoleto.set(entradas[0].contentRect.width),
      );
      observador.observe(this.boleto().nativeElement);
    });
  }
}
