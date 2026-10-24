/** Pure helpers shared by the interface, order renderer and tests. */
export const MAX_QUANTITY = 999;
export const money = cents => cents === null ? 'السعر عند الطلب' : new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100) + ' kr';
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
export function normalize(value) {
  return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '').replace(/[إأآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/[٠-٩]/g, n => String(n.charCodeAt(0)-1632)).replace(/[۰-۹]/g, n => String(n.charCodeAt(0)-1776)).replace(/[^a-z0-9\u0621-\u064a]+/g, ' ').trim();
}
export function cartKey(id, option = '') { return JSON.stringify([id, option]); }
export function sanitizeCart(raw, products) {
  const map = new Map(products.map(p => [p.id, p]));
  const result = new Map();
  if (!Array.isArray(raw)) return result;
  for (const item of raw.slice(0, 2000)) {
    if (!item || typeof item.id !== 'string') continue;
    const product = map.get(item.id);
    const quantity = Number(item.quantity);
    const option = typeof item.option === 'string' ? item.option : '';
    if (!product || !Number.isInteger(quantity) || quantity < 1) continue;
    if (product.options.length ? !product.options.includes(option) : option !== '') continue;
    const key = cartKey(item.id, option);
    const previous = result.get(key)?.quantity || 0;
    result.set(key, { id:item.id, option, quantity:Math.min(MAX_QUANTITY, quantity + previous) });
  }
  return result;
}
export function summarize(entries) {
  return entries.reduce((sum, entry) => ({
    units: sum.units + entry.quantity,
    totalCents: sum.totalCents + (entry.product.priceCents === null ? 0 : entry.product.priceCents * entry.quantity),
    unknown: sum.unknown + (entry.product.priceCents === null ? 1 : 0)
  }), { units:0, totalCents:0, unknown:0 });
}
export function localDate(date = new Date()) { return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-'); }
export function orderDate(date = new Date()) { return new Intl.DateTimeFormat('en-GB', { year:'numeric', month:'2-digit', day:'2-digit' }).format(date); }
export function buildTextOrder(entries, date = new Date()) {
  const isolate = text => '\u2066' + text + '\u2069';
  const lines = ['طلب جديد', 'تاريخ الطلب: ' + isolate(orderDate(date)), ''];
  for (const {product, quantity, option} of entries) {
    lines.push(product.name + (option ? ' — ' + option : ''));
    lines.push('الرمز: ' + (product.sku ? isolate(product.sku) : 'غير متوفر'));
    lines.push('الكمية: ' + quantity);
    lines.push('سعر الوحدة: ' + (product.priceCents === null ? 'السعر عند الطلب' : isolate(money(product.priceCents))));
    lines.push('الإجمالي: ' + (product.priceCents === null ? 'السعر عند الطلب' : isolate(money(product.priceCents * quantity))), '');
  }
  const summary = summarize(entries);
  lines.push((summary.unknown ? 'إجمالي الأسعار المتوفرة: ' : 'الإجمالي: ') + isolate(money(summary.totalCents)));
  return lines.join('\n');
}
