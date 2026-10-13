import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import * as d3 from 'd3';
import { CargaDatos } from './datos';
import { Diseno, SANGRIA_EJE } from './diseno';
import { CHECKPOINTS, EstadoApp, opacidadDesde, opacidadHasta, ultimoNoNulo } from './estado';
import { CATEGORIAS } from './mapa-argentina';

const ARRIBA = 32; // px para los títulos de los ejes
const ABAJO_ESCRITORIO = 62; // px: debajo del eje pasa el tren, sobre la vía del slider
const ABAJO_CELULAR = 22; // px para los años del eje x
const MARGEN_CELULAR = 44; // px a cada lado del gráfico para los números de los ejes
const ANCHO_NUMEROS_EJE = 34; // px desde el eje derecho hasta el final de sus números
const DURACION_FUNDIDO = 180; // ms que tarda en aparecer una barra
const PESO_CERRADAS = 4; // índice del peso de las estaciones cerradas
const DURACION_ALTERNAR = 350; // ms que tarda una serie en entrar o salir al prenderla o apagarla

// Las columnas de serie.json de cada categoría, de abajo hacia arriba en la pila.
const CAMPOS = ['km_pasajeros', 'km_carga', 'km_inactiva', 'km_levantada'] as const;
const CODIGOS = [3, 2, 1, 0]; // el código de cada campo en vias.json

// El gráfico va del primer checkpoint con año al último.
let PRIMER_CHECKPOINT = -1;
let ULTIMO_CHECKPOINT = 0;
for (let i = 0; i < CHECKPOINTS.length; i++) {
  if (CHECKPOINTS[i].anio !== null) {
    if (PRIMER_CHECKPOINT === -1) {
      PRIMER_CHECKPOINT = i;
    }
    ULTIMO_CHECKPOINT = i;
  }
}
const PRIMER_ANIO = CHECKPOINTS[PRIMER_CHECKPOINT].anio!;
const INDICE_GENTE = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'gente'); // desde acá, el gráfico de los censos
const ULTIMO_ANIO = CHECKPOINTS[ULTIMO_CHECKPOINT].anio!;

function miles(valor: number): string {
  return Math.round(valor).toLocaleString('es-AR');
}

