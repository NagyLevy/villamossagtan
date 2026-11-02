// Belépő oldal: felhasználónév + jelszó, Regisztráció gombbal. A fiók a haladást és a
// ranglista-helyet viszi magával bármelyik gépre. Belépés nélkül csak gyakorolni lehet.

import { signIn, signUp, type Account } from '../online/league';
import { h } from './dom';

const LOGO = '<svg width="28" height="28" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 9h3l2-5 4 10 2-5h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function loginPage(root: HTMLElement, onLogin: (a: Account) => void, onGuest: () => void): void {
  let register = false;
  const user = h('input', { class: 'answer-input', attrs: { id: 'login-user', name: 'username', autocomplete: 'username', spellcheck: 'false', autocapitalize: 'none', required: true, maxlength: 20 } });
  const pass = h('input', { class: 'answer-input', attrs: { id: 'login-pass', name: 'password', type: 'password', autocomplete: 'current-password', required: true } });
  const pass2 = h('input', { class: 'answer-input', attrs: { id: 'login-pass2', name: 'password2', type: 'password', autocomplete: 'new-password' } });
  const pass2Field = h('label', { class: 'login-field', attrs: { for: 'login-pass2' } }, h('span', { text: 'Jelszó még egyszer' }), pass2);
  const error = h('p', { class: 'login-error', attrs: { role: 'alert' } });
  const submit = h('button', { class: 'btn btn-primary login-submit', attrs: { type: 'submit' } });
  const switchBtn = h('button', { class: 'btn btn-secondary login-switch', attrs: { type: 'button' } });
  const hint = h('p', { class: 'login-hint' });
  const title = h('h1', { class: 'login-title' });

  const sync = () => {
    title.textContent = register ? 'Regisztráció' : 'Belépés';
    submit.textContent = register ? 'Fiók létrehozása' : 'Belépés';
    switchBtn.textContent = register ? 'Van már fiókom, belépek' : 'Regisztráció';
    pass2Field.hidden = !register;
    pass2.required = register;
    pass.setAttribute('autocomplete', register ? 'new-password' : 'current-password');
    hint.textContent = register
      ? 'A felhasználónév 3–20 karakter (betű, szám, pont, kötőjel, aláhúzás), ezen a néven látnak a ranglistán. A jelszó legalább 6 karakter. E-mail nem kell.'
      : 'Lépj be, és bármelyik gépről folytathatod a napi kihívást ugyanazzal a haladással.';
    error.textContent = '';
  };

  switchBtn.addEventListener('click', () => {
    register = !register;
    sync();
    user.focus();
  });

  const form = h(
    'form',
    { class: 'login-form', attrs: { novalidate: true } },
    h('label', { class: 'login-field', attrs: { for: 'login-user' } }, h('span', { text: 'Felhasználónév' }), user),
    h('label', { class: 'login-field', attrs: { for: 'login-pass' } }, h('span', { text: 'Jelszó' }), pass),
    pass2Field,
    error,
    submit,
    switchBtn,
  ) as HTMLFormElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (register && pass.value !== pass2.value) {
      error.textContent = 'A két jelszó nem egyezik.';
      return;
    }
    submit.disabled = true;
    submit.textContent = register ? 'Létrehozás…' : 'Belépés…';
    const r = register ? await signUp(user.value, pass.value) : await signIn(user.value, pass.value);
    submit.disabled = false;
    if (!r.ok) {
      sync();
      error.textContent = r.error;
      return;
    }
    onLogin(r.account);
  });

  const guest = h('button', { class: 'login-guest', attrs: { type: 'button' }, text: 'Csak gyakorolnék, belépés nélkül' });
  guest.addEventListener('click', onGuest);

  root.replaceChildren(
    h(
      'main',
      { class: 'login-page' },
      h(
        'section',
        { class: 'card login-card enter', attrs: { 'aria-labelledby': 'login-title' } },
        h('div', { class: 'login-brand' }, h('span', { class: 'brand-mark', html: LOGO }), h('span', { text: 'Villamosságtan' })),
        title,
        hint,
        form,
      ),
      guest,
      h('p', { class: 'login-note', text: 'Belépés nélkül nincs napi kihívás és ranglista.' }),
    ),
  );
  title.id = 'login-title';
  sync();
  user.focus();
}
