const app = document.querySelector('#app');
const navBtns = [...document.querySelectorAll('[data-nav]')];

let state = {
  suppliers: [],
  products: [],
  meta: { statuses: [] },
  route: 'dashboard',
  editOrder: null,
  orderPreset: null,
  unsentFilter: false
};

const rupiah = n => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0
}).format(Number(n || 0));

const fmtDate = s => s
  ? new Intl.DateTimeFormat('id-ID', {day:'2-digit', month:'short', year:'numeric'}).format(new Date(s + 'T00:00:00'))
  : '-';

const badge = s => `<span class="badge ${String(s).replaceAll(' ','')}">${escapeHtml(s)}</span>`;

function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));
}

function toast(msg) {
  const el = document.querySelector('#toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(window.__tt);
  window.__tt = setTimeout(() => el.style.display = 'none', 2600);
}


let idleLogoutTimer = null;
let maxLogoutTimer = null;
let lastSessionPingAt = 0;
let autoLogoutConfigured = false;

function logoutFor(reason) {
  window.location.assign(`/logout?reason=${encodeURIComponent(reason)}`);
}

function scheduleIdleLogout() {
  if (!state.meta.authEnabled) return;
  clearTimeout(idleLogoutTimer);
  const idleMs = Number(state.meta.idleTimeoutMs || 30 * 60 * 1000);
  idleLogoutTimer = setTimeout(() => logoutFor('idle'), idleMs);
}

async function pingSession() {
  const now = Date.now();
  if (!state.meta.authEnabled || now - lastSessionPingAt < 5 * 60 * 1000) return;
  lastSessionPingAt = now;
  try {
    const r = await fetch('/api/session/ping', {method:'POST', cache:'no-store'});
    if (r.status === 401) window.location.assign('/login?reason=expired');
  } catch {
    // Gangguan jaringan tidak langsung mengeluarkan user; server tetap menentukan validitas sesi.
  }
}

function recordUserActivity() {
  if (!state.meta.authEnabled) return;
  scheduleIdleLogout();
  void pingSession();
}

function setupAutoLogout() {
  if (!state.meta.authEnabled || autoLogoutConfigured) return;
  autoLogoutConfigured = true;
  scheduleIdleLogout();

  const maxMs = Number(state.meta.maxSessionMs || 8 * 60 * 60 * 1000);
  clearTimeout(maxLogoutTimer);
  maxLogoutTimer = setTimeout(() => logoutFor('max'), maxMs);

  ['pointerdown','keydown','touchstart','wheel'].forEach(eventName => {
    window.addEventListener(eventName, recordUserActivity, {passive:true});
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) recordUserActivity();
  });
}

async function api(path, opt={}) {
  const r = await fetch(path, {
    headers: {'Content-Type':'application/json', ...(opt.headers || {})},
    cache: 'no-store',
    ...opt
  });
  if (!r.ok) {
    if (r.status === 401) {
      window.location.assign('/login?reason=expired');
      throw new Error('Sesi login sudah berakhir.');
    }
    let data = {};
    try { data = await r.json(); } catch {}
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.data = data;
    err.status = r.status;
    throw err;
  }
  return r.json();
}

async function downloadFile(url, fallbackName) {
  try {
    const r = await fetch(url, {cache:'no-store'});
    if (!r.ok) {
      if (r.status === 401) {
        window.location.assign('/login?reason=expired');
        return;
      }
      let data = {};
      try { data = await r.json(); } catch {}
      throw new Error(data.error || `Download gagal (HTTP ${r.status})`);
    }
    const blob = await r.blob();
    const cd = r.headers.get('content-disposition') || '';
    const matched = cd.match(/filename="?([^";]+)"?/i);
    const filename = matched?.[1] || fallbackName;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(href);
      a.remove();
    }, 1500);
    toast(`File ${filename} dibuat`);
  } catch (e) {
    alert(e.message);
  }
}

async function bootstrap() {
  [state.suppliers, state.products, state.meta] = await Promise.all([
    api('/api/suppliers'), api('/api/products'), api('/api/meta')
  ]);
  const logoutBtn = document.querySelector('#logoutBtn');
  if (logoutBtn) logoutBtn.hidden = !state.meta.authEnabled;
  setupAutoLogout();
  route(location.hash.slice(1) || 'dashboard');
}

