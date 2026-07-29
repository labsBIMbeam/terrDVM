/// <reference types="vite/client" />

import './ui/tokens.css';
import { renderApp } from './ui/app';

const app = document.querySelector<HTMLDivElement>('#app');

if (!(app instanceof HTMLDivElement)) {
  throw new Error('Missing #app root');
}

// In a shell the region arrives through the `config` NAP. The query parameter
// is a development affordance for exercising regions without a shell.
const region = new URLSearchParams(location.search).get('region') ?? undefined;

renderApp(app, { region });
