import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import * as d3 from 'd3';
import { CargaDatos } from './datos';
import { CHECKPOINTS, EstadoApp, opacidadDesde, opacidadHasta } from './estado';
import { bajoLeyendas, poligonosDelMapa, proyeccionDelMapa } from './mapa-argentina';
import { CARGA, INACTIVA, PASAJEROS } from './modelo-reconectar';
import { Herramienta, Reconexion } from './reconexion';

const INDICE_RECONECTAR = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'reconectar');
const RADIO_PINCEL = 10; // px de pantalla del trazo al pintar y al borrar: unos 100 km en el mapa del país
// hm de mapa: el radio del círculo del departamento con más gente. Al estar en unidades del mapa,
// los círculos siguen su tamaño cuando el mapa se achica.
const RADIO_MAXIMO = 860;
// ms: un círculo recorre el 63 % de lo que le falta para su radio nuevo en ese tiempo, así se achica
// suave mientras se pinta y frena al llegar.
const TAU_PERSECUCION = 150;
const DURACION_ESTELA = 500; // ms que tarda en borrarse cada tramo de la estela del pincel
const ESTELA_ENTERA = 0.4; // la parte de esa duración en que el tramo todavía no empieza a apagarse
const DT_MAXIMO = 100; // ms: con cuadros más largos que esto la animación se estira en vez de saltar
const VALORES_REFERENCIA = [50_000, 200_000, 500_000]; // personas; el departamento más grande tiene unas 590.000

const HERRAMIENTAS: { id: Herramienta; nombre: string; ayuda: string; color: string }[] = [
  {
    id: 'pintar',
    nombre: 'Pintar',
    ayuda: 'Pintá vías naranjas o rojas para que lleven pasajeros.',
    color: 'var(--color-via-pasajeros)',
  },
  {
    id: 'borrar',
    nombre: 'Borrar',
    ayuda: 'Borrá lo pintado para dejar una vía como está hoy.',
    color: 'var(--color-tinta)',
  },
];

// Las vías que se dibujan, de abajo hacia arriba: la levantada no se puede reactivar y no va.
const CAPAS = [
  { categoria: INACTIVA, nombre: 'Vía sin trenes', color: 'var(--color-via-inactiva)' },
  { categoria: CARGA, nombre: 'Sólo carga', color: 'var(--color-via-carga)' },
  { categoria: PASAJEROS, nombre: 'Con pasajeros', color: 'var(--color-via-pasajeros)' },
];

interface Circulo extends d3.SimulationNodeDatum {
  dep: number;
  r: number;
  objetivo: number; // el radio que le toca por su gente, que r persigue
  origenX: number;
  origenY: number;
}

