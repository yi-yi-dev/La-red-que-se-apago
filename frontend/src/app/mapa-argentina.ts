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
} from '@angular/core';
import * as d3 from 'd3';
import { CargaDatos, Datos } from './datos';
import { CHECKPOINTS, EstadoApp, opacidadDesde, opacidadEn, opacidadHasta } from './estado';
import { provinciasDelUltimoCenso } from './serie-censos';

// Los polígonos de las provincias y la proyección que los encaja en un lugar: la usan este mapa y la
// capa de Reconectar, que va encima y tiene que coincidir punto por punto. Los datos ya vienen en
// hectómetros, así que sólo se escala, se centra y se da vuelta el eje y.
export function poligonosDelMapa(datos: Datos): [number, number][][][] {
  const poligonos: [number, number][][][] = [];
  for (const anillo of datos.mapa_base.anillos) {
    const puntos: [number, number][] = [];
    for (let k = 0; k < anillo.length; k += 2) {
      puntos.push([anillo[k], anillo[k + 1]]);
    }
    poligonos.push([puntos]);
  }
  return poligonos;
}

// hm de EPSG:5346: la caja de las Malvinas, al este de Tierra del Fuego. Ninguna costa del
// continente entra en ella.
const MALVINAS = { xMinimo: 46000, yMaximo: 45000 };
const AIRE_MALVINAS = 12; // px entre las leyendas del mapa y las islas

// Las leyendas al lado del mapa terminan justo arriba de las Malvinas, el único lugar sin país en
// esa esquina: la distancia, en px, del borde de abajo del mapa a ese punto.
export function bajoLeyendas(
  poligonos: [number, number][][][],
  proyeccion: d3.GeoIdentityTransform,
  alto: number,
): number {
  let arriba = -Infinity;
  for (const poligono of poligonos) {
    for (const [x, y] of poligono[0]) {
      if (x > MALVINAS.xMinimo && y < MALVINAS.yMaximo) {
        arriba = Math.max(arriba, y);
      }
    }
  }
  return alto - proyeccion([MALVINAS.xMinimo, arriba])![1] + AIRE_MALVINAS;
}

export function proyeccionDelMapa(poligonos: [number, number][][][], ancho: number, alto: number) {
  return d3
    .geoIdentity()
    .reflectY(true)
    .fitSize([ancho, alto], { type: 'MultiPolygon', coordinates: poligonos });
}

// Los códigos de `categoria` en vias.json, en el orden de la leyenda. La explicación es para quien
// nunca leyó del tema.
export const CATEGORIAS = [
  { codigo: 3, nombre: 'Con pasajeros', explicacion: 'trenes que llevan gente' },
  { codigo: 2, nombre: 'Sólo carga', explicacion: 'pasan trenes, pero no llevan gente' },
  { codigo: 1, nombre: 'Vía sin trenes', explicacion: 'los rieles están, no pasa nada' },
  { codigo: 0, nombre: 'Vía levantada', explicacion: 'se sacaron los rieles' },
];
const NO_CONSTRUIDA = -1;
const DURACION_FUNDIDO = 180; // ms que tarda en aparecer una parte de vía

const PRIMER_CON_ANIO = CHECKPOINTS.findIndex((checkpoint) => checkpoint.anio !== null);
const INDICE_GENTE = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'gente');
const INDICE_PROVINCIAS = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'provincias');
const INDICE_RECONECTAR = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'reconectar');
// Las categorías de censos.json, en su orden, para el mapa de las provincias.
const CATEGORIAS_GENTE = [
  { nombre: 'Con tren de pasajeros', color: 'var(--color-via-pasajeros)' },
  { nombre: 'Solo tren de carga', color: 'var(--color-via-carga)' },
  { nombre: 'Perdió el tren', color: 'var(--color-via-inactiva)' },
  { nombre: 'Nunca tuvo tren', color: 'var(--color-sin-tren)' },
];
// hm de mapa: el radio del círculo del departamento con más gente. Al estar en unidades del mapa,
// los círculos siguen su tamaño cuando el mapa se achica.
const RADIO_MAXIMO = 860;
const DURACION_DORLING = 600; // ms que tardan los círculos en pasar de una parte elegida a otra
// Para las categorías de censos.json, en su orden: la frase de la descripción y el color.
const NOMBRES_GENTE = [
  'a menos de 10 km de una estación con trenes de pasajeros',
  'a menos de 10 km de una estación con solo trenes de carga',
  'a menos de 10 km de una estación que se quedó sin trenes',
  'a más de 10 km de cualquier estación de tren',
];
const VALORES_REFERENCIA = [100_000, 500_000, 1_500_000]; // personas de los círculos de la escala
const ESPACIO_REFERENCIA = 8; // px entre los círculos de la escala
// Van como atributo: los estilos del componente no llegan a lo que crea d3.
const COLORES_GENTE = [
  'var(--color-via-pasajeros)',
  'var(--color-via-carga)',
  'var(--color-via-inactiva)',
  'var(--color-sin-tren)',
];

