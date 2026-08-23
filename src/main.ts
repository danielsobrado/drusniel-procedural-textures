import './styles/app.css';
import './styles/refinements.css';
import './styles/library-compact.css';
import './styles/tile-preview.css';
import './styles/brand.css';
import './styles/marble-glass.css';
import './styles/status-badge.css';
import './styles/progress.css';
import './styles/surface-depth.css';
import './styles/surface-designer.css';
import { reportBootStage } from './app/BootProgress';
import { App } from './app/App';
import { TouchRadialTrigger } from './ui/TouchRadialTrigger';

reportBootStage('Loading interface');

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