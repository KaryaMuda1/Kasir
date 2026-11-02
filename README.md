# SMART KASIR

Aplikasi POS web mandiri berbahasa Indonesia. Buka `index.html` di browser modern; tidak memerlukan build, instalasi paket, atau server Node.js.

Saat pertama dibuka, buat akun Admin dengan nama, email, dan password. Admin dapat membuka **Pengguna** untuk membuat akun Kasir menggunakan email serta password awal. Admin maupun Kasir dapat mengganti password melalui ikon profil dan keluar dari aplikasi. Setiap transaksi mencatat nama pengguna yang sedang login.

## Fitur yang tersedia

- Ringkasan penjualan lunas, total modal/HPP dari harga beli produk terjual, estimasi keuntungan, grafik, produk terlaris, dan peringatan stok minimum.
- Katalog produk dengan tambah, edit, hapus, SKU, barcode, kategori, harga, dan stok. Stok berkurang otomatis sesuai jumlah item ketika pembayaran tunai berhasil dan transaksi dicatat lunas; perubahan tercatat pada riwayat stok.
- Cetak label barcode Code 39 satuan atau massal dari produk yang dipilih; barcode menggunakan nilai kolom barcode, atau SKU bila barcode kosong.
- Kasir dengan pencarian, pemindaian langsung dari kamera belakang HP, keranjang, jumlah item, diskon rupiah/persen, pajak, pembayaran tunai, dan penghitungan kembalian.
- Pembayaran digital dicatat **belum lunas**; status tersebut tidak dapat dianggap terverifikasi atau dicetak sebagai struk lunas.
- Riwayat dan pembatalan transaksi yang belum lunas, laporan berdasarkan periode, ekspor CSV yang dapat dibuka di Excel, dan cetak laporan.
- Bukti transaksi tunai berukuran 58/80 mm melalui dialog cetak browser (pilih “Save as PDF” untuk mengunduh PDF).
- Login Admin dan Kasir menggunakan email; Admin pertama dibuat saat aplikasi dibuka pertama kali, sedangkan akun Kasir dibuat dari menu Pengguna. Akun memiliki password masing-masing dan pengguna dapat mengganti password melalui ikon profil.
- Pengaturan toko/pajak/struk, serta pencadangan dan pemulihan data JSON.

## Batasan dan persyaratan produksi

Versi ini merupakan aplikasi frontend mandiri untuk dicoba dan dikembangkan, **bukan** sistem backend siap produksi. Data dan akun disimpan dalam `localStorage` browser pada satu perangkat; data transaksi akan tersimpan di browser yang sama setelah login, tetapi tidak disinkronkan ke perangkat lain atau disimpan ke server dan dapat hilang jika data browser dihapus. Password di-hash dengan PBKDF2 sebelum disimpan, tetapi akun dan role lokal dapat dimanipulasi oleh orang yang memiliki akses ke browser/devtools. Login dan pembatasan menu ini **bukan autentikasi atau kontrol akses produksi** dan tidak menyediakan reset password jarak jauh; setiap pengguna dapat mengganti password setelah login. Cetak barcode menggunakan format Code 39; hasil cetak dapat dibuka melalui dialog cetak A4. Pemindaian kamera HP memerlukan aplikasi dibuka melalui HTTPS, izin kamera belakang, dan browser yang mendukung `BarcodeDetector`; browser tanpa dukungan tersebut memuat ZXing dari jsDelivr (memerlukan internet). Jika kamera atau pustaka scanner tidak tersedia, barcode dapat dimasukkan manual. Aplikasi yang dibuka sebagai `file://` di komputer tidak dapat diakses melalui kamera HP; host halaman ini di server HTTPS agar bisa dibuka menggunakan HP.

Tidak ada transaksi pembayaran gateway simulasi dalam aplikasi ini. QRIS, transfer, e-wallet, dan kartu hanya membuat catatan **belum lunas**. Tidak tersedia kunci gateway, pembuatan pembayaran, webhook, maupun verifikasi backend; karena itu transaksi digital tidak pernah dinyatakan lunas dan stok tidak berkurang sampai integrasi server yang aman ditambahkan. Jangan gunakan data contoh atau mode lokal untuk menerima pembayaran produksi.

Sebelum digunakan oleh bisnis nyata, migrasikan data ke PostgreSQL/Supabase atau backend tepercaya, gunakan autentikasi dan kebijakan RLS yang ditetapkan di server, lakukan validasi serta update stok secara atomik di database, dan implementasikan integrasi resmi Midtrans/Xendit beserta verifikasi signature webhook/idempotensi di backend. Simpan rahasia gateway hanya di server, atur backup database yang dapat diuji, otorisasi tindakan admin di server, dan uji seluruh alur pembayaran serta pembatalan di sandbox resmi gateway sebelum aktivasi produksi.
