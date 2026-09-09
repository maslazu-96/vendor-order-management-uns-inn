import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });
const volumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const dbPath = process.env.DB_PATH || (volumeMount ? path.join(volumeMount, 'orders.db') : path.join(dataDir, 'orders.db'));
export const activeDbPath = dbPath;
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      pic TEXT,
      whatsapp TEXT,
      address TEXT,
      category TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      primary_supplier_id INTEGER,
      unit TEXT NOT NULL DEFAULT 'pcs',
      last_price REAL DEFAULT 0,
      purchase_price REAL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(primary_supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT UNIQUE NOT NULL,
      supplier_id INTEGER NOT NULL,
      order_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Draft',
      notes TEXT,
      whatsapp_message TEXT,
      sent_date TEXT,
      confirmation_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      qty REAL NOT NULL,
      unit TEXT NOT NULL,
      price REAL DEFAULT 0,
      total REAL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
    CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);
  `);

  const count = db.prepare('SELECT COUNT(*) AS c FROM suppliers').get().c;
  const seedEnabled = !['0','false','no'].includes(String(process.env.SEED_SAMPLE_DATA || '1').toLowerCase());
  if (count === 0 && seedEnabled) seed();
}

function seed() {
  const insertSupplier = db.prepare(`INSERT INTO suppliers(name,pic,whatsapp,address,category,notes) VALUES(?,?,?,?,?,?)`);
  const s1 = insertSupplier.run('Sore Bu / Supplier Snack', 'Bu Sari', '6281234567890', 'Surakarta', 'Snack & Coffee Break', 'Dummy supplier untuk testing').lastInsertRowid;
  const s2 = insertSupplier.run('Supplier Minuman', 'Pak Budi', '628111222333', 'Surakarta', 'Minuman', 'Dummy supplier').lastInsertRowid;

  const insertProduct = db.prepare(`INSERT INTO products(name,sku,primary_supplier_id,unit,last_price,purchase_price,active,notes) VALUES(?,?,?,?,?,?,?,?)`);
  const products = [
    ['Sosis Basah Solo', 'SNK-001', s1, 'pcs', 4500, 4500, 1, ''],
    ['Getuk', 'SNK-002', s1, 'pcs', 3500, 3500, 1, ''],
    ['Kroket Ayam', 'SNK-003', s1, 'pcs', 4000, 4000, 1, ''],
    ['Carang Gesing', 'SNK-004', s1, 'pcs', 4000, 4000, 1, ''],
    ['Kletikan', 'SNK-005', s1, 'pcs', 3000, 3000, 1, ''],
    ['Teh Kotak', 'DRK-001', s2, 'kotak', 5000, 5000, 1, '']
  ];
  const ids = products.map(p => insertProduct.run(...p).lastInsertRowid);

  const createOrder = db.prepare(`INSERT INTO orders(order_no,supplier_id,order_date,status,notes,whatsapp_message) VALUES(?,?,?,?,?,?)`);
  const o1 = createOrder.run('ORD-20260910-001', s1, '2026-09-10', 'Ready to Send', 'Coffee break datang jam 9 pagi.', '').lastInsertRowid;
  const insertItem = db.prepare(`INSERT INTO order_items(order_id,product_id,product_name,qty,unit,price,total,notes) VALUES(?,?,?,?,?,?,?,?)`);
  insertItem.run(o1, ids[0], 'Sosis Basah Solo', 30, 'pcs', 4500, 135000, '');
  insertItem.run(o1, ids[1], 'Getuk', 30, 'pcs', 3500, 105000, '');

  const o2 = createOrder.run('ORD-20260910-002', s1, '2026-09-10', 'Draft', 'Coffee break datang jam 10 pagi. Snack box UNS Inn total 30 pcs.', '').lastInsertRowid;
  insertItem.run(o2, ids[2], 'Kroket Ayam', 30, 'pcs', 4000, 120000, '');
  insertItem.run(o2, ids[3], 'Carang Gesing', 30, 'pcs', 4000, 120000, '');
  insertItem.run(o2, ids[4], 'Kletikan', 30, 'pcs', 3000, 90000, '');
  insertItem.run(o2, ids[5], 'Teh Kotak', 30, 'kotak', 5000, 150000, '');
}

export function nextOrderNo(orderDate) {
  const compact = orderDate.replaceAll('-', '');
  const prefix = `ORD-${compact}-`;
  const row = db.prepare('SELECT order_no FROM orders WHERE order_no LIKE ? ORDER BY order_no DESC LIMIT 1').get(`${prefix}%`);
  let seq = 1;
  if (row) seq = Number(row.order_no.slice(-3)) + 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

export function getOrder(id) {
  const order = db.prepare(`
    SELECT o.*, s.name supplier_name, s.pic, s.whatsapp, s.address, s.category supplier_category,
           COALESCE((SELECT SUM(total) FROM order_items oi WHERE oi.order_id=o.id),0) grand_total
    FROM orders o JOIN suppliers s ON s.id=o.supplier_id WHERE o.id=?
  `).get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(id);
  return order;
}
