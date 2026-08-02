import '@terrcvm/napplet-kit/ui/tokens.css';
import './ui/field.css';
import { renderApp } from './ui/app';

const app = document.querySelector<HTMLDivElement>('#app');

if (!(app instanceof HTMLDivElement)) {
  throw new Error('Missing #app root');
}

renderApp(app);
