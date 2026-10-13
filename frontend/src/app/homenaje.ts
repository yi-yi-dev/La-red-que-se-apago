import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Diseno } from './diseno';
import { CHECKPOINTS, EstadoApp, opacidadDesde, ultimoNoNulo } from './estado';

const INDICE_FIN = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'fin');
const UMBRAL_ARRASTRE_PX = 4; // menos que esto es un toque, que da media vuelta, no un arrastre

// Las fotos de la familia que dicen atrás dónde se sacaron, con su lugar en hm de EPSG:5346. Las
// coordenadas son las de Nominatim para el nombre del dorso: marcan el pueblo, no el punto exacto.
// La 05 nombra un tramo, que va de la primera punta a la segunda. Cada dorso guarda su tamaño
// original, que no es el de su foto.
export const FOTOS_FIN = [
  {
    archivo: '02',
    ancho: 900,
    alto: 551,
    lugar: 'Dock Sud',
    alt: 'Diez trabajadores posan sobre rieles apilados, frente a unos galpones.',
    dorso: 'Atrás, a mano: Doc Sud, Ria Chuelo, Casa amarilla.',
    anchoDorso: 900,
    altoDorso: 631,
    puntos: [[49267, 61561]],
  },
  {
    archivo: '03',
    ancho: 900,
    alto: 555,
    lugar: 'Monte Grande, 1942',
    alt: 'Cuatro trabajadores con palas posan bajo los árboles, junto a una vía.',
    dorso: 'Atrás, a mano, en una postal: Monte Grande, 1942.',
    anchoDorso: 900,
    altoDorso: 549,
    puntos: [[49147, 61396]],
  },
  {
    archivo: '05',
    ancho: 584,
    alto: 900,
    lugar: 'De Maipú a Vivoratá',
    alt: 'Dos hombres posan sobre una vía en obra; uno sostiene una herramienta de madera en forma de T.',
    dorso: 'Atrás, a mano: Mar del Plata, Renovación Vía, Entre Maipú a Vivoratá.',
    anchoDorso: 636,
    altoDorso: 900,
    puntos: [
      [49565, 59084],
      [49708, 58185],
    ],
  },
];

