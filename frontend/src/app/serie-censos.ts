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
import { CargaDatos, Datos } from './datos';
import { Diseno, SANGRIA_EJE } from './diseno';
import { CHECKPOINTS, EstadoApp, opacidadDesde, opacidadHasta, ultimoNoNulo } from './estado';

const INDICE_GENTE = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'gente');
const INDICE_PROVINCIAS = CHECKPOINTS.findIndex((checkpoint) => checkpoint.id === 'provincias');
let ULTIMO_CON_ANIO = 0;
for (let i = 0; i < CHECKPOINTS.length; i++) {
  if (CHECKPOINTS[i].anio !== null) {
    ULTIMO_CON_ANIO = i;
  }
}
const ARRIBA = 8; // px sobre la barra más alta
const ABAJO_ESCRITORIO = 84; // px para los años del eje x y la indicación, que pueden ser dos renglones
const ABAJO_CELULAR = 72; // px para los años del eje x y la indicación, que puede ser tres renglones
const ESPACIO_INDICACION = 28; // px entre el eje x y la indicación
const MARGEN_CELULAR = 44; // px a cada lado
const ANCHO_BARRA = 0.62; // fracción del lugar de cada censo
const OPACIDAD_APAGADA = 0.35; // las partes no elegidas
const MINIMO_ROTULO = 5; // %: por debajo, el número no entra en el segmento

// El paso de la gente a las provincias, en fracciones del tramo: primero se desvanece todo menos la
// barra del último censo, después esa barra gira y se acuesta, y al final se parte en las provincias,
// que salen de a una, de la primera a la última del orden.
const FIN_DESVANECER = 0.3;
const FIN_GIRO = 0.6;
const DEMORA_PROVINCIAS = 0.25; // entre que sale la primera provincia y la última
const VUELO_PROVINCIA = 0.15; // lo que tarda cada provincia en llegar a su renglón
const COLUMNAS_PROVINCIAS = 2;
const ANCHO_LEYENDA_COMPLETA = 520; // px: con menos, la leyenda va más chica
const NOMBRE_PROVINCIA = { escritorio: 112, celular: 78 }; // px para el nombre, a la izquierda de cada barra
const ESPACIO_COLUMNAS = 20; // px entre las dos columnas de provincias
const PIE_PROVINCIAS = { escritorio: 62, celular: 8 }; // px debajo del último renglón: en escritorio pasa el tren
const ALTO_BARRA_PROVINCIA = 0.7; // fracción del renglón
const ANCHO_MINIMO_ROTULO = 34; // px: en una parte más angosta, el porcentaje no entra
const ALTO_MINIMO_ROTULO = 8; // px de barra
const TAMANIO_ROTULO_PROVINCIA = 11; // px; en una barra más baja, el alto de la barra
const DURACION_ALTERNAR = 350; // ms que tardan las barras en acomodarse al prender o apagar
const TODAS_VISIBLES = [true, true, true, true];

export interface Provincia {
  codigo: string;
  nombre: string;
  personas: number[]; // por categoría
  desde: number[]; // %, por categoría
  hasta: number[]; // %, por categoría
}

function avance(fase: number, desde: number, hasta: number): number {
  return d3.easeCubicInOut(Math.min(Math.max((fase - desde) / (hasta - desde), 0), 1));
}

