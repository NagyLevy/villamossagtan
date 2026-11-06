import 'katex/dist/katex.min.css';
import './ui/tokens.css';
import './ui/app.css';
import { startApp } from './ui/app';
import { initPerf } from './ui/perf';

const root = document.querySelector<HTMLDivElement>('#app')!;
initPerf();
startApp(root);
