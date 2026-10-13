import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Diseno } from './diseno';
import { CHECKPOINTS, EstadoApp } from './estado';

const UMBRAL_ARRASTRE_PX = 4; // menos que esto es un toque, no un arrastre
// Las etiquetas van en Courier Prime de 12 px, que es monoespaciada: el ancho sale de las letras.
const ANCHO_LETRA_ETIQUETA = 7.2; // px
const ESPACIO_ENTRE_ETIQUETAS = 6; // px; más cerca, las dos etiquetas se corren hacia los costados
const PASADAS_SEPARACION = 10; // cada pasada separa los pares que se pisan; con estas ya no se mueven
// px de la mitad de la pantalla que ocupan la flecha de adelante y su margen, en el celular.
const LUGAR_FLECHA_CELULAR = 84;
const ANCHO_VIA_CELULAR = 6; // en anchos del boleto, que en el celular ocupa la pantalla
const RIGIDEZ_RESORTE = 220; // en 1/s², qué tan fuerte tira el estado del tren dibujado
const AMORTIGUACION_REBOTE = 20; // en 1/s; con menos, el tren rebota más al llegar a un checkpoint
const AMORTIGUACION_SIN_REBOTE = 2 * Math.sqrt(RIGIDEZ_RESORTE); // en 1/s, la mínima que no rebota
const RESORTE_COLGADO_MS = 250; // sin un cuadro del resorte en este tiempo, se lo da por cortado

const ULTIMO = CHECKPOINTS.length - 1;
const INDICE_1857 = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === '1857'); // las flechas van entre este
const INDICE_1907 = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === '1907'); // y este checkpoint
const DURACION_CAMBIO_TREN = 180; // ms del fundido entre un tren y el siguiente

// Los trenes que recorren la vía, cada uno desde el año de su modelo (el del nombre de su archivo). Los
// cambios caen lejos de los checkpoints, así ningún tren queda en un tramo corto.
const TRENES = [
  { archivo: 'la-portena-1857', desde: 0 },
  { archivo: 'gt22cw-1970s', desde: 1970 },
  { archivo: 'csr-emu-2014', desde: 2014 },
];

// `fracciones` dice dónde cae cada checkpoint, como fracción de la vía (de 0 a 1).
function fraccionDePosicion(posicion: number, fracciones: number[]): number {
  const tramo = Math.min(Math.floor(posicion), ULTIMO - 1);
  const avance = posicion - tramo;
  return fracciones[tramo] + avance * (fracciones[tramo + 1] - fracciones[tramo]);
}

// Dónde cae un año en la vía; antes del primer checkpoint con año, en ese checkpoint.
function fraccionDeAnio(anio: number, fracciones: number[]): number {
  let fraccion = 0;
  for (let i = 0; i < ULTIMO; i++) {
    const desde = CHECKPOINTS[i].anio;
    const hasta = CHECKPOINTS[i + 1].anio;
    if (desde !== null && hasta !== null && anio >= desde && anio <= hasta) {
      fraccion =
        fracciones[i] + ((anio - desde) / (hasta - desde)) * (fracciones[i + 1] - fracciones[i]);
    }
  }
  return fraccion;
}

function posicionDeFraccion(fraccion: number, fracciones: number[]): number {
  let tramo = 0;
  while (tramo < ULTIMO - 1 && fraccion > fracciones[tramo + 1]) {
    tramo += 1;
  }
  const avance = (fraccion - fracciones[tramo]) / (fracciones[tramo + 1] - fracciones[tramo]);
  return tramo + avance;
}

interface Viaje {
  desde: number; // posición
  destino: number; // índice del checkpoint
  direccion: number; // 1 hacia adelante, -1 hacia atrás
  inicioMs: number;
  duracionMs: number;
}

interface Arrastre {
  xInicial: number;
  fraccionInicial: number;
  checkpoint: number | null; // el checkpoint tocado, si se tocó uno
  movio: boolean;
}