// Desde el último checkpoint con año en adelante, el mapa queda en ese año.
let ULTIMO_CON_ANIO = 0;
for (let i = 0; i < CHECKPOINTS.length; i++) {
  if (CHECKPOINTS[i].anio !== null) {
    ULTIMO_CON_ANIO = i;
  }
}

// La categoría de una parte de vía en un año, con la regla que describe el 3_ de DataWrangling.
function categoriaEn(
  anio: number,
  categoria: number,
  alta: number,
  finPasajeros: number | null,
  baja: number | null,
): number {
  if (alta > anio) {
    return NO_CONSTRUIDA;
  }
  if (finPasajeros === null || anio < finPasajeros) {
    return 3;
  }
  if (baja === null || anio < baja) {
    return 2;
  }
  return categoria;
}

// El mapa de la Argentina con la red del año de la escena. Los datos ya vienen proyectados en
// hectómetros, así que d3 no proyecta: sólo escala, centra y da vuelta el eje y. La red de un año
// son dos paths por categoría armados juntando trazos precalculados, así repintarla es barato y el
// slider no se traba.
@Component({
  selector: 'app-mapa-argentina',
  host: { class: 'block', '[style.opacity]': 'opacidadMapa()' },
  template: `
    <svg
      #lienzo
      class="mapa-vias size-full"
      role="img"
      aria-label="Mapa de la red ferroviaria argentina"
      [class.ocultar-3]="!visibles()[3]"
      [class.ocultar-2]="!visibles()[2]"
      [class.ocultar-1]="!visibles()[1]"
      [class.ocultar-0]="!visibles()[0]"
    >
      <g class="provincias"></g>
      <!-- En el checkpoint de las provincias, cada una pintada según la parte de su gente en la
           categoría elegida, de 0 % (el cartón) a 100 % (el color de la categoría). -->
      <g [style.opacity]="opacidadProvincias()">
        @for (provincia of provinciasDelMapa(); track provincia.codigo) {
          <path
            class="provincia-pintada"
            [attr.d]="provincia.d"
            [style.fill]="colorProvincia(provincia.porcentaje)"
          />
        }
      </g>
      <!-- En la portada, la red con trenes de pasajeros de su año máximo: en rojo lo que se perdió
           y en verde lo que queda. Se desvanece en el tramo que llega al primer año. -->
      <g class="portada" [style.opacity]="opacidadPortada()">
        <path class="via portada-perdida" [class.apagada]="!portadaVisibles()[0]" />
        <path class="via portada-queda" [class.apagada]="!portadaVisibles()[1]" />
      </g>
      <!-- De abajo hacia arriba, de la levantada a la de pasajeros. En cada categoría, las partes
           que acaban de aparecer van en su propio path, que es el que hace el fundido. -->
      <!-- En el checkpoint de la gente la red se va y quedan los círculos de los departamentos. -->
      <g [style.opacity]="opacidadRed()">
        @for (codigo of ORDEN_DE_DIBUJO; track codigo) {
          <path [attr.class]="'via via-' + codigo" />
          <path [attr.class]="'via via-' + codigo + ' recien'" />
        }
      </g>
      <g class="dorling" [style.opacity]="opacidadGente()"></g>
    </svg>
    <!-- En el checkpoint de las provincias: qué categoría pinta el mapa y su escala. -->
    <div
      [style.bottom.px]="bajo()"
      class="absolute right-0 flex w-48 flex-col items-stretch gap-1 text-xs"
      [style.opacity]="opacidadProvincias()"
      [class.invisible]="opacidadProvincias() === 0"
    >
      <p class="mb-1 font-bold">
        Parte de la gente de cada provincia en el censo de {{ ultimoCenso() }}
      </p>
      @for (categoria of categoriasGente; track categoria.nombre; let i = $index) {
        <button
          class="opcion-provincias cursor-pointer text-left"
          [class.elegida]="estado.categoriaProvincias() === i"
          [style.border-left-color]="categoria.color"
          [attr.aria-pressed]="estado.categoriaProvincias() === i"
          (click)="elegirCategoriaProvincias(i)"
        >
          {{ categoria.nombre }}
        </button>
      }
      <div
        class="mt-2 h-2.5 w-full"
        [style.background]="
          'linear-gradient(to right, var(--color-carton), ' +
          categoriasGente[estado.categoriaProvincias()].color +
          ')'
        "
        style="border: 1px solid rgb(43 43 43 / 0.4)"
      ></div>
      <div class="flex w-full justify-between text-[10px]">
        <span>0 %</span><span>50 %</span><span>100 %</span>
      </div>
    </div>
    <!-- Cómo leer los círculos, con su escala, o la invitación a elegir una parte del gráfico. -->
    <div
      [style.bottom.px]="bajo()"
      class="absolute right-0 w-48 text-xs leading-snug"
      [style.opacity]="opacidadGente()"
      [class.invisible]="opacidadGente() === 0"
    >
      @if (descripcionGente(); as descripcion) {
        <svg
          class="mb-2 block overflow-visible"
          [attr.width]="escalaReferencia().ancho"
          [attr.height]="escalaReferencia().alto"
          aria-hidden="true"
        >
          @for (circulo of escalaReferencia().circulos; track circulo.texto) {
            <circle
              [attr.cx]="circulo.x"
              [attr.cy]="escalaReferencia().base - circulo.r"
              [attr.r]="circulo.r"
              fill="none"
              stroke="var(--color-tinta)"
              stroke-opacity="0.6"
            />
            <text
              [attr.x]="circulo.x"
              [attr.y]="escalaReferencia().base + 12"
              text-anchor="middle"
              font-size="10"
              fill="var(--color-tinta)"
            >
              {{ circulo.texto }}
            </text>
          }
        </svg>
        <p>{{ descripcion }}</p>
      } @else {
        <p>Tocá una parte de una barra del gráfico para ver acá dónde vive esa gente.</p>
      }
    </div>
    <!-- En el Atlántico, entre Chubut y Malvinas. Las explicaciones se parten en dos líneas para
         que la leyenda no llegue a la costa. -->
    <!-- En la portada, la leyenda de las dos redes, en el mismo lugar que la de las vías. -->
    <div
      [style.bottom.px]="bajo()"
      class="absolute right-0 flex w-44 flex-col items-start gap-1.5 text-xs"
      [style.opacity]="opacidadPortada()"
      [class.invisible]="opacidadPortada() === 0"
    >
      <!-- Cada entrada prende y apaga su red, como la leyenda de las vías. -->
      <button
        class="entrada flex cursor-pointer items-start gap-2 text-left"
        [class.apagada]="!portadaVisibles()[0]"
        [attr.aria-pressed]="portadaVisibles()[0]"
        (click)="alternarPortada(0)"
      >
        <svg class="mt-[5px] shrink-0" width="22" height="8" aria-hidden="true">
          <line x1="2" y1="4" x2="20" y2="4" class="muestra portada-perdida" />
        </svg>
        <span>Vías que perdieron sus trenes de pasajeros desde {{ anioPico() }}</span>
      </button>
      <button
        class="entrada flex cursor-pointer items-start gap-2 text-left"
        [class.apagada]="!portadaVisibles()[1]"
        [attr.aria-pressed]="portadaVisibles()[1]"
        (click)="alternarPortada(1)"
      >
        <svg class="mt-[5px] shrink-0" width="22" height="8" aria-hidden="true">
          <line x1="2" y1="4" x2="20" y2="4" class="muestra portada-queda" />
        </svg>
        <span>Vías que todavía los tienen</span>
      </button>
    </div>
    <div
      [style.bottom.px]="bajo()"
      class="leyenda-vias absolute right-0 flex w-44 flex-col items-start gap-0.5 text-xs"
      [style.opacity]="opacidadLeyenda()"
      [class.invisible]="opacidadLeyenda() === 0"
    >
      @for (categoria of categorias; track categoria.codigo) {
        <button
          class="entrada flex cursor-pointer items-start gap-2 py-0.5 text-left"
          [class.apagada]="!visibles()[categoria.codigo]"
          [attr.aria-pressed]="visibles()[categoria.codigo]"
          (click)="alternar(categoria.codigo)"
        >
          <svg class="mt-[5px] shrink-0" width="22" height="8" aria-hidden="true">
            <line x1="2" y1="4" x2="20" y2="4" [attr.class]="'muestra via-' + categoria.codigo" />
          </svg>
          <span>
            {{ categoria.nombre }}
            <small class="block text-[10px] opacity-70">{{ categoria.explicacion }}</small>
          </span>
        </button>
      }
    </div>
    <!-- La fuente, en la esquina de abajo, debajo de Malvinas: en el checkpoint de la gente, la de
         los círculos. Cada nombre lleva a su ficha en metodologia.html, que enlaza la licencia: así
         la atribución de OpenStreetMap se lee y llega a la ODbL. -->
    <p
      class="absolute right-0 bottom-0 w-52 text-left text-[10px] leading-snug"
      [style.opacity]="0.75 * opacidadFuente()"
    >
      Fuentes:
      @if (despuesDeLaGente()) {
        <!-- Las provincias, pintadas con la gente del último censo. -->
        <a class="underline" href="metodologia.html#indec" target="_blank" rel="noopener">INDEC</a>,
        <a class="underline" href="metodologia.html#ide" target="_blank" rel="noopener"
          >IDE de Transporte</a
        >,
        <a class="underline" href="metodologia.html#osm" target="_blank" rel="noopener"
          >© OpenStreetMap</a
        >
        e
      } @else if (desdeLaGente()) {
        <a class="underline" href="metodologia.html#indec" target="_blank" rel="noopener">INDEC</a>,
        <a class="underline" href="metodologia.html#ide" target="_blank" rel="noopener"
          >IDE de Transporte</a
        >,
        <a class="underline" href="metodologia.html#osm" target="_blank" rel="noopener"
          >© OpenStreetMap</a
        >
        e
      } @else {
        <a class="underline" href="metodologia.html#ide" target="_blank" rel="noopener"
          >IDE de Transporte</a
        >,
        <a class="underline" href="metodologia.html#osm" target="_blank" rel="noopener"
          >© OpenStreetMap</a
        >,
        <a class="underline" href="metodologia.html#wikidata" target="_blank" rel="noopener"
          >Wikidata</a
        >
        e
      }
      <a class="underline" href="metodologia.html#ign" target="_blank" rel="noopener">IGN</a>.
      Elaboración propia.
    </p>
  `,
  styles: `
    .provincia-pintada {
      stroke: var(--color-tinta);
      stroke-opacity: 0.55;
      stroke-width: 0.7px;
      stroke-linejoin: round;
      transition: fill 400ms ease-in-out;
    }
    /* Cada opción es una ficha de cartón con el borde izquierdo del color de su categoría; la
       elegida, en el cartón del talón y con borde de tinta. */
    .opcion-provincias {
      padding: 3px 8px;
      border: 1px solid rgb(43 43 43 / 0.35);
      border-left-width: 5px;
      border-radius: 2px;
      opacity: 0.75;
      transition:
        background-color 200ms,
        opacity 200ms;
    }
    .opcion-provincias.elegida {
      border-top-color: var(--color-tinta);
      border-right-color: var(--color-tinta);
      border-bottom-color: var(--color-tinta);
      background: var(--color-talon);
      font-weight: 700;
      opacity: 1;
    }
    /* Prender o apagar una capa desde la leyenda es un fundido corto. */
    .via {
      transition: opacity 200ms ease-out;
      fill: none;
      stroke-width: var(--grosor-via);
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    /* Las dos redes de la portada no dependen de lo que se prende en la leyenda. */
    .portada-perdida {
      stroke: var(--color-via-inactiva);
    }
    .portada-queda {
      stroke: var(--color-via-pasajeros);
    }
    .mapa-vias.ocultar-3 .via-3,
    .mapa-vias.ocultar-2 .via-2,
    .mapa-vias.ocultar-1 .via-1,
    .mapa-vias.ocultar-0 .via-0,
    .via.apagada {
      opacity: 0;
    }
    .via-3 {
      stroke: var(--color-via-pasajeros);
    }
    .via-2 {
      stroke: var(--color-via-carga);
    }
    .via-1 {
      stroke: var(--color-via-inactiva);
    }
    .via-0 {
      stroke: var(--color-via-inactiva);
      stroke-dasharray: 0.1 4;
    }
    .muestra {
      stroke-linecap: round;
      stroke-width: 2.5px;
    }
    .muestra.via-0 {
      stroke-dasharray: 0.1 4;
    }
    .entrada.apagada {
      opacity: 0.4;
      text-decoration: line-through;
    }
  `,
})
export class MapaArgentina {
  private readonly carga = inject(CargaDatos);
  protected readonly ultimoCenso = computed(() => this.carga.datos()?.censos.censo.at(-1) ?? null);
  protected readonly estado = inject(EstadoApp);
  private readonly lienzo = viewChild.required<ElementRef<SVGSVGElement>>('lienzo');
  private readonly tamanio = signal({ ancho: 0, alto: 0 }); // px
  protected readonly categorias = CATEGORIAS;
  protected readonly ORDEN_DE_DIBUJO = [0, 1, 2, 3];
  protected readonly visibles = this.estado.viasVisiblesMapa; // por código de categoría

