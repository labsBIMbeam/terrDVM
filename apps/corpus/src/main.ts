/// <reference types="vite/client" />

import '@terrcvm/napplet-kit/ui/tokens.css';
import './ui/corpus.css';
import { readConfig } from './config';
import { renderApp } from './ui/app';

const app = document.querySelector<HTMLDivElement>('#app');

if (!(app instanceof HTMLDivElement)) {
  throw new Error('Missing #app root');
}

renderApp(app, readConfig(location.search));