@Component({
  selector: 'app-slider-vias',
  host: {
    class: 'papel-suave relative block h-28 overflow-x-clip bg-suelo select-none',
    '(document:keydown)': 'teclear($event)',
  },
  template: `
    <!-- Del lado del mapa, el suelo es un poco más oscuro. -->
    <div
      class="papel-suave absolute inset-y-0 right-0 hidden bg-suelo-mapa md:block"
      [style.left.%]="diseno.xTroquel() * 100"
    ></div>
    <div
      #via
      class="absolute top-0 h-0"
      [style.left]="esCelular() ? izquierdaCelular() : xInicioVia() * 100 + '%'"
      [style.right.%]="esCelular() ? null : (1 - xFinVia()) * 100"
      [style.width.px]="esCelular() ? ANCHO_VIA_CELULAR * diseno.anchoBoleto() : null"
      (pointermove)="mover($event)"
      (pointerup)="soltar()"
      (pointercancel)="soltar()"
    >
      <div
        class="absolute inset-x-0 -top-5 h-10 cursor-pointer touch-none"
        (pointerdown)="apretarVia($event)"
      ></div>
      <div class="durmientes pointer-events-none absolute inset-x-0 top-[2px] h-[7px]"></div>
      <div class="pointer-events-none absolute inset-x-0 -top-[4px] h-[6px] bg-tinta"></div>
      <div class="pointer-events-none absolute inset-x-0 top-[5px] h-[2px] bg-tinta"></div>

      @for (checkpoint of checkpoints; track checkpoint.id; let i = $index) {
        <div
          class="pointer-events-none absolute top-0 z-20 flex -translate-x-1/2 flex-col items-center"
          [style.left.%]="fracciones()[i] * 100"
        >
          <!-- Un aro del color de la vía que cuelga del riel, así el tren nunca lo tapa; se llena
               cuando el tren está parado en él. -->
          <div
            class="aro pointer-events-auto relative mt-[14px] size-4 cursor-pointer touch-none rounded-full border-[2.5px] border-tinta"
            [style.background-color]="
              estado.posicion() === i ? 'var(--color-tinta)' : 'var(--color-carton)'
            "
            (pointerdown)="apretar($event, i)"
          ></div>
          <span
            class="mt-[3px] text-xs font-bold"
            [style.translate.px]="corrimientoEtiqueta()[i]"
            >{{ checkpoint.etiqueta }}</span
          >
        </div>
      }

      <!-- La zona para agarrar el tren queda debajo de los aros, así un aro se puede tocar aunque el
           tren esté encima. -->
      <div
        class="absolute -bottom-[10px] z-10 h-20 w-28 -translate-x-1/2 cursor-grab touch-none active:cursor-grabbing"
        [style.left.%]="fraccionDibujada() * 100"
        (pointerdown)="apretar($event, null)"
      ></div>
      <!-- Los tres trenes, superpuestos: se ve el que corresponde a dónde está dibujado. Las ruedas
           apoyan sobre el riel y el dibujo va por encima de los aros, sin recibir el puntero. -->
      <div
        class="pointer-events-none absolute -bottom-[10px] z-30 h-20 w-28 -translate-x-1/2"
        [style.left.%]="fraccionDibujada() * 100"
      >
        @for (tren of trenes; track tren.archivo; let i = $index) {
          <div
            class="tren absolute bottom-[14px] left-1/2 h-[26px] w-[60px] -translate-x-1/2 bg-tinta"
            [class.oculto]="trenVisible() !== i"
            [style.mask-image]="'url(trenes/' + tren.archivo + '.webp)'"
          ></div>
        }
      </div>
    </div>

    <!-- Las flechas, y a su derecha la invitación, que no cuenta para ubicarlas. En escritorio
         quedan centradas entre 1857 y 1907, el tramo con más lugar; en el celular, centradas en
         la pantalla y la invitación se achica al lugar que les queda al costado. -->
    <div
      class="absolute bottom-[30px] -translate-x-1/2 md:bottom-[32px]"
      [style.left.%]="esCelular() ? 50 : xFlechas() * 100"
    >
      <div class="flex gap-10">
        <button
          class="cursor-pointer disabled:cursor-default disabled:opacity-30"
          aria-label="Atrás"
          [disabled]="estado.posicion() <= 0"
          (click)="avanzar(-1)"
        >
          <svg class="size-9 -scale-x-100" viewBox="0 0 24 24">
            <path class="flecha" d="M8 5 L19 12 L8 19 Z" />
          </svg>
        </button>
        <button
          class="cursor-pointer disabled:cursor-default disabled:opacity-30"
          aria-label="Adelante"
          [class.llamando]="enInicio()"
          [disabled]="estado.posicion() >= ULTIMO"
          (click)="avanzar(1)"
        >
          <svg class="size-9" viewBox="0 0 24 24">
            <path class="flecha" d="M8 5 L19 12 L8 19 Z" />
          </svg>
        </button>
      </div>
      <p
        class="invitacion absolute top-1/2 left-full ml-4 -translate-y-1/2 text-sm font-bold whitespace-nowrap max-md:ml-3 max-md:text-[10px] max-md:leading-tight max-md:whitespace-normal"
        [class.oculta]="!enInicio()"
        [style.width.px]="esCelular() ? diseno.anchoBoleto() / 2 - LUGAR_FLECHA_CELULAR : null"
      >
        Empezá el viaje
      </p>
    </div>
  `,
  styles: `
    /* En Inicio, la flecha de avanzar late en verde y crece para invitar a empezar: un golpe con
       ease out en el primer 40 % del ciclo y después queda quieta. */
    .llamando svg {
      animation: llamar 2s ease-out infinite;
    }
    @keyframes llamar {
      0%,
      40%,
      100% {
        color: var(--color-tinta);
        scale: 1;
      }
      8% {
        color: var(--color-via-pasajeros);
        scale: 1.25;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .llamando svg {
        animation: none;
        color: var(--color-via-pasajeros);
      }
    }
    .invitacion {
      transition: opacity 400ms ease-in-out;
    }
    .invitacion.oculta {
      opacity: 0;
    }
    /* El trazo que une el aro con el riel y, invisible, una zona de toque más grande que el aro. */
    .aro::before {
      content: '';
      position: absolute;
      left: 50%;
      bottom: 100%;
      width: 2px;
      height: 9px;
      translate: -50% 0;
      background: var(--color-tinta);
    }
    .aro::after {
      content: '';
      position: absolute;
      inset: -4px;
    }
    .tren {
      mask-size: contain;
      mask-repeat: no-repeat;
      /* Los dibujos no tienen todos la proporción de la caja: abajo y al centro, las ruedas siguen sobre el riel. */
      mask-position: center bottom;
      transition: opacity ${DURACION_CAMBIO_TREN}ms;
    }
    .tren.oculto {
      opacity: 0;
    }
    .durmientes {
      background: repeating-linear-gradient(
        to right,
        var(--color-tinta) 0 5px,
        transparent 5px 16px
      );
    }
    /* Un triángulo lleno con un trazo grueso del mismo color: el trazo redondea las puntas. */
    .flecha {
      fill: currentColor;
      stroke: currentColor;
      stroke-width: 3;
      stroke-linejoin: round;
    }
  `,
})
export class SliderVias {
  protected readonly estado = inject(EstadoApp);
  protected readonly checkpoints = CHECKPOINTS;
  protected readonly diseno = inject(Diseno);
  protected readonly ULTIMO = ULTIMO;
  protected readonly ANCHO_VIA_CELULAR = ANCHO_VIA_CELULAR;
  protected readonly LUGAR_FLECHA_CELULAR = LUGAR_FLECHA_CELULAR;
  protected readonly esCelular = this.diseno.esCelular;

