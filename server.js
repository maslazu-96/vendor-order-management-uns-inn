import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, db, nextOrderNo, getOrder, activeDbPath } from './db.js';
import { makeXlsx } from './xlsx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = __dirname;
initDb();

const PORT = Number(process.env.PORT || 3000);
const STATUSES = ['Draft','Ready to Send','Sent','Confirmed','Partially Fulfilled','Completed','Cancelled'];
const APP_NAME = 'Vendor Order Management UNS Inn';
const APP_USERNAME = process.env.APP_USERNAME || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || APP_PASSWORD || '';
const AUTH_ENABLED = Boolean(APP_PASSWORD);
const IDLE_TIMEOUT_MINUTES = Math.max(1, Number(process.env.IDLE_TIMEOUT_MINUTES || 60));
const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60 * 1000;

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}

function signSession(iat, idleExp) {
  const payload = `${iat}.${idleExp}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function readSession(req) {
  if (!AUTH_ENABLED) return {iat:Date.now(), idleExp:Infinity};
  const token = parseCookies(req).vom_session;
  if (!token || !SESSION_SECRET) return null;
  const [iatText, idleText, sig=''] = token.split('.');
  const iat = Number(iatText);
  const idleExp = Number(idleText);
  if (![iat,idleExp].every(Number.isFinite)) return null;
  const payload = `${iatText}.${idleText}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  try {
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  const now = Date.now();
  if (now > idleExp) return null;
  return {iat,idleExp};
}

function validSession(req) {
  return Boolean(readSession(req));
}

function sessionCookie(req, session) {
  const maxAge = Math.max(0, Math.floor((session.idleExp - Date.now()) / 1000));
  return `vom_session=${encodeURIComponent(signSession(session.iat, session.idleExp))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie(req)?'; Secure':''}`;
}

function refreshSession(req, res, session) {
  if (!AUTH_ENABLED || !session) return session;
  const now = Date.now();
  const refreshed = {
    ...session,
    idleExp: now + IDLE_TIMEOUT_MS
  };
  res.setHeader('Set-Cookie', sessionCookie(req, refreshed));
  return refreshed;
}

function loginPage(error='') {
  const msg = error ? `<div class="error">${error}</div>` : '';
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#166534"><title>Login — ${APP_NAME}</title><style>
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f7f9;color:#172033;min-height:100vh;display:grid;place-items:center;padding:20px}.card{width:min(420px,100%);background:white;border:1px solid #e5e7eb;border-radius:18px;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,.08)}h1{font-size:22px;margin:0 0 4px}p{margin:0 0 20px;color:#64748b;font-size:14px}label{display:block;font-size:13px;font-weight:650;margin:12px 0 6px}input{width:100%;padding:12px 13px;border:1px solid #cbd5e1;border-radius:10px;font:inherit}button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:10px;background:#166534;color:white;font-weight:750;font-size:15px;cursor:pointer}.error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:12px}.brand{font-weight:800;color:#166534;margin-bottom:14px}</style></head><body><form class="card" method="post" action="/login"><div class="brand">UNS Inn</div><h1>${APP_NAME}</h1><p>Masuk untuk mengelola order supplier.</p>${msg}<label>Username</label><input name="username" autocomplete="username" required value="${APP_USERNAME ? APP_USERNAME.replaceAll('&','&amp;').replaceAll('"','&quot;') : ''}"><label>Password</label><input name="password" type="password" autocomplete="current-password" required><button type="submit">Masuk</button></form></body></html>`;
}

function parseForm(req) {
  return new Promise((resolve,reject) => {
    let body='';
    req.on('data', c => { body += c; if (body.length > 100000) req.destroy(); });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(body))));
    req.on('error', reject);
  });
}

function secureCookie(req) {
  return req.headers['x-forwarded-proto'] === 'https' || Boolean(process.env.RAILWAY_ENVIRONMENT) || Boolean(process.env.RENDER);
}

