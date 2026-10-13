import { afterNextRender, Component, computed, ElementRef, inject, signal } from '@angular/core';
import * as d3 from 'd3';
import { CargaDatos } from './datos';
import { ANCHO_FUNDIDO, CHECKPOINTS, EstadoApp, opacidadHasta } from './estado';
import { FOTOS_FIN } from './homenaje';
import { poligonosDelMapa, proyeccionDelMapa } from './mapa-argentina';

const INDICE_RECONECTAR = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'reconectar');
const INDICE_FIN = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'fin');
const AIRE_ZOOM = 0.35; // fracción de la caja de los lugares que se suma alrededor al acercarse
const APARICION_MARCAS = 0.85; // fracción del zoom desde la que aparecen las marcas
const CATEGORIAS_DIBUJADAS = [1, 2, 3]; // de abajo hacia arriba; la levantada no va, como en Reconectar
const COLOR_CATEGORIA = [
  '',
  'var(--color-via-inactiva)',
  'var(--color-via-carga)',
  'var(--color-via-pasajeros)',
];
// Dock Sud y Monte Grande quedan cerca y se nombran hacia lados opuestos, si el panel lo permite.
const NOMBRE_A_LA_DERECHA = [true, false, true];
const SEPARACION_NOMBRE = 12; // px desde la marca hasta el comienzo de su nombre
const ANCHO_LETRA_NOMBRE = 7.2; // px: Courier Prime bold de 12 px, monoespaciada
const BORDE_FUNDIDO = 32; // px: acercado, el mapa se desvanece en los bordes en vez de cortarse

// En Fin, el mapa de la red de hoy se acerca a donde se sacaron las fotos de la izquierda. Sale con
// el mismo encuadre que el de Reconectar, aparece mientras ése se va, y recién después hace el zoom.
@Component({
  selector: 'app-mapa-fin',
  host: { class: 'pointer-events-none block' },
  template: `
    <div
      class="recorte relative size-full overflow-hidden"
      [style.opacity]="opacidad()"
      [style.--borde.px]="avanceZoom() * BORDE_FUNDIDO"
      [class.invisible]="opacidad() === 0"
    >
      <svg class="size-full" role="img" aria-label="Mapa de dónde se sacaron las fotos">
        <g [attr.transform]="vista().transformacion">
          <path class="tierra" [attr.d]="caminos().tierra" vector-effect="non-scaling-stroke" />
          @for (categoria of categorias; track categoria) {
            <path
              class="via"
              [attr.d]="caminos().vias[categoria]"
              [attr.stroke]="colores[categoria]"
              vector-effect="non-scaling-stroke"
            />
          }
        </g>
        <g
          [style.opacity]="opacidadMarcas()"
          [class.alguna-resaltada]="estado.fotoResaltadaFin() !== null"
        >
          @for (marca of marcas(); track marca.archivo; let i = $index) {
            <g
              class="marca"
              [class.resaltada]="estado.fotoResaltadaFin() === marca.archivo"
              [class.pointer-events-auto]="activo()"
              [attr.transform]="'translate(' + marca.x + ',' + marca.y + ')'"
              (pointerenter)="apuntar($event, marca.archivo)"
              (pointerleave)="estado.fotoApuntadaFin.set(null)"
              (click)="elegir(marca.archivo)"
            >
              <circle class="pulso" r="9" />
              <circle class="punto" r="6" />
              <circle class="zona" r="16" />
              <text
                [attr.x]="marca.aLaDerecha ? SEPARACION_NOMBRE : -SEPARACION_NOMBRE"
                [attr.text-anchor]="marca.aLaDerecha ? 'start' : 'end'"
                dominant-baseline="central"
              >
                {{ marca.lugar }}
              </text>
            </g>
          }
        </g>
      </svg>
    </div>
  `,
  styles: `
    .recorte {
      mask:
        linear-gradient(
          to right,
          transparent,
          #000 var(--borde),
          #000 calc(100% - var(--borde)),
          transparent
        ),
        linear-gradient(
          to bottom,
          transparent,
          #000 var(--borde),
          #000 calc(100% - var(--borde)),
          transparent
        );
      mask-composite: intersect;
    }
    .tierra {
      fill: var(--color-carton);
      stroke: var(--color-tinta);
      stroke-opacity: 0.55;
      stroke-width: 0.7px;
      stroke-linejoin: round;
    }
    .via {
      fill: none;
      stroke-width: var(--grosor-via);
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .marca {
      cursor: pointer;
      transition: opacity 250ms ease-out;
    }
    .alguna-resaltada .marca:not(.resaltada) {
      opacity: 0.45;
    }
    .punto {
      fill: var(--color-carton);
      stroke: var(--color-tinta);
      stroke-width: 2px;
      transition:
        fill 250ms ease-out,
        r 250ms ease-out;
    }
    .resaltada .punto {
      fill: var(--color-tinta);
      r: 8px;
    }
    .zona {
      fill: transparent;
    }
    .marca text {
      font-size: 12px;
      font-weight: 700;
      fill: var(--color-tinta);
      paint-order: stroke;
      stroke: var(--color-carton);
      stroke-width: 3px;
      stroke-linejoin: round;
    }
    /* La marca resaltada late, como la indicación de los otros checkpoints. */
    .pulso {
      fill: none;
      stroke: var(--color-tinta);
      stroke-width: 1.5px;
      opacity: 0;
    }
    .resaltada .pulso {
      animation: latir 1.6s ease-out infinite;
    }
    @keyframes latir {
      0% {
        opacity: 0.7;
        r: 8px;
      }
      100% {
        opacity: 0;
        r: 22px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .resaltada .pulso {
        animation: none;
      }
    }
  `,
})
export class MapaFin {
  private readonly carga = inject(CargaDatos);
  protected readonly estado = inject(EstadoApp);
  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tamanio = signal({ ancho: 0, alto: 0 }); // px
  protected readonly categorias = CATEGORIAS_DIBUJADAS;
  protected readonly colores = COLOR_CATEGORIA;
  protected readonly SEPARACION_NOMBRE = SEPARACION_NOMBRE;
  protected readonly BORDE_FUNDIDO = BORDE_FUNDIDO;