  // La vía va del primer checkpoint al último; las fracciones son relativas a ella. En el celular
  // se usan las mismas, sobre una vía más larga.
  protected readonly xInicioVia = computed(() => this.diseno.xCheckpoints()[0]);
  protected readonly xFinVia = computed(() => this.diseno.xCheckpoints()[ULTIMO]);
  protected readonly fracciones = computed(() => {
    const fracciones = [];
    for (const x of this.diseno.xCheckpoints()) {
      fracciones.push((x - this.xInicioVia()) / (this.xFinVia() - this.xInicioVia()));
    }
    return fracciones;
  });
  protected readonly trenes = TRENES;

  // Cuánto se corre cada etiqueta, en px, para no pisar a sus vecinas: dos que se pisan se apartan
  // lo mismo cada una, y si eso empuja a una tercera, también se corre.
  protected readonly corrimientoEtiqueta = computed(() => {
    let anchoVia = (this.xFinVia() - this.xInicioVia()) * this.diseno.anchoBoleto(); // px
    if (this.esCelular()) {
      anchoVia = ANCHO_VIA_CELULAR * this.diseno.anchoBoleto();
    }
    const centros: number[] = [];
    const anchos: number[] = [];
    for (let i = 0; i < CHECKPOINTS.length; i++) {
      centros.push(this.fracciones()[i] * anchoVia);
      anchos.push(CHECKPOINTS[i].etiqueta.length * ANCHO_LETRA_ETIQUETA);
    }
    const posiciones = [...centros];
    for (let pasada = 0; pasada < PASADAS_SEPARACION; pasada++) {
      for (let i = 0; i + 1 < posiciones.length; i++) {
        const minimo = (anchos[i] + anchos[i + 1]) / 2 + ESPACIO_ENTRE_ETIQUETAS;
        const falta = minimo - (posiciones[i + 1] - posiciones[i]);
        if (falta > 0) {
          posiciones[i] -= falta / 2;
          posiciones[i + 1] += falta / 2;
        }
      }
    }
    const corrimientos: number[] = [];
    for (let i = 0; i < posiciones.length; i++) {
      corrimientos.push(posiciones[i] - centros[i]);
    }
    return corrimientos;
  });