function json(res, data, status=200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function text(res, body, status=200, type='text/plain; charset=utf-8') {
  res.writeHead(status, {'Content-Type': type, 'Content-Length': Buffer.byteLength(body)});
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2e6) {
        reject(new Error('Payload terlalu besar'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function cleanPhone(value='') {
  let phone = String(value).replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '62' + phone.slice(1);
  return phone;
}

function q(url) { return Object.fromEntries(url.searchParams.entries()); }

function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  };
}

function getSetting(key, fallback='') {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key);
  return row?.value ?? fallback;
}

function setSetting(key, value='') {
  db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).run(key, String(value || ''));
}

function getGoogleSheetsUrl() {
  return getSetting('google_sheets_webhook_url') || process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';
}

function orderFilters(params) {
  const where = [];
  const values = [];
  if (params.date_from) { where.push('o.order_date >= ?'); values.push(params.date_from); }
  if (params.date_to) { where.push('o.order_date <= ?'); values.push(params.date_to); }
  if (params.supplier_id) { where.push('o.supplier_id = ?'); values.push(params.supplier_id); }
  if (params.status) { where.push('o.status = ?'); values.push(params.status); }
  if (params.order_no) { where.push('o.order_no LIKE ?'); values.push(`%${params.order_no}%`); }
  if (params.product) {
    where.push('EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id=o.id AND oi2.product_name LIKE ?)');
    values.push(`%${params.product}%`);
  }
  if (params.search) {
    where.push('(o.order_no LIKE ? OR s.name LIKE ? OR o.notes LIKE ?)');
    values.push(`%${params.search}%`, `%${params.search}%`, `%${params.search}%`);
  }
  if (params.unsent === '1') {
    where.push("o.status IN ('Draft','Ready to Send')");
  }
  return {clause: where.length ? 'WHERE ' + where.join(' AND ') : '', values};
}

function exportRows(params={}) {
  const f = orderFilters(params);
  return db.prepare(`
    SELECT o.order_no,o.order_date,s.name supplier,s.pic,oi.product_name,oi.qty,oi.unit,
           oi.price,oi.total,o.status,o.sent_date,o.confirmation_date,
           TRIM(COALESCE(o.notes,'') || CASE WHEN COALESCE(oi.notes,'')<>'' THEN ' | Item: '||oi.notes ELSE '' END) notes
    FROM orders o
    JOIN suppliers s ON s.id=o.supplier_id
    JOIN order_items oi ON oi.order_id=o.id
    ${f.clause}
    ORDER BY o.order_date DESC,o.id DESC,oi.id
  `).all(...f.values);
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}