function route(r) {
  state.route = r;
  state.editOrder = null;
  location.hash = r;
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.nav === r || (r === 'order-detail' && b.dataset.nav === 'orders')));
  render();
}

window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (h && !h.startsWith('order/')) route(h);
});

navBtns.forEach(b => b.onclick = () => route(b.dataset.nav));

function page(title, sub, body) {
  app.innerHTML = `<h1>${escapeHtml(title)}</h1><div class="subtitle">${escapeHtml(sub)}</div>${body}`;
}

async function render() {
  if (state.route === 'dashboard') return dashboard();
  if (state.route === 'orders') return orders();
  if (state.route === 'create') return orderForm();
  if (state.route === 'suppliers') return suppliers();
  if (state.route === 'products') return products();
  if (state.route === 'reports') return reports();
  return dashboard();
}

async function dashboard() {
  const d = await api('/api/dashboard');
  page('Dashboard', `Ringkasan order ${fmtDate(d.date)}`, `
    <div class="grid stats">
      ${stat('Total Order',d.total,'orders')}
      ${stat('Draft',d.draft,'orders?status=Draft')}
      ${stat('Belum Dikirim',d.unsent,'orders?unsent=1')}
      ${stat('Sudah Dikirim',d.sent,'orders?status=Sent')}
      ${stat('Menunggu Konfirmasi',d.waiting,'orders?status=Sent')}
      ${stat('Completed',d.completed,'orders?status=Completed')}
    </div>
    <div class="section">
      <div class="row">
        <h2 class="grow">Butuh Tindakan</h2>
        <button class="btn" id="newOrder">+ Order</button>
      </div>
      <div class="list">${d.actions.length ? d.actions.map(orderCard).join('') : '<div class="card empty">Tidak ada order yang membutuhkan tindakan.</div>'}</div>
    </div>
    <div class="toolbar section">
      <button class="btn secondary" id="toReports">Reports & Export</button>
      <button class="btn secondary" id="quickExport">Export Excel</button>
    </div>
  `);
  document.querySelector('#newOrder').onclick = () => route('create');
  document.querySelector('#toReports').onclick = () => route('reports');
  document.querySelector('#quickExport').onclick = () => downloadFile('/api/export.xlsx','vendor-order-uns-inn.xlsx');
  bindOrderCards();
}

function stat(t,n,target) {
  return `<div class="card stat kpi-link" data-target="${target}"><small>${escapeHtml(t)}</small><b>${n}</b></div>`;
}

function orderCard(o) {
  return `<div class="card order-card" data-order="${o.id}">
    <div class="head">
      <div><b>${escapeHtml(o.order_no)}</b><div class="muted">${escapeHtml(o.supplier_name)} · ${fmtDate(o.order_date)}</div></div>
      ${badge(o.status)}
    </div>
    <div class="row">
      <span class="money grow">${rupiah(o.grand_total)}</span>
      <button class="btn secondary open">Buka</button>
      ${o.status === 'Ready to Send' ? '<button class="btn whatsapp send">WA</button>' : ''}
    </div>
  </div>`;
}

function bindOrderCards() {
  document.querySelectorAll('[data-target]').forEach(el => el.onclick = () => {
    const [base, qs] = el.dataset.target.split('?');
    if (base === 'orders') {
      state.orderPreset = new URLSearchParams(qs || '');
      route('orders');
    }
  });
  document.querySelectorAll('[data-order] .open').forEach(b => b.onclick = e => {
    e.stopPropagation();
    openOrder(Number(b.closest('[data-order]').dataset.order));
  });
  document.querySelectorAll('[data-order] .send').forEach(b => b.onclick = e => {
    e.stopPropagation();
    sendWhatsApp(Number(b.closest('[data-order]').dataset.order));
  });
}