  // El tren que corresponde a dónde está dibujado, así también cambia al arrastrar.
  protected readonly trenVisible = computed(() => {
    let visible = 0;
    for (let i = 1; i < TRENES.length; i++) {
      if (this.fraccionDibujada() >= fraccionDeAnio(TRENES[i].desde, this.fracciones())) {
        visible = i;
      }
    }
    return visible;
  });
  protected readonly enInicio = computed(() => this.estado.posicion() === 0);
  protected readonly xFlechas = computed(() => {
    const x = this.diseno.xCheckpoints();
    return (x[INDICE_1857] + x[INDICE_1907]) / 2;
  });

  private readonly via = viewChild.required<ElementRef<HTMLElement>>('via');
  private viaje: Viaje | null = null;
  private arrastre: Arrastre | null = null;

  protected readonly fraccion = computed(() =>
    fraccionDePosicion(this.estado.posicion(), this.fracciones()),
  );

  // Dónde se dibuja el tren. Sigue a `fraccion` con un resorte, así cuando el estado salta de
  // golpe (un segundo clic) el tren llega con un rebote chico en vez de teletransportarse.
  protected readonly fraccionDibujada = signal(0);
  private velocidadDibujo = 0; // en fracción de vía por segundo
  private resorteAndando = false;
  private ultimoCuadroMs = 0; // cuándo corrió el último cuadro del resorte

  // En el celular el tren queda en el centro de la pantalla y la vía se corre debajo.
  protected readonly izquierdaCelular = computed(
    () =>
      `calc(50% - ${this.fraccionDibujada() * ANCHO_VIA_CELULAR * this.diseno.anchoBoleto()}px)`,
  );

  constructor() {
    effect(() => {
      this.fraccion();
      this.despertarResorte();
    });
  }

  // Corre cuadro a cuadro mientras el tren dibujado no haya alcanzado al estado, y se apaga solo.
  // Si la cadena de cuadros se cortó (el resorte figura andando pero no corrió hace rato), se
  // rearranca: si no, el tren dibujado quedaría quieto aunque el estado siga cambiando.
  private despertarResorte() {
    if (this.resorteAndando && performance.now() - this.ultimoCuadroMs < RESORTE_COLGADO_MS) {
      return;
    }
    this.resorteAndando = true;
    let anteriorMs = performance.now();

    this.ultimoCuadroMs = anteriorMs;
    const cuadro = (ahoraMs: number) => {
      this.ultimoCuadroMs = performance.now();
      // El paso se acota para que el resorte no explote si la pestaña estuvo en segundo plano.
      const dt = Math.min(Math.max((ahoraMs - anteriorMs) / 1000, 0), 1 / 30);
      anteriorMs = ahoraMs;

      const error = this.fraccion() - this.fraccionDibujada();
      if (Math.abs(error) < 1e-5 && Math.abs(this.velocidadDibujo) < 1e-4) {
        this.fraccionDibujada.set(this.fraccion());
        this.velocidadDibujo = 0;
        this.resorteAndando = false;
        return;
      }
      // Sólo rebota al llegar a un checkpoint; hacia un punto de la vía llega sin pasarse.
      let amortiguacion = AMORTIGUACION_SIN_REBOTE;
      if (Number.isInteger(this.estado.posicion())) {
        amortiguacion = AMORTIGUACION_REBOTE;
      }
      const aceleracion = RIGIDEZ_RESORTE * error - amortiguacion * this.velocidadDibujo;
      this.velocidadDibujo += aceleracion * dt;
      this.fraccionDibujada.set(this.fraccionDibujada() + this.velocidadDibujo * dt);
      requestAnimationFrame(cuadro);
    };
    requestAnimationFrame(cuadro);
  }

  protected avanzar(direccion: number) {
    // Un segundo clic en la misma dirección se saltea la animación.
    if (this.viaje !== null && this.viaje.direccion === direccion) {
      this.terminarViaje();
      return;
    }
    const posicion = this.estado.posicion();
    let destino = Math.ceil(posicion) - 1;
    if (direccion > 0) {
      destino = Math.floor(posicion) + 1;
    }
    if (destino >= 0 && destino <= ULTIMO) {
      this.viajarA(destino);
    }
  }

  protected teclear(evento: KeyboardEvent) {
    if (evento.key === 'ArrowRight') {
      this.avanzar(1);
    }
    if (evento.key === 'ArrowLeft') {
      this.avanzar(-1);
    }
  }

  // Un clic en un checkpoint salta directo; el rebote del tren dibujado hace de transición.
  private irACheckpoint(indice: number) {
    this.viaje = null;
    this.estado.posicion.set(indice);
  }