  // El año de la red: el de la escena, el último con año pasado el final, o null antes de 1857.
  // La portada se ve en el checkpoint del principio y se va en el tramo que llega al primer año.
  protected readonly portadaVisibles = signal([true, true]); // la red que se perdió y la que queda
  protected alternarPortada(cual: number) {
    const visibles = this.portadaVisibles().slice();
    visibles[cual] = !visibles[cual];
    this.portadaVisibles.set(visibles);
  }
  protected readonly opacidadPortada = computed(() => opacidadEn(this.estado.posicion(), 0));
  // La leyenda de las vías aparece a la vez que el texto y el gráfico del primer año.
  // Los círculos y su nota se ven sólo en el checkpoint de la gente: en el de las provincias el gráfico
  // ya no se puede elegir y el mapa queda con las provincias solas.
  protected readonly opacidadGente = computed(() =>
    Math.min(
      opacidadDesde(this.estado.posicion(), INDICE_GENTE),
      opacidadHasta(this.estado.posicion(), INDICE_GENTE),
    ),
  );
  protected readonly despuesDeLaGente = computed(() => this.estado.posicion() > INDICE_GENTE + 0.5);
  // El texto de la fuente cambia a mitad de tramo, cuando no se ve.
  protected readonly desdeLaGente = computed(() => this.estado.posicion() > INDICE_GENTE - 0.5);
  // La fuente cambia de texto al pasar a la gente y a las provincias: se va y vuelve con los mismos
  // fundidos que el resto, aunque diga lo mismo.
  protected readonly opacidadFuente = computed(() => {
    const posicion = this.estado.posicion();
    const actualidad = INDICE_GENTE - 1;
    if (posicion > actualidad && posicion < INDICE_GENTE) {
      return opacidadHasta(posicion, actualidad) + opacidadDesde(posicion, INDICE_GENTE);
    }
    if (posicion > INDICE_GENTE && posicion < INDICE_PROVINCIAS) {
      return opacidadHasta(posicion, INDICE_GENTE) + opacidadDesde(posicion, INDICE_PROVINCIAS);
    }
    if (posicion > INDICE_PROVINCIAS && posicion < INDICE_RECONECTAR) {
      return (
        opacidadHasta(posicion, INDICE_PROVINCIAS) + opacidadDesde(posicion, INDICE_RECONECTAR)
      );
    }
    return 1;
  });
  // Fin queda libre: el mapa entero se va al dejar Reconectar.
  protected readonly opacidadMapa = computed(() =>
    opacidadHasta(this.estado.posicion(), INDICE_RECONECTAR),
  );
  protected readonly opacidadProvincias = computed(() =>
    Math.min(
      opacidadDesde(this.estado.posicion(), INDICE_PROVINCIAS),
      opacidadHasta(this.estado.posicion(), INDICE_PROVINCIAS),
    ),
  );
  protected readonly categoriasGente = CATEGORIAS_GENTE;