// La capa de Reconectar, encima del mapa y con su misma proyección: los círculos de la gente que no
// tiene un tren de pasajeros cerca, la red con lo que pintó el usuario encima de ellos, y las
// herramientas. Sólo se puede editar parado en el checkpoint.
@Component({
  selector: 'app-mapa-reconectar',
  host: {
    class: 'pointer-events-none block',
    '(document:keydown)': 'teclear($event)',
  },
  template: `
    <div
      class="relative size-full"
      [style.opacity]="opacidad()"
      [class.invisible]="opacidad() === 0"
    >
      <svg
        #lienzo
        class="lienzo size-full"
        [class.pointer-events-auto]="activo()"
        (pointerdown)="apretar($event)"
        (pointermove)="mover($event)"
        (pointerup)="soltar()"
        (pointercancel)="soltar()"
        (pointerleave)="cursorVisible.set(false)"
        aria-label="Mapa para reconectar la red"
      >
        <g class="dorling" [style.opacity]="circulosVisibles() ? 1 : 0"></g>
        @for (capa of capas; track capa.categoria) {
          <path
            class="via-reconectar"
            [attr.d]="caminos()[capa.categoria]"
            [attr.stroke]="capa.color"
            [style.opacity]="viasVisibles()[capa.categoria] ? 1 : 0"
          />
        }
        <!-- Lo que cambia el trazo en curso, encima de la red: se rearma entera recién al soltar. -->
        <g class="trazo"></g>
        <circle
          class="cursor"
          [attr.r]="RADIO_PINCEL"
          [attr.visibility]="cursorVisible() && conMouse ? 'visible' : 'hidden'"
        />
      </svg>
      <!-- La estela del pincel va en un canvas: una máscara SVG no se actualizaba dentro del boleto. -->
      <canvas #estela class="estela pointer-events-none absolute inset-0 size-full"></canvas>

      <!-- Las herramientas, al lado del mapa, en el lugar de las leyendas. -->
      <div
        [style.bottom.px]="bajo()"
        class="absolute right-0 flex w-48 flex-col items-stretch gap-1 text-xs max-md:w-36 max-md:text-[10px]"
        [class.pointer-events-auto]="activo()"
      >
        <div class="grid grid-cols-3 gap-1">
          @for (h of herramientas; track h.id) {
            <button
              class="herramienta cursor-pointer"
              [class.elegida]="herramienta() === h.id"
              [style.border-left-color]="h.color"
              [attr.aria-pressed]="herramienta() === h.id"
              [title]="h.ayuda"
              (click)="reconexion.herramienta.set(h.id)"
            >
              <svg class="icono" viewBox="0 0 24 24" aria-hidden="true">
                @if (h.id === 'pintar') {
                  <!-- paint-roller de Lucide (lucide-static 1.56.0), © Lucide Icons and Contributors,
                       licencia ISC: https://lucide.dev/license -->
                  <rect width="16" height="6" x="2" y="2" rx="2" />
                  <path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                  <rect width="4" height="6" x="8" y="16" rx="1" />
                } @else {
                  <!-- eraser de Lucide (lucide-static 1.56.0), © Lucide Icons and Contributors,
                       licencia ISC: https://lucide.dev/license -->
                  <path
                    d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"
                  />
                  <path d="m5.082 11.09 8.828 8.828" />
                }
              </svg>
              <span class="etiqueta">{{ h.nombre }}</span>
            </button>
          }
          <button
            class="herramienta deshacer cursor-pointer disabled:cursor-default"
            title="Deshacer el último cambio (Ctrl+Z)"
            [disabled]="!hayEdiciones()"
            (click)="reconexion.deshacer()"
          >
            <svg class="icono" viewBox="0 0 24 24" aria-hidden="true">
              <!-- undo-2 de Lucide (lucide-static 1.56.0), © Lucide Icons and Contributors, licencia
                   ISC: https://lucide.dev/license -->
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
            </svg>
            <span class="etiqueta">Deshacer</span>
          </button>
        </div>
        <!-- La leyenda prende y apaga cada capa del mapa, como la de los años. -->
        <div class="mt-3 flex flex-col items-start gap-0.5">
          @for (capa of capas; track capa.categoria) {
            <button
              class="entrada flex cursor-pointer items-center gap-2"
              [class.apagada]="!viasVisibles()[capa.categoria]"
              [attr.aria-pressed]="viasVisibles()[capa.categoria]"
              (click)="alternarVia(capa.categoria)"
            >
              <span class="muestra-via" [style.background]="capa.color"></span>{{ capa.nombre }}
            </button>
          }
          <button
            class="entrada mt-2 flex cursor-pointer flex-col items-start gap-1 text-left"
            [class.apagada]="!circulosVisibles()"
            [attr.aria-pressed]="circulosVisibles()"
            (click)="circulosVisibles.set(!circulosVisibles())"
          >
            <span class="flex items-end gap-3">
              @for (c of escala(); track c.texto) {
                <span class="flex flex-col items-center gap-0.5">
                  <svg [attr.width]="2 * c.r + 2" [attr.height]="2 * c.r + 2" aria-hidden="true">
                    <circle
                      [attr.cx]="c.r + 1"
                      [attr.cy]="c.r + 1"
                      [attr.r]="c.r"
                      class="circulo-escala"
                    />
                  </svg>
                  <span class="text-[9px]">{{ c.texto }}</span>
                </span>
              }
            </span>
            <span class="text-[10px] leading-tight"
              >Personas sin un tren de pasajeros a menos de 10 km, por departamento</span
            >
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .lienzo {
      touch-action: none;
      user-select: none;
    }
    .lienzo.pointer-events-auto {
      cursor: crosshair;
    }
    /* El círculo del trazo reemplaza al puntero sólo con un mouse: con el dedo no hay puntero. */
    @media (hover: hover) and (pointer: fine) {
      .lienzo.pointer-events-auto {
        cursor: none;
      }
    }
    /* El puntero sólo ve al lienzo: si no, entra y sale de cada vía y cada círculo. */
    .lienzo * {
      pointer-events: none;
    }
    /* Prender o apagar una capa desde la leyenda es un fundido corto. */
    .dorling,
    .via-reconectar {
      transition: opacity 200ms ease-out;
    }
    .via-reconectar {
      fill: none;
      stroke-width: var(--grosor-via);
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .etiqueta {
      font-weight: 700;
      font-size: clamp(8px, 18.5cqw, 14px);
    }
    .icono {
      width: 50cqw;
      height: 50cqw;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .herramienta.deshacer {
      border-left-width: 1px;
    }
    .herramienta:disabled {
      opacity: 0.4;
    }
    .entrada.apagada {
      opacity: 0.4;
      text-decoration: line-through;
    }
    .muestra-via {
      width: 18px;
      height: var(--grosor-via);
      flex-shrink: 0;
    }
    .cursor {
      fill: none;
      stroke: var(--color-tinta);
      stroke-dasharray: 3 2;
      pointer-events: none;
    }
    .estela {
      opacity: 0.3;
    }
    .circulo-escala {
      fill: var(--color-bordo);
      fill-opacity: 0.19;
      stroke: var(--color-tinta);
      stroke-opacity: 0.5;
    }
    /* Fichas de cartón con su ícono, como el selector del mapa de las provincias. */
    /* Cuadradas e iguales: la letra y el ícono siguen el ancho de la ficha; "Deshacer", que es lo más
       largo, entra con un margen chico (Courier mide 0,6 em por letra). */
    .herramienta {
      container-type: inline-size;
      aspect-ratio: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      padding: 2px;
      background: var(--color-carton-mapa);
      border: 1px solid rgb(43 43 43 / 0.35);
      border-left-width: 5px;
      border-radius: 2px;
      opacity: 0.75;
      transition:
        background-color 200ms,
        opacity 200ms;
    }
    .herramienta.elegida {
      border-top-color: var(--color-tinta);
      border-right-color: var(--color-tinta);
      border-bottom-color: var(--color-tinta);
      background: var(--color-talon);
      font-weight: 700;
      opacity: 1;
    }
  `,
})
export class MapaReconectar {
  private readonly carga = inject(CargaDatos);
  private readonly estado = inject(EstadoApp);
  protected readonly reconexion = inject(Reconexion);
  private readonly injector = inject(Injector);
  private readonly lienzo = viewChild.required<ElementRef<SVGSVGElement>>('lienzo');
  private readonly lienzoEstela = viewChild.required<ElementRef<HTMLCanvasElement>>('estela');
  private readonly tamanio = signal({ ancho: 0, alto: 0 }); // px
  protected readonly herramientas = HERRAMIENTAS;
  protected readonly capas = CAPAS;
  protected readonly RADIO_PINCEL = RADIO_PINCEL;
  protected readonly herramienta = this.reconexion.herramienta;
  protected readonly cursorVisible = signal(false);
  protected readonly conMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  protected readonly viasVisibles = signal([true, true, true, true]); // por categoría
  protected readonly circulosVisibles = signal(true);

