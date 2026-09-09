# Railway deployment — FLAT GitHub version

Versi ini sengaja dibuat tanpa folder `public/` dan `src/`, sehingga semua file dapat di-upload satu per satu melalui tombol **Add file → Upload files** di GitHub Web.

# Deploy Online — Railway

Versi 1.2 disiapkan agar aplikasi bisa online tanpa komputer kantor harus menyala.

## Arsitektur MVP online

- **App/API:** Railway Web Service
- **Database:** SQLite pada **Railway Volume**
- **Akses:** HTTPS domain dari Railway
- **Login:** username/password dari environment variables
- **PWA:** tetap bisa Add to Home Screen di HP

Untuk penggunaan kecil/satu tim UNS Inn, ini lebih sederhana daripada langsung migrasi database ke PostgreSQL. Jika nanti aplikasi dipakai banyak user secara bersamaan atau membutuhkan audit/login per user, migrasikan database ke PostgreSQL/Supabase.

## 1. Upload source ke GitHub

Buat repository baru, misalnya:

`vendor-order-management-uns-inn`

Upload **isi folder aplikasi**, sehingga `package.json` dan `Dockerfile` berada di root repository.

## 2. Deploy repository di Railway

1. Login ke Railway.
2. Buat project baru.
3. Pilih deploy dari GitHub repository.
4. Pilih repository `vendor-order-management-uns-inn`.
5. Railway akan mendeteksi `Dockerfile` secara otomatis.

Tidak perlu mengatur `PORT`. Railway menyediakan variable `PORT` secara otomatis dan aplikasi sudah menggunakannya.

## 3. Tambahkan persistent Volume

Ini WAJIB agar database tidak hilang saat deploy/restart.

Pada service aplikasi:

1. Tambahkan **Volume**.
2. Mount path: `/data`
3. Deploy/apply perubahan.

Aplikasi v1.2 otomatis mendeteksi `RAILWAY_VOLUME_MOUNT_PATH` dan menyimpan database sebagai:

`/data/orders.db`

Tidak perlu mengisi `DB_PATH` secara manual di Railway.

## 4. Environment Variables

Tambahkan variables berikut pada Railway service:

```text
APP_USERNAME=admin
APP_PASSWORD=GANTI_DENGAN_PASSWORD_KUAT
SESSION_SECRET=GANTI_DENGAN_RANDOM_STRING_PANJANG
SEED_SAMPLE_DATA=0
```

Keterangan:

- `APP_USERNAME`: username login aplikasi.
- `APP_PASSWORD`: password login. Jika kosong, aplikasi tidak memakai login.
- `SESSION_SECRET`: random string panjang untuk menandatangani session login.
- `SEED_SAMPLE_DATA=0`: database production dimulai kosong.
- Gunakan `SEED_SAMPLE_DATA=1` jika ingin dummy supplier/product/order saat pertama kali deploy.

Opsional:

```text
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/xxxxx/exec
```

URL Google Sheets juga dapat dimasukkan dari menu **Reports**, jadi variable ini tidak wajib.

## 5. Healthcheck

Jika Railway menyediakan pengaturan Healthcheck Path, isi:

`/api/health`

Endpoint tersebut mengembalikan HTTP 200 ketika server dan database berhasil dimulai.

## 6. Generate domain

Buka service -> **Networking** -> generate public domain.

Contoh hasil:

`https://vendor-order-management-uns-inn-production.up.railway.app`

Buka URL tersebut. Jika `APP_PASSWORD` sudah diset, aplikasi akan menampilkan halaman Login.

## 7. Install di HP

### Android / Chrome

Buka URL aplikasi -> menu Chrome -> **Add to Home screen / Install app**.

### iPhone / Safari

Buka URL aplikasi -> **Share** -> **Add to Home Screen**.

## 8. Data lama dari laptop (opsional)

Database lokal v1.1/v1.2 berada di:

`data/orders.db`

Jika masih hanya dummy/testing, lebih mudah mulai database production kosong.

Jika database lokal sudah berisi data penting, jangan membuat order production dulu. Upload file `orders.db` lama ke volume Railway sebagai `/data/orders.db`, lalu restart/deploy service.

Simpan backup file `orders.db` lokal sebelum proses migrasi.

## 9. Backup

Untuk backup aplikasi MVP:

- Export order secara berkala melalui **Export Excel**.
- Backup file `/data/orders.db` dari Railway Volume secara berkala.

SQLite + satu Railway Volume sesuai untuk MVP kecil. Untuk multi-instance, user login terpisah, audit log, dan penggunaan lebih besar, gunakan PostgreSQL/Supabase pada versi berikutnya.