// Del lado izquierdo, en Fin: la dedicatoria y las fotos en abanico. Pasar por una foto marca en el
// mapa dónde se sacó, y tocarla la abre en grande; abierta, se gira tocándola o arrastrándola.
@Component({
  selector: 'app-homenaje',
  host: {
    class: 'pointer-events-none block @container',
    '(document:keydown)': 'teclear($event)',
    '(document:pointerdown)': 'tocar($event)',
  },
  template: `
    <div
      class="contenido relative flex size-full flex-col justify-center-safe"
      [style.opacity]="opacidad()"
      [class.invisible]="opacidad() === 0"
      [class.pointer-events-auto]="opacidad() >= 0.5"
    >
      <div class="select-text">
        <p class="dedicatoria">
          En memoria de mi bisabuelo y de los inmigrantes polacos que ayudaron a construir las vías
          de este mapa.
        </p>
        <p class="fuente">Fotos: archivo familiar.</p>
      </div>
      <ul class="fotos">
        @for (foto of fotos; track foto.archivo; let i = $index) {
          <li
            [class.resaltada]="estado.fotoResaltadaFin() === foto.archivo"
            [style.flex-grow]="foto.ancho / foto.alto"
            [style.rotate.deg]="ABANICO[i].giro"
            [style.translate]="'0 ' + ABANICO[i].bajada + 'px'"
          >
            <button
              class="foto"
              [attr.aria-label]="foto.lugar + '. ' + foto.alt"
              (pointerenter)="apuntar($event, foto.archivo)"
              (pointerleave)="estado.fotoApuntadaFin.set(null)"
              (click)="elegir(foto.archivo)"
            >
              <img
                [src]="'fotos/' + foto.archivo + '.webp'"
                [attr.width]="foto.ancho"
                [attr.height]="foto.alto"
                alt=""
              />
            </button>
          </li>
        }
      </ul>

      <!-- Abierta una foto, todo el boleto se oscurece apenas. Un toque en cualquier lugar fuera de
           ella la cierra, igual que la cruz o Escape; el velo y la capa atajan ese toque para que no
           abra otra foto ni toque el mapa. -->
      <div class="velo" [class.abierta]="estado.fotoElegidaFin() !== null"></div>
      <div
        class="ampliada"
        [class.abierta]="estado.fotoElegidaFin() !== null"
        [attr.aria-hidden]="estado.fotoElegidaFin() === null"
      >
        @if (fotoAmpliada(); as foto) {
          <figure #figura>
            <!-- Un toque le da media vuelta; también se agarra y se gira con el dedo o el mouse. Con
                 el teclado, Enter. -->
            <div
              class="foto-abierta"
              role="button"
              tabindex="0"
              aria-label="Dar vuelta la foto"
              (pointerdown)="apretar($event)"
              (pointermove)="mover($event)"
              (pointerup)="soltar()"
              (pointercancel)="soltar()"
              (keydown.enter)="girarMedia()"
              (keydown.space)="girarMedia(); $event.preventDefault()"
            >
              <!-- Las dos caras de la copia, cada una con su tamaño y centradas una sobre la otra: al
                   girar, la foto toma la forma del dorso. -->
              <div
                class="caras"
                [class.arrastrando]="arrastrando()"
                [style.transform]="'rotateY(' + angulo() + 'deg)'"
              >
                <img
                  class="frente"
                  draggable="false"
                  [src]="'fotos/' + foto.archivo + '.webp'"
                  [attr.width]="foto.ancho"
                  [attr.height]="foto.alto"
                  [alt]="foto.alt"
                />
                <img
                  class="dorso"
                  draggable="false"
                  [src]="'fotos/' + foto.archivo + 'b.webp'"
                  [attr.width]="foto.anchoDorso"
                  [attr.height]="foto.altoDorso"
                  [alt]="foto.dorso"
                />
              </div>
            </div>
            <!-- Una mano con una flecha curva: se entiende sin leer, con mouse o con dedo. Al abrir la
                 foto, la mano va y vuelve una vez. -->
            <p class="pista">
              <svg class="icono-pista" viewBox="0 0 36 30" aria-hidden="true">
                <!-- Una flecha de dos puntas: se puede arrastrar hacia los dos lados. -->
                <path class="arco" d="M5 9 C12 3, 24 3, 31 9" />
                <path class="arco" d="M7.5 4.8 L5 9 L9.6 9.6" />
                <path class="arco" d="M28.5 4.8 L31 9 L26.4 9.6" />
                <path
                  class="mano"
                  d="M15.5 25.5 l-3.2 -3.4 a1.6 1.6 0 0 1 2.3 -2.2 l1.4 1.4 V12.6 a1.6 1.6 0 0 1 3.2 0 V18 M19.2 17 a1.6 1.6 0 0 1 3.2 0 V18.4 M22.4 17.6 a1.6 1.6 0 0 1 3.2 0 V21 c0 3 -2 5 -5 5 h-1.6 c-1.2 0 -2.2 -0.3 -3.1 -1"
                />
              </svg>
              <span>Tocá o arrastrá la foto para girarla</span>
            </p>
            @if (diseno.esCelular()) {
              <button class="ver-mapa" (click)="diseno.vistaCelular.set('mapa')">
                Ver dónde se sacó
              </button>
            }
            <button class="cerrar" aria-label="Cerrar la foto" (click)="cerrar()">✕</button>
          </figure>
        }
      </div>
    </div>
  `,
  styles: `
    /* Como la portada: centrado en el alto que queda debajo del sello, así nunca lo toca. */
    .contenido {
      padding-top: var(--lado-sello, 0px);
      padding-bottom: 4%;
    }
    .dedicatoria {
      font-style: italic;
      font-size: 1.375rem;
      line-height: 1.45;
    }
    .fuente {
      margin-top: 0.75rem;
      font-size: 10px;
      opacity: 0.75;
    }
    /* Las tres fotos en abanico, todas del mismo alto: cada una crece según su proporción y se
       monta un poco sobre la anterior. La apuntada pasa adelante. */
    .fotos {
      display: flex;
      align-items: flex-start;
      margin-top: 2.5rem;
      padding: 0 5%;
    }
    .fotos li {
      position: relative;
      flex-basis: 0;
      display: flex;
      flex-direction: column;
      min-width: 0;
      transition: scale 250ms ease-out;
    }
    .fotos li + li {
      margin-left: -4%;
    }
    .fotos li.resaltada {
      z-index: 1;
      scale: 1.04;
    }
    /* Un marco claro del cartón del talón y una sombra cálida y suave, no negra. */
    .foto {
      cursor: pointer;
      padding: 5px;
      background: var(--color-talon);
      box-shadow: 0 3px 10px rgb(110 80 45 / 0.22);
      transition: box-shadow 250ms ease-out;
    }
    .resaltada .foto {
      box-shadow: 0 10px 22px rgb(110 80 45 / 0.3);
    }
    .foto img {
      display: block;
      width: 100%;
      height: auto;
    }
    .foto:focus-visible {
      outline: 2px solid var(--color-violeta);
      outline-offset: 3px;
    }
    /* Fijo a la ventana, así oscurece el boleto entero; queda debajo de la foto abierta. */
    .velo {
      position: fixed;
      inset: 0;
      z-index: 45;
      background: rgb(47 42 38 / 0.28);
      opacity: 0;
      visibility: hidden;
      transition:
        opacity 250ms ease-out,
        visibility 0s 250ms;
    }
    .velo.abierta {
      opacity: 1;
      visibility: visible;
      transition: opacity 250ms ease-out;
    }
    .ampliada {
      position: absolute;
      inset: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem 0;
      container-type: size;
      cursor: zoom-out;
      opacity: 0;
      visibility: hidden;
      transition:
        opacity 250ms ease-out,
        visibility 0s 250ms;
    }
    .ampliada.abierta {
      opacity: 1;
      visibility: visible;
      transition: opacity 250ms ease-out;
    }
    /* La foto sola, sin marco, con la misma sombra cálida de las chicas. */
    .ampliada figure {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: calc(100% - 2rem);
      max-height: 100%;
      filter: drop-shadow(0 12px 18px rgb(110 80 45 / 0.35));
      cursor: default;
      scale: 0.92;
      transition: scale 250ms ease-out;
    }
    .ampliada.abierta figure {
      scale: 1;
    }
    .foto-abierta {
      position: relative;
      display: flex;
    }
    .caras {
      display: grid;
      place-items: center;
    }
    /* La perspectiva hace que el giro se vea de costado y no como un aplastamiento. */
    /* Sin la selección ni el arrastre de imagen del navegador, que cancelarían el giro. */
    .foto-abierta {
      perspective: 1400px;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .foto-abierta:active {
      cursor: grabbing;
    }
    .foto-abierta:focus-visible {
      outline: 2px solid var(--color-violeta);
      outline-offset: 4px;
    }
    /* Al soltar, termina de girar sola; mientras se arrastra, sigue al puntero sin demora. */
    .caras {
      transform-style: preserve-3d;
      transition: transform 500ms cubic-bezier(0.3, 0.7, 0.3, 1);
    }
    .caras.arrastrando {
      transition: none;
    }
    /* Cada cara entra entera en el lugar de la capa, sin deformarse: lo que queda debajo es para la
       pista y la cruz. */
    .caras img {
      grid-area: 1 / 1;
      width: auto;
      height: auto;
      max-width: calc(100cqw - 2rem);
      max-height: calc(100cqh - 7rem);
      backface-visibility: hidden;
    }
    .caras .dorso {
      transform: rotateY(180deg);
    }
    /* Fichas con una muesca recortada a cada costado, como el talón del resumen de Reconectar: por
       las muescas se ve lo que hay detrás. La sombra es la de la foto, que sigue el
       recorte. */
    .pista,
    .ver-mapa {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 0.9rem;
      padding: 2px 18px 2px 14px;
      background: var(--color-carton);
      border: 1px solid rgb(43 43 43 / 0.25);
      border-radius: 2px;
      mask:
        radial-gradient(circle 6px at 0 50%, transparent 97%, #000) left / 51% 100% no-repeat,
        radial-gradient(circle 6px at 100% 50%, transparent 97%, #000) right / 51% 100% no-repeat;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.03em;
    }
    .ver-mapa {
      margin-top: 0.5rem;
      padding-top: 6px;
      padding-bottom: 6px;
      cursor: pointer;
    }
    .icono-pista {
      width: 34px;
      height: 28px;
      fill: none;
      stroke: var(--color-tinta);
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    /* La flecha, más tenue que la mano: lo que se hace es la mano. */
    .arco {
      stroke-opacity: 0.55;
    }
    .mano {
      fill: var(--color-carton);
    }
    /* La clase abierta se pone al abrir cada foto, así la animación arranca de nuevo cada vez. */
    .ampliada.abierta .mano {
      animation: arrastrar 1.7s 400ms;
    }
    /* Como un dedo de verdad: arranca despacio, frena antes de cada punta, se queda un instante y la
       pasada larga de un lado al otro dura más que las cortas. */
    @keyframes arrastrar {
      0% {
        translate: 0 0;
        animation-timing-function: cubic-bezier(0.55, 0, 0.3, 1);
      }
      22%,
      30% {
        translate: -7px 0;
        animation-timing-function: cubic-bezier(0.6, 0, 0.25, 1);
      }
      66%,
      74% {
        translate: 7px 0;
        animation-timing-function: cubic-bezier(0.45, 0, 0.2, 1);
      }
      100% {
        translate: 0 0;
      }
    }
    /* Una ficha redonda de tinta, montada en la esquina de arriba. */
    .cerrar {
      position: absolute;
      top: -0.9rem;
      right: -0.9rem;
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      background: var(--color-tinta);
      color: var(--color-carton);
      box-shadow: 0 2px 6px rgb(110 80 45 / 0.4);
      cursor: pointer;
      font-size: 1rem;
    }
    @media (min-width: 1080px) {
      .dedicatoria {
        font-size: clamp(1.4rem, 4.2cqw, 2rem);
        max-width: 64cqw;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .ampliada.abierta .mano {
        animation: none;
      }
      .fotos li,
      .foto,
      .velo,
      .ampliada,
      .ampliada figure,
      .caras {
        transition: none;
      }
    }
  `,
})
export class Homenaje {
  protected readonly estado = inject(EstadoApp);
  protected readonly diseno = inject(Diseno);
  protected readonly fotos = FOTOS_FIN;
  // El giro de cada foto en grados y cuántos px baja: sueltas sobre la mesa, no alineadas.
  protected readonly ABANICO = [
    { giro: -6, bajada: 0 },
    { giro: 3, bajada: 18 },
    { giro: 8, bajada: 0 },
  ];
  protected readonly angulo = signal(0); // grados que lleva girada la foto abierta
  protected readonly arrastrando = signal(false);
  private arrastre: { x: number; angulo: number; ancho: number; movio: boolean } | null = null;
  private readonly figura = viewChild<ElementRef<HTMLElement>>('figura');