  // Los polígonos de cada provincia en un solo path. Cada anillo de mapa_base es de la provincia de los
  // centros de departamento que caen adentro; una isla sin ninguno, de la del centro más cercano.
  private readonly anillosPorProvincia = signal<{ codigo: string; d: string }[]>([]);

  protected readonly provinciasDelMapa = computed(() => {
    const datos = this.carga.datos();
    if (datos === null) {
      return [];
    }
    const categoria = this.estado.categoriaProvincias();
    const porcentajes = new Map<string, number>();
    const provincias = provinciasDelUltimoCenso(datos);
    for (const provincia of provincias) {
      porcentajes.set(provincia.codigo, provincia.hasta[categoria] - provincia.desde[categoria]);
    }
    const lista = [];
    for (const anillos of this.anillosPorProvincia()) {
      lista.push({
        codigo: anillos.codigo,
        d: anillos.d,
        porcentaje: porcentajes.get(anillos.codigo) ?? 0,
      });
    }
    return lista;
  });

  protected colorProvincia(porcentaje: number): string {
    const color = CATEGORIAS_GENTE[this.estado.categoriaProvincias()].color;
    return `color-mix(in srgb, ${color} ${Math.round(porcentaje)}%, var(--color-carton))`;
  }

  private agruparPorProvincia(datos: Datos, poligonos: [number, number][][][], camino: d3.GeoPath) {
    const deps = datos.censos_departamentos.departamentos;
    const caminos = new Map<string, string>();
    for (const poligono of poligonos) {
      const anillo = poligono[0];
      const cuenta = new Map<string, number>();
      for (let d = 0; d < deps.codigo.length; d++) {
        if (d3.polygonContains(anillo, [deps.x[d], deps.y[d]])) {
          const provincia = deps.codigo[d].slice(0, 2);
          cuenta.set(provincia, (cuenta.get(provincia) ?? 0) + 1);
        }
      }
      let provincia = '';
      let mayor = 0;
      for (const [codigo, veces] of cuenta) {
        if (veces > mayor) {
          provincia = codigo;
          mayor = veces;
        }
      }
      if (provincia === '') {
        let distancia = Infinity;
        for (let d = 0; d < deps.codigo.length; d++) {
          const dx = deps.x[d] - anillo[0][0];
          const dy = deps.y[d] - anillo[0][1];
          if (dx * dx + dy * dy < distancia) {
            distancia = dx * dx + dy * dy;
            provincia = deps.codigo[d].slice(0, 2);
          }
        }
      }
      caminos.set(
        provincia,
        (caminos.get(provincia) ?? '') + (camino({ type: 'Polygon', coordinates: poligono }) ?? ''),
      );
    }
    const lista = [];
    for (const [codigo, d] of caminos) {
      lista.push({ codigo, d });
    }
    this.anillosPorProvincia.set(lista);
  }