// Los km de vía de cada año en las cuatro categorías del mapa, apilados, y las estaciones cerradas
// por año. Se van dibujando hasta el año de la escena. En escritorio el eje x coincide con los
// checkpoints del slider que está abajo; en el celular el gráfico tiene su propio eje.
@Component({
  selector: 'app-serie-red',
  // El contenedor no recibe el puntero, así el gráfico invisible no tapa al otro.
  host: { class: 'pointer-events-none block' },
  // Sin encapsulación, porque las áreas, las barras y los ejes los crea d3 y Angular no los marca;
  // por eso cada regla empieza con el selector del componente.
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      class="flex size-full flex-col"
      [style.opacity]="opacidad()"
      [class.pointer-events-auto]="opacidad() > 0"
    >
      <div class="pr-4" [style.padding-left.px]="escalas().x0 - SANGRIA_EJE">
        <h2 class="text-2xl leading-tight font-bold max-md:text-xl xl:text-[1.75rem]">
          ¿Cuánta vía quedaba en servicio cada año?
        </h2>
        <p class="mt-1 text-xs leading-snug opacity-60">
          Fuentes:
          <a class="underline" href="metodologia.html#ide" target="_blank" rel="noopener"
            >IDE de Transporte</a
          >,
          <a class="underline" href="metodologia.html#osm" target="_blank" rel="noopener"
            >© OpenStreetMap</a
          >
          y fechas de
          <a class="underline" href="metodologia.html#wikidata" target="_blank" rel="noopener"
            >Wikidata</a
          >. Elaboración propia.
        </p>
        <!-- Cada entrada prende o apaga su serie en el gráfico. -->
        <!-- Centrada sobre el gráfico, entre sus dos ejes. -->
        <ul
          class="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm max-md:mt-2 max-md:gap-x-3 max-md:text-xs"
          [style.margin-left.px]="SANGRIA_EJE"
          [style.width.px]="escalas().x1 - escalas().x0"
        >
          @for (categoria of categorias; track categoria.codigo) {
            <li>
              <button
                class="entrada flex cursor-pointer items-center gap-1"
                [class.apagada]="!estado.viasVisiblesGrafico()[categoria.codigo]"
                [attr.aria-pressed]="estado.viasVisiblesGrafico()[categoria.codigo]"
                (click)="alternarCategoria(categoria.codigo)"
              >
                <svg width="12" height="10" aria-hidden="true">
                  <rect width="12" height="10" [attr.class]="'area-' + categoria.codigo" />
                </svg>
                {{ categoria.nombre }}
              </button>
            </li>
          }
          <li>
            <button
              class="entrada flex cursor-pointer items-center gap-1"
              [class.apagada]="!estado.cerradasVisibles()"
              [attr.aria-pressed]="estado.cerradasVisibles()"
              (click)="estado.cerradasVisibles.set(!estado.cerradasVisibles())"
            >
              <svg width="5" height="10" aria-hidden="true">
                <rect width="5" height="10" class="barra" />
              </svg>
              Estaciones cerradas (eje derecho)
            </button>
          </li>
        </ul>
      </div>
      <!-- El gráfico ocupa lo que deja el encabezado, que puede ocupar más de una línea. -->
      <div #caja class="relative flex-1">
        <svg #lienzo class="absolute inset-0 size-full overflow-visible" aria-hidden="true">
          <defs>
            <pattern
              id="rayado-levantada"
              patternUnits="userSpaceOnUse"
              width="5"
              height="5"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="5"
                style="stroke: var(--color-via-inactiva); stroke-width: 1.8px"
              />
            </pattern>
          </defs>
          <g class="ejes"></g>
          <g class="areas"></g>
          <g class="barras"></g>
          <line class="guia" />
          <rect
            class="sensor"
            fill="transparent"
            (pointermove)="apuntar($event)"
            (pointerdown)="apuntar($event)"
            (pointerleave)="anioApuntado.set(null)"
          />
        </svg>
        @if (fichaMostrada(); as d) {
          <div
            class="ficha pointer-events-none absolute z-10 text-xs whitespace-nowrap"
            [class.oculta]="dato() === null"
            [style.left.px]="d.x"
            [style.top.px]="d.y"
          >
            <b>{{ d.anio }}</b>
            @for (fila of d.filas; track fila.codigo) {
              <div class="flex items-center gap-1.5">
                <svg width="10" height="10" aria-hidden="true">
                  <rect width="10" height="10" [attr.class]="'area-' + fila.codigo" />
                </svg>
                {{ fila.nombre }}: {{ fila.km }} km
              </div>
            }
            @if (d.cerradas !== null) {
              <div class="flex items-center gap-1.5">
                <svg width="10" height="10" aria-hidden="true">
                  <rect x="3" width="4" height="10" class="barra" />
                </svg>
                Estaciones cerradas: {{ d.cerradas }}
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    app-serie-red .area-3 {
      fill: var(--color-via-pasajeros);
    }
    app-serie-red .area-2 {
      fill: var(--color-via-carga);
    }
    app-serie-red .area-1 {
      fill: var(--color-via-inactiva);
    }
    app-serie-red .area-0 {
      fill: url(#rayado-levantada);
    }
    app-serie-red .barra {
      fill: var(--color-cerradas);
    }
    app-serie-red .barras .barra {
      animation: aparecer-barra ${DURACION_FUNDIDO}ms ease-out;
    }
    @keyframes aparecer-barra {
      from {
        opacity: 0;
      }
    }
    app-serie-red .entrada.apagada {
      opacity: 0.4;
      text-decoration: line-through;
    }
    app-serie-red .guia {
      stroke: var(--color-tinta);
      stroke-opacity: 0.5;
      stroke-dasharray: 2 3;
    }
    /* Un talón cortado del boleto: muescas a los costados. */
    app-serie-red .ficha.oculta {
      opacity: 0;
    }
    app-serie-red .ficha {
      translate: -50% calc(-100% - 10px);
      transition: opacity 200ms;
      padding: 8px 16px;
      background:
        radial-gradient(circle at 0 50%, transparent 7px, var(--color-carton) 7.5px) left / 51% 100%
          no-repeat,
        radial-gradient(circle at 100% 50%, transparent 7px, var(--color-carton) 7.5px) right / 51%
          100% no-repeat;
      filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.25));
    }
  `,
})
export class SerieRed {
  private readonly carga = inject(CargaDatos);
  protected readonly estado = inject(EstadoApp);
  protected readonly SANGRIA_EJE = SANGRIA_EJE;
  private readonly diseno = inject(Diseno);
  private readonly lienzo = viewChild.required<ElementRef<SVGSVGElement>>('lienzo');
  private readonly caja = viewChild.required<ElementRef<HTMLElement>>('caja');
  private readonly tamanio = signal({ ancho: 0, alto: 0 }); // px
  protected readonly categorias = CATEGORIAS;
  protected readonly anioApuntado = signal<number | null>(null);

  // Cuánto de cada serie se dibuja, de 0 a 1; se anima al prenderla o apagarla. Las cuatro primeras
  // son las categorías de vía, por código; la última, las estaciones cerradas.
  private readonly pesos = signal(this.pesosDe(this.seriesVisibles()));
  private animacion = 0;

  // Aparece junto con el texto del primer año y se va junto con el texto del último, antes de que el
  // gráfico de los censos tome su lugar.
  protected readonly opacidad = computed(() => {
    const posicion = this.estado.posicion();
    return Math.min(
      opacidadDesde(posicion, PRIMER_CHECKPOINT),
      opacidadHasta(posicion, INDICE_GENTE - 1),
    );
  });

  // El año hasta el que se dibuja, continuo; antes del primer año es el primero.
  private readonly anioDibujado = computed(() => {
    const anio = this.estado.anio();
    if (anio !== null) {
      return anio;
    }
    if (this.estado.posicion() >= ULTIMO_CHECKPOINT) {
      return ULTIMO_ANIO;
    }
    return PRIMER_ANIO;
  });

  // La suma de las cuatro categorías de cada año: el techo de la pila.
  private readonly totales = computed(() => {
    const datos = this.carga.datos();
    const totales: number[] = [];
    if (datos === null) {
      return totales;
    }
    for (let k = 0; k < datos.serie.anio.length; k++) {
      let total = 0;
      for (const campo of CAMPOS) {
        total += datos.serie[campo][k];
      }
      totales.push(total);
    }
    return totales;
  });

  // En escritorio el host empieza en el borde izquierdo del boleto, así que la posición de un
  // checkpoint en px es su fracción por el ancho del boleto.
  protected readonly escalas = computed(() => {
    const { ancho, alto } = this.tamanio();
    const datos = this.carga.datos();
    let x0 = MARGEN_CELULAR;
    let x1 = ancho - MARGEN_CELULAR;
    let abajo = ABAJO_CELULAR;
    if (!this.diseno.esCelular()) {
      const xCheckpoints = this.diseno.xCheckpoints();
      x0 = xCheckpoints[PRIMER_CHECKPOINT] * this.diseno.anchoBoleto();
      x1 = xCheckpoints[ULTIMO_CHECKPOINT] * this.diseno.anchoBoleto();
      abajo = ABAJO_ESCRITORIO;
    }
    let kmMaximo = 1;
    let cerradasMaximo = 1;
    if (datos !== null) {
      kmMaximo = d3.max(this.totales())!;
      for (const cerradas of datos.serie.cerradas) {
        cerradasMaximo = Math.max(cerradasMaximo, cerradas ?? 0);
      }
    }
    return {
      x0,
      x1,
      x: d3.scaleLinear().domain([PRIMER_ANIO, ULTIMO_ANIO]).range([x0, x1]),
      km: d3
        .scaleLinear()
        .domain([0, kmMaximo])
        .nice()
        .range([alto - abajo, ARRIBA]),
      cerradas: d3
        .scaleLinear()
        .domain([0, cerradasMaximo])
        .nice()
        .range([alto - abajo, ARRIBA]),
    };
  });

  // Lo que muestra la ficha del año apuntado, que no puede ser posterior al dibujado.
  protected readonly dato = computed(() => {
    const anio = this.anioApuntado();
    const datos = this.carga.datos();
    if (anio === null || datos === null || anio > this.anioDibujado()) {
      return null;
    }
    const k = anio - PRIMER_ANIO;
    // Sólo las series prendidas, de arriba hacia abajo como en la pila.
    const filas = [];
    for (let c = CAMPOS.length - 1; c >= 0; c--) {
      if (this.estado.viasVisiblesGrafico()[CODIGOS[c]]) {
        const categoria = CATEGORIAS.find((cat) => cat.codigo === CODIGOS[c])!;
        filas.push({
          codigo: CODIGOS[c],
          nombre: categoria.nombre,
          km: miles(datos.serie[CAMPOS[c]][k]),
        });
      }
    }
    const cerradas = datos.serie.cerradas[k] ?? 0;
    let textoCerradas: string | null = null;
    if (this.estado.cerradasVisibles()) {
      textoCerradas = miles(cerradas);
    }
    const escalas = this.escalas();
    return {
      anio,
      filas,
      cerradas: textoCerradas,
      x: escalas.x(anio),
      y: Math.min(escalas.km(this.totales()[k]), escalas.cerradas(cerradas)),
    };
  });

  // La ficha sigue dibujada con lo último que mostró mientras se desvanece.
  protected readonly fichaMostrada = ultimoNoNulo(this.dato);

  constructor() {
    // Al dejar el checkpoint la ficha se desvanece, aunque el puntero siga encima: lo que tenía
    // abajo cambia o desaparece y no siempre llega el pointerleave.
    effect(() => {
      if (this.estado.checkpoint() === null) {
        untracked(() => {
          this.anioApuntado.set(null);
        });
      }
    });
    afterNextRender(() => {
      const observador = new ResizeObserver((entradas) => {
        const caja = entradas[0].contentRect;
        this.tamanio.set({ ancho: caja.width, alto: caja.height });
      });
      observador.observe(this.caja().nativeElement);
    });
    effect(() => {
      const visibles = this.seriesVisibles();
      untracked(() => this.animarPesos(visibles));
    });
    effect(() => this.dibujarEjes());
    effect(() => this.dibujarDatos());
    effect(() => this.dibujarApuntado());
  }

  // Lleva el peso de cada categoría hacia 1 si está prendida y hacia 0 si no. Una animación nueva
  // corta la anterior y sigue desde donde quedó.
  private animarPesos(visibles: boolean[]) {
    cancelAnimationFrame(this.animacion);
    const desde = this.pesos().slice();
    const inicio = performance.now();
    const cuadro = (ahora: number) => {
      const avance = d3.easeCubicInOut(Math.min((ahora - inicio) / DURACION_ALTERNAR, 1));
      const pesos = [];
      for (let codigo = 0; codigo < desde.length; codigo++) {
        const objetivo = visibles[codigo] ? 1 : 0;
        pesos.push(desde[codigo] + (objetivo - desde[codigo]) * avance);
      }
      this.pesos.set(pesos);
      if (avance < 1) {
        this.animacion = requestAnimationFrame(cuadro);
      }
    };
    this.animacion = requestAnimationFrame(cuadro);
  }

  private seriesVisibles(): boolean[] {
    return [...this.estado.viasVisiblesGrafico(), this.estado.cerradasVisibles()];
  }

  private pesosDe(visibles: boolean[]): number[] {
    const pesos = [];
    for (const visible of visibles) {
      pesos.push(visible ? 1 : 0);
    }
    return pesos;
  }

  protected alternarCategoria(codigo: number) {
    const visibles = this.estado.viasVisiblesGrafico().slice();
    visibles[codigo] = !visibles[codigo];
    this.estado.viasVisiblesGrafico.set(visibles);
  }

  protected apuntar(evento: PointerEvent) {
    const [px] = d3.pointer(evento, this.lienzo().nativeElement);
    const anio = Math.round(this.escalas().x.invert(px));
    // Sólo un año ya dibujado: sobre la parte que el slider todavía no reveló no hay ficha.
    if (anio < PRIMER_ANIO || anio > Math.floor(this.anioDibujado())) {
      this.anioApuntado.set(null);
      return;
    }
    this.anioApuntado.set(anio);
  }

  // Dos ejes y: a la izquierda los km y a la derecha las estaciones, cada uno con su título. En
  // escritorio, de cada checkpoint con año baja una guía hasta su aro en la vía del slider.
  private dibujarEjes() {
    const { ancho, alto } = this.tamanio();
    if (ancho === 0 || this.carga.datos() === null) {
      return;
    }
    const { x0, x1, x, km, cerradas } = this.escalas();
    const svg = d3.select(this.lienzo().nativeElement);
    const ejes = svg.select<SVGGElement>('.ejes');
    ejes.selectAll('*').remove();

    const base = km.range()[0];
    const ejeX = ejes.append('g').attr('transform', `translate(0,${base})`);
    if (this.diseno.esCelular()) {
      ejeX.call(
        d3
          .axisBottom(x)
          .tickValues([PRIMER_ANIO, 1900, 1950, 2000, ULTIMO_ANIO])
          .tickFormat(d3.format('d'))
          .tickSizeOuter(0),
      );
    } else {
      // Los años los dice el slider de abajo: acá sólo van las marcas de cada década.
      ejeX.call(
        d3
          .axisBottom(x)
          .ticks(17)
          .tickFormat(() => '')
          .tickSizeOuter(0),
      );
      for (const checkpoint of CHECKPOINTS) {
        if (checkpoint.anio !== null) {
          ejes
            .append('line')
            .attr('class', 'guia')
            .attr('x1', x(checkpoint.anio))
            .attr('x2', x(checkpoint.anio))
            .attr('y1', base)
            .attr('y2', alto);
        }
      }
    }
    ejes
      .append('g')
      .attr('transform', `translate(${x0},0)`)
      .call(
        d3
          .axisLeft(km)
          .ticks(5)
          .tickFormat((v) => miles(+v))
          .tickSizeOuter(0),
      );
    ejes
      .append('g')
      .attr('transform', `translate(${x1},0)`)
      .call(d3.axisRight(cerradas).ticks(4).tickSizeOuter(0));
    ejes.selectAll('.domain').attr('stroke', 'var(--color-tinta)').attr('stroke-opacity', 0.6);
    ejes.selectAll('.tick line').attr('stroke', 'var(--color-tinta)').attr('stroke-opacity', 0.6);
    ejes
      .selectAll('.tick text')
      .attr('fill', 'var(--color-tinta)')
      .attr('font-family', 'inherit')
      .attr('font-size', 12);

    const arriba = km.range()[1] - 14;
    ejes
      .append('text')
      .attr('x', x0)
      .attr('y', arriba)
      .attr('text-anchor', 'middle')
      .attr('font-size', 13)
      .attr('fill', 'var(--color-tinta)')
      .text('km de vía');
    // Termina donde terminan los números del eje: centrado, en el celular se saldría del gráfico.
    ejes
      .append('text')
      .attr('x', x1 + ANCHO_NUMEROS_EJE)
      .attr('y', arriba)
      .attr('text-anchor', 'end')
      .attr('font-size', 13)
      .attr('fill', 'var(--color-tinta)')
      .text('estaciones cerradas');

    svg
      .select('.sensor')
      .attr('x', x0)
      .attr('y', km.range()[1])
      .attr('width', x1 - x0)
      .attr('height', base - km.range()[1]);
  }

  // Las áreas llegan hasta el año de la escena, con el último tramo interpolado; las barras son las
  // de los años completos.
  private dibujarDatos() {
    const datos = this.carga.datos();
    if (datos === null || this.tamanio().ancho === 0) {
      return;
    }
    const anio = this.anioDibujado();
    const { x, km, cerradas } = this.escalas();
    const serie = datos.serie;
    const ultimoEntero = Math.floor(anio);

    // Los años a dibujar y el valor de cada categoría en cada uno; el último puede ser fraccionario.
    const anios: number[] = [];
    const valores: number[][] = [];
    for (let a = PRIMER_ANIO; a <= ultimoEntero; a++) {
      anios.push(a);
      const fila = [];
      for (const campo of CAMPOS) {
        fila.push(serie[campo][a - PRIMER_ANIO]);
      }
      valores.push(fila);
    }
    if (anio > ultimoEntero) {
      const k = ultimoEntero - PRIMER_ANIO;
      const avance = anio - ultimoEntero;
      anios.push(anio);
      const fila = [];
      for (const campo of CAMPOS) {
        fila.push(serie[campo][k] + (serie[campo][k + 1] - serie[campo][k]) * avance);
      }
      valores.push(fila);
    }

    const capas = [];
    const abajo = new Array(anios.length).fill(0);
    // Cada categoría ocupa su valor por su peso: apagada no ocupa lugar y las de arriba bajan. La
    // escala queda fija.
    const pesos = this.pesos();
    for (let c = 0; c < CAMPOS.length; c++) {
      const peso = pesos[CODIGOS[c]];
      if (peso === 0) {
        continue;
      }
      const puntos: [number, number, number][] = [];
      for (let i = 0; i < anios.length; i++) {
        puntos.push([anios[i], abajo[i], abajo[i] + valores[i][c] * peso]);
        abajo[i] += valores[i][c] * peso;
      }
      capas.push({ codigo: CODIGOS[c], puntos });
    }
    const area = d3
      .area<[number, number, number]>()
      .x((p) => x(p[0]))
      .y0((p) => km(p[1]))
      .y1((p) => km(p[2]));
    const svg = d3.select(this.lienzo().nativeElement);
    svg
      .select('.areas')
      .selectAll<SVGPathElement, { codigo: number; puntos: [number, number, number][] }>('path')
      .data(capas)
      .join('path')
      .attr('class', (capa) => `area-${capa.codigo}`)
      .attr('d', (capa) => area(capa.puntos));

    const barras: { anio: number; cerradas: number }[] = [];
    for (let a = PRIMER_ANIO; a <= ultimoEntero; a++) {
      const valor = serie.cerradas[a - PRIMER_ANIO];
      if (valor !== null && valor > 0) {
        barras.push({ anio: a, cerradas: valor });
      }
    }
    const anchoBarra = Math.max(1, x(PRIMER_ANIO + 1) - x(PRIMER_ANIO) - 1);
    const pesoCerradas = pesos[PESO_CERRADAS];
    svg
      .select('.barras')
      .selectAll<SVGRectElement, { anio: number; cerradas: number }>('rect')
      .data(barras, (barra) => barra.anio)
      .join('rect')
      .attr('class', 'barra')
      .attr('x', (barra) => x(barra.anio) - anchoBarra / 2)
      .attr('width', anchoBarra)
      // Crecen desde la base con su peso al prenderlas.
      .attr('y', (barra) => cerradas(barra.cerradas * pesoCerradas))
      .attr('height', (barra) => cerradas(0) - cerradas(barra.cerradas * pesoCerradas));
  }

  private dibujarApuntado() {
    const dato = this.dato();
    const guia = d3.select(this.lienzo().nativeElement).select(':scope > .guia');
    guia.attr('visibility', dato === null ? 'hidden' : 'visible');
    if (dato === null) {
      return;
    }
    const { km } = this.escalas();
    guia.attr('x1', dato.x).attr('x2', dato.x).attr('y1', km.range()[0]).attr('y2', km.range()[1]);
  }
}
