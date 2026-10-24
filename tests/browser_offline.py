from __future__ import annotations
import pathlib, json, base64, os, shutil
from playwright.sync_api import sync_playwright, expect
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'test-artifacts'
OUT.mkdir(exist_ok=True)
from browser_fixture import fixture_html
FIXTURE=fixture_html()
results=[]
def ok(name):results.append(name);print('PASS',name,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':1440,'height':1050},device_scale_factor=1)
 page=context.new_page();page.set_default_timeout(10000);errors=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda req:requests.append(req.url))
 page.set_content(FIXTURE)
 expect(page.locator('#password')).to_be_visible();expect(page.locator('#app')).to_be_hidden()
 assert not page.evaluate('window.__requests')
 assert page.locator('button:visible').count()==0
 page.screenshot(path=str(OUT/'password-screen.png'))
 ok('Entry shows only password; product data is not requested before unlock')
 page.fill('#password','9999');expect(page.locator('#password')).to_have_attribute('aria-invalid','true');expect(page.locator('#app')).to_be_hidden();ok('Incorrect password stays locked')
 page.fill('#password','0102');expect(page.locator('#app')).to_be_visible();expect(page.locator('#product-grid article')).to_have_count(24)
 expect(page.locator('#catalog-count')).to_have_text('229');ok('Leading-zero PIN unlocks all 229 product records')
 page.wait_for_function("[...document.querySelectorAll('#product-grid img')].slice(0,5).every(img=>img.complete&&img.naturalWidth>0)");page.locator('#page-title').evaluate('el=>el.blur()');page.screenshot(path=str(OUT/'store-desktop.png'))
 assert page.evaluate("sessionStorage.getItem('store:unlocked:2026-10')")== 'yes';ok('Unlock state is stored for the current tab session')
 page.fill('#search','CH329');expect(page.locator('#product-grid article')).to_have_count(1);expect(page.locator('.product-bottom .price')).to_have_text('45,00 kr')
 page.click('[data-add="CH329"]');page.click('[data-add="CH329"]');expect(page.locator('#cart-count')).to_have_text('2');ok('SKU search and updated price; adding twice updates quantity')
 page.fill('#search','no-such-item');expect(page.locator('#empty-state')).to_be_visible();page.click('#empty-reset');expect(page.locator('#product-grid article')).to_have_count(24);ok('Empty search state resets cleanly')
 page.click('[data-category="coffee"]');expect(page.locator('#product-grid article')).to_have_count(6)
 page.select_option('#sort','price-desc');expect(page.locator('#product-grid article').first.locator('.price')).to_have_text('45,00 kr');ok('Categories and price sorting')
 page.click('#reset-filters');page.fill('#search','P037');expect(page.locator('#product-grid article')).to_have_count(1);page.click('[data-add="P037"]')
 expect(page.locator('#product-dialog')).to_be_visible();page.click('#detail-add');expect(page.locator('#detail-options')).to_have_attribute('aria-invalid','true')
 page.select_option('#detail-options','شوكولاتة');page.click('#detail-add');expect(page.locator('#product-dialog')).not_to_be_visible()
 page.click('[data-add="P037"]');page.select_option('#detail-options','فراولة');page.click('#detail-add');ok('Variant selection required; different variants remain distinct')
 page.fill('#search','LAT001');expect(page.locator('#product-grid article')).to_have_count(1);expect(page.locator('.price')).to_have_text('السعر عند الطلب');page.click('[data-add="LAT001"]')
 page.click('#cart-trigger');expect(page.locator('#cart-items li')).to_have_count(4);expect(page.locator('#cart-total')).to_have_text('110,00 kr');expect(page.locator('#pending-prices')).to_be_visible()
 ok('Unknown-price item is retained and excluded from known total')
 quantity=page.locator('[data-quantity]').first;quantity.fill('3');quantity.press('Tab');expect(page.locator('#cart-total')).to_have_text('155,00 kr')
 quantity=page.locator('[data-quantity]').first;quantity.fill('0');quantity.press('Tab');expect(page.locator('[data-quantity]').first).to_have_value('3');ok('Manual quantities and invalid-input guard')
 expect(page.locator('#send-order')).to_be_enabled(timeout=15000)
 assert 'PDF' not in page.locator('#send-order').inner_text();assert page.locator('#cart-dialog input:not([data-quantity])').count()==0
 page.screenshot(path=str(OUT/'cart-desktop.png'))
 ok('Only Send Order primary action; no customer fields or PDF-labeled buttons')
 page.evaluate('''() => {
   Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>files?.[0]?.type==='application/pdf'});
   Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{window.__shareActivation=navigator.userActivation.isActive;window.__sharedFile=payload.files[0];window.__sharePayloadKeys=Object.keys(payload);}});
 }''')
 page.click('#send-order');page.wait_for_function('window.__sharedFile && window.__shareActivation')
 assert page.evaluate('window.__sharePayloadKeys')==['files']
 pdf=page.evaluate('''async()=>{const bytes=new Uint8Array(await window.__sharedFile.arrayBuffer());let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result)}''')
 (OUT/'order-sample.pdf').write_bytes(base64.b64decode(pdf))
 ok('Native share receives only a valid PDF File with live user activation')
 page.evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:()=>Promise.reject(new DOMException('Cancelled','AbortError'))})")
 page.click('#send-order');expect(page.locator('#share-status')).to_have_text('');expect(page.locator('#cart-items li')).to_have_count(4);ok('Cancelling sharing retains the entire cart')
 page.evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false})")
 page.click('#send-order')
 page.wait_for_function('window.__lastDownload')
 assert page.evaluate("window.__links.some(url=>url.startsWith('https://wa.me/'))")
 expect(page.locator('#share-status')).to_contain_text('لم يُرفق تلقائيًا')
 ok('Unsupported file sharing saves the file and honestly requests manual attachment')
 page.click('[data-close="cart-dialog"]')
 page.fill('#search','');expect(page.locator('#product-grid article')).to_have_count(24)
 for _ in range(10):
  if not page.locator('#load-more').is_visible():break
  page.click('#load-more')
 expect(page.locator('#product-grid article')).to_have_count(229)
 page.evaluate("document.querySelectorAll('#product-grid img').forEach(img=>img.loading='eager')")
 page.wait_for_function("[...document.querySelectorAll('#product-grid img')].every(img=>img.complete&&img.naturalWidth>0)")
 ok('Every one of the 229 product cards renders with a valid local image or placeholder')
 # Generate a long real order from the same module, not a separate PDF implementation.
 all_pdf=page.evaluate('''async()=>{
   const {createOrderFile}=window.__catalogTest;const data=window.__dataFixture;
   const file=await createOrderFile(data.products.map((product,i)=>({product,quantity:(i%3)+1,option:product.options[0]||''})),new Date('2026-10-24T12:00:00'));
   const bytes=new Uint8Array(await file.arrayBuffer());let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);
 }''')
 (OUT/'all-products-order.pdf').write_bytes(base64.b64decode(all_pdf));ok('All-product PDF generation completes; pagination is checked separately by rendering')
 page.click('#lock-store');expect(page.locator('#app')).to_be_hidden();expect(page.locator('#password')).to_be_visible()
 page.fill('#password','٠١٠٢');expect(page.locator('#app')).to_be_visible();ok('Explicit lock and Arabic-digit password input')
 assert errors==[],errors;ok('No JavaScript runtime errors in desktop flows')
 mobile=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
 m=mobile.new_page();m.set_content(FIXTURE);expect(m.locator('#app')).to_be_hidden();m.fill('#password','0102');expect(m.locator('#app')).to_be_visible()
 m.wait_for_function("[...document.querySelectorAll('#product-grid img')].slice(0,2).every(img=>img.complete&&img.naturalWidth>0)");m.screenshot(path=str(OUT/'store-mobile.png'))
 assert m.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
 m.click('[data-add="CH111"]');expect(m.locator('#mobile-cart')).to_be_visible();m.click('#mobile-cart');expect(m.locator('#cart-dialog')).to_be_visible()
 expect(m.locator('#send-order')).to_be_enabled(timeout=15000);m.screenshot(path=str(OUT/'cart-mobile.png'))
 for _ in range(15):m.keyboard.press('Tab');assert m.evaluate("document.activeElement.closest('#cart-dialog')!==null")
 ok('390px mobile layout, sticky cart and dialog keyboard focus containment')
 m.keyboard.press('Escape');expect(m.locator('#cart-dialog')).not_to_be_visible();ok('Escape closes the cart and restores navigation')
 m.set_viewport_size({'width':320,'height':700});assert m.evaluate('document.documentElement.scrollWidth<=window.innerWidth');m.screenshot(path=str(OUT/'store-small-mobile.png'));ok('320px narrow-screen layout does not overflow')
 # Separate session remains locked; disabling JavaScript never reveals the catalog.
 nojs=browser.new_context(java_script_enabled=False);n=nojs.new_page();n.set_content(fixture_html(javascript=False));expect(n.locator('#app')).to_be_hidden();expect(n.locator('#password')).to_be_visible();ok('No-JavaScript behavior remains visually locked')
 browser.close()

(OUT/'browser-test-results.json').write_text(json.dumps({'passed':len(results),'checks':results,'engine':'Chromium /usr/bin/chromium; offline injected-transport DOM harness','realWhatsAppAppTested':False},indent=2))
print('TOTAL',len(results))
