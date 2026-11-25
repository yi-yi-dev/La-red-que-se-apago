// El idioma de la app sale de la URL: la versión en inglés vive en la carpeta en/ (la arma el
// workflow copiando index.html), así la misma compilación sirve para los dos idiomas.
export type Idioma = 'es' | 'en';

export const IDIOMA: Idioma = /\/en(\/|\/index\.html)?$/.test(window.location.pathname)
  ? 'en'
  : 'es';
export const EN = IDIOMA === 'en';
const LOCALE = EN ? 'en-US' : 'es-AR';

// El texto en el idioma de la app: el español primero y el inglés después, uno al lado del otro.
export function t<T>(es: T, en: T): T {
  return EN ? en : es;
}

// Un número entero con el separador de miles del idioma.
export function miles(valor: number): string {
  return Math.round(valor).toLocaleString(LOCALE);
}

// Un número con un decimal y la coma o el punto del idioma.
export function unDecimal(valor: number): string {
  const texto = valor.toFixed(1);
  return EN ? texto : texto.replace('.', ',');
}

// La página de metodología del idioma, relativa al base href (la inglesa está en en/).
export const METODOLOGIA = EN ? 'en/metodologia.html' : 'metodologia.html';
