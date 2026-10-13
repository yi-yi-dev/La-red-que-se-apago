// Una grilla de celdas cuadradas para encontrar rápido lo que está cerca de un punto.
export class Grilla {
  private readonly celdas = new Map<number, number[]>();

  constructor(readonly lado: number) {}

  // Las coordenadas son positivas y caben de sobra en 4096 celdas por eje.
  private clave(cx: number, cy: number): number {
    return cx * 4096 + cy;
  }

  agregar(id: number, x: number, y: number) {
    const k = this.clave(Math.floor(x / this.lado), Math.floor(y / this.lado));
    const lista = this.celdas.get(k);
    if (lista) {
      lista.push(id);
    } else {
      this.celdas.set(k, [id]);
    }
  }

  // Las claves de las celdas que toca un círculo de radio r.
  private clavesAlrededor(x: number, y: number, r: number): number[] {
    const claves = [];
    const x0 = Math.floor((x - r) / this.lado);
    const x1 = Math.floor((x + r) / this.lado);
    const y0 = Math.floor((y - r) / this.lado);
    const y1 = Math.floor((y + r) / this.lado);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        claves.push(this.clave(cx, cy));
      }
    }
    return claves;
  }

  // Llama a f con cada id de las celdas que toca el círculo; la distancia la mide quien llama.
  alrededor(x: number, y: number, r: number, f: (id: number) => void) {
    for (const k of this.clavesAlrededor(x, y, r)) {
      const lista = this.celdas.get(k);
      if (lista) {
        for (const id of lista) {
          f(id);
        }
      }
    }
  }
}