  constructor() {
    afterNextRender(() => {
      const observador = new ResizeObserver((entradas) => {
        const caja = entradas[0].contentRect;
        this.tamanio.set({ ancho: caja.width, alto: caja.height });
      });
      observador.observe(this.elemento.nativeElement);
    });
  }

  // Aparece en el tramo que sale de Reconectar a la vez que ese mapa se va, y sigue en Fin.
  protected readonly opacidad = computed(() => {
    const posicion = this.estado.posicion();
    if (posicion <= INDICE_RECONECTAR) {
      return 0;
    }
    return 1 - opacidadHasta(posicion, INDICE_RECONECTAR);
  });
  protected readonly activo = computed(() => this.estado.posicion() === INDICE_FIN);

  private readonly proyeccion = computed(() => {
    const datos = this.carga.datos();
    const { ancho, alto } = this.tamanio();
    if (datos === null || ancho === 0) {
      return null;
    }
    return proyeccionDelMapa(poligonosDelMapa(datos), ancho, alto);
  });

  // Los paths van en px del mapa entero; el zoom es una transformación encima, así no se rearman.
  protected readonly caminos = computed(() => {
    const datos = this.carga.datos();
    const proyeccion = this.proyeccion();
    const caminos = { tierra: '', vias: ['', '', '', ''] };
    if (datos === null || proyeccion === null) {
      return caminos;
    }
    const camino = d3.geoPath(proyeccion);
    for (const poligono of poligonosDelMapa(datos)) {
      caminos.tierra += camino({ type: 'Polygon', coordinates: poligono }) ?? '';
    }
    for (let p = 0; p < datos.vias.xy.length; p++) {
      const xy = datos.vias.xy[p];
      const puntos: [number, number][] = [];
      for (let k = 0; k < xy.length; k += 2) {
        puntos.push([xy[k], xy[k + 1]]);
      }
      const categoria = datos.vias.categoria[p];
      if (CATEGORIAS_DIBUJADAS.includes(categoria)) {
        caminos.vias[categoria] += camino({ type: 'LineString', coordinates: puntos }) ?? '';
      }
    }
    return caminos;
  });