  // Sólo en Reconectar: Fin queda libre.
  protected readonly opacidad = computed(() =>
    Math.min(
      opacidadDesde(this.estado.posicion(), INDICE_RECONECTAR),
      opacidadHasta(this.estado.posicion(), INDICE_RECONECTAR),
    ),
  );
  protected readonly activo = computed(() => this.estado.posicion() === INDICE_RECONECTAR);
  protected readonly hayEdiciones = computed(() => {
    this.reconexion.version();
    return (this.reconexion.modelo()?.ediciones.length ?? 0) > 0;
  });

  private readonly proyeccion = computed(() => {
    const datos = this.carga.datos();
    const { ancho, alto } = this.tamanio();
    if (datos === null || ancho === 0) {
      return null;
    }
    return proyeccionDelMapa(poligonosDelMapa(datos), ancho, alto);
  });

  protected readonly bajo = computed(() => {
    const datos = this.carga.datos();
    const proyeccion = this.proyeccion();
    if (datos === null || proyeccion === null) {
      return null;
    }
    return bajoLeyendas(poligonosDelMapa(datos), proyeccion, this.tamanio().alto);
  });

  // El path de cada parte se arma una vez por tamaño; con cada edición sólo se reparten.
  private readonly caminoDeParte = computed(() => {
    const datos = this.carga.datos();
    const proyeccion = this.proyeccion();
    const caminos: string[] = [];
    if (datos === null || proyeccion === null) {
      return caminos;
    }
    const camino = d3.geoPath(proyeccion);
    for (const l of datos.vias.xy) {
      const puntos: [number, number][] = [];
      for (let k = 0; k < l.length; k += 2) {
        puntos.push([l[k], l[k + 1]]);
      }
      caminos.push(camino({ type: 'LineString', coordinates: puntos }) ?? '');
    }
    return caminos;
  });

