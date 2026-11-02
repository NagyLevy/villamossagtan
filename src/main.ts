import 'katex/dist/katex.min.css';
import './ui/tokens.css';
import './ui/app.css';
import { adoptProgress, clearProgress } from './daily/progress';
import { connect, loadMine, onlineState, signOut, type Account } from './online/league';
import { startApp } from './ui/app';
import { loginPage } from './ui/login';
import { initPerf } from './ui/perf';

const root = document.querySelector<HTMLDivElement>('#app')!;

const login = () => {
  sessionStorage.removeItem('villamossagtan.guest');
  location.reload();
};
const logout = async () => {
  await signOut();
  clearProgress();
  location.reload();
};

/** Belépés után: a fiók haladása kerül a gépre, aztán indul az app. */
async function enter(account: Account): Promise<void> {
  const server = await loadMine();
  if (server) adoptProgress(account.id, server);
  startApp(root, { account, mode: 'online', onLogin: login, onLogout: () => void logout() });
}

async function boot(): Promise<void> {
  const client = await connect();
  // Szerver nélkül (pl. a claude.ai-os változatban) belépés nélkül, pontkóddal megy minden.
  if (!client) return startApp(root);
  const { user } = onlineState();
  if (user) return enter(user);
  try {
    if (sessionStorage.getItem('villamossagtan.guest')) return startApp(root, { account: null, mode: 'guest', onLogin: login, onLogout: () => {} });
  } catch {
    // A tárolás nem kötelező.
  }
  loginPage(
    root,
    (account) => void enter(account),
    () => {
      try {
        sessionStorage.setItem('villamossagtan.guest', '1');
      } catch {
        // A tárolás nem kötelező.
      }
      startApp(root, { account: null, mode: 'guest', onLogin: login, onLogout: () => {} });
    },
  );
}

initPerf();
void boot();