  // Del mapa entero a la caja de los lugares de las fotos, con un zoom suave (van Wijk y Nuij) y un
  // ease-in-out. Empieza recién cuando el mapa de Reconectar ya se fue, así se cruzan con el mismo
  // encuadre.
  protected readonly avanceZoom = computed(() => {
    const avance =
      (this.estado.posicion() - INDICE_RECONECTAR - ANCHO_FUNDIDO) / (1 - ANCHO_FUNDIDO);
    return d3.easeCubicInOut(Math.min(Math.max(avance, 0), 1));
  });

  private readonly interpolador = computed(() => {
    const proyeccion = this.proyeccion();
    const { ancho, alto } = this.tamanio();
    if (proyeccion === null) {
      return null;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const foto of FOTOS_FIN) {
      for (const punto of foto.puntos) {
        const [x, y] = proyeccion(punto as [number, number])!;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    const anchoVista = Math.max(x1 - x0, ((y1 - y0) * ancho) / alto) * (1 + AIRE_ZOOM);
    return d3.interpolateZoom(
      [ancho / 2, alto / 2, ancho],
      [(x0 + x1) / 2, (y0 + y1) / 2, anchoVista],
    );
  });

  protected readonly vista = computed(() => {
    const interpolador = this.interpolador();
    const { ancho, alto } = this.tamanio();
    if (interpolador === null) {
      return { k: 1, x: 0, y: 0, transformacion: '' };
    }
    const [cx, cy, anchoVista] = interpolador(this.avanceZoom());
    const k = ancho / anchoVista;
    const x = ancho / 2 - cx * k;
    const y = alto / 2 - cy * k;
    return { k, x, y, transformacion: `translate(${x},${y}) scale(${k})` };
  });

  protected readonly opacidadMarcas = computed(() =>
    Math.min(Math.max((this.avanceZoom() - APARICION_MARCAS) / (1 - APARICION_MARCAS), 0), 1),
  );

  // Cada marca en px de pantalla, fuera del zoom, así su tamaño no cambia: la de un tramo, en el
  // medio de sus puntas. Si su nombre se saldría del panel por su lado, va del otro.
  protected readonly marcas = computed(() => {
    const proyeccion = this.proyeccion();
    const vista = this.vista();
    const ancho = this.tamanio().ancho;
    const marcas: { archivo: string; lugar: string; x: number; y: number; aLaDerecha: boolean }[] =
      [];
    if (proyeccion === null) {
      return marcas;
    }
    for (let i = 0; i < FOTOS_FIN.length; i++) {
      const foto = FOTOS_FIN[i];
      let x = 0;
      let y = 0;
      for (const punto of foto.puntos) {
        const [px, py] = proyeccion(punto as [number, number])!;
        x += px / foto.puntos.length;
        y += py / foto.puntos.length;
      }
      const enPantalla = vista.x + x * vista.k;
      const largo = SEPARACION_NOMBRE + foto.lugar.length * ANCHO_LETRA_NOMBRE + BORDE_FUNDIDO;
      let aLaDerecha = NOMBRE_A_LA_DERECHA[i];
      if (aLaDerecha && enPantalla + largo > ancho) {
        aLaDerecha = false;
      } else if (!aLaDerecha && enPantalla - largo < 0) {
        aLaDerecha = true;
      }
      marcas.push({
        archivo: foto.archivo,
        lugar: foto.lugar,
        x: enPantalla,
        y: vista.y + y * vista.k,
        aLaDerecha,
      });
    }
    return marcas;
  });

  protected apuntar(evento: PointerEvent, archivo: string) {
    if (evento.pointerType === 'mouse') {
      this.estado.fotoApuntadaFin.set(archivo);
    }
  }

  protected elegir(archivo: string) {
    const elegida = this.estado.fotoElegidaFin();
    this.estado.fotoElegidaFin.set(elegida === archivo ? null : archivo);
  }
}