  // Un path por categoría, con lo pintado entre las de pasajeros.
  protected readonly caminos = computed(() => {
    this.reconexion.version();
    const modelo = this.reconexion.modelo();
    const caminoDeParte = this.caminoDeParte();
    const caminos = ['', '', '', ''];
    if (modelo === null || caminoDeParte.length === 0) {
      return caminos;
    }
    const categoria = modelo.d.vias.categoria;
    for (let p = 0; p < categoria.length; p++) {
      if (modelo.pintada[p]) {
        caminos[PASAJEROS] += caminoDeParte[p];
      } else if (categoria[p] > 0) {
        caminos[categoria[p]] += caminoDeParte[p];
      }
    }
    return caminos;
  });

  // El radio de un círculo según su gente, con el máximo al empezar: así se achica al ganar acceso.
  private readonly radio = computed(() => {
    const modelo = this.reconexion.modelo();
    const escala = this.proyeccion()?.scale() ?? 0; // px por hm
    let maximo = 1;
    if (modelo !== null) {
      for (const gente of modelo.sinTren) {
        maximo = Math.max(maximo, gente);
      }
    }
    return d3
      .scaleSqrt()
      .domain([0, maximo])
      .range([0, RADIO_MAXIMO * escala]);
  });

  protected readonly escala = computed(() => {
    const radio = this.radio();
    const circulos = [];
    for (const valor of VALORES_REFERENCIA) {
      circulos.push({ r: radio(valor), texto: valor.toLocaleString('es-AR') });
    }
    return circulos;
  });

  private circulos: Circulo[] = [];
  private simulacion: d3.Simulation<Circulo, undefined> | null = null;
  private trazo: number[] = []; // en hm, lo ya procesado
  private pendientes: number[] = []; // en hm, los puntos que esperan al próximo cuadro
  // En px; `inicio` marca el primer punto de un trazo, que no se une con la estela del anterior.
  private estela: { x: number; y: number; t: number; inicio: boolean }[] = [];
  private estelaPedida = false;
  private colorEstela = '';
  private dibujando = false;
  private pintaTrazo = true;
  private cuadroPedido = false;
  private ultimoTick = 0;

  constructor() {
    afterNextRender(() => {
      const observador = new ResizeObserver((entradas) => {
        const caja = entradas[0].contentRect;
        this.tamanio.set({ ancho: caja.width, alto: caja.height });
      });
      observador.observe(this.lienzo().nativeElement);
    });
    effect(() => this.armarDorling());
    effect(() => {
      this.reconexion.versionGente();
      untracked(() => this.actualizarDorling());
    });
  }

  protected alternarVia(categoria: number) {
    const visibles = this.viasVisibles().slice();
    visibles[categoria] = !visibles[categoria];
    this.viasVisibles.set(visibles);
  }