  private irAlMasCercano() {
    let masCercano = 0;
    for (let i = 1; i <= ULTIMO; i++) {
      const distancia = Math.abs(this.fracciones()[i] - this.fraccion());
      if (distancia < Math.abs(this.fracciones()[masCercano] - this.fraccion())) {
        masCercano = i;
      }
    }
    this.viajarA(masCercano);
  }

  // Todo viaje cubre a lo sumo un tramo, y dura la parte que recorre de ese tramo.
  private viajarA(destino: number) {
    const posicion = this.estado.posicion();
    const tramo = Math.floor(Math.min(destino, posicion));
    const duracionMs = Math.abs(destino - posicion) * CHECKPOINTS[tramo].duracionMs;
    if (duracionMs === 0) {
      this.estado.posicion.set(destino);
      this.viaje = null;
      return;
    }

    const viaje: Viaje = {
      desde: posicion,
      destino,
      direccion: Math.sign(destino - posicion),
      inicioMs: performance.now(),
      duracionMs,
    };
    this.viaje = viaje;

    // Si otro viaje o un arrastre lo reemplazó, el cuadro no hace nada.
    const cuadro = (ahoraMs: number) => {
      if (this.viaje !== viaje) {
        return;
      }
      const t = Math.min((ahoraMs - viaje.inicioMs) / viaje.duracionMs, 1);
      if (t >= 1) {
        this.terminarViaje();
        return;
      }
      const suave = t * t * (3 - 2 * t); // arranca y frena despacio
      this.estado.posicion.set(viaje.desde + (viaje.destino - viaje.desde) * suave);
      requestAnimationFrame(cuadro);
    };
    requestAnimationFrame(cuadro);
  }

  private terminarViaje() {
    if (this.viaje !== null) {
      this.estado.posicion.set(this.viaje.destino);
      this.viaje = null;
    }
  }

  protected apretarVia(evento: PointerEvent) {
    // En escritorio el tren salta a donde se tocó la vía, como en un slider nativo.
    if (!this.esCelular()) {
      const caja = this.via().nativeElement.getBoundingClientRect();
      const fraccion = Math.min(Math.max((evento.clientX - caja.left) / caja.width, 0), 1);
      this.viaje = null;
      this.estado.posicion.set(posicionDeFraccion(fraccion, this.fracciones()));
    }
    this.apretar(evento, null);
  }

  // Todos los toques terminan en la vía, que captura el puntero: así el arrastre sigue
  // aunque el dedo o el mouse salgan del tren.
  protected apretar(evento: PointerEvent, checkpoint: number | null) {
    evento.preventDefault();
    this.via().nativeElement.setPointerCapture(evento.pointerId);
    this.arrastre = {
      xInicial: evento.clientX,
      fraccionInicial: this.fraccionDibujada(),
      checkpoint,
      movio: false,
    };
  }

  protected mover(evento: PointerEvent) {
    const arrastre = this.arrastre;
    if (arrastre === null) {
      return;
    }
    const dx = evento.clientX - arrastre.xInicial;

    // El arrastre empieza recién al pasar el umbral, y ahí corta el viaje que hubiera. El tren
    // pudo haberse movido desde que se apretó, así que se arrastra desde donde está ahora.
    if (!arrastre.movio) {
      if (Math.abs(dx) < UMBRAL_ARRASTRE_PX) {
        return;
      }
      arrastre.movio = true;
      arrastre.fraccionInicial = this.fraccionDibujada();
      this.viaje = null;
    }

    // En el celular se arrastra la vía, que se mueve al revés que el tren.
    let signo = 1;
    if (this.esCelular()) {
      signo = -1;
    }
    const anchoVia = this.via().nativeElement.getBoundingClientRect().width;
    const fraccion = Math.min(Math.max(arrastre.fraccionInicial + (signo * dx) / anchoVia, 0), 1);
    this.estado.posicion.set(posicionDeFraccion(fraccion, this.fracciones()));

    // Al arrastrar no hay resorte: el tren, o la vía en el celular, va pegado al puntero.
    this.fraccionDibujada.set(fraccion);
    this.velocidadDibujo = 0;
  }

  protected soltar() {
    const arrastre = this.arrastre;
    if (arrastre === null) {
      return;
    }
    this.arrastre = null;

    if (arrastre.movio) {
      this.irAlMasCercano();
    } else if (arrastre.checkpoint !== null) {
      this.irACheckpoint(arrastre.checkpoint);
    } else if (this.viaje === null) {
      this.irAlMasCercano();
    }
  }
}
