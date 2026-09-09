import fs from 'node:fs';

const dbPath = '/tmp/vendor-order-unsinn-smoke.db';
for (const suffix of ['', '-shm', '-wal']) {
  try { fs.rmSync(dbPath + suffix, {force:true}); } catch {}
}
process.env.DB_PATH = dbPath;
process.env.PORT = '3199';

await import('./server.js');
const base = 'http://127.0.0.1:3199';
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(350);

async function request(path, opt={}) {
  const r = await fetch(base + path, {headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt});
  let data = null;
  const type = r.headers.get('content-type') || '';
  if (type.includes('application/json')) data = await r.json();
  return {r,data};
}

for (const p of ['/api/health','/api/suppliers','/api/products','/api/orders','/api/dashboard']) {
  const {r} = await request(p);
  if (!r.ok) throw new Error(`${p} failed ${r.status}`);
  console.log('OK', p);
}

const supplierCreate = await request('/api/suppliers', {
  method:'POST',
  body:JSON.stringify({name:'Supplier Smoke',pic:'PIC Test',whatsapp:'081234567890',category:'Test'})
});
if (supplierCreate.r.status !== 201) throw new Error('create supplier failed');
const supplierId = Number(supplierCreate.data.id);
console.log('OK create supplier', supplierId);

const productCreate = await request('/api/products', {
  method:'POST',
  body:JSON.stringify({name:'Produk Smoke',sku:'SMOKE-001',primary_supplier_id:supplierId,unit:'pcs',last_price:5000,purchase_price:5000,active:true})
});
if (productCreate.r.status !== 201) throw new Error('create product failed');
const productId = Number(productCreate.data.id);
console.log('OK create product', productId);

const orderCreate = await request('/api/orders', {
  method:'POST',
  body:JSON.stringify({
    supplier_id:supplierId,
    order_date:'2026-09-12',
    status:'Draft',
    notes:'smoke test',
    items:[{product_id:productId,product_name:'Produk Smoke',qty:2,unit:'pcs',price:5000}]
  })
});
if (orderCreate.r.status !== 201 || Number(orderCreate.data.grand_total) !== 10000) throw new Error('create order failed');
const orderId = Number(orderCreate.data.id);
console.log('OK create order', orderCreate.data.order_no);

const statusUpdate = await request(`/api/orders/${orderId}/status`, {
  method:'PATCH', body:JSON.stringify({status:'Sent'})
});
if (!statusUpdate.r.ok || statusUpdate.data.status !== 'Sent' || !statusUpdate.data.sent_date) throw new Error('status update failed');
console.log('OK update status');

const exp = await fetch(base + '/api/export.xlsx');
if (!exp.ok || !(exp.headers.get('content-type')||'').includes('spreadsheet')) throw new Error('export xlsx failed');
const xlsx = Buffer.from(await exp.arrayBuffer());
if (xlsx.length < 1000 || xlsx.subarray(0,2).toString() !== 'PK') throw new Error('xlsx payload invalid');
console.log('OK export.xlsx', xlsx.length, 'bytes');

const csv = await fetch(base + '/api/export.csv');
const csvText = await csv.text();
if (!csv.ok || !csvText.includes('Order ID') || !csvText.includes('Produk Smoke')) throw new Error('export csv failed');
console.log('OK export.csv');

const settings = await request('/api/settings', {
  method:'PUT', body:JSON.stringify({google_sheets_webhook_url:'https://script.google.com/macros/s/example/exec'})
});
if (!settings.r.ok) throw new Error('settings save failed');
const settingsGet = await request('/api/settings');
if (!settingsGet.data.google_sheets_webhook_url.includes('script.google.com')) throw new Error('settings read failed');
console.log('OK settings');

const deleteBlocked = await request(`/api/suppliers/${supplierId}`, {method:'DELETE'});
if (deleteBlocked.r.status !== 409 || !deleteBlocked.data.requires_force) throw new Error('supplier delete guard failed');
console.log('OK supplier delete guard');

const deleteForce = await request(`/api/suppliers/${supplierId}?force=1`, {method:'DELETE'});
if (!deleteForce.r.ok || deleteForce.data.deleted_orders !== 1) throw new Error('force delete supplier failed');
console.log('OK force delete supplier');

console.log('SMOKE TEST PASSED');
process.exit(0);
