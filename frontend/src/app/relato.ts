import {
  afterNextRender,
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { CargaDatos, Datos } from './datos';
import { CHECKPOINTS, EstadoApp, opacidadEn } from './estado';
import { Provincia, provinciasDelUltimoCenso } from './serie-censos';

const ESCALA_MINIMA = 0.6; // la letra de un texto largo no baja de esta fracción
const PASO_ESCALA = 0.05;

interface TextoDeCheckpoint {
  titulo: string;
  texto: (d: Cifras) => string;
  fuente?: { nombre: string; url: string };
}

// Las cifras que usan los textos, sacadas de los datos para que no queden escritas a mano.
interface Cifras {
  cerradas: (anio: number) => string;
  kmPico: string;
  porcentajeHoy: number[]; // con pasajeros, solo carga, sin trenes y levantada
  primerCenso: number;
  ultimoCenso: number;
  conTren: { primero: number; ultimo: number }; // % de la gente con tren de pasajeros en cada censo
  provincias: { primera: string; porcentajePrimera: number; sinPasajeros: number; total: number };
}

// Un texto corto por checkpoint con año: lo que pasó, para leer junto al gráfico.
const TEXTOS: Record<string, TextoDeCheckpoint> = {
  '1857': {
    titulo: 'El primer tren',
    texto: () =>
      'El 29 de agosto sale La Porteña, el primer tren del país, en un viaje inaugural de 10 km.',
    fuente: {
      nombre: 'Canal 26',
      url: 'https://www.canal26.com/turismo/2025/10/12/asi-fue-el-primer-tren-argentino-tenia-10-kilometros-de-extension-y-cambio-para-siempre-la-historia-del-pais/',
    },
  },
  '1907': {
    titulo: 'La Ley Mitre',
    texto: () =>
      'Las empresas ferroviarias pueden traer del exterior los materiales para construir sus vías sin pagar aduana, hasta 1947. A cambio, pagan una única contribución del 3 % de lo que ganan con sus trenes, que se usa para hacer caminos hacia las estaciones, y quedan exentas de cualquier otro impuesto.',
    fuente: {
      nombre: 'Ley 5315',
      url: 'https://www.argentina.gob.ar/normativa/nacional/ley-5315-175380/texto',
    },
  },
  '1955': {
    titulo: 'El máximo',
    texto: (d) => `La red con trenes de pasajeros llega a su mayor extensión, ${d.kmPico} km.`,
  },
  '1961': {
    titulo: 'El Plan Larkin',
    texto: (d) =>
      `El gobierno de Frondizi propone desactivar más de la mitad de la red, y los ferroviarios responden con una huelga de 42 días. Ese año cierran ${d.cerradas(1961)} estaciones.`,
    fuente: {
      nombre: 'Decreto 4061/61, Boletín Oficial del 30 de mayo de 1961',
      url: 'https://archive.org/details/Boletin_Oficial_Republica_Argentina_1ra_seccion_1961-05-30',
    },
  },
  '1977': {
    titulo: 'El cierre más grande',
    texto: (d) =>
      `Entre 1977 y 1979, el gobierno militar cierra o levanta cerca de 6.000 km de vías. En 1977 cierran ${d.cerradas(1977)} estaciones, más que en cualquier otro año.`,
  },
  '1993': {
    titulo: 'Sin larga distancia',
    texto: (d) =>
      `Se suprimen los trenes de pasajeros de larga distancia de Ferrocarriles Argentinos. La provincia que quiera conservar uno tiene que cubrir todo su déficit. Ese año cierran ${d.cerradas(1993)} estaciones.`,
    fuente: {
      nombre: 'Decreto 1168/92',
      url: 'https://www.argentina.gob.ar/normativa/nacional/norma-9199/texto',
    },
  },
  gente: {
    titulo: 'Cada vez más lejos',
    texto: (d) =>
      `En el censo de ${d.primerCenso}, el ${d.conTren.primero} % de la gente vivía a menos de 10 km de una estación con trenes de pasajeros. En el de ${d.ultimoCenso}, solo el ${d.conTren.ultimo} %.`,
  },
  provincias: {
    titulo: 'Provincia por provincia',
    texto: (d) =>
      `En ${d.ultimoCenso}, en ${d.provincias.primera} el ${d.provincias.porcentajePrimera} % de la gente vivía cerca de un tren de pasajeros. En ${d.provincias.sinPasajeros} de las ${d.provincias.total} provincias, nadie.`,
  },
  actualidad: {
    titulo: 'Hoy',
    texto: (d) =>
      `De cada 100 km de vía que se construyeron, hoy ${d.porcentajeHoy[0]} llevan trenes de pasajeros, ${d.porcentajeHoy[1]} solo trenes de carga y ${d.porcentajeHoy[2]} están sin trenes. Los otros ${d.porcentajeHoy[3]} fueron levantados.`,
  },
};

function miles(valor: number): string {
  return Math.round(valor).toLocaleString('es-AR');
}

// Los porcentajes redondeados de varias partes, corregidos para que sumen 100: la diferencia del
// redondeo va a la parte más grande.
function porcentajesQueSuman100(valores: number[]): number[] {
  let total = 0;
  for (const valor of valores) {
    total += valor;
  }
  const porcentajes = [];
  let suma = 0;
  let mayor = 0;
  for (let i = 0; i < valores.length; i++) {
    porcentajes.push(Math.round((valores[i] / total) * 100));
    suma += porcentajes[i];
    if (valores[i] > valores[mayor]) {
      mayor = i;
    }
  }
  porcentajes[mayor] += 100 - suma;
  return porcentajes;
}

// La primera categoría de censos.json es la de la gente con tren de pasajeros.
function porcentajeConTren(personas: number[]): number {
  let total = 0;
  for (const cantidad of personas) {
    total += cantidad;
  }
  return Math.round((personas[0] / total) * 100);
}

// La primera provincia del orden, con su parte con tren de pasajeros, y cuántas no tienen ninguna.
function resumenProvincias(provincias: Provincia[]) {
  let sinPasajeros = 0;
  for (const provincia of provincias) {
    if (provincia.personas[0] === 0) {
      sinPasajeros += 1;
    }
  }
  const primera = provincias[0];
  return {
    primera: primera.nombre,
    porcentajePrimera: Math.round(primera.hasta[0] - primera.desde[0]),
    sinPasajeros,
    total: provincias.length,
  };
}

function calcularCifras(datos: Datos): Cifras {
  const censos = datos.censos;
  const serie = datos.serie;
  let k = 0;
  for (let i = 0; i < serie.anio.length; i++) {
    if (serie.km_pasajeros[i] > serie.km_pasajeros[k]) {
      k = i;
    }
  }
  const u = serie.anio.length - 1;
  return {
    cerradas: (anio) => miles(serie.cerradas[serie.anio.indexOf(anio)] ?? 0),
    kmPico: miles(serie.km_pasajeros[k]),
    porcentajeHoy: porcentajesQueSuman100([
      serie.km_pasajeros[u],
      serie.km_carga[u],
      serie.km_inactiva[u],
      serie.km_levantada[u],
    ]),
    primerCenso: censos.censo[0],
    ultimoCenso: censos.censo[censos.censo.length - 1],
    provincias: resumenProvincias(provinciasDelUltimoCenso(datos)),
    conTren: {
      primero: porcentajeConTren(censos.personas[0]),
      ultimo: porcentajeConTren(censos.personas[censos.personas.length - 1]),
    },
  };
}

// En cada checkpoint con año, un texto sobre lo que pasó: el título estampado como el sello y una
// o dos oraciones. Cada texto es función de la posición: se ve entero en su checkpoint y se va al
// alejarse.
@Component({
  selector: 'app-relato',
  // El contenedor no recibe el puntero, así no tapa al gráfico.
  host: { class: 'pointer-events-none block @container' },
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
      font-size: calc(1.375rem * var(--escala, 1));
    }
    .texto {
      margin-top: 1.25rem;
      font-size: calc(1.125rem * var(--escala, 1));
      line-height: 1.6;
    }
    /* Como la fuente de los gráficos: chica y tenue, debajo del texto. */
    .fuente {
      margin-top: 0.75rem;
      font-size: calc(0.75rem * var(--escala, 1));
      line-height: 1.4;
      opacity: 0.6;
    }
    /* En el celular, tamaños fijos; en escritorio, proporcionales al ancho del sector, con techo
       en los de una ventana de 1.300 px. */
    @media (min-width: 1080px) {
      .estampado {
        font-size: calc(clamp(1.25rem, 4cqw, 1.5625rem) * var(--escala, 1));
      }
      .texto {
        margin-top: 2cqw;
        font-size: calc(clamp(0.9375rem, 3cqw, 1.1875rem) * var(--escala, 1));
        max-width: 72cqw;
      }
    }
  `,
  template: `
    @if (cifras(); as d) {
      @for (tarjeta of visibles(); track tarjeta.id) {
        <!-- Centrado en el alto de su lugar. El texto visible recibe el puntero, así se puede
             seleccionar. -->
        <div
          class="tarjeta absolute inset-0 flex flex-col justify-center-safe py-6 max-md:py-2"
          [style.opacity]="tarjeta.opacidad"
        >
          <div class="contenido select-text" [class.pointer-events-auto]="tarjeta.opacidad >= 0.5">
            <!-- El lugar del sello: el texto lo rodea y puede seguir por debajo. -->
            <div class="hueco-sello"></div>
            <h2 class="estampado font-bold">{{ tarjeta.texto.titulo }}</h2>
            <p class="texto">{{ tarjeta.texto.texto(d) }}</p>
            @if (tarjeta.texto.fuente; as fuente) {
              <p class="fuente">
                Fuente:
                <a class="underline" [href]="fuente.url" target="_blank" rel="noopener">{{
                  fuente.nombre
                }}</a
                >.
              </p>
            }
          </div>
        </div>
      }
    }
  `,
})
export class Relato {
  private readonly carga = inject(CargaDatos);
  private readonly estado = inject(EstadoApp);
  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tamanio = signal({ ancho: 0, alto: 0 }); // px

  constructor() {
    afterNextRender(() => {
      const observador = new ResizeObserver((entradas) => {
        const caja = entradas[0].contentRect;
        this.tamanio.set({ ancho: caja.width, alto: caja.height });
      });
      observador.observe(this.elemento.nativeElement);
    });
    // Sólo cuando cambian los textos visibles o el lugar, no en cada cuadro de un viaje.
    afterRenderEffect(() => {
      this.idsVisibles();
      this.tamanio();
      this.ajustarLetra();
    });
  }

  private readonly idsVisibles = computed(() =>
    this.visibles()
      .map((tarjeta) => tarjeta.id)
      .join(),
  );

  // Si un texto no entra en su lugar, achica su letra de a poco hasta que entre.
  private ajustarLetra() {
    for (const tarjeta of this.elemento.nativeElement.querySelectorAll<HTMLElement>('.tarjeta')) {
      const contenido = tarjeta.querySelector<HTMLElement>('.contenido')!;
      const estilo = getComputedStyle(tarjeta);
      const lugar =
        tarjeta.clientHeight - parseFloat(estilo.paddingTop) - parseFloat(estilo.paddingBottom);
      let escala = 1;
      tarjeta.style.setProperty('--escala', '1');
      while (contenido.offsetHeight > lugar && escala > ESCALA_MINIMA) {
        escala -= PASO_ESCALA;
        tarjeta.style.setProperty('--escala', String(escala));
      }
    }
  }

  protected readonly cifras = computed(() => {
    const datos = this.carga.datos();
    return datos === null ? null : calcularCifras(datos);
  });

  // Los textos que se ven en la posición actual, con su opacidad: a lo sumo dos, durante el cruce.
  protected readonly visibles = computed(() => {
    const posicion = this.estado.posicion();
    const tarjetas = [];
    for (let i = 0; i < CHECKPOINTS.length; i++) {
      const opacidad = opacidadEn(posicion, i);
      const id = CHECKPOINTS[i].id;
      if (opacidad > 0 && id in TEXTOS) {
        tarjetas.push({ id, opacidad, texto: TEXTOS[id] });
      }
    }
    return tarjetas;
  });
}
