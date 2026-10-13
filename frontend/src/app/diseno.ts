import { computed, Injectable, signal } from '@angular/core';
import { CHECKPOINTS } from './estado';

// El layout de escritorio, en fracciones del ancho del boleto. La vía y el troquel vertical
// comparten estas medidas, así Actualidad queda a la izquierda del troquel y La gente a la derecha.
export const ANCHO_TALON = 0.045;
const X_TROQUEL_MAXIMO = 0.68; // el troquel va acá mientras al panel del mapa le alcance el ancho
const ANCHO_MINIMO_MAPA = 500; // px: si no alcanza, el troquel se corre a la izquierda
const X_PRESENTACION = 0.08; // el checkpoint sin año del principio
const X_PRIMER_ANIO = 0.125; // 1857: lo justo para que las etiquetas no se toquen en 1.080 px
const SEPARACION_ACTUALIDAD = 0.04; // Actualidad queda esta fracción a la izquierda del troquel
const PRIMERO_EN_EL_MAPA = 0.12; // La gente, como fracción del panel del mapa
// px entre el eje izquierdo del gráfico de la serie y su texto; el texto de cada checkpoint usa el
// mismo margen, así los dos quedan alineados.
export const SANGRIA_EJE = 44;
const ANCHO_ESCRITORIO_PX = 1080; // el breakpoint md, redefinido en styles.css
// px de alto de ventana con los que el layout respira. Con menos, la app se dibuja con este alto y
// se achica entera para entrar: queda igual, más chica. 920 deja afuera la ventana maximizada de 1080p.
const ALTO_NECESARIO = { escritorio: 920, celular: 812 };
const ALTO_CELULAR_ACOSTADO = 500; // px: acostado y con menos alto, la app pide girar el teléfono

// Una caja invisible de 100svh: el navegador no da ese alto directo en JS.
function crearSondaAltoChico(): HTMLElement {
  const sonda = document.createElement('div');
  sonda.style.cssText = 'position: fixed; top: 0; height: 100svh; width: 0; visibility: hidden;';
  document.body.append(sonda);
  return sonda;
}

@Injectable({ providedIn: 'root' })
export class Diseno {
  private readonly consultaEscritorio = window.matchMedia(`(min-width: ${ANCHO_ESCRITORIO_PX}px)`);
  readonly esCelular = signal(!this.consultaEscritorio.matches);

  readonly anchoBoleto = signal(window.innerWidth); // px; lo mide el componente base
  // px de pantalla: el alto con las barras del navegador del celular a la vista (100svh), que no
  // cambia cuando la barra se esconde al tocar. Con innerHeight la app se rearmaba entera.
  private readonly sonda = crearSondaAltoChico();
  readonly altoVentana = signal(this.sonda.offsetHeight);
  readonly anchoVentana = signal(window.innerWidth); // px de pantalla

  // Cuánto se achica la app entera: 1 si la ventana tiene el alto necesario.
  readonly escala = computed(() => {
    // El cartel que pide girar el teléfono va sin achicar.
    const acostado = this.anchoVentana() > this.altoVentana();
    if (this.esCelular() && acostado && this.altoVentana() <= ALTO_CELULAR_ACOSTADO) {
      return 1;
    }
    const necesario = this.esCelular() ? ALTO_NECESARIO.celular : ALTO_NECESARIO.escritorio;
    return Math.min(1, this.altoVentana() / necesario);
  });

  // En el celular el área grande muestra una cosa por vez: el mapa o la información.
  readonly vistaCelular = signal<'mapa' | 'informacion'>('informacion');

  // En el celular no hay troquel: la vía usa las proporciones de una pantalla ancha.
  readonly xTroquel = computed(() => {
    if (this.esCelular()) {
      return X_TROQUEL_MAXIMO;
    }
    return Math.min(X_TROQUEL_MAXIMO, 1 - ANCHO_MINIMO_MAPA / this.anchoBoleto());
  });

  // Dónde cae cada checkpoint, como fracción del ancho del boleto: el sin año del principio, los
  // años proporcionales entre 1857 y Actualidad, que queda junto al troquel, y los sin año del final
  // dentro del panel del mapa.
  readonly xCheckpoints = computed(() => {
    const xTroquel = this.xTroquel();
    const xFinAnios = xTroquel - SEPARACION_ACTUALIDAD;
    let primerAnio: number | null = null;
    let ultimoAnio = 0;
    for (const checkpoint of CHECKPOINTS) {
      if (checkpoint.anio !== null) {
        primerAnio = primerAnio ?? checkpoint.anio;
        ultimoAnio = checkpoint.anio;
      }
    }

    // Los sin año del final van parejos desde La gente hasta Fin, que queda tan lejos del borde
    // derecho como Inicio del izquierdo.
    let cantidadDelFinal = 0;
    let pasoUnAnio = false;
    for (const checkpoint of CHECKPOINTS) {
      if (checkpoint.anio !== null) {
        pasoUnAnio = true;
      } else if (pasoUnAnio) {
        cantidadDelFinal += 1;
      }
    }
    const xPrimeroDelFinal = xTroquel + PRIMERO_EN_EL_MAPA * (1 - xTroquel);
    const pasoDelFinal = (1 - X_PRESENTACION - xPrimeroDelFinal) / (cantidadDelFinal - 1);

    const posiciones = [];
    let sinAnioDelFinal = 0;
    for (const checkpoint of CHECKPOINTS) {
      if (checkpoint.anio !== null) {
        posiciones.push(
          X_PRIMER_ANIO +
            ((checkpoint.anio - primerAnio!) / (ultimoAnio - primerAnio!)) *
              (xFinAnios - X_PRIMER_ANIO),
        );
      } else if (posiciones.length === 0) {
        posiciones.push(X_PRESENTACION);
      } else {
        posiciones.push(xPrimeroDelFinal + sinAnioDelFinal * pasoDelFinal);
        sinAnioDelFinal += 1;
      }
    }
    return posiciones;
  });

  // Dónde empieza el texto del gráfico de la serie, en px desde el borde izquierdo del boleto: su
  // eje izquierdo cae en el primer checkpoint con año.
  readonly bordeTextoSerie = computed(() => {
    let primero = 0;
    while (CHECKPOINTS[primero].anio === null) {
      primero += 1;
    }
    return this.xCheckpoints()[primero] * this.anchoBoleto() - SANGRIA_EJE;
  });

  constructor() {
    this.consultaEscritorio.addEventListener('change', (evento) =>
      this.esCelular.set(!evento.matches),
    );
    window.addEventListener('resize', () => {
      this.altoVentana.set(this.sonda.offsetHeight);
      this.anchoVentana.set(window.innerWidth);
    });
  }
}