async function api(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (p === '/api/health') return json(res, {ok:true, app:APP_NAME, db:activeDbPath});
  if (p === '/api/meta') return json(res, {statuses:STATUSES, googleSheetsConfigured:!!getGoogleSheetsUrl(), appName:APP_NAME, authEnabled:AUTH_ENABLED, idleTimeoutMs:IDLE_TIMEOUT_MS, idleTimeoutMinutes:IDLE_TIMEOUT_MINUTES});
  if (p === '/api/session/ping' && method === 'POST') return json(res, {ok:true, now:Date.now()});

  if (p === '/api/settings' && method === 'GET') {
    return json(res, {google_sheets_webhook_url:getGoogleSheetsUrl()});
  }
  if (p === '/api/settings' && method === 'PUT') {
    const b = await parseBody(req);
    const value = String(b.google_sheets_webhook_url || '').trim();
    if (value && !/^https:\/\//i.test(value)) return json(res,{error:'URL Google Sheets harus diawali https://'},400);
    setSetting('google_sheets_webhook_url', value);
    return json(res,{ok:true,google_sheets_webhook_url:value});
  }

  if (p === '/api/dashboard') {
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0,10);
    const rows = db.prepare('SELECT status,COUNT(*) c FROM orders WHERE order_date=? GROUP BY status').all(date);
    const by = Object.fromEntries(rows.map(r => [r.status, r.c]));
    const total = rows.reduce((a,r) => a+r.c, 0);
    const actions = db.prepare(`
      SELECT o.id,o.order_no,o.order_date,o.status,s.name supplier_name,COALESCE(SUM(oi.total),0) grand_total
      FROM orders o JOIN suppliers s ON s.id=o.supplier_id
      LEFT JOIN order_items oi ON oi.order_id=o.id
      WHERE o.status IN ('Draft','Ready to Send','Sent','Confirmed','Partially Fulfilled')
      GROUP BY o.id ORDER BY o.order_date ASC,o.id DESC LIMIT 12
    `).all();
    return json(res, {
      date,total,
      draft:by['Draft']||0,
      unsent:(by['Draft']||0)+(by['Ready to Send']||0),
      sent:by['Sent']||0,
      waiting:by['Sent']||0,
      completed:by['Completed']||0,
      actions
    });
  }

  if (p === '/api/suppliers' && method === 'GET') {
    return json(res, db.prepare(`
      SELECT s.*,(SELECT COUNT(*) FROM orders o WHERE o.supplier_id=s.id) order_count,
             (SELECT COUNT(*) FROM products p WHERE p.primary_supplier_id=s.id) product_count
      FROM suppliers s ORDER BY s.name
    `).all());
  }
  if (p === '/api/suppliers' && method === 'POST') {
    const b = await parseBody(req);
    if (!b.name) return json(res,{error:'Nama supplier wajib'},400);
    const r = db.prepare('INSERT INTO suppliers(name,pic,whatsapp,address,category,notes) VALUES(?,?,?,?,?,?)')
      .run(b.name,b.pic||'',cleanPhone(b.whatsapp),b.address||'',b.category||'',b.notes||'');
    return json(res,db.prepare('SELECT * FROM suppliers WHERE id=?').get(r.lastInsertRowid),201);
  }

  let m = p.match(/^\/api\/suppliers\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (method === 'PUT') {
      const b = await parseBody(req);
      if (!b.name) return json(res,{error:'Nama supplier wajib'},400);
      db.prepare('UPDATE suppliers SET name=?,pic=?,whatsapp=?,address=?,category=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(b.name,b.pic||'',cleanPhone(b.whatsapp),b.address||'',b.category||'',b.notes||'',id);
      return json(res,db.prepare('SELECT * FROM suppliers WHERE id=?').get(id));
    }
    if (method === 'DELETE') {
      const supplier = db.prepare('SELECT * FROM suppliers WHERE id=?').get(id);
      if (!supplier) return json(res,{error:'Supplier tidak ditemukan'},404);
      const orderCount = db.prepare('SELECT COUNT(*) c FROM orders WHERE supplier_id=?').get(id).c;
      const force = url.searchParams.get('force') === '1';
      if (orderCount > 0 && !force) {
        return json(res,{
          error:`Supplier masih memiliki ${orderCount} order. Hapus permanen akan ikut menghapus histori order supplier ini.`,
          requires_force:true,
          order_count:orderCount
        },409);
      }
      const tx = transaction(() => {
        if (force) db.prepare('DELETE FROM orders WHERE supplier_id=?').run(id);
        db.prepare('UPDATE products SET primary_supplier_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE primary_supplier_id=?').run(id);
        db.prepare('DELETE FROM suppliers WHERE id=?').run(id);
      });
      tx();
      return json(res,{ok:true,deleted_orders:force?orderCount:0});
    }
  }

  if (p === '/api/products' && method === 'GET') {
    return json(res, db.prepare(`SELECT p.*,s.name supplier_name FROM products p LEFT JOIN suppliers s ON s.id=p.primary_supplier_id ORDER BY p.active DESC,p.name`).all());
  }
  if (p === '/api/products' && method === 'POST') {
    const b = await parseBody(req);
    if (!b.name) return json(res,{error:'Nama produk wajib'},400);
    const r = db.prepare('INSERT INTO products(name,sku,primary_supplier_id,unit,last_price,purchase_price,active,notes) VALUES(?,?,?,?,?,?,?,?)')
      .run(b.name,b.sku||null,b.primary_supplier_id||null,b.unit||'pcs',Number(b.last_price||0),Number(b.purchase_price||0),b.active===false?0:1,b.notes||'');
    return json(res,db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid),201);
  }

  m = p.match(/^\/api\/products\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (method === 'PUT') {
      const b = await parseBody(req);
      db.prepare('UPDATE products SET name=?,sku=?,primary_supplier_id=?,unit=?,last_price=?,purchase_price=?,active=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(b.name,b.sku||null,b.primary_supplier_id||null,b.unit||'pcs',Number(b.last_price||0),Number(b.purchase_price||0),b.active===false?0:1,b.notes||'',id);
      return json(res,db.prepare('SELECT * FROM products WHERE id=?').get(id));
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM products WHERE id=?').run(id);
      return json(res,{ok:true});
    }
  }

  if (p === '/api/orders' && method === 'GET') {
    const f = orderFilters(q(url));
    const rows = db.prepare(`
      SELECT o.*,s.name supplier_name,s.pic,COALESCE(SUM(oi.total),0) grand_total,COUNT(oi.id) item_count
      FROM orders o JOIN suppliers s ON s.id=o.supplier_id
      LEFT JOIN order_items oi ON oi.order_id=o.id
      ${f.clause}
      GROUP BY o.id ORDER BY o.order_date DESC,o.id DESC LIMIT 500
    `).all(...f.values);
    return json(res,rows);
  }

  if (p === '/api/orders' && method === 'POST') {
    const b = await parseBody(req);
    if (!b.supplier_id || !b.order_date || !Array.isArray(b.items) || !b.items.length) {
      return json(res,{error:'Supplier, tanggal, dan item wajib diisi'},400);
    }
    const tx = transaction(() => {
      const orderNo = nextOrderNo(b.order_date);
      const r = db.prepare('INSERT INTO orders(order_no,supplier_id,order_date,status,notes,whatsapp_message) VALUES(?,?,?,?,?,?)')
        .run(orderNo,b.supplier_id,b.order_date,b.status||'Draft',b.notes||'',b.whatsapp_message||'');
      const orderId = r.lastInsertRowid;
      const ins = db.prepare('INSERT INTO order_items(order_id,product_id,product_name,qty,unit,price,total,notes) VALUES(?,?,?,?,?,?,?,?)');
      const up = db.prepare('UPDATE products SET last_price=?,updated_at=CURRENT_TIMESTAMP WHERE id=?');
      for (const it of b.items) {
        const qty = Number(it.qty||0), price = Number(it.price||0);
        ins.run(orderId,it.product_id||null,it.product_name,qty,it.unit||'pcs',price,qty*price,it.notes||'');
        if (it.product_id) up.run(price,it.product_id);
      }
      return orderId;
    });
    return json(res,getOrder(tx()),201);
  }

  m = p.match(/^\/api\/orders\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (method === 'GET') {
      const o = getOrder(id);
      return o ? json(res,o) : json(res,{error:'Not found'},404);
    }
    if (method === 'PUT') {
      const b = await parseBody(req);
      const tx = transaction(() => {
        db.prepare('UPDATE orders SET supplier_id=?,order_date=?,status=?,notes=?,whatsapp_message=?,sent_date=?,confirmation_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(b.supplier_id,b.order_date,b.status||'Draft',b.notes||'',b.whatsapp_message||'',b.sent_date||null,b.confirmation_date||null,id);
        db.prepare('DELETE FROM order_items WHERE order_id=?').run(id);
        const ins = db.prepare('INSERT INTO order_items(order_id,product_id,product_name,qty,unit,price,total,notes) VALUES(?,?,?,?,?,?,?,?)');
        for (const it of b.items||[]) {
          const qty = Number(it.qty||0), price = Number(it.price||0);
          ins.run(id,it.product_id||null,it.product_name,qty,it.unit||'pcs',price,qty*price,it.notes||'');
        }
      });
      tx();
      return json(res,getOrder(id));
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM orders WHERE id=?').run(id);
      return json(res,{ok:true});
    }
  }

  m = p.match(/^\/api\/orders\/(\d+)\/status$/);
  if (m && method === 'PATCH') {
    const id = Number(m[1]);
    const b = await parseBody(req);
    if (!STATUSES.includes(b.status)) return json(res,{error:'Status tidak valid'},400);
    let sent = null, conf = null;
    if (b.status === 'Sent') sent = new Date().toISOString();
    if (b.status === 'Confirmed') conf = new Date().toISOString();
    db.prepare('UPDATE orders SET status=?,sent_date=COALESCE(?,sent_date),confirmation_date=COALESCE(?,confirmation_date),updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(b.status,sent,conf,id);
    return json(res,getOrder(id));
  }

  m = p.match(/^\/api\/orders\/(\d+)\/duplicate$/);
  if (m && method === 'POST') {
    const old = getOrder(Number(m[1]));
    if (!old) return json(res,{error:'Not found'},404);
    const b = await parseBody(req);
    const date = b.order_date || new Date().toISOString().slice(0,10);
    const tx = transaction(() => {
      const no = nextOrderNo(date);
      const r = db.prepare('INSERT INTO orders(order_no,supplier_id,order_date,status,notes) VALUES(?,?,?,?,?)')
        .run(no,old.supplier_id,date,'Draft',old.notes);
      const ins = db.prepare('INSERT INTO order_items(order_id,product_id,product_name,qty,unit,price,total,notes) VALUES(?,?,?,?,?,?,?,?)');
      for (const it of old.items) ins.run(r.lastInsertRowid,it.product_id,it.product_name,it.qty,it.unit,it.price,it.total,it.notes);
      return r.lastInsertRowid;
    });
    return json(res,getOrder(tx()),201);
  }

  if (p === '/api/export.xlsx' && method === 'GET') {
    const rows = exportRows(q(url));
    const data = rows.map(r => [r.order_no,r.order_date,r.supplier,r.pic,r.product_name,r.qty,r.unit,r.price,r.total,r.status,r.sent_date||'',r.confirmation_date||'',r.notes||'']);
    const buf = makeXlsx(data);
    const filename = `vendor-order-uns-inn-${new Date().toISOString().slice(0,10)}.xlsx`;
    res.writeHead(200, {
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':`attachment; filename="${filename}"`,
      'Content-Length':buf.length,
      'Cache-Control':'no-store'
    });
    return res.end(buf);
  }

  if (p === '/api/export.csv' && method === 'GET') {
    const rows = exportRows(q(url));
    const headers = ['Order ID','Order Date','Supplier','PIC','Product','Qty','Unit','Price','Total','Status','Sent Date','Confirmation Date','Notes'];
    const lines = [headers, ...rows.map(r => [r.order_no,r.order_date,r.supplier,r.pic,r.product_name,r.qty,r.unit,r.price,r.total,r.status,r.sent_date||'',r.confirmation_date||'',r.notes||''])]
      .map(row => row.map(csvEscape).join(','));
    const body = '\uFEFF' + lines.join('\r\n');
    const filename = `vendor-order-uns-inn-${new Date().toISOString().slice(0,10)}.csv`;
    res.writeHead(200, {
      'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':`attachment; filename="${filename}"`,
      'Content-Length':Buffer.byteLength(body),
      'Cache-Control':'no-store'
    });
    return res.end(body);
  }

  if (p === '/api/google-sheets/sync' && method === 'POST') {
    const webhook = getGoogleSheetsUrl();
    if (!webhook) return json(res,{error:'URL Google Apps Script belum diisi. Buka Reports lalu isi URL Web App terlebih dahulu.'},400);
    const rows = exportRows({}).map(r => ({
      order_no:r.order_no,order_date:r.order_date,supplier:r.supplier,pic:r.pic,product:r.product_name,
      qty:r.qty,unit:r.unit,price:r.price,total:r.total,status:r.status,
      sent_date:r.sent_date||'',confirmation_date:r.confirmation_date||'',notes:r.notes||''
    }));
    try {
      const rr = await fetch(webhook, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({source:APP_NAME,rows}),
        redirect:'follow'
      });
      const responseText = await rr.text();
      if (!rr.ok) throw new Error(`HTTP ${rr.status}${responseText ? ` - ${responseText.slice(0,160)}` : ''}`);
      return json(res,{ok:true,count:rows.length,response:responseText.slice(0,300)});
    } catch (e) {
      return json(res,{error:`Sync gagal: ${e.message}`},502);
    }
  }

  return json(res,{error:'API not found'},404);
}

function staticFile(res, urlPath) {
  const allowed = new Set(['/index.html','/app.js','/styles.css','/manifest.webmanifest','/icon.svg','/sw.js']);
  let fp = urlPath === '/' ? '/index.html' : urlPath;
  if (!allowed.has(fp)) return false;
  const full = path.join(publicDir, fp);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return false;
  const ext = path.extname(full);
  const types = {
    '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
    '.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'
  };
  const buf = fs.readFileSync(full);
  res.writeHead(200, {
    'Content-Type':types[ext]||'application/octet-stream',
    'Content-Length':buf.length,
    'Cache-Control':ext==='.html'||ext==='.js'||ext==='.css'?'no-cache':'public, max-age=3600'
  });
  res.end(buf);
  return true;
}

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host||'localhost'}`);

    if (url.pathname === '/login' && req.method === 'GET') {
      if (validSession(req)) { res.writeHead(302,{Location:'/'}); return res.end(); }
      const reason = url.searchParams.get('reason');
      const messages = {
        idle:`Sesi berakhir karena tidak ada aktivitas selama ${IDLE_TIMEOUT_MINUTES} menit. Silakan masuk kembali.`,
        expired:'Sesi login sudah berakhir. Silakan masuk kembali.'
      };
      return text(res, loginPage(messages[reason] || ''), 200, 'text/html; charset=utf-8');
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      const b = await parseForm(req);
      const userOk = !APP_USERNAME || b.username === APP_USERNAME;
      const passOk = b.password === APP_PASSWORD;
      if (!userOk || !passOk) return text(res, loginPage('Username atau password salah.'), 401, 'text/html; charset=utf-8');
      const now = Date.now();
      const session = {iat:now, idleExp:now + IDLE_TIMEOUT_MS};
      res.writeHead(302,{Location:'/', 'Set-Cookie':sessionCookie(req, session)}); return res.end();
    }
    if (url.pathname === '/logout') {
      const reason = url.searchParams.get('reason');
      const target = ['idle','expired'].includes(reason) ? `/login?reason=${reason}` : '/login';
      res.writeHead(302,{Location:target,'Set-Cookie':`vom_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie(req)?'; Secure':''}`}); return res.end();
    }

    if (url.pathname === '/api/health') return await api(req,res,url);
    const session = readSession(req);
    if (!session) {
      if (url.pathname.startsWith('/api/')) return json(res,{error:'Unauthorized'},401);
      res.writeHead(302,{Location:'/login?reason=expired'}); return res.end();
    }

    if (url.pathname.startsWith('/api/')) {
      refreshSession(req, res, session);
      return await api(req,res,url);
    }
    if (staticFile(res,url.pathname)) return;
    return staticFile(res,'/index.html') || text(res,'Not found',404);
  } catch (e) {
    console.error(e);
    return json(res,{error:e.message||'Server error'},500);
  }
});

server.listen(PORT, () => console.log(`${APP_NAME} running on port ${PORT} | DB: ${activeDbPath} | Auth: ${AUTH_ENABLED?'ON':'OFF'}`));
