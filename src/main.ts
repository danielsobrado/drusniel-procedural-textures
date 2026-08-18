import './styles/app.css';
import { App } from './app/App';
import { installLongPressContextMenu } from './ui/LongPressContextMenu';

const root = document.querySelector<HTMLElement>('#app');

if (root === null) {
  throw new Error('Application root not found.');
}

new App(root);
installLongPressContextMenu();
