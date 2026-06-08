# Panduan Instalasi dan Penggunaan NetX

Dokumentasi ini menjelaskan langkah-langkah persiapan, instalasi, dan cara penggunaan platform manajemen jaringan **NetX** di sistem operasi Windows, Linux, dan macOS.

---

## 1. Pendahuluan & Arsitektur Sistem

**NetX** adalah platform manajemen jaringan modern berbasis web (Network Management Platform) yang berfungsi untuk melakukan pemetaan port fisik switch (Port Mapping), pelacakan perangkat (MAC & IP), visualisasi topologi jaringan interaktif, serta manajemen backup konfigurasi otomatis.

Sistem NetX terdiri dari dua bagian utama:
1. **Backend**: FastAPI (Python 3.10+) yang berkomunikasi dengan perangkat jaringan menggunakan Netmiko (SSH/Telnet) dan menyimpan data pada basis data SQLite lokal (`netx.db`).
2. **Frontend**: Single Page Application (SPA) berbasis React (Vite) yang menyajikan antarmuka premium dengan visualisasi switch faceplate interaktif dan grafis topologi berbasis SVG.

Untuk rincian arsitektur teknis, detail database (23 tabel), diagram Mermaid interaktif, serta taktik adopsi maksimal, silakan merujuk ke **[Panduan Referensi Sistem NetX](file:///c:/Code/Auto/NetX/docs/comprehensive_system_reference.md)**, serta [program_technical_details.md](file:///c:/Code/Auto/NetX/docs/program_technical_details.md) dan [technical_documentation.md](file:///c:/Code/Auto/NetX/docs/technical_documentation.md).

---

## 2. Struktur Direktori Proyek

```text
NetX/
├── backend/                  # Kode backend (Python & FastAPI)
│   ├── app/                  # Logika aplikasi backend
│   │   ├── routers/          # Endpoint API (routing, terminal, dll.)
│   │   ├── services/         # Parser vendor, backup, auth, dll.
│   │   └── database.py       # Inisialisasi & skema basis data
│   ├── data/                 # Folder data (berisi netx.db & secret.key)
│   ├── main.py               # Main entrypoint backend FastAPI
│   ├── requirements.txt      # Dependency Python backend
│   ├── run.bat               # Skrip jalankan server development (Windows)
│   └── run_production.bat    # Skrip jalankan server production (Windows)
├── docs/                     # Folder Dokumentasi
│   ├── installation_and_usage_guide.md
│   ├── program_technical_details.md
│   └── technical_documentation.md
└── frontend/                 # Kode frontend (React & Vite)
    ├── src/                  # Komponen, Halaman, dan Aset React
    ├── package.json          # Dependency frontend Node.js
    └── vite.config.js        # Konfigurasi Vite & API Proxy
```

---

## 3. Prasyarat Sistem (Prerequisites)

Sebelum melakukan instalasi NetX, pastikan sistem operasi Anda telah terinstal perangkat lunak berikut:

* **Python**: Versi **3.10** atau lebih tinggi.
  * [Unduh Python untuk Windows/macOS](https://www.python.org/downloads/)
  * *Catatan untuk Linux*: Biasanya Python sudah terinstal secara bawaan. Pastikan paket `python3-venv` dan `python3-pip` juga terinstal (`sudo apt install python3-venv python3-pip` untuk Debian/Ubuntu).
* **Node.js & npm**: Versi **18** atau lebih tinggi.
  * [Unduh Node.js](https://nodejs.org/) (disarankan versi LTS).
* **Git**: Versi terbaru untuk melakukan klon repositori.
  * [Unduh Git](https://git-scm.com/)

---

## 4. Panduan Instalasi di Windows

Anda dapat menginstal dan menjalankan NetX di Windows dengan dua metode:

### Metode A: Instalasi Otomatis (Direkomendasikan untuk Production/Uji Coba)

Kami menyediakan skrip otomatis (`.bat`) yang akan memaketkan (build) frontend React ke dalam file statis, membuat Virtual Environment Python, menginstal dependensi backend, dan menjalankan server web secara langsung.

1. Buka File Explorer dan masuk ke direktori proyek NetX.
2. Masuk ke folder `backend/` dan klik ganda berkas **`run_production.bat`**.
3. Skrip CMD akan terbuka dan melakukan langkah-langkah berikut secara otomatis:
   * Pindah ke folder `frontend/` dan mengompilasi kode React menggunakan Vite (`npm run build`).
   * Membuat Virtual Environment Python (`venv`) di folder `backend/venv` jika belum ada.
   * Menginstal dependency Python yang tertulis di `backend/requirements.txt`.
   * Menjalankan server web produksi FastAPI + Uvicorn pada alamat port `http://localhost:8000`.
4. Anda dapat mengakses NetX langsung dari browser melalui:
   * Komputer lokal: `http://localhost:8000`
   * Perangkat lain di jaringan yang sama: `http://<IP_KOMPUTER_WINDOWS>:8000`

---

### Metode B: Instalasi Manual (Disarankan untuk Pengembangan/Development)

Jika Anda ingin memodifikasi kode backend atau frontend (Hot Reload aktif), jalankan server backend dan frontend di dua terminal yang berbeda.

#### Langkah 1: Persiapan dan Menjalankan Backend
1. Buka **Command Prompt (CMD)** atau **PowerShell** dan masuk ke folder `backend`:
   ```cmd
   cd backend
   ```
2. Buat Python Virtual Environment (`venv`):
   ```cmd
   python -m venv venv
   ```
3. Aktifkan Virtual Environment:
   ```cmd
   venv\Scripts\activate
   ```
4. Upgrade pip dan instal semua dependensi backend:
   ```cmd
   pip install --upgrade pip
   pip install -r requirements.txt
   ```
5. Jalankan server backend FastAPI dengan fitur auto-reload:
   ```cmd
   python main.py
   ```
   *Server backend akan berjalan di `http://localhost:8000`.*

#### Langkah 2: Persiapan dan Menjalankan Frontend
1. Buka jendela terminal/CMD baru, lalu masuk ke folder `frontend`:
   ```cmd
   cd frontend
   ```
2. Instal semua paket Node.js yang diperlukan:
   ```cmd
   npm install
   ```
3. Jalankan server pengembangan Vite:
   ```cmd
   npm run dev
   ```
   *Frontend dev server akan berjalan di `http://localhost:5173`. Semua request API ke `/api/*` secara otomatis diarahkan (proxied) ke backend di port 8000.*

---

## 5. Panduan Instalasi di Linux dan macOS

Di sistem operasi Linux (Ubuntu, Debian, CentOS, dll.) dan macOS, Anda dapat melakukan instalasi secara manual dengan langkah-langkah berikut:

### Langkah 1: Persiapan Backend (Virtual Environment)
1. Buka aplikasi Terminal dan masuk ke direktori `backend`:
   ```bash
   cd backend
   ```
2. Buat Virtual Environment Python:
   ```bash
   python3 -m venv venv
   ```
3. Aktifkan Virtual Environment:
   ```bash
   source venv/bin/activate
   ```
4. Upgrade pip dan instal dependensi backend:
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

### Langkah 2: Kompilasi Aset Frontend (Production Mode)
Proses ini akan memaketkan kode React menjadi file statis (HTML, CSS, JS) di folder `frontend/dist`. Selanjutnya, server backend FastAPI akan menyajikan file tersebut secara otomatis pada port 8000.
1. Buka terminal baru atau keluar sejenak ke direktori root proyek, lalu masuk ke folder `frontend`:
   ```bash
   cd ../frontend
   ```
2. Instal paket Node.js:
   ```bash
   npm install
   ```
3. Lakukan kompilasi/build proyek frontend:
   ```bash
   npm run build
   ```

### Langkah 3: Menjalankan Server NetX
1. Kembali ke direktori `backend` dan pastikan virtual environment aktif:
   ```bash
   cd ../backend
   ```
   ```bash
   source venv/bin/activate
   ```
2. Jalankan server web Uvicorn:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```
3. Aplikasi kini aktif dan dapat diakses di browser Anda:
   * Akses Web UI: `http://localhost:8000`
   * Dokumentasi API (Swagger): `http://localhost:8000/api/docs`

---

### Langkah 4: Menjalankan NetX sebagai Background Service di Linux (Opsional)

Agar NetX tetap berjalan setelah terminal ditutup atau ketika server dimulai ulang (reboot), Anda dapat mendaftarkannya sebagai **Systemd Service** di Linux.

1. Buat berkas unit systemd baru:
   ```bash
   sudo nano /etc/systemd/system/netx.service
   ```
2. Tempelkan konfigurasi berikut (sesuaikan `/path/to/NetX` dengan lokasi asli folder Anda dan `username` Anda):
   ```ini
   [Unit]
   Description=NetX Network Management Platform Backend & Frontend Server
   After=network.target

   [Service]
   User=username
   WorkingDirectory=/path/to/NetX/backend
   ExecStart=/path/to/NetX/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```
3. Muat ulang systemd, aktifkan service saat startup, lalu jalankan service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable netx.service
   sudo systemctl start netx.service
   ```
4. Cek status service untuk memastikan semuanya berjalan normal:
   ```bash
   sudo systemctl status netx.service
   ```

---

## 6. Panduan Penggunaan Sistem (User Guide)

### 1. Login Pertama Kali
Ketika Anda pertama kali membuka `http://localhost:8000`, Anda akan diarahkan ke halaman login. Gunakan akun administrator default berikut:
* **Username**: `admin`
* **Password**: `netx@admin`

> [!WARNING]
> Demi keamanan sistem, **segera ubah kata sandi** administrator default setelah login pertama kali. Anda dapat mengubah kata sandi atau menambahkan akun pengguna baru pada menu **User Management**.

### 2. Membuat Profil Kredensial Global (Credentials)
Sebelum mendaftarkan perangkat, Anda perlu mendaftarkan profil kredensial (kombinasi username & password) yang digunakan untuk login ke switch/router di jaringan Anda.
1. Navigasi ke menu **Credentials** di sidebar.
2. Klik tombol **Add Credential**.
3. Isi **Credential Name** (misal: `SSH_Core_Switches`), serta isi **Username** dan **Password** perangkat Anda.
4. Klik **Save**. Kata sandi akan otomatis dienkripsi secara aman menggunakan enkripsi simetris Fernet sebelum disimpan ke database SQLite.

### 3. Mendaftarkan Perangkat Jaringan (Devices)
Setelah kredensial dibuat, Anda dapat menambahkan switch/router baru yang ingin dipantau:
1. Pergi ke menu **Devices**, klik **Add Device**.
2. Lengkapi formulir perangkat:
   * **Device Name**: Nama identitas unik untuk perangkat (misal: `Switch-Core-1`).
   * **IP Address**: IP address management perangkat yang dapat dijangkau dari server NetX.
   * **Device Type**: Tipe OS perangkat jaringan (misal: `cisco_ios` untuk Cisco IOS, `allied_telesis` untuk Allied Telesis AW+, `juniper_junos` untuk Juniper, dll.).
   * **Protocol**: Pilih `SSH` (port default 22) atau `Telnet` (port default 23).
   * **Credential Profile**: Pilih profil kredensial global yang telah Anda buat di langkah sebelumnya.
   * **Device Role**: Pilih peran perangkat (misalnya `Access Switch`, `Core Switch`, atau `Distribution Switch`).
3. Klik **Test Connection** untuk memverifikasi apakah server NetX berhasil melakukan login SSH/Telnet ke perangkat tersebut.
4. Jika sukses, klik **Save** untuk menyimpan perangkat.

### 4. Melakukan Sinkronisasi Data (Sync)
Agar visualisasi faceplate port dan data topologi terisi, NetX perlu mengambil data MAC address, tabel ARP, dan data tetangga LLDP/CDP langsung dari perangkat.
1. Masuk ke halaman detail perangkat dengan mengeklik nama perangkat di daftar.
2. Klik tombol **Sync Data** (atau **Sync Port Map**).
3. Backend akan menjalankan background thread untuk terhubung ke perangkat via SSH/Telnet, menjalankan perintah pengambilan data, mem-parsing hasilnya menjadi data terstruktur, dan memperbarui cache database SQLite.

### 5. Membaca Visualisasi Port (Switch Faceplate)
Di halaman detail perangkat, NetX menyajikan representasi visual port fisik switch layaknya Anda melihat switch fisik di rak server:
* **Warna Abu-abu (Slate)**: Port dalam status `Down` (tidak ada kabel terhubung atau port dimatikan).
* **Warna Hijau**: Port aktif (`Up`) dan terhubung ke komputer klien/host. Klik port tersebut untuk menampilkan informasi detail seperti:
  * Alamat MAC klien
  * Alamat IP klien (jika terdeteksi di tabel ARP)
  * Nama Vendor manufaktur (OUI Lookup - misal: Intel, Apple, HP)
  * Perkiraan jenis perangkat (misal: IP Phone, Camera, PC)
* **Warna Ungu**: Port merupakan tautan **Uplink** (terhubung ke switch/router lain). Dilengkapi dengan informasi identitas perangkat tetangga berdasarkan protokol LLDP atau CDP.
* **Warna Biru**: Port berstatus `Up` namun belum mempelajari MAC address klien (biasanya dalam proses inisialisasi).

### 6. Peta Topologi Interaktif (Topology)
Menu **Topology** memetakan seluruh switch yang terhubung satu sama lain secara dinamis:
* Jalur koneksi antar switch digambar otomatis berdasarkan data tetangga LLDP/CDP.
* Anda dapat menggeser posisi node (drag & drop) untuk merapikan visual topologi.
* Klik tombol **Save Positions** di pojok kanan atas agar susunan tata letak node yang telah Anda rapikan tidak kembali berantakan saat halaman dimuat ulang.

### 7. Menggunakan Terminal Web SSH (Web CLI)
NetX menyediakan terminal interaktif berbasis web yang aman untuk mengakses CLI perangkat secara langsung dari browser tanpa perlu aplikasi eksternal seperti PuTTY:
1. Pada detail perangkat (yang bertipe koneksi SSH), navigasikan ke tab **Web Terminal** (atau klik ikon Terminal).
2. Sistem akan membuka koneksi WebSocket (`/api/terminal/ws/...`) ke backend dan membuka shell interaktif paramiko ke switch Anda.
3. Anda dapat mengetikkan perintah konfigurasi langsung dari browser.

### 8. Otomatisasi Backup Konfigurasi (Device Backup)
NetX dapat menarik konfigurasi perangkat (*running-config*) secara berkala untuk tujuan backup dan melacak riwayat perubahan konfigurasi.
1. Masuk ke menu **Device Backup**.
2. Klik **Add Schedule** untuk membuat jadwal pencadangan baru.
3. Tentukan nama jadwal, pilih daftar perangkat yang ingin dibackup, frekuensi pencadangan (harian, mingguan, bulanan), dan waktu eksekusi.
4. NetX secara otomatis akan menarik konfigurasi switch sesuai jadwal.
5. Anda dapat melihat riwayat konfigurasi yang tersimpan dan membandingkan perbedaan baris teks konfigurasi (*Config Diff Viewer*) antar versi backup secara berdampingan.

> [!TIP]
> **Deteksi Perubahan Konfigurasi**: Pencadangan terjadwal maupun manual dilengkapi dengan fitur deteksi perubahan konfigurasi. Jika konfigurasi saat ini sama persis dengan versi pencadangan sukses sebelumnya, sistem tidak akan menyimpan versi baru ke database dan nomor versi tidak akan bertambah. Pada backup manual, pengguna akan menerima pesan informasi bahwa backup dilewati karena tidak ada perubahan.

### 9. Manajemen MIB SNMP & Kueri Kustom (SNMP OID Query)
NetX mendukung penambahan berkas MIB secara dinamis untuk memperluas kapabilitas kueri SNMP sesuai tipe vendor perangkat.
1. **Impor MIB**:
   - Masuk ke menu **Settings** -> **SNMP MIB Manager**.
   - Seret atau pilih berkas MIB (`.mib`, `.my`, `.txt`) pada area pengunggahan.
   - Isi deskripsi singkat dan tentukan asosiasi vendor perangkat (misal: `Cisco IOS` jika MIB khusus Cisco, atau `Semua Vendor (Global)` jika MIB bersifat standar industri).
   - Klik **Unggah & Parse**. Sistem akan membaca berkas, mengekstrak variabel OID, dan meresolusi pohon OID secara otomatis.
2. **Pengelolaan MIB**:
   - Anda dapat menonaktifkan (*toggle off*) MIB agar tidak digunakan sementara waktu tanpa menghapusnya.
   - Klik tombol **Objek** untuk membuka laci samping yang menampilkan daftar variabel OID hasil parsing lengkap dengan tipe syntax data dan deskripsinya.
3. **Kueri OID Kustom**:
   - Masuk ke menu **Settings** -> **SNMP Tester**.
   - Pilih tab **Kueri OID MIB Kustom**.
   - Pilih perangkat target Anda. Sistem secara otomatis mendeteksi vendor perangkat dan menyaring variabel OID aktif yang cocok untuk perangkat tersebut.
   - Pilih nama variabel OID dari dropdown (atau ketik OID manual). Rincian deskripsi OID terpilih akan tampil di bawahnya.
   - Pilih metode kueri **SNMP GET** (mengambil satu nilai) atau **SNMP WALK** (memindai seluruh sub-tree).
   - Klik **Jalankan Query OID** untuk menampilkan tabel hasil kueri SNMP dari perangkat secara real-time.

---

## 7. Troubleshooting & FAQ

#### Q: Mengapa proses sinkronisasi (Sync Data) memakan waktu lama atau gagal?
* **Penyebab 1**: Masalah konektivitas IP. Pastikan server NetX dapat melakukan `ping` ke IP address switch tersebut.
* **Penyebab 2**: Firewall memblokir port SSH (22) atau Telnet (23). Pastikan akses port tersebut diizinkan di switch dan di jaringan.
* **Penyebab 3**: Batasan sesi SSH pada switch (misalnya jumlah VTY line penuh). Coba bersihkan sesi VTY aktif pada perangkat Anda.

#### Q: Mengapa visualisasi Faceplate Port tidak menampilkan warna Hijau/Ungu?
* Pastikan Anda telah melakukan **Sync Data** pada perangkat tersebut.
* Pastikan jenis OS perangkat yang Anda pilih pada form saat menambahkan perangkat sudah tepat (misal: `cisco_ios` untuk Cisco). Parser NetX sangat bergantung pada tipe OS untuk memproses teks CLI secara tepat.

#### Q: Terjadi error `cryptography.fernet.InvalidToken` saat login atau sinkronisasi.
* **Penyebab**: Berkas enkripsi `backend/data/secret.key` terhapus, terubah, atau tidak cocok dengan data terenkripsi di database.
* **Solusi**: Jika Anda melakukan restorasi database dari sistem lain, pastikan Anda juga menyalin berkas `secret.key` yang sesuai dari sistem asal ke dalam folder `backend/data/`. Jika file `secret.key` hilang secara permanen, Anda harus mengupdate ulang password kredensial di menu **Credentials** agar disimpan kembali menggunakan kunci yang baru.

#### Q: Aplikasi menampilkan error "Database is locked" pada SQLite.
* NetX telah dioptimalkan dengan mode **Write-Ahead Logging (WAL)** untuk mendukung konkurensi pembacaan tinggi. Namun, jika terjadi operasi penulisan yang sangat padat secara bersamaan, database bisa terkunci sesaat. Hal ini normal dan sistem akan mencoba kembali dalam beberapa milidetik. Pastikan folder `backend/data/` memiliki hak akses tulis (write permissions) penuh bagi user yang menjalankan server web NetX.

---

## 8. Integrasi & Migrasi PostgreSQL

NetX mendukung migrasi database dari SQLite bawaan ke **PostgreSQL** untuk performa yang lebih andal dan terdistribusi.

### Langkah 1: Persiapan Server PostgreSQL
1. Siapkan sebuah instance database PostgreSQL aktif (lokal atau cloud).
2. Buat database baru khusus untuk NetX, misalnya bernama `netx`.
3. Pastikan port PostgreSQL (biasanya `5432`) dapat diakses dari server backend NetX.

### Langkah 2: Konfigurasi Koneksi di UI NetX
1. Masuk ke aplikasi NetX menggunakan akun **Administrator**.
2. Buka menu **Settings** -> **Integrasi PostgreSQL**.
3. Isi detail koneksi Anda:
   - **Host / IP**: Alamat IP server PostgreSQL Anda (misal: `localhost`).
   - **Port**: Port PostgreSQL (default: `5432`).
   - **Nama Database**: Nama database yang dibuat (misal: `netx`).
   - **Username**: Nama pengguna PostgreSQL (misal: `postgres`).
   - **Password**: Kata sandi pengguna PostgreSQL Anda.
   - **SSL Mode**: Pilih mode SSL yang sesuai (default: `prefer`).
4. Klik tombol **Uji Koneksi DB** untuk memastikan parameter koneksi yang dimasukkan sudah benar.
5. Klik **Simpan ke .env** untuk menulis konfigurasi tersebut ke berkas `.env` backend.

### Langkah 3: Melakukan Migrasi Data
Sebelum mengaktifkan engine PostgreSQL, jalankan script migrasi mandiri untuk mentransfer seluruh rekaman data (devices, users, credentials, logs, dll.) dari SQLite lokal ke PostgreSQL baru:
1. Jalankan CMD / Terminal, masuk ke folder `backend`.
2. Jalankan perintah migrasi berikut:
   ```cmd
   venv\Scripts\python migrate_data.py
   ```
3. Pastikan proses migrasi selesai dengan output `[+] Migrasi data berhasil diselesaikan!`.

### Langkah 4: Mengaktifkan PostgreSQL
1. Kembali ke halaman **Integrasi PostgreSQL** di UI NetX.
2. Klik tombol **Aktifkan PostgreSQL di .env**.
3. **Restart Server Backend NetX** (hentikan proses `run.bat` / `run_production.bat` dan jalankan kembali).
4. Aplikasi kini aktif berjalan menggunakan PostgreSQL!

---

## 9. Pemantauan Kesehatan Mandiri (Self-Health Monitoring)

NetX dilengkapi dengan dashboard **Kesehatan Sistem (Self-Health Monitoring)** untuk mengawasi kondisi kesehatan internal tool demi mencegah gangguan operasional.

### Cara Mengakses Dashboard Diagnosa
1. Masuk ke platform NetX sebagai **Administrator**.
2. Masuk ke menu **Settings** -> **Kesehatan Sistem**.

### Metrik yang Dipantau secara Real-time
*   **DB Query Latency (ms)**: Mengukur rata-rata kecepatan pembacaan dan penulisan query ke basis data (SQLite/PostgreSQL).
*   **Event Loop Lag (ms)**: Memantau delay pemrosesan event loop asinkron. Lag yang tinggi menunjukkan beban kerja CPU server yang padat.
*   **Scan Throughput**: Menghitung rata-rata jumlah pemindaian perangkat switch per menit.
*   **Disk Space**: Menampilkan kapasitas media penyimpanan server, sisa ruang kosong (dalam GB), dan ukuran berkas database lokal.

### Sistem Log Alert & Degradasi Performa
Dashboard ini dilengkapi dengan log alert otomatis yang akan mencantumkan komponen yang mengalami masalah apabila terjadi penurunan performa melewati batas threshold aman:
-   **Peringatan Latensi DB**: Muncul jika latensi query rata-rata > 100 ms (Warning) atau > 300 ms (Critical/Degraded).
-   **Peringatan Event Loop**: Muncul jika lag loop asinkron > 150 ms (Warning) atau > 500 ms (Critical/Degraded).
-   **Peringatan Disk Space**: Muncul jika kapasitas ruang penyimpanan kosong < 15% (Warning) atau < 5% (Critical/Degraded).