  protected elegirCategoriaProvincias(categoria: number) {
    this.estado.categoriaProvincias.set(categoria);
  }
  // La red se va junto con el texto de Actualidad, antes de que lleguen los círculos. En
  // Reconectar la dibuja su propia capa, encima de los círculos.
  protected readonly opacidadRed = computed(() =>
    opacidadHasta(this.estado.posicion(), INDICE_GENTE - 1),
  );
  // La leyenda de las vías no vuelve: en Reconectar ese lugar es de las herramientas.
  protected readonly opacidadLeyenda = computed(() =>
    Math.min(
      opacidadDesde(this.estado.posicion(), PRIMER_CON_ANIO),
      opacidadHasta(this.estado.posicion(), INDICE_GENTE - 1),
    ),
  );
  private readonly proyeccion = signal<d3.GeoIdentityTransform | null>(null);
  protected readonly bajo = computed(() => {
    const datos = this.carga.datos();
    const proyeccion = this.proyeccion();
    if (datos === null || proyeccion === null) {
      return null;
    }
    return bajoLeyendas(poligonosDelMapa(datos), proyeccion, this.tamanio().alto);
  });

  protected readonly descripcionGente = computed(() => {
    const eleccion = this.estado.seleccionCenso();
    const datos = this.carga.datos();
    if (eleccion === null || datos === null) {
      return null;
    }
    const categoria = NOMBRES_GENTE[eleccion.categoria];
    return `Población ${categoria}, en ${datos.censos.censo[eleccion.censo]}.`;
  });
  protected readonly anioPico = signal(0); // el año con más vía con trenes de pasajeros