async function orders() {
  const preset = state.orderPreset || new URLSearchParams();
  state.orderPreset = null;
  state.unsentFilter = preset.get('unsent') === '1';
  page('Orders','Cari, filter, edit, duplicate, dan update status.', `
    <div class="toolbar">
      <button class="btn" id="newOrder">+ Create Order</button>
      <button class="btn secondary" id="export">Export Excel</button>
      <button class="btn secondary" id="exportCsv">Export CSV</button>
    </div>
    <div class="card filters">
      <div class="field"><label>Search</label><input id="fSearch" placeholder="No order / supplier"></div>
      <div class="field"><label>Status</label><select id="fStatus"><option value="">Semua</option>${state.meta.statuses.map(s => `<option ${preset.get('status')===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select></div>
      <div class="field"><label>Supplier</label><select id="fSupplier"><option value="">Semua</option>${state.suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Dari</label><input type="date" id="fFrom"></div>
      <div class="field"><label>Sampai</label><input type="date" id="fTo"></div>
    </div>
    <div id="orderResults" class="section"></div>
  `);
  document.querySelector('#newOrder').onclick = () => route('create');
  const controls = ['fSearch','fStatus','fSupplier','fFrom','fTo'];
  controls.forEach(id => document.querySelector('#'+id).addEventListener('input',loadOrders));
  document.querySelector('#export').onclick = () => downloadFile('/api/export.xlsx?' + currentFilters().toString(),'vendor-order-uns-inn.xlsx');
  document.querySelector('#exportCsv').onclick = () => downloadFile('/api/export.csv?' + currentFilters().toString(),'vendor-order-uns-inn.csv');
  await loadOrders();
}

function currentFilters() {
  const p = new URLSearchParams();
  const map = [['fSearch','search'],['fStatus','status'],['fSupplier','supplier_id'],['fFrom','date_from'],['fTo','date_to']];
  for (const [id,k] of map) {
    const el = document.querySelector('#'+id);
    if (el?.value) p.set(k,el.value);
  }
  if (state.unsentFilter) p.set('unsent','1');
  return p;
}

async function loadOrders() {
  const qs = currentFilters();
  const rows = await api('/api/orders?' + qs.toString());
  const el = document.querySelector('#orderResults');
  el.innerHTML = rows.length ? `
    <div class="mobile-cards">${rows.map(orderCard).join('')}</div>
    <div class="desktop-table table-wrap">
      <table><thead><tr><th>Order</th><th>Tanggal</th><th>Supplier</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${rows.map(o => `<tr><td><b>${escapeHtml(o.order_no)}</b></td><td>${fmtDate(o.order_date)}</td><td>${escapeHtml(o.supplier_name)}</td><td>${rupiah(o.grand_total)}</td><td>${badge(o.status)}</td><td><button class="btn secondary open-row" data-id="${o.id}">Buka</button></td></tr>`).join('')}</tbody></table>
    </div>` : '<div class="card empty">Order tidak ditemukan.</div>';
  bindOrderCards();
  document.querySelectorAll('.open-row').forEach(b => b.onclick = () => openOrder(Number(b.dataset.id)));
}

async function openOrder(id) {
  const o = await api('/api/orders/' + id);
  const defaultMsg = buildMessage(o);
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-box">
    <div class="row"><div class="grow"><h2>${escapeHtml(o.order_no)}</h2><div class="muted">${escapeHtml(o.supplier_name)} · ${fmtDate(o.order_date)}</div></div><button class="btn secondary" id="closeModal">Tutup</button></div>
    <div class="section">${badge(o.status)} <b style="margin-left:8px">${rupiah(o.grand_total)}</b></div>
    <div class="section table-wrap"><table><thead><tr><th>Produk</th><th>Qty</th><th>Harga</th><th>Total</th></tr></thead><tbody>${o.items.map(i => `<tr><td>${escapeHtml(i.product_name)}</td><td>${i.qty} ${escapeHtml(i.unit)}</td><td>${rupiah(i.price)}</td><td>${rupiah(i.total)}</td></tr>`).join('')}</tbody></table></div>
    <div class="section field"><label>Catatan</label><div class="card">${escapeHtml(o.notes || '-')}</div></div>
    <div class="section field"><label>Pesan WhatsApp (bisa diedit)</label><textarea id="waMessage">${escapeHtml(o.whatsapp_message || defaultMsg)}</textarea></div>
    <div class="toolbar">
      <button class="btn whatsapp" id="waOpen">Buka WhatsApp</button>
      <button class="btn" id="markSent">Mark as Sent</button>
      <button class="btn secondary" id="editOrder">Edit</button>
      <button class="btn secondary" id="duplicate">Duplicate</button>
      <select id="statusSelect">${state.meta.statuses.map(s => `<option ${s===o.status?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select>
      <button class="btn secondary" id="updateStatus">Update Status</button>
      <button class="btn danger" id="deleteOrder">Delete</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#closeModal').onclick = () => modal.remove();
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.querySelector('#waOpen').onclick = () => sendWhatsApp(o.id,modal.querySelector('#waMessage').value);
  modal.querySelector('#markSent').onclick = async () => {
    await api(`/api/orders/${o.id}/status`,{method:'PATCH',body:JSON.stringify({status:'Sent'})});
    toast('Order ditandai Sent'); modal.remove(); render();
  };
  modal.querySelector('#updateStatus').onclick = async () => {
    await api(`/api/orders/${o.id}/status`,{method:'PATCH',body:JSON.stringify({status:modal.querySelector('#statusSelect').value})});
    toast('Status diperbarui'); modal.remove(); render();
  };
  modal.querySelector('#duplicate').onclick = async () => {
    const d = await api(`/api/orders/${o.id}/duplicate`,{method:'POST',body:JSON.stringify({})});
    toast(`Duplicated: ${d.order_no}`); modal.remove(); route('orders');
  };
  modal.querySelector('#editOrder').onclick = () => {
    state.editOrder = o; modal.remove(); state.route = 'create'; render();
  };
  modal.querySelector('#deleteOrder').onclick = async () => {
    if (confirm(`Hapus ${o.order_no}?`)) {
      await api(`/api/orders/${o.id}`,{method:'DELETE'});
      toast('Order dihapus'); modal.remove(); route('orders');
    }
  };
}

function buildMessage(o) {
  const items = o.items.map((i,idx) => `${idx+1}. ${i.product_name} — ${i.qty} ${i.unit}`).join('\n');
  return `Halo ${o.pic || ''},\n\nBerikut order untuk tanggal ${fmtDate(o.order_date)}:\n\n${items}\n\nTotal order: ${rupiah(o.grand_total)}${o.notes ? `\n\nCatatan: ${o.notes}` : ''}\n\nMohon dikonfirmasi ketersediaannya.\n\nTerima kasih.`;
}

async function sendWhatsApp(id, override) {
  const o = await api('/api/orders/' + id);
  const msg = override || o.whatsapp_message || buildMessage(o);
  const phone = String(o.whatsapp || '').replace(/\D/g,'');
  if (!phone) return toast('Nomor WhatsApp supplier belum diisi');
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,'_blank','noopener');
}

function orderForm() {
  const o = state.editOrder;
  const today = new Date().toISOString().slice(0,10);
  page(o ? 'Edit Order' : 'Create Order','Flow cepat: supplier → produk → qty → simpan → WhatsApp.', `
    <div class="card form-grid two">
      <div class="field"><label>Supplier *</label><select id="supplier"><option value="">Pilih supplier</option>${state.suppliers.map(s => `<option value="${s.id}" ${o?.supplier_id===s.id?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Tanggal Order *</label><input type="date" id="orderDate" value="${o?.order_date || today}"></div>
      <div class="field"><label>Status</label><select id="status">${state.meta.statuses.map(s => `<option ${s===(o?.status||'Draft')?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select></div>
      <div class="field"><label>Catatan</label><textarea id="notes" placeholder="Contoh: coffee break datang jam 9 pagi">${escapeHtml(o?.notes || '')}</textarea></div>
    </div>
    <div class="section"><div class="row"><h2 class="grow">Item Order</h2><button class="btn secondary" id="addItem">+ Item</button></div><div id="items" class="list"></div></div>
    <div class="card section"><div class="row"><b class="grow">Total</b><b id="grandTotal">Rp0</b></div></div>
    <div class="toolbar section"><button class="btn" id="saveOrder">${o?'Update Order':'Generate Order'}</button><button class="btn secondary" id="cancelOrder">Batal</button></div>
  `);

  const items = (o?.items || [{product_id:'',product_name:'',qty:1,unit:'pcs',price:0}]).map(x => ({...x}));
  const box = document.querySelector('#items');

  function draw() {
    box.innerHTML = items.map((it,i) => `<div class="item-editor" data-i="${i}">
      <div class="field"><label>Produk</label><select class="prod"><option value="">Pilih produk</option>${state.products.filter(p => p.active || p.id===it.product_id).map(p => `<option value="${p.id}" ${Number(it.product_id)===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Qty</label><input class="qty" type="number" min="0" step="1" value="${it.qty}"></div>
      <div class="field"><label>Satuan</label><input class="unit" value="${escapeHtml(it.unit)}"></div>
      <div class="field price"><label>Harga</label><input class="pricev" type="number" min="0" value="${it.price}"></div>
      <button class="btn danger remove">×</button>
    </div>`).join('');

    box.querySelectorAll('.item-editor').forEach(el => {
      const i = Number(el.dataset.i);
      el.querySelector('.prod').onchange = e => {
        const p = state.products.find(x => x.id === Number(e.target.value));
        if (p) {
          items[i].product_id = p.id;
          items[i].product_name = p.name;
          items[i].unit = p.unit;
          items[i].price = p.last_price || p.purchase_price || 0;
          draw();
        }
      };
      el.querySelector('.qty').oninput = e => { items[i].qty = Number(e.target.value); sum(); };
      el.querySelector('.unit').oninput = e => items[i].unit = e.target.value;
      el.querySelector('.pricev').oninput = e => { items[i].price = Number(e.target.value); sum(); };
      el.querySelector('.remove').onclick = () => { items.splice(i,1); draw(); };
    });
    sum();
  }

  function sum() {
    document.querySelector('#grandTotal').textContent = rupiah(items.reduce((a,it) => a + Number(it.qty||0)*Number(it.price||0),0));
  }

  draw();
  document.querySelector('#addItem').onclick = () => { items.push({product_id:'',product_name:'',qty:1,unit:'pcs',price:0}); draw(); };
  document.querySelector('#cancelOrder').onclick = () => route('orders');
  document.querySelector('#saveOrder').onclick = async () => {
    try {
      const payload = {
        supplier_id:Number(document.querySelector('#supplier').value),
        order_date:document.querySelector('#orderDate').value,
        status:document.querySelector('#status').value,
        notes:document.querySelector('#notes').value,
        items:items.filter(i => i.product_name && i.qty > 0)
      };
      const result = o
        ? await api(`/api/orders/${o.id}`,{method:'PUT',body:JSON.stringify(payload)})
        : await api('/api/orders',{method:'POST',body:JSON.stringify(payload)});
      toast(o ? 'Order diperbarui' : `Order dibuat: ${result.order_no}`);
      state.editOrder = null;
      route('orders');
    } catch (e) { alert(e.message); }
  };
}

async function suppliers() {
  state.suppliers = await api('/api/suppliers');
  page('Suppliers','Master vendor dan nomor WhatsApp Click-to-Chat.', `
    <div class="toolbar"><button class="btn" id="addSupplier">+ Supplier</button></div>
    <div class="list">${state.suppliers.map(s => `<div class="card"><div class="row">
      <div class="grow"><b>${escapeHtml(s.name)}</b><div class="muted">${escapeHtml(s.pic||'-')} · ${escapeHtml(s.whatsapp||'-')} · ${escapeHtml(s.category||'-')}${Number(s.order_count||0) ? ` · ${s.order_count} order` : ''}</div></div>
      <button class="btn secondary edit-s" data-id="${s.id}">Edit</button>
      <button class="btn danger delete-s" data-id="${s.id}">Hapus</button>
    </div></div>`).join('')}</div>
  `);
  document.querySelector('#addSupplier').onclick = () => supplierModal();
  document.querySelectorAll('.edit-s').forEach(b => b.onclick = () => supplierModal(state.suppliers.find(s => s.id===Number(b.dataset.id))));
  document.querySelectorAll('.delete-s').forEach(b => b.onclick = () => deleteSupplier(Number(b.dataset.id)));
}

async function deleteSupplier(id) {
  const s = state.suppliers.find(x => x.id === id);
  if (!s) return;
  if (!confirm(`Hapus supplier "${s.name}"?`)) return;
  try {
    await api(`/api/suppliers/${id}`,{method:'DELETE'});
    toast('Supplier dihapus');
  } catch (e) {
    if (!e.data?.requires_force) return alert(e.message);
    const ok = confirm(`${e.message}\n\nPERINGATAN: jika dilanjutkan, histori order supplier ini juga akan dihapus permanen. Lanjutkan?`);
    if (!ok) return;
    await api(`/api/suppliers/${id}?force=1`,{method:'DELETE'});
    toast('Supplier dan histori order terkait dihapus');
  }
  [state.suppliers,state.products] = await Promise.all([api('/api/suppliers'),api('/api/products')]);
  render();
}

function supplierModal(s={}) {
  formModal(s.id ? 'Edit Supplier' : 'Tambah Supplier', `
    <div class="form-grid two">
      ${input('sName','Nama Supplier *',s.name)}
      ${input('sPic','PIC',s.pic)}
      ${input('sWa','WhatsApp',s.whatsapp)}
      ${input('sCat','Kategori',s.category)}
      ${input('sAddr','Alamat',s.address)}
      ${input('sNotes','Catatan',s.notes)}
    </div>
  `, async modal => {
    const b = {name:v('sName'),pic:v('sPic'),whatsapp:v('sWa'),category:v('sCat'),address:v('sAddr'),notes:v('sNotes')};
    await api(s.id ? `/api/suppliers/${s.id}` : '/api/suppliers',{method:s.id?'PUT':'POST',body:JSON.stringify(b)});
    modal.remove();
    toast('Supplier disimpan');
    [state.suppliers,state.products] = await Promise.all([api('/api/suppliers'),api('/api/products')]);
    route('suppliers');
  });
}

async function products() {
  state.products = await api('/api/products');
  page('Products','Master produk, satuan, dan harga terakhir.', `
    <div class="toolbar"><button class="btn" id="addProduct">+ Produk</button></div>
    <div class="list">${state.products.map(p => `<div class="card"><div class="row"><div class="grow"><b>${escapeHtml(p.name)}</b><div class="muted">${escapeHtml(p.sku||'-')} · ${escapeHtml(p.unit)} · ${rupiah(p.last_price)} · ${escapeHtml(p.supplier_name||'Tanpa supplier utama')} · ${p.active?'Aktif':'Nonaktif'}</div></div><button class="btn secondary edit-p" data-id="${p.id}">Edit</button></div></div>`).join('')}</div>
  `);
  document.querySelector('#addProduct').onclick = () => productModal();
  document.querySelectorAll('.edit-p').forEach(b => b.onclick = () => productModal(state.products.find(p => p.id===Number(b.dataset.id))));
}

function productModal(p={}) {
  formModal(p.id ? 'Edit Produk' : 'Tambah Produk', `
    <div class="form-grid two">
      ${input('pName','Nama Produk *',p.name)}
      ${input('pSku','SKU',p.sku)}
      <div class="field"><label>Supplier utama</label><select id="pSupplier"><option value="">-</option>${state.suppliers.map(s => `<option value="${s.id}" ${p.primary_supplier_id===s.id?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}</select></div>
      ${input('pUnit','Satuan',p.unit||'pcs')}
      ${input('pLast','Harga terakhir',p.last_price||0,'number')}
      ${input('pBuy','Harga beli',p.purchase_price||0,'number')}
      <div class="field"><label>Status</label><select id="pActive"><option value="1" ${p.active!==0?'selected':''}>Aktif</option><option value="0" ${p.active===0?'selected':''}>Nonaktif</option></select></div>
      ${input('pNotes','Catatan',p.notes)}
    </div>
  `, async modal => {
    const b = {name:v('pName'),sku:v('pSku'),primary_supplier_id:Number(v('pSupplier'))||null,unit:v('pUnit'),last_price:Number(v('pLast')),purchase_price:Number(v('pBuy')),active:v('pActive')==='1',notes:v('pNotes')};
    await api(p.id ? `/api/products/${p.id}` : '/api/products',{method:p.id?'PUT':'POST',body:JSON.stringify(b)});
    modal.remove();
    toast('Produk disimpan');
    state.products = await api('/api/products');
    route('products');
  });
}

function input(id,label,value='',type='text') {
  return `<div class="field"><label>${escapeHtml(label)}</label><input id="${id}" type="${type}" value="${escapeHtml(String(value??''))}"></div>`;
}
function v(id) { return document.querySelector('#'+id)?.value || ''; }

function formModal(title,body,onSave) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-box"><div class="row"><h2 class="grow">${escapeHtml(title)}</h2><button class="btn secondary close">Tutup</button></div>${body}<div class="toolbar section"><button class="btn save">Simpan</button></div></div>`;
  document.body.appendChild(modal);
  modal.querySelector('.close').onclick = () => modal.remove();
  modal.querySelector('.save').onclick = () => onSave(modal);
}

async function reports() {
  const [orders,settings] = await Promise.all([api('/api/orders'),api('/api/settings')]);
  const bySupplier = {};
  const byProduct = {};
  for (const o of orders) bySupplier[o.supplier_name] = (bySupplier[o.supplier_name] || 0) + Number(o.grand_total);
  const details = await Promise.all(orders.slice(0,100).map(o => api('/api/orders/'+o.id)));
  for (const o of details) for (const i of o.items) byProduct[i.product_name] = (byProduct[i.product_name] || 0) + Number(i.qty);

  page('Reports','Ringkasan pembelian, Excel, CSV, dan Google Sheets.', `
    <div class="toolbar">
      <button class="btn" id="exportAll">Export Excel</button>
      <button class="btn secondary" id="exportCsvAll">Export CSV</button>
      <button class="btn secondary" id="syncSheets">Sync to Google Sheets</button>
    </div>
    <div class="grid form-grid two">
      <div class="card"><h2>Purchase Summary</h2><b style="font-size:28px">${rupiah(orders.reduce((a,o) => a+Number(o.grand_total),0))}</b><div class="muted">${orders.length} order tersimpan</div></div>
      <div class="card"><h2>Supplier Summary</h2>${Object.entries(bySupplier).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,n]) => `<div class="row"><span class="grow">${escapeHtml(k)}</span><b>${rupiah(n)}</b></div>`).join('') || '<div class="muted">Belum ada data</div>'}</div>
      <div class="card"><h2>Produk paling sering dipesan</h2>${Object.entries(byProduct).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,n]) => `<div class="row"><span class="grow">${escapeHtml(k)}</span><b>${n}</b></div>`).join('') || '<div class="muted">Belum ada data</div>'}</div>
      <div class="card">
        <h2>Google Sheets</h2>
        <div class="field"><label>Google Apps Script Web App URL</label><input id="gsUrl" type="url" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeHtml(settings.google_sheets_webhook_url || '')}"></div>
        <div class="muted section-small">Paste URL hasil Deploy Apps Script. URL disimpan di database lokal, jadi tidak perlu restart aplikasi.</div>
        <div class="toolbar section"><button class="btn secondary" id="saveGs">Simpan URL</button><button class="btn" id="saveAndSyncGs">Simpan & Sync</button></div>
      </div>
    </div>
  `);

  document.querySelector('#exportAll').onclick = () => downloadFile('/api/export.xlsx','vendor-order-uns-inn.xlsx');
  document.querySelector('#exportCsvAll').onclick = () => downloadFile('/api/export.csv','vendor-order-uns-inn.csv');
  document.querySelector('#syncSheets').onclick = syncSheets;
  document.querySelector('#saveGs').onclick = async () => {
    await saveSheetsUrl();
    toast('URL Google Sheets disimpan');
  };
  document.querySelector('#saveAndSyncGs').onclick = async () => {
    await saveSheetsUrl();
    await syncSheets();
  };
}

async function saveSheetsUrl() {
  const url = document.querySelector('#gsUrl')?.value.trim() || '';
  await api('/api/settings',{method:'PUT',body:JSON.stringify({google_sheets_webhook_url:url})});
  state.meta.googleSheetsConfigured = !!url;
}

async function syncSheets() {
  try {
    const r = await api('/api/google-sheets/sync',{method:'POST'});
    toast(`${r.count} baris berhasil disinkronkan ke Google Sheets`);
  } catch (e) {
    alert(e.message);
  }
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  document.querySelector('#installBtn').hidden = false;
});

document.querySelector('#installBtn').onclick = async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.querySelector('#installBtn').hidden = true;
  }
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => reg.update()).catch(() => {});
}

bootstrap().catch(e => {
  app.innerHTML = `<div class="card"><b>Gagal memuat aplikasi</b><p>${escapeHtml(e.message)}</p></div>`;
});
