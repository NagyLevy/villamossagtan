import 'katex/dist/katex.min.css';
import '@fontsource-variable/ibm-plex-sans/wdth.css';
import './ui/tokens.css';
import './ui/app.css';
import './ui/theme.css';
import { startApp } from './ui/app';
import { initPerf } from './ui/perf';

const root = document.querySelector<HTMLDivElement>('#app')!;
initPerf();
startApp(root);