  protected readonly opacidad = computed(() => opacidadDesde(this.estado.posicion(), INDICE_FIN));
  // Mientras se cierra, la foto ampliada sigue mostrando la que tenía.
  protected readonly fotoAmpliada = ultimoNoNulo(() => {
    const elegida = this.estado.fotoElegidaFin();
    return FOTOS_FIN.find((foto) => foto.archivo === elegida) ?? null;
  });

  constructor() {
    // Al irse de Fin, la foto abierta se cierra.
    effect(() => {
      if (this.estado.posicion() !== INDICE_FIN) {
        untracked(() => this.cerrar());
      }
    });
  }

  // Sólo el mouse apunta: un dedo no avisa cuando se va, y la foto quedaría resaltada.
  protected apuntar(evento: PointerEvent, archivo: string) {
    if (evento.pointerType === 'mouse') {
      this.estado.fotoApuntadaFin.set(archivo);
    }
  }

  // Cada foto se abre de frente. La foto abierta sigue dibujada entre una y otra, así que el ángulo
  // vuelve a 0 sin transición; si no, desanda todas las vueltas que le dio la foto anterior.
  protected elegir(archivo: string) {
    this.arrastrando.set(true);
    this.angulo.set(0);
    this.estado.fotoElegidaFin.set(archivo);
    requestAnimationFrame(() => this.arrastrando.set(false));
  }