  protected teclear(evento: KeyboardEvent) {
    if (this.activo() && (evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'z') {
      evento.preventDefault();
      this.reconexion.deshacer();
    }
  }

  private aDatos(evento: PointerEvent): { px: number; py: number; x: number; y: number } {
    const [px, py] = d3.pointer(evento, this.lienzo().nativeElement);
    const [x, y] = this.proyeccion()!.invert!([px, py])!;
    return { px, py, x, y };
  }

  protected apretar(evento: PointerEvent) {
    if (!this.activo() || this.proyeccion() === null) {
      return;
    }
    evento.preventDefault(); // si no, arrastrar selecciona el texto de la página
    this.lienzo().nativeElement.setPointerCapture(evento.pointerId);
    this.dibujando = true;
    this.pintaTrazo = this.herramienta() === 'pintar';
    this.trazo = [];
    this.pendientes = [];
    // El canvas no entiende var(): se lee el color de la variable de CSS.
    const variable = HERRAMIENTAS.find((h) => h.id === this.herramienta())!.color.slice(4, -1);
    this.colorEstela = getComputedStyle(this.lienzo().nativeElement).getPropertyValue(variable);
    this.reconexion.empezarTrazo();
    this.agregarPunto(evento, true);
  }

  protected mover(evento: PointerEvent) {
    if (!this.activo()) {
      return;
    }
    const [px, py] = d3.pointer(evento, this.lienzo().nativeElement);
    this.cursorVisible.set(true);
    d3.select(this.lienzo().nativeElement).select('.cursor').attr('cx', px).attr('cy', py);
    if (this.dibujando) {
      this.agregarPunto(evento);
    }
  }

  // Los puntos se juntan y se procesan una vez por cuadro: con un mouse rápido llegan varios.
  private agregarPunto(evento: PointerEvent, inicio = false) {
    const { px, py, x, y } = this.aDatos(evento);
    this.pendientes.push(x, y);
    this.estela.push({
      x: px,
      y: py,
      t: performance.now(),
      inicio,
    });
    if (!this.estelaPedida) {
      this.estelaPedida = true;
      requestAnimationFrame(() => this.dibujarEstela());
    }
    if (!this.cuadroPedido) {
      this.cuadroPedido = true;
      requestAnimationFrame(() => {
        this.cuadroPedido = false;
        this.procesarPendientes();
      });
    }
  }

  // Cada tramo queda entero un rato y después se apaga con un coseno, que arranca y termina sin cortes; sigue después de soltar,
  // hasta que se borra el último. Antes de dibujar un tramo se borra lo que pisa del anterior, así
  // las uniones no se oscurecen como pasaría con tramos semitransparentes encimados.
  private dibujarEstela() {
    const ahora = performance.now();
    while (this.estela.length > 1 && ahora - this.estela[1].t > DURACION_ESTELA) {
      this.estela.shift();
    }
    const canvas = this.lienzoEstela().nativeElement;
    const densidad = window.devicePixelRatio;
    const ancho = Math.round(canvas.clientWidth * densidad);
    const alto = Math.round(canvas.clientHeight * densidad);
    if (canvas.width !== ancho || canvas.height !== alto) {
      canvas.width = ancho;
      canvas.height = alto;
    }
    const contexto = canvas.getContext('2d')!;
    contexto.setTransform(densidad, 0, 0, densidad, 0, 0);
    contexto.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    contexto.lineCap = 'round';
    contexto.lineWidth = 2 * RADIO_PINCEL;
    contexto.strokeStyle = this.colorEstela;
    let quedan = false;
    for (let k = 0; k < this.estela.length; k++) {
      const b = this.estela[k];
      const a = b.inicio || k === 0 ? b : this.estela[k - 1];
      const edad = (ahora - b.t) / DURACION_ESTELA;
      if (edad >= 1) {
        continue;
      }
      quedan = true;
      contexto.beginPath();
      contexto.moveTo(a.x, a.y);
      contexto.lineTo(b.x, b.y);
      contexto.globalCompositeOperation = 'destination-out';
      contexto.globalAlpha = 1;
      contexto.stroke();
      contexto.globalCompositeOperation = 'source-over';
      const apagado = Math.max(0, (edad - ESTELA_ENTERA) / (1 - ESTELA_ENTERA));
      contexto.globalAlpha = (1 + Math.cos(Math.PI * apagado)) / 2;
      contexto.stroke();
    }
    if (quedan) {
      requestAnimationFrame(() => this.dibujarEstela());
    } else {
      this.estela = [];
      this.estelaPedida = false;
    }
  }

  // El tramo nuevo arranca en el último punto ya procesado, así no queda un hueco entre cuadros.
  private procesarPendientes() {
    if (this.pendientes.length === 0) {
      return;
    }
    const n = this.trazo.length;
    const tramo =
      n >= 2 ? [this.trazo[n - 2], this.trazo[n - 1], ...this.pendientes] : this.pendientes;
    this.trazo.push(...this.pendientes);
    this.pendientes = [];
    // El radio del trazo, de px a hectómetros.
    const nuevas = this.reconexion.sumarAlTrazo(tramo, RADIO_PINCEL / this.proyeccion()!.scale());
    this.dibujarEnCapa(nuevas);
  }

  // Sólo lo nuevo, en un path propio: lo pintado va con pasajeros y lo borrado vuelve a su color.
  private dibujarEnCapa(partes: number[]) {
    const modelo = this.reconexion.modelo();
    if (partes.length === 0 || modelo === null) {
      return;
    }
    const caminoDeParte = this.caminoDeParte();
    const categoria = modelo.d.vias.categoria;
    const capa = d3.select(this.lienzo().nativeElement).select('.trazo');
    for (const c of CAPAS) {
      let d = '';
      for (const p of partes) {
        const va = this.pintaTrazo ? c.categoria === PASAJEROS : categoria[p] === c.categoria;
        if (va) {
          d += caminoDeParte[p];
        }
      }
      if (d !== '') {
        // d3 agrega el path fuera del encapsulado de Angular: no le llegan los estilos de la clase.
        capa
          .append('path')
          .attr('fill', 'none')
          .attr('stroke', c.color)
          .attr('stroke-linecap', 'round')
          .attr('stroke-linejoin', 'round')
          .style('stroke-width', 'var(--grosor-via)')
          .attr('d', d)
          .style('opacity', this.viasVisibles()[c.categoria] ? 1 : 0);
      }
    }
  }

  protected soltar() {
    if (!this.dibujando) {
      return;
    }
    this.dibujando = false;
    this.procesarPendientes();
    this.reconexion.terminarTrazo();
    // La capa se vacía cuando la red ya se rearmó con el trazo, así no hay un cuadro sin él.
    afterNextRender(
      () => d3.select(this.lienzo().nativeElement).select('.trazo').selectAll('*').remove(),
      { injector: this.injector },
    );
  }

  // Un círculo por departamento con su gente sin tren de pasajeros (las tres categorías juntas),
  // en el centro de esa gente y corrido lo justo para no pisar a los vecinos.
  private armarDorling() {
    const modelo = this.reconexion.modelo();
    const proyeccion = this.proyeccion();
    if (modelo === null || proyeccion === null) {
      return;
    }
    const deps = modelo.d.regiones.departamentos;
    const radio = this.radio();
    this.circulos = [];
    for (let d = 0; d < deps.codigo.length; d++) {
      const [x, y] = proyeccion([deps.x[d], deps.y[d]]) as [number, number];
      const r = radio(modelo.sinTren[d]);
      this.circulos.push({ dep: d, r, objetivo: r, x, y, origenX: x, origenY: y });
    }
    this.simulacion?.stop();
    this.simulacion = d3
      .forceSimulation(this.circulos)
      .force('x', d3.forceX<Circulo>((c) => c.origenX).strength(0.2))
      .force('y', d3.forceY<Circulo>((c) => c.origenY).strength(0.2))
      .force(
        'choque',
        d3.forceCollide<Circulo>((c) => (c.r > 0 ? c.r + 0.5 : 0)),
      )
      .stop();
    // Al arrancar se resuelve de una, sin animación.
    this.simulacion.tick(150);
    d3.select(this.lienzo().nativeElement)
      .select('.dorling')
      .selectAll('circle')
      .data(this.circulos)
      .join('circle')
      .attr('fill', 'var(--color-bordo)')
      .attr('fill-opacity', 0.19)
      .attr('stroke', 'var(--color-carton)')
      .attr('stroke-width', 0.75);
    this.posicionarCirculos();
    this.simulacion.on('tick', () => this.crecerCirculos());
  }

  // Cada radio persigue al suyo; el choque vuelve a leer los radios, que d3 guarda al armarse.
  private crecerCirculos() {
    const ahora = performance.now();
    const dt = Math.min(DT_MAXIMO, ahora - this.ultimoTick);
    this.ultimoTick = ahora;
    const avance = 1 - Math.exp(-dt / TAU_PERSECUCION);
    let cambiaron = false;
    for (const c of this.circulos) {
      if (c.r !== c.objetivo) {
        c.r += (c.objetivo - c.r) * avance;
        if (Math.abs(c.objetivo - c.r) < 0.05) {
          c.r = c.objetivo;
        }
        cambiaron = true;
      }
    }
    if (cambiaron) {
      this.simulacion!.force<d3.ForceCollide<Circulo>>('choque')!.radius((c) =>
        c.r > 0 ? c.r + 0.5 : 0,
      );
    }
    this.posicionarCirculos();
  }

  private posicionarCirculos() {
    d3.select(this.lienzo().nativeElement)
      .select('.dorling')
      .selectAll<SVGCircleElement, Circulo>('circle')
      .attr('cx', (c) => c.x!)
      .attr('cy', (c) => c.y!)
      .attr('r', (c) => c.r);
  }

  // Con cada cuadro del trazo los círculos van hacia su tamaño nuevo y se reacomodan desde donde estaban.
  private actualizarDorling() {
    if (this.simulacion === null) {
      return;
    }
    const radio = this.radio();
    const sinTren = this.reconexion.modelo()!.sinTren;
    for (const c of this.circulos) {
      c.objetivo = radio(sinTren[c.dep]);
    }
    if (this.simulacion.alpha() < this.simulacion.alphaMin()) {
      this.ultimoTick = performance.now(); // estaba quieta: el primer cuadro no cuenta la pausa
    }
    this.simulacion.alpha(0.3).restart();
  }
}
