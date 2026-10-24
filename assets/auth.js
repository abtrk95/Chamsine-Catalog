/** A convenience screen, NOT server authentication. Static assets remain public. */
const SESSION_KEY = 'store:unlocked:2026-10';
const PIN = '0102';
const gate = document.getElementById('gate');
const field = document.getElementById('password');
const status = document.getElementById('gate-status');
let opening = false;
let catalog;
const readSession = () => { try { return sessionStorage.getItem(SESSION_KEY) === 'yes'; } catch { return false; } };
const writeSession = value => { try { value ? sessionStorage.setItem(SESSION_KEY, 'yes') : sessionStorage.removeItem(SESSION_KEY); } catch { /* Private browsing: gate still works in memory. */ } };
function normalizedPIN(value) {
  return value.replace(/[٠-٩]/g, n => String(n.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, n => String(n.charCodeAt(0) - 1776)).replace(/\s/g, '');
}
async function openCatalog() {
  if (opening) return;
  opening = true;
  field.disabled = true;
  field.setAttribute('aria-busy', 'true');
  try {
    catalog ||= await import('./store.js');
    await catalog.init();
    writeSession(true);
    gate.hidden = true;
    document.getElementById('app').hidden = false;
    document.body.classList.add('unlocked');
    field.value = '';
    status.textContent = '';
    document.getElementById('page-title').focus({ preventScroll: true });
  } catch (error) {
    writeSession(false);
    field.setAttribute('aria-invalid', 'true');
    field.title = 'تعذر فتح المتجر. تحقق من الاتصال وحاول مجددًا.';
    status.textContent = field.title;
    console.error('Catalog could not load:', error);
  } finally {
    opening = false;
    field.disabled = false;
    field.removeAttribute('aria-busy');
    if (!gate.hidden) { field.focus(); field.select(); }
  }
}
function attempt() {
  const value = normalizedPIN(field.value);
  if (value === PIN) return openCatalog();
  field.setAttribute('aria-invalid', 'true');
  field.title = 'كلمة المرور غير صحيحة';
  status.textContent = field.title;
  field.select();
}
field.addEventListener('input', () => {
  field.removeAttribute('aria-invalid'); field.title = ''; status.textContent = '';
  if (normalizedPIN(field.value).length === 4) attempt();
});
document.getElementById('gate-form').addEventListener('submit', event => { event.preventDefault(); attempt(); });
document.getElementById('lock-store').addEventListener('click', () => {
  writeSession(false);
  document.getElementById('app').hidden = true;
  document.getElementById('toast').hidden = true;
  gate.hidden = false;
  document.body.classList.remove('unlocked');
  field.value = ''; field.removeAttribute('aria-invalid'); field.title = ''; status.textContent = '';
  window.scrollTo(0, 0); field.focus();
});
if (readSession()) openCatalog();
