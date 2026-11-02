import 'katex/dist/katex.min.css';
import './ui/tokens.css';
import './ui/app.css';
import { startApp } from './ui/app';

startApp(document.querySelector<HTMLDivElement>('#app')!);
