const app = document.querySelector<HTMLDivElement>('#app');

if (!(app instanceof HTMLDivElement)) {
  throw new Error('Missing #app root');
}
