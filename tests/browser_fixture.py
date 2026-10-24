"""Offline DOM harness. No network requests or browser-policy changes are used.
Only transports (module loading, data/images, storage and OS share handoff) are
injected. Production event handlers, rendering, arithmetic and PDF bytes run as-is.
"""
from pathlib import Path
import base64,json,re
ROOT=Path(__file__).resolve().parents[1]

def fixture_html(javascript=True):
 html=(ROOT/'index.html').read_text()
 html=re.sub(r'<link rel="stylesheet"[^>]+>',lambda _: '<style>'+(ROOT/'assets/store.css').read_text()+'</style>',html)
 html=re.sub(r'<script type="module"[^>]+></script>','',html)
 icons=(ROOT/'assets/icons.svg').read_text().replace('<svg xmlns="http://www.w3.org/2000/svg">','<svg xmlns="http://www.w3.org/2000/svg" style="display:none">')
 icons=icons.replace('<symbol id=\"','<symbol id=\"icon-')
 html=html.replace('<body>','<body>'+icons).replace('assets/icons.svg#','#icon-')
 if not javascript:return html
 data=json.loads((ROOT/'data/products.json').read_text())
 paths={p['image'] for p in data['products']}
 images={p:'data:'+('image/webp' if p.endswith('.webp') else 'image/svg+xml')+';base64,'+base64.b64encode((ROOT/p).read_bytes()).decode() for p in paths}
 code='\n'.join((ROOT/'assets'/f).read_text() for f in ['core.js','order-pdf.js','store.js','auth.js'])
 code=re.sub(r'^import .*?;\s*$', '', code,flags=re.M)
 code=re.sub(r'\bexport\s+(?=(?:async\s+)?(?:function|const))','',code)
 code=code.replace('import.meta.url','"https://fixture.invalid/assets/store.js"')
 code=code.replace("await import('./store.js')",'({init})')
 code=code.replace('assets/icons.svg#','#icon-')
 code=code.replace("new URL('./placeholder.svg',\"https://fixture.invalid/assets/store.js\").href", "window.__imageFixtures['assets/placeholder.svg']")
 code=code.replace('src="${esc(p.image)}"','src="${window.__imageFixtures[p.image]}"')
 code=code.replace("$('detail-image').src=p.image", "$('detail-image').src=window.__imageFixtures[p.image]")
 prelude='''
window.__dataFixture=DATA;
window.__imageFixtures=IMAGES;
window.__requests=[];
window.__links=[];
window.__savedURLs=new Map();
window.__fixtureStores ||= {local:new Map(),session:new Map()};
function storage(map){return {getItem:k=>map.get(String(k))??null,setItem:(k,v)=>map.set(String(k),String(v)),removeItem:k=>map.delete(String(k)),clear:()=>map.clear()};}
Object.defineProperty(window,'localStorage',{configurable:true,value:storage(window.__fixtureStores.local)});
Object.defineProperty(window,'sessionStorage',{configurable:true,value:storage(window.__fixtureStores.session)});
Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});
window.fetch=async url=>{window.__requests.push(String(url));if(String(url).includes('products.json'))return new Response(JSON.stringify(window.__dataFixture),{status:200,headers:{'Content-Type':'application/json'}});throw new Error('Unexpected offline fetch: '+url)};
URL.createObjectURL=file=>{const key='blob:fixture-'+window.__savedURLs.size;window.__savedURLs.set(key,file);return key};
URL.revokeObjectURL=url=>window.__savedURLs.delete(url);
HTMLAnchorElement.prototype.click=function(){if(this.download)window.__lastDownload=window.__savedURLs.get(this.href);else window.__links.push(this.href)};
'''.replace('DATA',json.dumps(data,ensure_ascii=False).replace('<','\\u003c'),1).replace('IMAGES',json.dumps(images),1)
 script='(()=>{ const esc = value => escapeHTML(value);'+prelude+'\n'+code+'\nwindow.__catalogTest={createOrderFile,state,prepareOrder};})();'
 return html.replace('</body>','<script>'+script+'</script></body>')