  // El radio de un círculo según su gente, con el máximo de todos los censos y categorías.
  private readonly radioDorling = computed(() => {
    const escala = this.proyeccion()?.scale() ?? 0; // px por hm
    let maximo = 1;
    const datos = this.carga.datos();
    if (datos !== null) {
      for (const censo of datos.censos_departamentos.personas) {
        for (const categoria of censo) {
          for (const personas of categoria) {
            maximo = Math.max(maximo, personas);
          }
        }
      }
    }
    return d3
      .scaleSqrt()
      .domain([0, maximo])
      .range([0, RADIO_MAXIMO * escala]);
  });

  // Tres círculos de la misma escala, uno al lado del otro y apoyados en una base, con cuánta gente
  // representa cada uno debajo.
  protected readonly escalaReferencia = computed(() => {
    const radio = this.radioDorling();
    const circulos = [];
    let x = 0;
    for (const valor of VALORES_REFERENCIA) {
      const r = radio(valor);
      // Cada número mide unos 6 px por carácter: el lugar de cada círculo es el mayor de los dos.
      const lugar = Math.max(2 * r, valor.toLocaleString('es-AR').length * 6);
      circulos.push({ r, x: x + lugar / 2, texto: valor.toLocaleString('es-AR') });
      x += lugar + ESPACIO_REFERENCIA;
    }
    const base = 2 * radio(VALORES_REFERENCIA[VALORES_REFERENCIA.length - 1]) + 1;
    return { circulos, base, alto: base + 14, ancho: x };
  });

