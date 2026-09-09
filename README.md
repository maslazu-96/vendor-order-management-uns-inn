# Vendor Order Management UNS Inn — MVP v1.2

Responsive web/PWA untuk membuat order supplier, mengirim order via WhatsApp Click-to-Chat, monitoring status, histori, dan rekap.

## Update v1.2 — siap deploy online
- Siap deploy ke **Railway** dengan Dockerfile.
- Database otomatis memakai **Railway Volume** jika tersedia, sehingga data tetap tersimpan saat restart/deploy.
- Login production opsional via `APP_USERNAME`, `APP_PASSWORD`, dan `SESSION_SECRET`.
- `SEED_SAMPLE_DATA=0` untuk memulai database production kosong tanpa dummy data.
- Panduan lengkap deployment: `DEPLOY-RAILWAY.md`.

## Update v1.1
- Nama aplikasi: **Vendor Order Management UNS Inn**.
- Supplier sekarang punya tombol **Hapus**.
- Supplier tanpa histori order dapat langsung dihapus.
- Jika supplier masih mempunyai order, aplikasi memberi peringatan sebelum penghapusan permanen beserta histori order terkait.
- Export Excel diperbaiki: download dilakukan melalui browser sebagai file `.xlsx`.
- Ditambahkan fallback **Export CSV** yang dapat langsung dibuka/import di Excel atau Google Sheets.
- URL Google Apps Script sekarang dapat diisi langsung dari menu **Reports** dan disimpan di database; tidak perlu mengatur environment variable atau restart aplikasi.
- Cache PWA dinaikkan versinya agar perubahan frontend lebih cepat diterapkan.

## Requirement
- Node.js >= 22.5

## Menjalankan di Windows
Extract folder, lalu buka Command Prompt di folder yang berisi `package.json`.

```cmd
cd C:\lokasi\vendor-order-management-uns-inn
npm start
```

Buka:

```text
http://localhost:3000
```

Jika browser masih menampilkan versi lama, tekan `Ctrl + F5` sekali.

## Fitur utama
- Dashboard monitoring order
- CRUD Supplier
- CRUD Product
- Create / Edit / Delete Order
- Duplicate order
- Status order
- WhatsApp Click-to-Chat
- Mark as Sent manual
- Order History + filter
- Export Excel `.xlsx`
- Export CSV untuk Excel/Google Sheets
- Sync Google Sheets via Google Apps Script Web App
- PWA / Add to Home Screen

## Menghapus supplier
Menu **Supplier** sekarang memiliki tombol **Hapus**.

- Supplier yang belum dipakai order: langsung dapat dihapus.
- Supplier yang sudah mempunyai histori order: aplikasi meminta konfirmasi kedua karena penghapusan permanen juga akan menghapus histori order supplier tersebut.
- Produk yang menggunakan supplier sebagai supplier utama tidak ikut dihapus; supplier utama produk akan dikosongkan.

## Export Excel
Bisa dilakukan dari:
- Dashboard → **Export Excel**
- Orders → **Export Excel**
- Reports → **Export Excel**

File yang dihasilkan menggunakan format `.xlsx` dan berisi:
- Order ID
- Order Date
- Supplier
- PIC
- Product
- Qty
- Unit
- Price
- Total
- Status
- Sent Date
- Confirmation Date
- Notes

Jika satu order mempunyai beberapa produk, setiap produk ditulis pada baris tersendiri dengan Order ID yang sama.

## Export CSV / Google Sheets tanpa integrasi
Menu **Orders** atau **Reports** → **Export CSV**.

File `.csv` dapat dibuka langsung di Excel atau di-import ke Google Sheets. Ini adalah pilihan paling sederhana jika belum ingin memasang Apps Script.

## Sync langsung ke Google Sheets
### 1. Buat Google Sheet
Buka Google Sheets dan buat spreadsheet baru.

### 2. Buka Apps Script
Di Google Sheet:

**Extensions → Apps Script**

Hapus kode awal dan paste isi file:

```text
google-apps-script.gs
```

### 3. Deploy Apps Script
Pilih:

**Deploy → New deployment → Web app**

Gunakan pengaturan yang memungkinkan aplikasi lokal mengakses Web App sesuai kebutuhan akun Anda. Setelah deploy, copy URL yang berakhiran `/exec`.

Contoh:

```text
https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec
```

### 4. Masukkan URL di aplikasi
Buka:

**Dashboard → Reports & Export → Google Sheets**

Paste URL tersebut ke kolom **Google Apps Script Web App URL** lalu pilih:

- **Simpan URL**, atau
- **Simpan & Sync**

URL tersimpan di SQLite pada tabel `app_settings`, sehingga tidak perlu restart aplikasi.

### 5. Sync berikutnya
Cukup klik **Sync to Google Sheets** pada menu Reports.

Data pada sheet `Order Recap` akan diperbarui dari data aplikasi.

## Database
Default:

```text
data/orders.db
```

Aplikasi otomatis melakukan migrasi ringan untuk menambahkan tabel `app_settings` pada database versi lama.

Untuk menggunakan database lain:

Windows CMD:

```cmd
set DB_PATH=C:\data\orders.db
npm start
```

## WhatsApp
Nomor supplier dapat diisi seperti:

```text
081234567890
```

Aplikasi akan menyimpan nomor baru sebagai format `62...`.

Tombol **Buka WhatsApp** membuka `wa.me` dengan nomor supplier dan pesan yang sudah terisi. Status tidak otomatis berubah menjadi Sent; gunakan **Mark as Sent** setelah pesan benar-benar dikirim.

## Akses dari HP dalam Wi-Fi yang sama
Cari IP laptop, misalnya `192.168.1.10`, lalu dari HP buka:

```text
http://192.168.1.10:3000
```

Windows Firewall mungkin meminta izin untuk Node.js. Izinkan pada jaringan Private.

## Struktur
```text
public/                  Frontend SPA + PWA
src/server.js            HTTP server + REST API
src/db.js                SQLite schema + sample data
src/xlsx.js              Generator XLSX
src/smoke-test.js        Smoke test
schema.sql               Struktur database
Google-apps-script.gs    Template sinkronisasi Google Sheets
data/orders.db           Database lokal
```

## Deployment berikutnya
Untuk penggunaan multi-user dan akses dari luar jaringan lokal, rekomendasi berikutnya adalah migrasi database ke Supabase/PostgreSQL lalu deploy aplikasi ke Render/Railway/VPS.
