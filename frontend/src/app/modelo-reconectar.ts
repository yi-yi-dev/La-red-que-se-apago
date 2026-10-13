// El estado de la red que arma el usuario en Reconectar. La red de hoy es un piso fijo y las
// ediciones son una lista de trazos que pintan o borran; la gente que gana un tren se recalcula sólo
// alrededor de las estaciones que cambiaron.
import { Datos } from './datos';
import { Grilla } from './grilla';

export const INACTIVA = 1;
export const CARGA = 2;
export const PASAJEROS = 3;

// Un trazo pintado pone pasajeros en sus partes y uno borrado se los saca; deshacer es sacar la última.
export interface Edicion {
  pinta: boolean;
  partes: number[];
}

// Pone vértices cada `paso` como máximo, así un movimiento rápido del puntero no saltea vías.
function remuestrear(trazo: number[], paso: number): number[] {
  const salida = [trazo[0], trazo[1]];
  for (let k = 2; k < trazo.length; k += 2) {
    const x0 = trazo[k - 2];
    const y0 = trazo[k - 1];
    const x1 = trazo[k];
    const y1 = trazo[k + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / paso));
    for (let j = 1; j <= n; j++) {
      salida.push(x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n);
    }
  }
  return salida;
}

export class ModeloReconectar {
  private readonly grillaPartes: Grilla;
  // Para cada estación sin pasajeros, los puntos de gente sin tren de pasajeros a su alcance.
  private readonly puntosDeEstacion: number[][] = [];

  ediciones: Edicion[] = [];
  pintada: Uint8Array; // si el usuario le puso pasajeros a cada parte
  private estacionActiva: Uint8Array; // si cada estación tiene pasajeros por lo pintado
  private estacionesCerca: Uint16Array; // por punto de gente, cuántas estaciones activas lo alcanzan
  sinTren: Float64Array; // por departamento, la gente que sigue sin un tren de pasajeros cerca
  personasQueGanan = 0;

  constructor(readonly d: Datos) {
    const v = d.vias;
    const pob = d.poblacion;
    const lado = d.meta.celda_grilla;

    this.grillaPartes = new Grilla(lado);
    for (let p = 0; p < v.xy.length; p++) {
      const l = v.xy[p];
      if (v.categoria[p] !== CARGA && v.categoria[p] !== INACTIVA) {
        continue;
      }
      for (let k = 0; k < l.length; k += 2) {
        this.grillaPartes.agregar(p, l[k], l[k + 1]);
      }
    }

    this.sinTren = new Float64Array(d.regiones.departamentos.codigo.length);
    const grillaPuntos = new Grilla(lado);
    for (let i = 0; i < pob.x.length; i++) {
      if (pob.nivel[i] < PASAJEROS) {
        grillaPuntos.agregar(i, pob.x[i], pob.y[i]);
        this.sinTren[pob.dep[i]] += pob.pob[i];
      }
    }
    const alcance = d.meta.alcance;
    for (let s = 0; s < d.estaciones.x.length; s++) {
      const cerca: number[] = [];
      if (d.estaciones.nivel[s] < PASAJEROS) {
        const x = d.estaciones.x[s];
        const y = d.estaciones.y[s];
        grillaPuntos.alrededor(x, y, alcance, (i) => {
          if ((pob.x[i] - x) ** 2 + (pob.y[i] - y) ** 2 <= alcance ** 2) {
            cerca.push(i);
          }
        });
      }
      this.puntosDeEstacion.push(cerca);
    }

    this.pintada = new Uint8Array(v.categoria.length);
    this.estacionActiva = new Uint8Array(d.estaciones.x.length);
    this.estacionesCerca = new Uint16Array(pob.x.length);
  }

  // Las partes de carga o sin trenes con algún vértice a menos de r del trazo.
  partesBajoTrazo(trazo: number[], r: number): number[] {
    const denso = remuestrear(trazo, Math.max(1, r / 2));
    const elegidas = new Set<number>();
    for (let k = 0; k < denso.length; k += 2) {
      const x = denso[k];
      const y = denso[k + 1];
      this.grillaPartes.alrededor(x, y, r, (p) => {
        if (elegidas.has(p)) {
          return;
        }
        const l = this.d.vias.xy[p];
        for (let j = 0; j < l.length; j += 2) {
          if ((l[j] - x) ** 2 + (l[j + 1] - y) ** 2 <= r * r) {
            elegidas.add(p);
            return;
          }
        }
      });
    }
    return [...elegidas];
  }

  // Todo un trazo es una sola edición, que crece mientras se arrastra: un Ctrl+Z lo deshace entero.
  empezarTrazo(pinta: boolean) {
    this.ediciones.push({ pinta, partes: [] });
  }

  // Devuelve sólo las partes que cambian, para dibujar lo nuevo del trazo sin rearmar la red.
  sumarAlTrazo(partes: number[]): number[] {
    const edicion = this.ediciones[this.ediciones.length - 1];
    const valor = edicion.pinta ? 1 : 0;
    const nuevas = [];
    for (const p of partes) {
      if (this.pintada[p] !== valor) {
        this.pintada[p] = valor;
        edicion.partes.push(p);
        nuevas.push(p);
      }
    }
    return nuevas;
  }

  // Sólo se guarda el trazo si cambió algo, así cada Ctrl+Z deshace algo visible.
  terminarTrazo() {
    if (this.ediciones[this.ediciones.length - 1].partes.length === 0) {
      this.ediciones.pop();
    }
  }

  deshacer() {
    this.ediciones.pop();
  }

  recalcular() {
    const v = this.d.vias;
    const pob = this.d.poblacion;
    this.pintada.fill(0);
    for (const e of this.ediciones) {
      for (const p of e.partes) {
        this.pintada[p] = e.pinta ? 1 : 0;
      }
    }

    const activa = new Uint8Array(this.estacionActiva.length);
    for (let p = 0; p < v.categoria.length; p++) {
      if (this.pintada[p]) {
        for (const s of v.estaciones[p]) {
          activa[s] = 1;
        }
      }
    }

    // Cada estación que se prende o se apaga suma o resta a los puntos que alcanza; un punto gana el
    // tren cuando pasa de cero estaciones a una y lo pierde al volver a cero.
    for (let s = 0; s < activa.length; s++) {
      if (activa[s] === this.estacionActiva[s]) {
        continue;
      }
      for (const i of this.puntosDeEstacion[s]) {
        if (activa[s]) {
          this.estacionesCerca[i] += 1;
          if (this.estacionesCerca[i] === 1) {
            this.sinTren[pob.dep[i]] -= pob.pob[i];
            this.personasQueGanan += pob.pob[i];
          }
        } else {
          this.estacionesCerca[i] -= 1;
          if (this.estacionesCerca[i] === 0) {
            this.sinTren[pob.dep[i]] += pob.pob[i];
            this.personasQueGanan -= pob.pob[i];
          }
        }
      }
    }
    this.estacionActiva = activa;
  }

  // Los km pintados de cada categoría y la gente que gana un tren de pasajeros cerca.
  resumen() {
    let kmMixtos = 0;
    let kmReactivados = 0;
    for (let p = 0; p < this.pintada.length; p++) {
      if (!this.pintada[p]) {
        continue;
      }
      if (this.d.vias.categoria[p] === CARGA) {
        kmMixtos += this.d.vias.km[p];
      } else {
        kmReactivados += this.d.vias.km[p];
      }
    }
    return { kmMixtos, kmReactivados, personasQueGanan: this.personasQueGanan };
  }
}