  // Un círculo por departamento, de área proporcional a la gente de la parte elegida, que arranca en
  // el centro de su gente y se corre lo justo para no pisar a los vecinos. La escala es la misma
  // para todos los censos y categorías, así se pueden comparar.
  private dibujarDorling() {
    const proyeccion = this.proyeccion();
    const datos = this.carga.datos();
    const eleccion = this.estado.seleccionCenso();
    if (proyeccion === null || datos === null) {
      return;
    }
    const deps = datos.censos_departamentos;
    const radio = this.radioDorling();

    const nodos: {
      codigo: string;
      x: number;
      y: number;
      origenX: number;
      origenY: number;
      r: number;
    }[] = [];
    if (eleccion !== null) {
      const personas = deps.personas[eleccion.censo][eleccion.categoria];
      for (let d = 0; d < deps.departamentos.codigo.length; d++) {
        if (personas[d] > 0) {
          const [x, y] = proyeccion([deps.departamentos.x[d], deps.departamentos.y[d]])!;
          nodos.push({
            codigo: deps.departamentos.codigo[d],
            x,
            y,
            origenX: x,
            origenY: y,
            r: radio(personas[d]),
          });
        }
      }
      d3.forceSimulation(nodos)
        .force('x', d3.forceX<(typeof nodos)[number]>((nodo) => nodo.origenX).strength(0.2))
        .force('y', d3.forceY<(typeof nodos)[number]>((nodo) => nodo.origenY).strength(0.2))
        .force(
          'choque',
          d3.forceCollide<(typeof nodos)[number]>((nodo) => nodo.r + 0.5),
        )
        .stop()
        .tick(120);
    }
    const color = eleccion === null ? 'none' : COLORES_GENTE[eleccion.categoria];
    d3.select(this.lienzo().nativeElement)
      .select('.dorling')
      .selectAll<SVGCircleElement, (typeof nodos)[number]>('circle')
      .data(nodos, (nodo) => nodo.codigo)
      .join(
        (entrada) =>
          entrada
            .append('circle')
            .attr('cx', (nodo) => nodo.x)
            .attr('cy', (nodo) => nodo.y)
            .attr('r', 0),
        (actualizar) => actualizar,
        (salida) => salida.transition().duration(DURACION_DORLING).attr('r', 0).remove(),
      )
      .attr('fill', color)
      .attr('stroke', 'var(--color-carton)')
      .attr('stroke-width', 0.75)
      .transition()
      .duration(DURACION_DORLING)
      .ease(d3.easeCubicInOut)
      .attr('cx', (nodo) => nodo.x)
      .attr('cy', (nodo) => nodo.y)
      .attr('r', (nodo) => nodo.r);
  }

  // El año con más vía con trenes de pasajeros, y qué partes la tenían ese año y la tienen hoy.
  private dibujarPortada(datos: Datos) {
    const serie = datos.serie;
    let k = 0;
    for (let i = 0; i < serie.anio.length; i++) {
      if (serie.km_pasajeros[i] > serie.km_pasajeros[k]) {
        k = i;
      }
    }
    const anioPico = serie.anio[k];
    this.anioPico.set(anioPico);
    const v = datos.vias;
    let perdida = '';
    let queda = '';
    for (let p = 0; p < this.trazos.length; p++) {
      if (categoriaEn(anioPico, v.categoria[p], v.alta[p], v.fin_pasajeros[p], v.baja[p]) !== 3) {
        continue;
      }
      if (v.fin_pasajeros[p] === null) {
        queda += this.trazos[p];
      } else {
        perdida += this.trazos[p];
      }
    }
    const svg = this.lienzo().nativeElement;
    svg.querySelector('.portada-perdida')!.setAttribute('d', perdida);
    svg.querySelector('.portada-queda')!.setAttribute('d', queda);
  }

