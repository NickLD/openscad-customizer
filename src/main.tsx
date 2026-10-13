import { render } from 'preact';
import { AppController } from './app/controller';
import { createBrowserEngine } from './engine/engine';
import { browserNet } from './repo/net';
import { App } from './ui/App';
import './ui/styles.css';

const ctl = new AppController({
  net: browserNet,
  engine: createBrowserEngine(),
  setHash: (hash) => history.replaceState(null, '', hash || location.pathname),
});
window.addEventListener('hashchange', () => void ctl.open(location.hash));
void ctl.open(location.hash);
render(<App ctl={ctl} />, document.getElementById('app')!);