function entre(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Las categorías de censos.json, de abajo hacia arriba, con el color de su vía en el mapa; la gente
// que nunca tuvo tren no tiene vía y va en gris.
const CATEGORIAS = [
  { nombre: 'Con tren de pasajeros', clase: 'pasajeros' },
  { nombre: 'Solo tren de carga', clase: 'carga' },
  { nombre: 'Perdió el tren', clase: 'perdio' },
  { nombre: 'Nunca tuvo tren', clase: 'sin-tren' },
];

interface Segmento {
  censo: number;
  indiceCenso: number; // posición en censos.json
  categoria: number;
  desde: number; // %
  hasta: number; // %
  personas: number;
  rotulo: number; // el porcentaje redondeado, así los de una barra suman 100
  visible: boolean; // apagada en la leyenda, no ocupa lugar y las de arriba bajan de a poco
}

// La gente del último censo por provincia, de la misma tabla que su barra (así suman lo mismo),
// ordenada: primero la que más gente con tren de pasajeros tiene, y entre las que no tienen, la que
// más con tren de carga, y así.
export function provinciasDelUltimoCenso(datos: Datos): Provincia[] {
  const provincias: Provincia[] = [];
  const deps = datos.censos_departamentos;
  const ultimo = deps.personas.length - 1;
  const regiones = datos.regiones.provincias;
  for (let p = 0; p < regiones.codigo.length; p++) {
    const personas = [0, 0, 0, 0];
    for (let d = 0; d < deps.departamentos.codigo.length; d++) {
      if (deps.departamentos.codigo[d].startsWith(regiones.codigo[p])) {
        for (let k = 0; k < CATEGORIAS.length; k++) {
          personas[k] += deps.personas[ultimo][k][d];
        }
      }
    }
    let total = 0;
    for (const cantidad of personas) {
      total += cantidad;
    }
    const desde = [];
    const hasta = [];
    let acumulado = 0;
    for (const cantidad of personas) {
      desde.push(acumulado);
      acumulado += (cantidad / total) * 100;
      hasta.push(acumulado);
    }
    provincias.push({
      codigo: regiones.codigo[p],
      nombre: regiones.nombre[p],
      personas,
      desde,
      hasta,
    });
  }
  provincias.sort((a, b) => {
    for (let k = 0; k < CATEGORIAS.length; k++) {
      const diferencia = b.hasta[k] - b.desde[k] - (a.hasta[k] - a.desde[k]);
      if (diferencia !== 0) {
        return diferencia;
      }
    }
    return 0;
  });
  return provincias;
}

// Los porcentajes enteros de cada parte, que sumen 100: se redondea todo hacia abajo y los puntos que
// faltan van a las partes con mayor resto, las que más cerca estaban del entero de arriba.
function redondeadosQueSuman100(partes: number[], total: number): number[] {
  const enteros = [];
  const restos = [];
  let suma = 0;
  for (let k = 0; k < partes.length; k++) {
    const exacto = (partes[k] / total) * 100;
    enteros.push(Math.floor(exacto));
    restos.push({ k, resto: exacto - Math.floor(exacto) });
    suma += Math.floor(exacto);
  }
  restos.sort((a, b) => b.resto - a.resto);
  for (let i = 0; i < 100 - suma; i++) {
    enteros[restos[i].k] += 1;
  }
  return enteros;
}

// La gente de cada censo según su acceso al tren con la red de su año, en porcentaje. Toma el lugar
// del gráfico de la serie en el checkpoint de la gente, y en el de las provincias su última barra se
// parte en una por provincia.
@Component({
  selector: 'app-serie-censos',
  // El contenedor no recibe el puntero, así el gráfico invisible no tapa al otro.
  host: { class: 'pointer-events-none block' },
  // Sin encapsulación, porque los segmentos los crea d3; cada regla empieza con el selector.
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      class="flex size-full flex-col"
      [style.opacity]="opacidad()"
      [class.pointer-events-auto]="opacidad() > 0"
    >
      <div class="pr-4" [style.padding-left.px]="x0() - SANGRIA_EJE">
        <!-- El título y la descripción de los censos se cruzan con los de las provincias. La
             descripción y la fuente no pasan de la vertical de Actualidad. -->
        <div class="grid">
          <!-- Cada texto deja de ocupar lugar cuando ya no se ve, así el gráfico gana alto. -->
          <div
            class="col-start-1 row-start-1"
            [style.opacity]="tituloGente()"
            [class.hidden]="tituloGente() === 0 && tituloProvincias() > 0"
          >
            <h2 class="text-2xl leading-tight font-bold max-md:text-xl xl:text-[1.75rem]">
              ¿Quién vivía cerca de un tren en cada censo?
            </h2>
            <p
              class="mt-1 text-sm leading-snug max-md:text-xs"
              [style.max-width.px]="x1() - x0() + SANGRIA_EJE"
            >
              Qué parte de la gente vivía a menos de 10 km de una estación de tren, y qué trenes
              pasaban por ella, con las vías que había el año de cada censo.
            </p>
          </div>
          <div
            class="col-start-1 row-start-1"
            [style.opacity]="tituloProvincias()"
            [class.hidden]="tituloProvincias() === 0"
          >
            <h2 class="text-2xl leading-tight font-bold max-md:text-xl xl:text-[1.75rem]">
              ¿Y en cada provincia?
            </h2>
            <p
              class="mt-1 text-sm leading-snug max-md:text-xs"
              [style.max-width.px]="x1() - x0() + SANGRIA_EJE"
            >
              Los mismos datos que la barra del censo de {{ ultimoCenso() }}, provincia por
              provincia.
            </p>
          </div>
        </div>
        <p
          class="mt-1 text-xs leading-snug opacity-60"
          [style.opacity]="0.6 * (tituloGente() + tituloProvincias())"
          [style.max-width.px]="x1() - x0() + SANGRIA_EJE"
        >
          Fuentes:
          <a class="underline" href="metodologia.html#indec" target="_blank" rel="noopener">INDEC</a
          >,
          <a class="underline" href="metodologia.html#ide" target="_blank" rel="noopener"
            >IDE de Transporte</a
          >
          y
          <a class="underline" href="metodologia.html#osm" target="_blank" rel="noopener"
            >© OpenStreetMap</a
          >. Elaboración propia.
        </p>
      </div>
      <!-- La leyenda, centrada sobre las barras: cada entrada prende o apaga su parte en todas. -->
      <!-- En un lugar angosto, más chica, para que entre en menos renglones. -->
      <ul
        class="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm max-md:mt-2 max-md:gap-x-3 max-md:text-xs"
        [class.angosta]="x1() - x0() < ANCHO_LEYENDA_COMPLETA"
        [style.margin-left.px]="x0()"
        [style.width.px]="x1() - x0()"
      >
        @for (categoria of categorias; track categoria.clase; let k = $index) {
          <li>
            <button
              class="entrada flex cursor-pointer items-center gap-1"
              [class.apagada]="!visibles()[k]"
              [attr.aria-pressed]="visibles()[k]"
              (click)="alternarCategoria(k)"
            >
              <svg width="12" height="10" aria-hidden="true">
                <rect width="12" height="10" [attr.class]="'censo-' + categoria.clase" />
              </svg>
              {{ categoria.nombre }}
            </button>
          </li>
        }
      </ul>
      <!-- Cada redibujo reemplaza las barras, y la que estaba bajo el puntero ya no avisa cuando el
           puntero sale: la ficha se suelta al pasar por algo que no sea una barra, o al salir. -->
      <div
        #caja
        class="relative flex-1"
        (pointerover)="soltarFicha($event)"
        (pointerleave)="soltarFicha($event)"
      >
        <svg #lienzo class="absolute inset-0 size-full overflow-visible" aria-hidden="true"></svg>
        <!-- Debajo del eje, centrada; late cada 5 s hasta que se elige una parte por primera vez. -->
        <p
          class="indicacion absolute text-center text-sm font-bold max-md:text-xs"
          [class.latido]="latiendo()"
          [style.opacity]="1 - avanceDesvanecer()"
          [style.top.px]="escalas().y(0) + ESPACIO_INDICACION"
          [style.left.px]="x0()"
          [style.width.px]="x1() - x0()"
        >
          Tocá una parte de una barra para ver en el mapa dónde vive esa gente.
        </p>
        @if (fichaMostrada(); as a) {
          <div
            class="ficha pointer-events-none absolute z-10 text-xs whitespace-nowrap"
            [class.oculta]="apuntado() === null"
            [style.left.px]="a.x"
            [style.top.px]="a.y"
          >
            <b>{{ a.titulo }}</b>
            @for (fila of a.filas; track fila.clase) {
              <div class="flex items-center gap-1.5">
                <svg width="10" height="10" aria-hidden="true">
                  <rect width="10" height="10" [attr.class]="'censo-' + fila.clase" />
                </svg>
                {{ fila.nombre }}: {{ fila.porcentaje }} % ({{ fila.personas }} M)
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    app-serie-censos .censo-pasajeros {
      fill: var(--color-via-pasajeros);
    }
    app-serie-censos .censo-carga {
      fill: var(--color-via-carga);
    }
    app-serie-censos .censo-perdio {
      fill: var(--color-via-inactiva);
    }
    app-serie-censos .censo-sin-tren {
      fill: var(--color-sin-tren);
    }
    app-serie-censos .segmento {
      stroke: var(--color-carton);
      stroke-width: 1.5px;
      cursor: pointer;
      transition: opacity 200ms;
    }
    /* La parte elegida, con un borde fino de tinta; las demás se apagan (ver dibujar). */
    app-serie-censos .segmento.elegido {
      stroke: rgb(43 43 43 / 0.55);
    }
    app-serie-censos .entrada.apagada {
      opacity: 0.4;
      text-decoration: line-through;
    }
    app-serie-censos .rayado-fondo {
      fill: var(--color-sin-tren);
      opacity: 0.18;
    }
    app-serie-censos .rayado-linea {
      stroke: var(--color-sin-tren);
      stroke-opacity: 0.55;
      stroke-width: 2px;
    }
    app-serie-censos .angosta {
      column-gap: 0.75rem;
      font-size: 0.75rem;
    }
    app-serie-censos .nombre-provincia {
      fill: var(--color-tinta);
      font-size: 12px;
    }
    @media (max-width: 1079px) {
      app-serie-censos .nombre-provincia {
        font-size: 10px;
      }
    }
    app-serie-censos .rotulo {
      fill: var(--color-carton);
      font-size: 12px;
      font-weight: 700;
      pointer-events: none;
    }
    /* Un talón cortado del boleto: muescas a los costados. */
    app-serie-censos .ficha.oculta {
      opacity: 0;
    }
    app-serie-censos .ficha {
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
    /* El mismo golpe de la flecha de Inicio, 0,8 s, seguido de una pausa larga. */
    app-serie-censos .indicacion.latido {
      animation: latido-indicacion 5s ease-out infinite;
    }
    @keyframes latido-indicacion {
      0%,
      16%,
      100% {
        color: var(--color-tinta);
        scale: 1;
      }
      3.2% {
        color: var(--color-via-pasajeros);
        scale: 1.08;
      }
    }
  `,
})
export class SerieCensos {
  private readonly carga = inject(CargaDatos);
  protected readonly estado = inject(EstadoApp);
  private readonly diseno = inject(Diseno);
  private readonly lienzo = viewChild.required<ElementRef<SVGSVGElement>>('lienzo');
  private readonly caja = viewChild.required<ElementRef<HTMLElement>>('caja');
  private readonly tamanio = signal({ ancho: 0, alto: 0 }); // px
  private readonly censoApuntado = signal<number | null>(null);
  private readonly provinciaApuntada = signal<number | null>(null); // posición en el orden
  // El peso de cada categoría en las barras de los censos y de las provincias: va de 1 a 0 al
  // apagarla en la leyenda, con una transición.
  private readonly pesos = signal([1, 1, 1, 1]);
  private pesosAntes = [1, 1, 1, 1]; // los pesos al empezar la animación en curso
  private animacion = 0;
  protected readonly categorias = CATEGORIAS;
  protected readonly SANGRIA_EJE = SANGRIA_EJE;
  protected readonly ANCHO_LEYENDA_COMPLETA = ANCHO_LEYENDA_COMPLETA;
  protected readonly ESPACIO_INDICACION = ESPACIO_INDICACION;
  protected readonly latiendo = computed(
    () => this.estado.posicion() === INDICE_GENTE && !this.estado.yaEligioCenso(),
  );

  // El borde derecho de la última barra cae en la vertical del último checkpoint con año, como el
  // eje derecho del gráfico de la serie.
  protected readonly x1 = computed(() => {
    if (this.diseno.esCelular()) {
      return this.tamanio().ancho - MARGEN_CELULAR;
    }
    return this.diseno.xCheckpoints()[ULTIMO_CON_ANIO] * this.diseno.anchoBoleto();
  });

  // Las categorías de cada checkpoint, y todas en el tramo entre los dos: así la barra que se
  // parte en las provincias está entera, y al volver cada uno recupera lo que tenía.
  private readonly listaVisibles = computed(() => {
    const posicion = this.estado.posicion();
    if (posicion <= INDICE_GENTE) {
      return this.estado.categoriasVisiblesGente;
    }
    if (posicion >= INDICE_PROVINCIAS) {
      return this.estado.categoriasVisiblesProvincias;
    }
    return null;
  });
  protected readonly visibles = computed(() => this.listaVisibles()?.() ?? TODAS_VISIBLES);

  // Cuánto se avanzó del checkpoint de la gente al de las provincias, de 0 a 1.
  private readonly fase = computed(() => {
    return Math.min(
      Math.max((this.estado.posicion() - INDICE_GENTE) / (INDICE_PROVINCIAS - INDICE_GENTE), 0),
      1,
    );
  });
  protected readonly avanceDesvanecer = computed(() => avance(this.fase(), 0, FIN_DESVANECER));
  // Los títulos se cruzan a la vez que el texto de cada checkpoint, con la misma regla.
  protected readonly tituloGente = computed(() =>
    opacidadHasta(this.estado.posicion(), INDICE_GENTE),
  );
  protected readonly tituloProvincias = computed(() =>
    opacidadDesde(this.estado.posicion(), INDICE_PROVINCIAS),
  );
  protected readonly ultimoCenso = computed(() => {
    const censos = this.carga.datos()?.censos.censo ?? [];
    return censos[censos.length - 1];
  });

  private readonly provincias = computed(() => {
    const datos = this.carga.datos();
    return datos === null ? [] : provinciasDelUltimoCenso(datos);
  });

  // Dónde va cada provincia: dos columnas de renglones, con el nombre a la izquierda de su barra.
  // En el celular se usa todo el ancho y casi todo el alto, porque ya no hay ejes.
  private readonly lugarProvincias = computed(() => {
    const { ancho, alto } = this.tamanio();
    const celular = this.diseno.esCelular();
    const izquierda = celular ? PIE_PROVINCIAS.celular : this.x0();
    const derecha = celular ? ancho - PIE_PROVINCIAS.celular : this.x1();
    const abajo = alto - (celular ? PIE_PROVINCIAS.celular : PIE_PROVINCIAS.escritorio);
    const renglones = Math.ceil(this.provincias().length / COLUMNAS_PROVINCIAS);
    const anchoColumna =
      (derecha - izquierda - ESPACIO_COLUMNAS * (COLUMNAS_PROVINCIAS - 1)) / COLUMNAS_PROVINCIAS;
    const nombre = celular ? NOMBRE_PROVINCIA.celular : NOMBRE_PROVINCIA.escritorio;
    return {
      izquierda,
      derecha,
      arriba: ARRIBA,
      abajo,
      renglones,
      altoRenglon: (abajo - ARRIBA) / renglones,
      anchoColumna,
      nombre,
      anchoBarra: anchoColumna - nombre,
    };
  });

  // Aparece a la vez que el texto de su checkpoint y se va al dejar el de las provincias.
  protected readonly opacidad = computed(() =>
    Math.min(
      opacidadDesde(this.estado.posicion(), INDICE_GENTE),
      opacidadHasta(this.estado.posicion(), INDICE_PROVINCIAS),
    ),
  );

  // El mismo eje izquierdo que el gráfico de la serie, así los dos títulos caen en el mismo lugar.
  protected readonly x0 = computed(() => {
    if (this.diseno.esCelular()) {
      return MARGEN_CELULAR;
    }
    return this.diseno.bordeTextoSerie() + SANGRIA_EJE;
  });

  private readonly segmentos = computed(() => {
    const datos = this.carga.datos();
    const segmentos: Segmento[] = [];
    if (datos === null) {
      return segmentos;
    }
    const censos = datos.censos;
    const pesos = this.pesos();
    for (let c = 0; c < censos.censo.length; c++) {
      let total = 0;
      for (const personas of censos.personas[c]) {
        total += personas;
      }
      const rotulos = redondeadosQueSuman100(censos.personas[c], total);
      let desde = 0;
      for (let k = 0; k < CATEGORIAS.length; k++) {
        const porcentaje = (censos.personas[c][k] / total) * 100 * pesos[k];
        segmentos.push({
          censo: censos.censo[c],
          indiceCenso: c,
          categoria: k,
          desde,
          hasta: desde + porcentaje,
          personas: censos.personas[c][k],
          rotulo: rotulos[k],
          visible: pesos[k] > 0,
        });
        desde += porcentaje;
      }
    }
    return segmentos;
  });

  protected readonly escalas = computed(() => {
    const { alto } = this.tamanio();
    const datos = this.carga.datos();
    const x1 = this.x1();
    const abajo = this.diseno.esCelular() ? ABAJO_CELULAR : ABAJO_ESCRITORIO;
    return {
      x: d3
        .scaleBand<number>()
        .domain(datos?.censos.censo ?? [])
        .range([this.x0(), x1])
        .paddingInner(1 - ANCHO_BARRA)
        .paddingOuter(0),
      y: d3
        .scaleLinear()
        .domain([0, 100])
        .range([alto - abajo, ARRIBA]),
    };
  });

  protected readonly apuntado = computed(() => {
    const provincia = this.provinciaApuntada();
    if (provincia !== null) {
      return this.fichaProvincia(provincia);
    }
    const censo = this.censoApuntado();
    if (censo === null) {
      return null;
    }
    const { x, y } = this.escalas();
    let total = 0;
    for (const segmento of this.segmentos()) {
      if (segmento.censo === censo) {
        total += segmento.personas;
      }
    }
    // La ficha muestra todas las partes, aunque alguna esté apagada en las barras.
    const filas = [];
    for (const segmento of this.segmentos()) {
      if (segmento.censo === censo) {
        filas.unshift({
          clase: CATEGORIAS[segmento.categoria].clase,
          nombre: CATEGORIAS[segmento.categoria].nombre,
          porcentaje: ((segmento.personas / total) * 100).toFixed(1).replace('.', ','),
          personas: (segmento.personas / 1e6).toFixed(1).replace('.', ','),
        });
      }
    }
    return { titulo: String(censo), filas, x: x(censo)! + x.bandwidth() / 2, y: y(100) };
  });

  // La ficha sigue dibujada con lo último que mostró mientras se desvanece.
  protected readonly fichaMostrada = ultimoNoNulo(this.apuntado);

  private fichaProvincia(orden: number) {
    const provincia = this.provincias()[orden];
    const lugar = this.lugarProvincias();
    const filas = [];
    let total = 0;
    for (const personas of provincia.personas) {
      total += personas;
    }
    for (let k = CATEGORIAS.length - 1; k >= 0; k--) {
      filas.push({
        clase: CATEGORIAS[k].clase,
        nombre: CATEGORIAS[k].nombre,
        porcentaje: ((provincia.personas[k] / total) * 100).toFixed(1).replace('.', ','),
        personas: (provincia.personas[k] / 1e6).toFixed(1).replace('.', ','),
      });
    }
    const columna = Math.floor(orden / lugar.renglones);
    const renglon = orden % lugar.renglones;
    const izquierda =
      lugar.izquierda + columna * (lugar.anchoColumna + ESPACIO_COLUMNAS) + lugar.nombre;
    return {
      titulo: provincia.nombre,
      filas,
      x: izquierda + lugar.anchoBarra / 2,
      y: lugar.arriba + renglon * lugar.altoRenglon,
    };
  }

  constructor() {
    // Al dejar el checkpoint la ficha se desvanece, aunque el puntero siga encima: lo que tenía
    // abajo cambia o desaparece y no siempre llega el pointerleave.
    effect(() => {
      if (this.estado.checkpoint() === null) {
        untracked(() => {
          this.censoApuntado.set(null);
          this.provinciaApuntada.set(null);
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
      const visibles = this.visibles();
      untracked(() => this.animarPesos(visibles));
    });
    effect(() => this.dibujar());
  }

  // Lleva el peso de cada categoría hacia 1 si está prendida y hacia 0 si no. Una animación nueva
  // corta la anterior y sigue desde donde quedó.
  private animarPesos(visibles: boolean[]) {
    cancelAnimationFrame(this.animacion);
    const desde = this.pesos().slice();
    this.pesosAntes = desde;
    const inicio = performance.now();
    const cuadro = (ahora: number) => {
      const avance = d3.easeCubicInOut(Math.min((ahora - inicio) / DURACION_ALTERNAR, 1));
      const pesos = [];
      for (let k = 0; k < desde.length; k++) {
        const objetivo = visibles[k] ? 1 : 0;
        pesos.push(desde[k] + (objetivo - desde[k]) * avance);
      }
      this.pesos.set(pesos);
      if (avance < 1) {
        this.animacion = requestAnimationFrame(cuadro);
      }
    };
    this.animacion = requestAnimationFrame(cuadro);
  }

  protected soltarFicha(evento: PointerEvent) {
    if (!(evento.target instanceof SVGRectElement)) {
      this.censoApuntado.set(null);
      this.provinciaApuntada.set(null);
    }
  }

  protected alternarCategoria(k: number) {
    // En el tramo entre los dos checkpoints no hay a cuál guardárselo.
    const lista = this.listaVisibles();
    if (lista === null) {
      return;
    }
    const visibles = lista().slice();
    visibles[k] = !visibles[k];
    lista.set(visibles);
    // Apagar la categoría de la parte elegida la suelta: el mapa mostraría gente que ya no se ve.
    if (!visibles[k] && this.estado.seleccionCenso()?.categoria === k) {
      this.estado.seleccionCenso.set(null);
    }
  }

  // Un toque elige esa parte, que el mapa muestra por departamento; otro toque en la misma la suelta.
  private elegir(segmento: Segmento) {
    const actual = this.estado.seleccionCenso();
    if (actual?.censo === segmento.indiceCenso && actual?.categoria === segmento.categoria) {
      this.estado.seleccionCenso.set(null);
      return;
    }
    this.estado.seleccionCenso.set({ censo: segmento.indiceCenso, categoria: segmento.categoria });
    this.estado.yaEligioCenso.set(true);
  }

  private dibujar() {
    if (this.tamanio().ancho === 0 || this.segmentos().length === 0) {
      return;
    }
    const fase = this.fase();
    const desvanecer = avance(fase, 0, FIN_DESVANECER);
    const giro = avance(fase, FIN_DESVANECER, FIN_GIRO);
    const { x, y } = this.escalas();
    const svg = d3.select(this.lienzo().nativeElement);
    svg.selectAll('*').remove();

    const base = y(0);
    const ejeX = svg
      .append('g')
      .attr('opacity', 1 - desvanecer)
      .attr('transform', `translate(0,${base})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(8));
    ejeX.select('.domain').attr('stroke', 'var(--color-tinta)').attr('stroke-opacity', 0.6);
    ejeX
      .selectAll('.tick text')
      .attr('fill', 'var(--color-tinta)')
      .attr('font-family', 'inherit')
      .attr('font-size', 13)
      .attr('font-weight', 700);

    // Las barras de los censos. Sólo se pueden elegir quietas, en el checkpoint de la gente.
    const eleccion = this.estado.seleccionCenso();
    const quieta = fase === 0;
    const grupo = svg.append('g');
    const ultimo = this.segmentos()[this.segmentos().length - 1].censo;
    const giratoria = svg.append('g').attr('transform', this.transformacionDelGiro(giro));
    for (const segmento of this.segmentos()) {
      const esUltimo = segmento.censo === ultimo;
      const esElegido =
        eleccion?.censo === segmento.indiceCenso && eleccion?.categoria === segmento.categoria;
      // Con una parte elegida, las demás se apagan, y se vuelven a encender de a poco al salir.
      const apagada = eleccion !== null && !esElegido ? entre(OPACIDAD_APAGADA, 1, desvanecer) : 1;
      const destino = esUltimo ? giratoria : grupo;
      if (!segmento.visible) {
        continue;
      }
      const rect = destino
        .append('rect')
        .attr('class', `segmento censo-${CATEGORIAS[segmento.categoria].clase}`)
        .classed('elegido', esElegido && desvanecer < 1)
        .attr('x', x(segmento.censo)!)
        .attr('width', x.bandwidth())
        .attr('y', y(segmento.hasta))
        .attr('height', y(segmento.desde) - y(segmento.hasta));
      rect.attr('opacity', (esUltimo ? 1 : 1 - desvanecer) * apagada);
      if (quieta) {
        rect
          .on('pointerenter', () => this.censoApuntado.set(segmento.censo))
          .on('pointerdown', () => this.censoApuntado.set(segmento.censo))
          .on('pointerleave', () => this.censoApuntado.set(null))
          .on('click', () => this.elegir(segmento));
      }
      const porcentaje = segmento.hasta - segmento.desde;
      // Los rótulos van con su barra: los de la del último censo, encima de ella.
      if (porcentaje >= MINIMO_ROTULO && desvanecer < 1) {
        destino
          .append('text')
          .attr('class', 'rotulo')
          .attr('opacity', 1 - desvanecer)
          .attr('x', x(segmento.censo)! + x.bandwidth() / 2)
          .attr('y', y((segmento.desde + segmento.hasta) / 2))
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .text(`${segmento.rotulo} %`);
      }
    }
    // Mientras las provincias se desprenden, la barra acostada se apaga.
    giratoria.attr('opacity', 1 - avance(fase, FIN_GIRO, FIN_GIRO + VUELO_PROVINCIA));
    if (fase > FIN_GIRO) {
      this.dibujarProvincias(svg, fase);
    }
  }

  // La barra del último censo, de parada a acostada en el medio del lugar de las provincias, con el
  // tren de pasajeros (abajo) a la izquierda: gira un cuarto de vuelta en el sentido del reloj.
  private transformacionDelGiro(giro: number): string {
    const { x, y } = this.escalas();
    const ultimo = this.segmentos()[this.segmentos().length - 1].censo;
    const acostada = this.barraAcostada();
    const centroX = x(ultimo)! + x.bandwidth() / 2;
    const centroY = (y(0) + y(100)) / 2;
    const escalaGrosor = entre(1, acostada.grosor / x.bandwidth(), giro);
    const escalaLargo = entre(1, acostada.largo / (y(0) - y(100)), giro);
    return (
      `translate(${entre(centroX, acostada.centroX, giro)},${entre(centroY, acostada.centroY, giro)}) ` +
      `rotate(${90 * giro}) scale(${escalaGrosor},${escalaLargo}) translate(${-centroX},${-centroY})`
    );
  }

  private barraAcostada() {
    const lugar = this.lugarProvincias();
    return {
      centroX: (lugar.izquierda + lugar.derecha) / 2,
      centroY: (lugar.arriba + lugar.abajo) / 2,
      largo: lugar.derecha - lugar.izquierda,
      grosor: lugar.altoRenglon * ALTO_BARRA_PROVINCIA * 1.6,
    };
  }

  // Cada provincia sale de la barra acostada: cada parte arranca en la parte de su color y vuela a su
  // renglón. Salen de a una, en el orden de la lista.
  private dibujarProvincias(
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    fase: number,
  ) {
    const lugar = this.lugarProvincias();
    const acostada = this.barraAcostada();
    const izquierdaAcostada = acostada.centroX - acostada.largo / 2;
    const segmentosUltimo = this.segmentos().slice(-CATEGORIAS.length);
    const provincias = this.provincias();
    const pesos = this.pesos();
    const visibles = this.visibles();
    // El rayado de una provincia sin categorías: líneas grises a 45° sobre un gris clarito.
    const rayado = svg
      .append('defs')
      .append('pattern')
      .attr('id', 'rayado-sin-categorias')
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 6)
      .attr('height', 6)
      .attr('patternTransform', 'rotate(45)');
    rayado.append('rect').attr('class', 'rayado-fondo').attr('width', 6).attr('height', 6);
    rayado
      .append('line')
      .attr('class', 'rayado-linea')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', 6);
    const grupo = svg.append('g');
    for (let orden = 0; orden < provincias.length; orden++) {
      const salida = FIN_GIRO + (DEMORA_PROVINCIAS * orden) / Math.max(provincias.length - 1, 1);
      const t = avance(fase, salida, salida + VUELO_PROVINCIA);
      if (t === 0) {
        continue;
      }
      const columna = Math.floor(orden / lugar.renglones);
      const renglon = orden % lugar.renglones;
      const izquierdaColumna = lugar.izquierda + columna * (lugar.anchoColumna + ESPACIO_COLUMNAS);
      const altoBarra = lugar.altoRenglon * ALTO_BARRA_PROVINCIA;
      const arribaBarra =
        lugar.arriba + renglon * lugar.altoRenglon + (lugar.altoRenglon - altoBarra) / 2;
      const fila = grupo.append('g');
      const provincia = provincias[orden];
      // Las categorías prendidas forman el 100 % de cada barra: cada una pesa su gente por su peso,
      // que la animación lleva de 1 a 0 al apagarla.
      const partes = [];
      let total = 0;
      let totalAntes = 0;
      let totalDespues = 0;
      for (let k = 0; k < CATEGORIAS.length; k++) {
        partes.push(provincia.personas[k] * pesos[k]);
        total += partes[k];
        totalAntes += provincia.personas[k] * this.pesosAntes[k];
        if (visibles[k]) {
          totalDespues += provincia.personas[k];
        }
      }
      // Una barra que se queda sin categorías se vacía hacia la izquierda, y una que las recupera se
      // llena desde ahí: el 100 % queda fijo en lo que tenía o en lo que va a tener.
      let cien = total;
      if (totalDespues === 0) {
        cien = totalAntes;
      } else if (totalAntes === 0) {
        cien = totalDespues;
      }
      let rotulos: number[] = [];
      if (total > 0) {
        rotulos = redondeadosQueSuman100(partes, total);
      }
      // Debajo, una barra rayada que se ve donde no hay categorías: entera si no queda ninguna.
      if (cien === 0 || total < cien * (1 - 1e-6)) {
        fila
          .append('rect')
          .attr('fill', 'url(#rayado-sin-categorias)')
          .attr('opacity', t)
          .attr('x', izquierdaColumna + lugar.nombre)
          .attr('width', lugar.anchoBarra)
          .attr('y', arribaBarra)
          .attr('height', altoBarra);
      }
      let desdeProvincia = 0;
      for (let k = 0; k < CATEGORIAS.length; k++) {
        const origen = segmentosUltimo[k];
        if (partes[k] === 0) {
          continue;
        }
        const desdeX = izquierdaAcostada + (origen.desde / 100) * acostada.largo;
        const anchoDesde = ((origen.hasta - origen.desde) / 100) * acostada.largo;
        const hastaX = izquierdaColumna + lugar.nombre + desdeProvincia * lugar.anchoBarra;
        const anchoHasta = (partes[k] / cien) * lugar.anchoBarra;
        desdeProvincia += partes[k] / cien;
        fila
          .append('rect')
          .attr('class', `censo-${CATEGORIAS[k].clase}`)
          .attr('x', entre(desdeX, hastaX, t))
          .attr('width', entre(anchoDesde, anchoHasta, t))
          .attr('y', entre(acostada.centroY - acostada.grosor / 2, arribaBarra, t))
          .attr('height', entre(acostada.grosor, altoBarra, t));
        // El porcentaje, sólo en las partes donde entra; los demás están en la ficha.
        if (anchoHasta >= ANCHO_MINIMO_ROTULO && altoBarra >= ALTO_MINIMO_ROTULO) {
          fila
            .append('text')
            .attr('class', 'rotulo')
            .attr('opacity', t)
            .style('font-size', `${Math.min(altoBarra, TAMANIO_ROTULO_PROVINCIA)}px`)
            .attr('x', hastaX + anchoHasta / 2)
            .attr('y', arribaBarra + altoBarra / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .text(`${rotulos[k]} %`);
        }
      }
      fila
        .append('text')
        .attr('class', 'nombre-provincia')
        .attr('opacity', t)
        .attr('x', izquierdaColumna + lugar.nombre - 6)
        .attr('y', arribaBarra + altoBarra / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'central')
        .text(provincia.nombre);
      // Quieta, cada provincia muestra su ficha al pasar por su renglón.
      if (fase === 1) {
        fila
          .append('rect')
          .attr('x', izquierdaColumna)
          .attr('y', lugar.arriba + renglon * lugar.altoRenglon)
          .attr('width', lugar.anchoColumna)
          .attr('height', lugar.altoRenglon)
          .attr('fill', 'transparent')
          .on('pointerenter', () => this.provinciaApuntada.set(orden))
          .on('pointerdown', () => this.provinciaApuntada.set(orden))
          .on('pointerleave', () => this.provinciaApuntada.set(null));
      }
    }
  }
}
