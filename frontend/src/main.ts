import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { EN } from './app/idioma';

// La versión en inglés usa el mismo index.html: el idioma y el título se ajustan acá.
if (EN) {
  document.documentElement.lang = 'en';
  document.title = 'The network that went dark';
}

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