  protected cerrar() {
    this.estado.fotoElegidaFin.set(null);
  }

  // Tocar fuera de la foto abierta la cierra, también en el mapa o en la vía. Sobre la foto lo
  // decide soltar(): un toque le da media vuelta y un arrastre la gira de a poco. "Ver dónde se
  // sacó" no cuenta como afuera, y en la vista del mapa del celular la foto queda abierta en la otra
  // pestaña: así el mapa sigue marcando su lugar.
  protected tocar(evento: PointerEvent) {
    const objetivo = evento.target as Node;
    const figura = this.figura()?.nativeElement;
    const foto = figura?.querySelector('.foto-abierta');
    const verMapa = figura?.querySelector('.ver-mapa');
    const enElMapa = this.diseno.esCelular() && this.diseno.vistaCelular() === 'mapa';
    if (
      this.estado.fotoElegidaFin() !== null &&
      !enElMapa &&
      !foto?.contains(objetivo) &&
      !verMapa?.contains(objetivo)
    ) {
      this.cerrar();
    }
  }

  // La foto captura el puntero, así el giro sigue aunque el dedo salga de ella.
  protected apretar(evento: PointerEvent) {
    const foto = evento.currentTarget as HTMLElement;
    foto.setPointerCapture(evento.pointerId);
    this.arrastre = {
      x: evento.clientX,
      angulo: this.angulo(),
      ancho: foto.getBoundingClientRect().width,
      movio: false,
    };
  }

  // Arrastrar el ancho entero de la foto la da media vuelta.
  protected mover(evento: PointerEvent) {
    const arrastre = this.arrastre;
    if (arrastre === null) {
      return;
    }
    const dx = evento.clientX - arrastre.x;
    if (!arrastre.movio && Math.abs(dx) < UMBRAL_ARRASTRE_PX) {
      return;
    }
    arrastre.movio = true;
    this.arrastrando.set(true);
    this.angulo.set(arrastre.angulo + (dx / arrastre.ancho) * 180);
  }

  // Al soltar, la foto termina de girar hacia la cara más cercana.
  protected soltar() {
    const arrastre = this.arrastre;
    if (arrastre === null) {
      return;
    }
    this.arrastre = null;
    this.arrastrando.set(false);
    if (!arrastre.movio) {
      this.girarMedia();
      return;
    }
    this.angulo.set(Math.round(this.angulo() / 180) * 180);
  }

  protected girarMedia() {
    this.angulo.set(this.angulo() + 180);
  }

  protected teclear(evento: KeyboardEvent) {
    if (evento.key === 'Escape') {
      this.cerrar();
    }
  }
}
