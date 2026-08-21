function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing required tile workspace element: ${selector}`);
  return element;
}

export class TileWorkspace {
  public readonly host: HTMLElement;

  private readonly shell: HTMLElement;

  public constructor(root: HTMLElement) {
    this.shell = required(root, '.app-shell');
    const toolbar = required<HTMLElement>(root, '.toolbar-project');
    const divider = toolbar.querySelector<HTMLElement>('.phase3-divider');
    const button = document.createElement('button');
    button.className = 'compact-button tile-command';
    button.type = 'button';
    button.dataset.command = 'tile-preview';
    button.title = 'Preview repeated tiles and export seamless PBR maps';
    button.textContent = 'Tiles';
    toolbar.insertBefore(button, divider);

    this.host = document.createElement('section');
    this.host.className = 'tile-workspace';
    this.host.dataset.role = 'tile-preview';
    this.host.setAttribute('aria-label', 'Seamless tile preview');
    const inspector = required<HTMLElement>(this.shell, '[data-role="inspector"]');
    this.shell.insertBefore(this.host, inspector);
  }

  public setActive(active: boolean): void {
    this.shell.classList.toggle('is-tile-mode', active);
  }
}
