import { MAX_QUANTITY, money, escapeHTML as esc, normalize, cartKey, sanitizeCart, summarize, localDate, buildTextOrder } from './core.js';
import { createOrderFile } from './order-pdf.js';

const CART_KEY = 'store:cart:v2';
const PAGE_SIZE = 24;
const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="assets/icons.svg#${name}"/></svg>`;
const state = { products:[], byId:new Map(), categories:[], cart:new Map(), query:'', category:'all', sort:'default', limit:PAGE_SIZE, revision:0, activeProduct:null };
let initialized = false;
let initializePromise;
let preparedOrder = null;
let preparingTimer;
let sharing = false;
let forceFileFallback = false;
let savedScroll = 0;
let toastTimer;

function entries() {
  return Array.from(state.cart, ([key,item]) => ({...item,key,product:state.byId.get(item.id)})).filter(item => item.product);
}
function storedCart() {
  try { const value=JSON.parse(localStorage.getItem(CART_KEY));return value?.version===2 ? value.items : []; }
  catch { return []; }
}
function persist() {
  try { localStorage.setItem(CART_KEY,JSON.stringify({version:2,items:Array.from(state.cart.values())})); }
  catch { /* The cart remains fully usable when storage is unavailable. */ }
}
function toast(message) {
  clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;
  toastTimer=setTimeout(()=>{$('toast').hidden=true;},2300);
}
function validateData(data) {
  if (!data || data.currency!=='DKK' || !Array.isArray(data.products) || !Array.isArray(data.categories)) throw new Error('Invalid catalog');
  const ids=new Set();
  const categoryIDs=new Set(data.categories.map(c=>c.id));
  for (const p of data.products) {
    if (!p || typeof p.id!=='string' || !p.id || ids.has(p.id) || typeof p.name!=='string' || !categoryIDs.has(p.category)) throw new Error('Invalid or duplicate product');
    if (p.priceCents!==null && (!Number.isSafeInteger(p.priceCents) || p.priceCents<0)) throw new Error('Invalid price');
    if (!Array.isArray(p.options) || p.options.some(x=>typeof x!=='string') || typeof p.image!=='string' || !/^(images\/[a-f0-9]+\.webp|assets\/placeholder\.svg)$/.test(p.image)) throw new Error('Invalid product metadata');
    ids.add(p.id);
  }
  return data;
}
export async function init() {
  if (initialized) return;
  if (initializePromise) return initializePromise;
  initializePromise=(async()=>{
    const response=await fetch(new URL('../data/products.json',import.meta.url),{cache:'no-cache'});
    if (!response.ok) throw new Error('Catalog request failed: '+response.status);
    const data=validateData(await response.json());
    state.products=data.products.map(p=>({...p,search:normalize(`${p.name} ${p.options.join(' ')} ${p.sourceName || ''} ${p.sku || ''}`)}));
    state.byId=new Map(state.products.map(p=>[p.id,p]));state.categories=data.categories;
    state.cart=sanitizeCart(storedCart(),state.products);
    $('catalog-count').textContent=String(state.products.length);
    renderCategories();renderProducts();bindEvents();renderCart();
    initialized=true;
  })();
  try { await initializePromise; } catch(error) { initializePromise=null;throw error; }
}
function categoryName(id) { return state.categories.find(c=>c.id===id)?.name || ''; }
function renderCategories() {
  const counts=new Map();for(const p of state.products)counts.set(p.category,(counts.get(p.category)||0)+1);
  const list=[{id:'all',name:'الكل'},...state.categories.filter(c=>counts.has(c.id))];
  $('categories').innerHTML=list.map(c=>`<button type="button" class="category-chip" data-category="${esc(c.id)}" aria-pressed="${state.category===c.id}">${esc(c.name)}<span>${c.id==='all'?state.products.length:counts.get(c.id)}</span></button>`).join('');
}
function filteredProducts() {
  const words=normalize(state.query).split(' ').filter(Boolean);
  const result=state.products.filter(p=>(state.category==='all'||p.category===state.category)&&words.every(word=>p.search.includes(word)));
  if(state.sort==='name')result.sort((a,b)=>a.name.localeCompare(b.name,'ar')||a.order-b.order);
  else if(state.sort==='price-asc'||state.sort==='price-desc')result.sort((a,b)=>{
    if(a.priceCents===null)return b.priceCents===null?a.order-b.order:1;
    if(b.priceCents===null)return -1;
    return (a.priceCents-b.priceCents)*(state.sort==='price-desc'?-1:1)||a.order-b.order;
  });
  return result;
}
function cardHTML(p) {
  return `<article class="product-card" data-card-id="${esc(p.id)}"><button class="image-button" type="button" data-open="${esc(p.id)}" aria-label="عرض تفاصيل ${esc(p.name)}"><img src="${esc(p.image)}" alt="${esc(p.name)}" width="640" height="640" loading="lazy" decoding="async"><span class="card-badge" data-badge="${esc(p.id)}" hidden></span></button><div class="product-info"><p class="product-category">${esc(categoryName(p.category))}</p><h2 class="product-name">${esc(p.name)}</h2><p class="sku">${p.sku?`<bdi>${esc(p.sku)}</bdi>`:'الرمز غير متوفر'}</p><div class="product-bottom"><span class="price${p.priceCents===null?' pending':''}"><bdi>${esc(money(p.priceCents))}</bdi></span><button class="card-add" type="button" data-add="${esc(p.id)}" aria-label="${p.options.length?'اختر نوع':'أضف إلى السلة:'} ${esc(p.name)}">${icon('plus')}<span>${p.options.length?'اختر':'أضف'}</span></button></div></div></article>`;
}
function renderProducts(append=false) {
  const result=filteredProducts();
  const shown=result.slice(0,state.limit);
  if(append){const start=$('product-grid').children.length;$('product-grid').insertAdjacentHTML('beforeend',shown.slice(start).map(cardHTML).join(''));}
  else $('product-grid').innerHTML=shown.map(cardHTML).join('');
  $('results-count').textContent=result.length?`عرض ${shown.length} من ${result.length} منتج`:'لا توجد نتائج';
  $('empty-state').hidden=!!result.length;$('load-more').hidden=shown.length>=result.length;
  $('reset-filters').hidden=!state.query&&state.category==='all'&&state.sort==='default';
  $('clear-search').hidden=!state.query;
  updateBadges();
}
function updateBadges() {
  const counts=new Map();for(const item of state.cart.values())counts.set(item.id,(counts.get(item.id)||0)+item.quantity);
  document.querySelectorAll('[data-badge]').forEach(badge=>{const count=counts.get(badge.dataset.badge)||0;badge.hidden=!count;badge.textContent=String(count);badge.setAttribute('aria-label',`${count} في السلة`);});
}
function resetFilters() {
  state.query='';state.category='all';state.sort='default';state.limit=PAGE_SIZE;
  $('search').value='';$('sort').value='default';renderCategories();renderProducts();
}
function addProduct(id,option='') {
  const product=state.byId.get(id);if(!product)return;
  if(product.options.length&&!product.options.includes(option)){openProduct(id);return;}
  const key=cartKey(id,option);const current=state.cart.get(key);
  if(current?.quantity>=MAX_QUANTITY){toast(`الحد الأقصى ${MAX_QUANTITY} قطعة لكل نوع`);return;}
  state.cart.set(key,{id,option,quantity:(current?.quantity||0)+1});
  cartChanged();toast('أُضيف المنتج إلى السلة');
}
function cartChanged() {
  state.revision++;preparedOrder=null;persist();renderCart();updateBadges();
  if($('cart-dialog').open)prepareOrder();
}
function renderCart() {
  const list=entries(),sum=summarize(list);
  const active=document.activeElement;
  const focus=active?.closest('#cart-items')?{key:active.dataset.key,action:active.dataset.action,isQuantity:active.hasAttribute('data-quantity')}:null;
  $('cart-count').textContent=String(sum.units);
  $('cart-trigger').setAttribute('aria-label',`السلة، ${sum.units} قطعة`);
  $('mobile-cart-count').textContent=`(${sum.units})`;
  $('mobile-cart-total').textContent=money(sum.totalCents)+(sum.unknown?' +':'');
  $('mobile-cart').hidden=!list.length;document.body.classList.toggle('has-cart',!!list.length);
  $('cart-subtitle').textContent=list.length?`${list.length} صنف · ${sum.units} قطعة`:'راجع اختياراتك قبل الإرسال.';
  $('cart-empty').hidden=!!list.length;$('cart-footer').hidden=!list.length;
  $('total-label').textContent=sum.unknown?'إجمالي الأسعار المتوفرة':'الإجمالي';
  $('cart-total').textContent=money(sum.totalCents);
  $('pending-prices').hidden=!sum.unknown;
  $('pending-prices').textContent=`${sum.unknown} من أصناف الطلب دون سعر محدد، ولا تدخل في الإجمالي أعلاه.`;
  $('send-order').disabled=!preparedOrder||sharing;
  $('send-text').disabled=!list.length;
  $('cart-items').innerHTML=list.map(({key,product:p,quantity,option})=>`<li class="cart-item"><img class="cart-thumb" src="${esc(p.image)}" alt="" width="68" height="68" loading="lazy"><div><h3>${esc(p.name)}</h3><p class="sku">${p.sku?`<bdi>${esc(p.sku)}</bdi>`:'الرمز غير متوفر'}</p>${option?`<span class="cart-variant">${esc(option)}</span>`:''}<div class="cart-prices"><span>سعر الوحدة <bdi>${esc(money(p.priceCents))}</bdi></span><strong><bdi>${esc(money(p.priceCents===null?null:p.priceCents*quantity))}</bdi></strong></div><div class="item-controls"><div class="quantity"><button type="button" data-action="decrease" data-key="${esc(key)}" aria-label="تقليل كمية ${esc(p.name)}">${icon('minus')}</button><input type="number" inputmode="numeric" min="1" max="${MAX_QUANTITY}" step="1" data-quantity data-key="${esc(key)}" value="${quantity}" aria-label="كمية ${esc(p.name)}${option?' — '+esc(option):''}"><button type="button" data-action="increase" data-key="${esc(key)}" aria-label="زيادة كمية ${esc(p.name)}">${icon('plus')}</button></div><button class="icon-button remove-item" type="button" data-action="remove" data-key="${esc(key)}" aria-label="حذف ${esc(p.name)}">${icon('trash')}</button></div></div></li>`).join('');
  if(focus?.key){const candidates=Array.from($('cart-items').querySelectorAll('[data-key]'));const target=candidates.find(el=>el.dataset.key===focus.key&&(focus.isQuantity?el.hasAttribute('data-quantity'):el.dataset.action===focus.action));if(target)target.focus({preventScroll:true});else if($('cart-dialog').open)$('cart-dialog').querySelector('[data-close]').focus({preventScroll:true});}
}
function lockScroll() {savedScroll=window.scrollY;document.body.style.top=`-${savedScroll}px`;document.body.classList.add('dialog-open');}
function unlockScroll() {document.body.classList.remove('dialog-open');document.body.style.top='';window.scrollTo(0,savedScroll);}
function openDialog(dialog) {
  if(dialog.open)return;
  for(const other of document.querySelectorAll('dialog[open]'))other.close();
  lockScroll();dialog.showModal();
}
function openCart() {renderCart();openDialog($('cart-dialog'));prepareOrder();}
function openProduct(id) {
  const p=state.byId.get(id);if(!p)return;state.activeProduct=id;
  delete $('detail-image').dataset.fallbackApplied;$('detail-image').src=p.image;$('detail-image').alt=p.name;
  $('detail-title').textContent=p.name;$('detail-category').textContent=categoryName(p.category);
  $('detail-sku').innerHTML=p.sku?`<bdi>${esc(p.sku)}</bdi>`:'الرمز غير متوفر';
  $('detail-price').innerHTML=`<bdi>${esc(money(p.priceCents))}</bdi>`;
  $('detail-options-wrap').hidden=!p.options.length;
  $('detail-options').innerHTML='<option value="">اختر النوع</option>'+p.options.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  $('detail-options').removeAttribute('aria-invalid');$('detail-feedback').textContent='';
  openDialog($('product-dialog'));
}
function supportsFileSharing(file) {
  try{return !forceFileFallback&&window.isSecureContext&&typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]});}
  catch{return false;}
}
function prepareOrder() {
  clearTimeout(preparingTimer);
  const list=entries();
  if(!list.length){preparedOrder=null;$('send-order').disabled=true;$('share-status').textContent='';return;}
  if(preparedOrder?.revision===state.revision&&preparedOrder.date===localDate()){$('send-order').disabled=sharing;return;}
  const revision=state.revision;
  $('send-order').disabled=true;$('send-order').setAttribute('aria-busy','true');$('share-status').textContent='جارٍ تجهيز الطلب…';
  preparingTimer=setTimeout(async()=>{
    try{
      const now=new Date();const file=await createOrderFile(list,now);
      if(revision!==state.revision)return;
      preparedOrder={file,revision,date:localDate(now)};
      $('send-order').disabled=sharing;$('send-order').removeAttribute('aria-busy');$('share-status').textContent='';
      const supported=supportsFileSharing(file);
      $('share-hint').hidden=supported;
      $('share-hint').textContent='هذا المتصفح لا يدعم مشاركة الملفات مباشرة. سيُحفظ الطلب على جهازك؛ أرفقه يدويًا في واتساب.';
    }catch(error){
      if(revision!==state.revision)return;
      $('send-order').removeAttribute('aria-busy');$('send-order').disabled=false;
      $('share-status').textContent='تعذر تجهيز الطلب. اضغط إرسال الطلب للمحاولة مجددًا.';
      console.error('Order preparation failed:',error);
    }
  },100);
}
function openWhatsApp(text='') {
  const link=document.createElement('a');link.href='https://wa.me/'+(text?'?text='+encodeURIComponent(text):'');link.target='_blank';link.rel='noopener noreferrer';document.body.append(link);link.click();link.remove();
}
function saveAndOpenWhatsApp(file) {
  const url=URL.createObjectURL(file);
  const a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  $('share-status').textContent='تم تجهيز الملف للحفظ. أرفقه من التنزيلات في محادثة واتساب؛ لم يُرفق تلقائيًا.';
  openWhatsApp('طلب جديد');
}
function sendOrder() {
  if(sharing||!entries().length)return;
  if(!preparedOrder||preparedOrder.revision!==state.revision||preparedOrder.date!==localDate()){prepareOrder();return;}
  const file=preparedOrder.file;
  if(!supportsFileSharing(file)){saveAndOpenWhatsApp(file);return;}
  sharing=true;$('send-order').disabled=true;
  $('share-status').textContent='اختر واتساب من خيارات المشاركة لإكمال إرسال الطلب.';
  // Do not await PDF generation here: the OS share sheet needs this click's activation.
  try{
    Promise.resolve(navigator.share({files:[file]})).catch(error=>{
      if(error?.name==='AbortError'){$('share-status').textContent='';return;}
      if(error?.name==='NotSupportedError'||error?.name==='TypeError'){
        forceFileFallback=true;$('share-hint').hidden=false;
        $('share-hint').textContent='تعذرت مشاركة الملف مباشرة. اضغط إرسال الطلب لحفظه ثم أرفقه يدويًا في واتساب.';
      }
      $('share-status').textContent='لم يُرسل الطلب. حاول مجددًا أو استخدم أيقونة الرسالة.';
    }).finally(()=>{sharing=false;$('send-order').disabled=!entries().length;});
  }catch(error){sharing=false;$('send-order').disabled=false;$('share-status').textContent='تعذرت المشاركة. حاول مجددًا.';}
}
function bindEvents() {
  let searchTimer;
  $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=$('search').value;state.limit=PAGE_SIZE;renderProducts();},100);});
  $('clear-search').addEventListener('click',()=>{clearTimeout(searchTimer);state.query='';$('search').value='';state.limit=PAGE_SIZE;renderProducts();$('search').focus();});
  $('sort').addEventListener('change',()=>{state.sort=$('sort').value;state.limit=PAGE_SIZE;renderProducts();});
  $('categories').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(!button)return;state.category=button.dataset.category;state.limit=PAGE_SIZE;for(const chip of $('categories').children)chip.setAttribute('aria-pressed',String(chip===button));renderProducts();});
  $('reset-filters').addEventListener('click',resetFilters);$('empty-reset').addEventListener('click',resetFilters);
  $('load-more').addEventListener('click',()=>{const before=$('product-grid').children.length;state.limit+=PAGE_SIZE;renderProducts(true);if($('load-more').hidden)$('product-grid').children[before]?.querySelector('button')?.focus({preventScroll:true});});
  $('product-grid').addEventListener('click',event=>{const add=event.target.closest('[data-add]'),open=event.target.closest('[data-open]');if(add)addProduct(add.dataset.add);else if(open)openProduct(open.dataset.open);});
  $('cart-trigger').addEventListener('click',openCart);$('mobile-cart').addEventListener('click',openCart);
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach(dialog=>{
    dialog.addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))unlockScroll();});
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const focusable=Array.from(dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]')).filter(el=>el.getClientRects().length);
      const first=focusable[0],last=focusable[focusable.length-1];
      if(!first){event.preventDefault();dialog.focus();return;}
      if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
    });
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  });
  $('detail-add').addEventListener('click',()=>{
    const p=state.byId.get(state.activeProduct);if(!p)return;
    const option=p.options.length?$('detail-options').value:'';
    if(p.options.length&&!option){$('detail-feedback').textContent='اختر النوع أولًا.';$('detail-options').setAttribute('aria-invalid','true');$('detail-options').focus();return;}
    addProduct(p.id,option);$('product-dialog').close();
  });
  $('detail-options').addEventListener('change',()=>{$('detail-options').removeAttribute('aria-invalid');$('detail-feedback').textContent='';});
  $('cart-items').addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button)return;
    const key=button.dataset.key,item=state.cart.get(key);if(!item)return;
    if(button.dataset.action==='remove'||button.dataset.action==='decrease'&&item.quantity===1)state.cart.delete(key);
    else if(button.dataset.action==='increase')item.quantity=Math.min(MAX_QUANTITY,item.quantity+1);
    else if(button.dataset.action==='decrease')item.quantity--;
    cartChanged();
  });
  $('cart-items').addEventListener('change',event=>{
    const input=event.target.closest('[data-quantity]');if(!input)return;
    const item=state.cart.get(input.dataset.key);if(!item)return;
    const next=Number(input.value);
    if(!Number.isInteger(next)||next<1){input.value=String(item.quantity);return;}
    item.quantity=Math.min(MAX_QUANTITY,next);cartChanged();
  });
  $('clear-cart').addEventListener('click',()=>{if(window.confirm('هل تريد إفراغ السلة؟')){state.cart.clear();cartChanged();$('cart-dialog').querySelector('[data-close]').focus();}});
  $('send-order').addEventListener('click',sendOrder);
  $('send-text').addEventListener('click',()=>{const list=entries();if(list.length)openWhatsApp(buildTextOrder(list));});
  // Synchronize validated quantities across tabs; never trust prices from storage.
  window.addEventListener('storage',event=>{if(event.key===CART_KEY){state.cart=sanitizeCart(storedCart(),state.products);state.revision++;preparedOrder=null;renderCart();updateBadges();if($('cart-dialog').open)prepareOrder();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('cart-dialog').open)prepareOrder();});
  // A missing file never leaves a broken-image icon or recursively reloads itself.
  document.addEventListener('error',event=>{const image=event.target;if(!(image instanceof HTMLImageElement)||image.dataset.fallbackApplied)return;image.dataset.fallbackApplied='true';image.src=new URL('./placeholder.svg',import.meta.url).href;},true);
}