  protected readonly anioDeLaRed = computed(() => {
    const anio = this.estado.anio();
    if (anio !== null) {
      return Math.floor(anio);
    }
    if (this.estado.posicion() >= ULTIMO_CON_ANIO) {
      return CHECKPOINTS[ULTIMO_CON_ANIO].anio;
    }
    return null;
  });

  private trazos: string[] = []; // el atributo d de cada parte de vía, en px
  private categoriaDibujada: number[] = [];

  constructor() {
    afterNextRender(() => {
      const observador = new ResizeObserver((entradas) => {
        const caja = entradas[0].contentRect;
        this.tamanio.set({ ancho: caja.width, alto: caja.height });
      });
      observador.observe(this.lienzo().nativeElement);
    });
    effect(() => this.dibujar());
    effect(() => this.mostrarAnio(true));
    effect(() => this.dibujarDorling());
  }

  protected alternar(codigo: number) {
    const visibles = this.visibles().slice();
    visibles[codigo] = !visibles[codigo];
    this.visibles.set(visibles);
  }

  private dibujar() {
    const datos = this.carga.datos();
    const { ancho, alto } = this.tamanio();
    if (datos === null || ancho === 0) {
      return;
    }

    const poligonos = poligonosDelMapa(datos);
    const proyeccion = proyeccionDelMapa(poligonos, ancho, alto);
    this.proyeccion.set(proyeccion);
    const camino = d3.geoPath(proyeccion);

    d3.select(this.lienzo().nativeElement)
      .select('.provincias')
      .selectAll('path')
      .data(poligonos)
      .join('path')
      .attr('d', (poligono) => camino({ type: 'Polygon', coordinates: poligono }))
      .attr('fill', 'var(--color-carton)')
      .attr('stroke', 'var(--color-tinta)')
      .attr('stroke-opacity', 0.55)
      .attr('stroke-width', 0.7)
      .attr('stroke-linejoin', 'round');

    this.trazos = [];
    for (const xy of datos.vias.xy) {
      const puntos: [number, number][] = [];
      for (let k = 0; k < xy.length; k += 2) {
        puntos.push([xy[k], xy[k + 1]]);
      }
      this.trazos.push(camino({ type: 'LineString', coordinates: puntos }) ?? '');
    }
    if (this.categoriaDibujada.length === 0) {
      this.categoriaDibujada = new Array(this.trazos.length).fill(NO_CONSTRUIDA);
    }
    this.dibujarPortada(datos);
    this.agruparPorProvincia(datos, poligonos, camino);
    // Fuera del seguimiento: si no, cada cambio de año volvería a proyectar todas las partes.
    untracked(() => this.mostrarAnio(false));
  }

  // Con `fundido`, las partes que no estaban dibujadas aparecen de a poco; un cambio de categoría
  // es inmediato.
  private mostrarAnio(fundido: boolean) {
    const anio = this.anioDeLaRed();
    const datos = this.carga.datos();
    if (datos === null || this.trazos.length === 0) {
      return;
    }
    const v = datos.vias;
    const asentadas = ['', '', '', ''];
    const recien = ['', '', '', ''];
    for (let p = 0; p < this.trazos.length; p++) {
      let categoria = NO_CONSTRUIDA;
      if (anio !== null) {
        categoria = categoriaEn(anio, v.categoria[p], v.alta[p], v.fin_pasajeros[p], v.baja[p]);
      }
      if (categoria !== NO_CONSTRUIDA) {
        if (fundido && this.categoriaDibujada[p] === NO_CONSTRUIDA) {
          recien[categoria] += this.trazos[p];
        } else {
          asentadas[categoria] += this.trazos[p];
        }
      }
      this.categoriaDibujada[p] = categoria;
    }

    const svg = this.lienzo().nativeElement;
    for (const codigo of this.ORDEN_DE_DIBUJO) {
      svg.querySelector(`.via-${codigo}:not(.recien)`)!.setAttribute('d', asentadas[codigo]);
      const pathRecien = svg.querySelector(`.via-${codigo}.recien`)!;
      pathRecien.setAttribute('d', recien[codigo]);
      // Una categoría apagada no hace el fundido de lo que aparece, si no se asomaría un instante.
      if (recien[codigo] !== '' && this.visibles()[codigo]) {
        pathRecien.animate([{ opacity: 0 }, { opacity: 1 }], DURACION_FUNDIDO);
      }
    }
  }
}
