import './styles/app.css';
import { App } from './app/App';

const root = document.querySelector<HTMLElement>('#app');

if (root === null) {
  throw new Error('Application root not found.');
}

new App(root);
