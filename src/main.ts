import './styles/app.css';
import './styles/refinements.css';
import './styles/tile-preview.css';
import { App } from './app/App';
import { TouchRadialTrigger } from './ui/TouchRadialTrigger';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) {
  throw new Error('Application root was not found.');
}

new App(root);

const viewport = root.querySelector<HTMLElement>('[data-role="viewport"]');
if (viewport === null) {
  throw new Error('Viewport was not created.');
}

new TouchRadialTrigger(viewport);
