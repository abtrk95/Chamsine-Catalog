import { money, orderDate, localDate, summarize } from './core.js';

// Arabic is shaped by the browser, not reversed by hand. Canvas pages are embedded
// as high-resolution JPEGs in a standards-compliant PDF, with no CDN or font files.
const WIDTH = 595.28;
const HEIGHT = 841.89;
const SCALE = 2.6;
const LEFT = 40;
const RIGHT = WIDTH - 40;
const BOTTOM = 774;
const FONT = 'Arial, Tahoma, sans-serif';
const encode = text => new TextEncoder().encode(text);

function writePDF(images) {
  const pieces = [encode('%PDF-1.4\n% Store order\n')];
  const offsets = [0];
  let length = pieces[0].length;
  const append = value => { const bytes = typeof value === 'string' ? encode(value) : value; pieces.push(bytes); length += bytes.length; };
  const object = (id, body, binary) => {
    offsets[id] = length;
    append(`${id} 0 obj\n${body}`);
    if (binary) { append('\nstream\n'); append(binary); append('\nendstream'); }
    append('\nendobj\n');
  };
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${images.length} /Kids [${images.map((_, i) => `${3+i*3} 0 R`).join(' ')}] >>`);
  images.forEach((image, index) => {
    const id = 3 + index * 3;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /XObject << /Im0 ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    object(id+1, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>`, image.data);
    const stream = encode(`q\n${WIDTH} 0 0 ${HEIGHT} 0 0 cm\n/Im0 Do\nQ\n`);
    object(id+2, `<< /Length ${stream.length} >>`, stream);
  });
  const xref = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let i=1; i<offsets.length; i++) append(String(offsets[i]).padStart(10,'0') + ' 00000 n \n');
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(pieces, {type:'application/pdf'});
}
function text(ctx, value, x, y, {size=11, bold=false, color='#23352b', align='right', direction='rtl'}={}) {
  ctx.font = `${bold ? '700' : '400'} ${size}px ${FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.direction = direction; ctx.textBaseline = 'top';
  ctx.fillText(String(value), x, y);
}
function wrap(ctx, value, maxWidth, size=11) {
  ctx.font = `400 ${size}px ${FONT}`;
  const lines=[]; let current='';
  for (const word of String(value).split(/\s+/)) {
    const next = current ? current+' '+word : word;
    if (ctx.measureText(next).width <= maxWidth) { current=next; continue; }
    if (current) { lines.push(current); current=''; }
    if (ctx.measureText(word).width <= maxWidth) { current=word; continue; }
    // Defensive handling for exceptionally long, unspaced product/variant names.
    for (const char of Array.from(word)) {
      if (ctx.measureText(current+char).width > maxWidth && current) { lines.push(current); current=''; }
      current += char;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}
function page(date) {
  const canvas = document.createElement('canvas');
  canvas.width=Math.ceil(WIDTH*SCALE); canvas.height=Math.ceil(HEIGHT*SCALE);
  const ctx=canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported');
  ctx.scale(SCALE,SCALE);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,WIDTH,HEIGHT);
  text(ctx, 'الطلب', RIGHT, 38, {size:26,bold:true,color:'#174f40'});
  text(ctx, 'تاريخ الطلب', RIGHT, 81, {size:10,color:'#66776b'});
  text(ctx, orderDate(date), LEFT, 81, {size:11,align:'left',direction:'ltr'});
  ctx.fillStyle='#174f40';ctx.fillRect(LEFT,109,RIGHT-LEFT,32);
  text(ctx,'المنتج',RIGHT-12,118,{size:10,bold:true,color:'#ffffff'});
  text(ctx,'SKU',263,118,{size:10,bold:true,color:'#ffffff',align:'center',direction:'ltr'});
  text(ctx,'سعر الوحدة',177,118,{size:10,bold:true,color:'#ffffff',align:'center'});
  text(ctx,'الإجمالي',84,118,{size:10,bold:true,color:'#ffffff',align:'center'});
  return {canvas,ctx,y:141};
}
async function imageOf(canvas) {
  const blob = await new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not render order')), 'image/jpeg', .93));
  const result={data:new Uint8Array(await blob.arrayBuffer()),width:canvas.width,height:canvas.height};
  canvas.width=1;canvas.height=1;
  return result;
}
export async function createOrderFile(entries, date = new Date()) {
  if (!entries.length) throw new Error('Cannot create an empty order');
  if (document.fonts?.ready) await document.fonts.ready;
  const images=[];
  let current=page(date), rowIndex=0;
  for (const {product, quantity, option} of entries) {
    if (!Number.isInteger(quantity) || quantity<1) throw new Error('Invalid quantity');
    const name=product.name+(option ? ' — '+option : '');
    const lines=wrap(current.ctx,name,RIGHT-312,11);
    const height=Math.max(49,lines.length*17+20);
    if (height > BOTTOM-141) throw new Error('Product name is too long');
    if (current.y+height > BOTTOM) { images.push(await imageOf(current.canvas));current=page(date);rowIndex=0; }
    const {ctx,y}=current;
    ctx.fillStyle=rowIndex%2 ? '#f6f8f4' : '#ffffff';ctx.fillRect(LEFT,y,RIGHT-LEFT,height);
    lines.forEach((line,i)=>text(ctx,line,RIGHT-12,y+12+i*17,{size:11}));
    text(ctx,product.sku || '—',263,y+17,{size:10,align:'center',direction:'ltr',color:'#55665a'});
    const known=product.priceCents!==null;
    text(ctx,known ? money(product.priceCents) : 'عند الطلب',177,y+17,{size:known?10:9,align:'center',direction:known?'ltr':'rtl'});
    text(ctx,known ? money(product.priceCents*quantity) : 'عند الطلب',84,y+17,{size:known?10:9,bold:known,align:'center',direction:known?'ltr':'rtl'});
    ctx.strokeStyle='#e2e8df';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(LEFT,y+height);ctx.lineTo(RIGHT,y+height);ctx.stroke();
    current.y+=height;rowIndex++;
  }
  if (current.y+80 > BOTTOM) { images.push(await imageOf(current.canvas));current=page(date); }
  const summary=summarize(entries);
  current.ctx.fillStyle='#edf3e9';current.ctx.fillRect(LEFT,current.y+18,RIGHT-LEFT,54);
  text(current.ctx,summary.unknown ? 'إجمالي الأسعار المتوفرة' : 'الإجمالي',RIGHT-14,current.y+36,{size:12,bold:true,color:'#174f40'});
  text(current.ctx,money(summary.totalCents),LEFT+14,current.y+34,{size:16,bold:true,color:'#174f40',align:'left',direction:'ltr'});
  images.push(await imageOf(current.canvas));
  return new File([writePDF(images)],`order-${localDate(date)}.pdf`,{type:'application/pdf',lastModified:date.getTime()});
}
