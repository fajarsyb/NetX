# Detail Teknis Sistem NetX (Network Management Platform)

Dokumentasi ini memberikan penjelasan menyeluruh mengenai arsitektur, basis data, alur backend FastAPI, parser vendor, serta struktur antarmuka (frontend) SPA React yang menyusun platform **NetX**.

---

## 1. Arsitektur Sistem Global

Platform NetX dirancang menggunakan arsitektur **Client-Server** yang memisahkan backend pemrosesan data jaringan dengan visualisasi di frontend:

```mermaid
graph LR
    subgraph Frontend [React SPA Client]
        A[Dashboard / UI]
        B[Interactive Switch Faceplate]
        C[Topology SVG Graph]
    end

    subgraph Backend [FastAPI Server]
        D[FastAPI Router API]
        E[Netmiko Connection Handler]
        F[Multi-Vendor Parsers]
        G[OUI Lookup Service]
        H[Backup Scheduler]
    end

    subgraph Database [Database Storage (SQLite / PostgreSQL)]
        I[(netx.db / External Postgres)]
        J[secret.key - Fernet Key]
    end

    subgraph Network [Managed Network Devices]
        K[Cisco Devices]
        L[Allied Telesis AW+]
        M[Juniper / Ruijie / Mikrotik]
    end

    A <-->|HTTP REST / JWT| D
    D <--> I
    E <-->|SSH / Telnet| K & L & M
    E -->|Raw CLI Outputs| F
    F -->|Structured Data| I
    H -->|Background Jobs| E
    D -->|OUI Prefix Lookup| G
```

---

## 2. Skema & Model Basis Data (SQLite / PostgreSQL)

NetX mendukung arsitektur basis data ganda (**Multi-Engine Database**) yang dapat dikonfigurasi melalui berkas `.env` dengan opsi `DB_ENGINE=sqlite` atau `DB_ENGINE=postgresql`.

*   **SQLite (Lokal)**: Konfigurasi bawaan untuk kemudahan deployment tanpa setup eksternal. Dioptimalkan dengan mode **Write-Ahead Logging (WAL)** (`PRAGMA journal_mode=WAL;`) serta penegakan integritas kunci asing (`PRAGMA foreign_keys=ON;`).
*   **PostgreSQL (Eksternal)**: Opsi performa tinggi terdistribusi yang direkomendasikan untuk instalasi produksi dengan konkurensi penulisan tinggi (seperti syslog server). Menggunakan pooling koneksi thread-safe (`ThreadedConnectionPool`).

Berikut adalah relasi utama tabel-tabel di dalam `netx.db`:

### A. Autentikasi & Log Audit
* **`users`**: Menyimpan pengguna platform. Password di-hash menggunakan **bcrypt** (`$2b$`).
* **`audit_logs`**: Mencatat riwayat aksi pengguna (misalnya: pembuatan perangkat, sinkronisasi port, modifikasi konfigurasi backup) untuk keperluan audit kepatuhan.

### B. Konfigurasi Perangkat
* **`devices`**: Tabel pusat yang menyimpan informasi perangkat jaringan (IP, protocol SSH/Telnet, port, custom commands, model hardware, nomor seri, dan versi OS).
* **`device_groups`**: Hirarki grup perangkat (bertipe pohon/tree) yang didukung oleh referensi mandiri (`parent_id REFERENCES device_groups(id)`).
* **`device_credentials`**: Tempat penyimpanan kredensial global. Password disimpan terenkripsi secara simetris di database menggunakan modul **Fernet (cryptography)** dan kunci eksternal `secret.key`.

### C. Cache Hasil Scanning (Topology & Port Mapping)
* **`arp_cache`**: Menyimpan hasil resolusi IP-ke-MAC dari switch, lengkap dengan OUI vendor dan kategori perangkat (misal: IP Phone, Router).
* **`mac_addresses`**: Menyimpan tabel alamat MAC yang dipelajari pada port fisik switch (`show mac address-table`).
* **`lldp_neighbors` & `cdp_neighbors`**: Menyimpan data relasi ketetanggaan antar switch (neighbor) yang diperoleh dari LLDP dan CDP.
* **`routing_table`**: Cache rute aktif (`show ip route`) untuk memantau gateway dan rute keluar.
* **`topology_positions`**: Koordinat koordinasi visual ($x, y$) untuk node di halaman peta topologi SVG jaringan.

### D. Otomatisasi Backup
* **`device_config_backups`**: Menyimpan riwayat revisi konfigurasi startup/running config yang ditarik dari perangkat.
* **`device_backup_schedules`**: Menyimpan jadwal penarikan backup otomatis (harian, mingguan, dll.) dengan perhitungan waktu eksekusi berikutnya (`next_run`).

### E. Manajemen SNMP MIB
* **`snmp_mibs`**: Menyimpan metadata dari berkas MIB SNMP yang diimpor oleh pengguna (nama MIB, deskripsi, asosiasi vendor perangkat, status aktif).
* **`snmp_mib_objects`**: Menyimpan data objek OID yang berhasil diparsing dari berkas MIB (nama objek, OID absolut bertitik, tipe sintaks, dan deskripsi).

### F. Monitoring, Alerting & Syslogs
* **`network_anomalies`**: Menyimpan log alert aktif dan riwayat anomali jaringan (storms, flapping, L2 STP changes, dan auth failures).
* **`interface_stats_latest`**: Menyimpan snapshot counter paket interface SNMP untuk menghitung laju delta dan flapping status operasional port.
* **`mac_history_tracking`**: Mencatat lokasi penempatan port MAC address terakhir demi memantau kejadian perpindahan MAC (MAC flapping).
* **`device_syslogs`**: Menyimpan pesan log syslog dari perangkat jaringan masuk dengan informasi facility, severity, program, timestamp, dan pesan mentah.

---

## 3. Detail Backend & Modul Layanan (Services)

Backend NetX dibangun menggunakan **FastAPI** (Python 3.10+) dengan pustaka pembantu utama **Netmiko** untuk interaksi terminal.

### A. Konektivitas & Manajemen Sesi (connector.py)
NetX mengeksekusi perintah terminal secara sinkronous menggunakan Netmiko. Agar server API FastAPI tidak terblokir selama proses SSH/Telnet yang membutuhkan waktu lama, NetX menjalankan sesi Netmiko di dalam Thread Pool menggunakan `asyncio.to_thread`:
```python
async def connect_and_run(device_dict: dict, password: str, command: str) -> str:
    return await asyncio.to_thread(_run_sync, device_dict, password, command)
```
Sesi koneksi mendukung enkripsi kredensial otomatis dan negosiasi port (port 22 untuk SSH dan 23 untuk Telnet).

### B. Sistem Parser Teks CLI Vendor
Untuk menyatukan output CLI dari berbagai vendor yang berbeda format, NetX menerapkan parser modular di bawah folder `backend/app/services/`:
1. **mac_parser.py**: Mengekstrak VLAN, MAC Address, tipe entri (static/dynamic), dan port fisik. Mendukung vendor Cisco, Juniper, Ruijie, HP, Allied Telesis, Ruckus, dll.
2. **arp_parser.py**: Mengekstrak pemetaan IP, MAC, Interface, dan Age. Dilengkapi generic fallback berbasis pencarian regex pasangan IP-MAC jika tipe vendor tidak terdaftar.
3. **lldp_parser.py**: Parser LLDP tergolong kompleks karena harus membaca blok teks berindentasi. Dilengkapi dengan tokenisasi block-based dan fallback pencarian tabel berkolom tetap (fixed column offsets) menggunakan pemetaan indeks string.
4. **cdp_parser.py**: Mengekstrak tetangga jaringan berbasis protokol CDP (Cisco proprietary/emulasi).
5. **routing_parser.py**: Membaca tabel routing langsung (direct), statik, maupun protokol dinamis (OSPF/BGP).

### C. OUI Lookup & Klasifikasi Perangkat (oui_lookup.py)
NetX memiliki berkas basis data manufaktur OUI lokal. Ketika alamat MAC dipelajari dari ARP/MAC table, sistem memecah 6 digit pertama MAC address untuk menemukan vendor (misal: `00:50:56` -> `VMware, Inc.`).
Layanan ini juga menyematkan algoritma heuristik klasifikasi perangkat (`device_hint`):
* Jika nama vendor mengandung kata "Cisco", "Juniper", "Huawei", "Switch" -> Dikategorikan sebagai **Network Device**.
* Jika mengandung "D-Link", "Tp-Link", "Ubiquiti" -> Dikategorikan sebagai **Access Point / IoT**.
* Jika mengandung "Hikvision", "Dahua" -> Dikategorikan sebagai **IP Camera**.
* Jika mengandung "Avaya", "Polycom", "Yealink" -> Dikategorikan sebagai **IP Phone**.

### D. Backup Scheduler & Deteksi Perubahan (device_backup_service.py)
Scheduler berjalan sebagai background task asinkron saat FastAPI melakukan *startup*. Scheduler ini bangun setiap 60 detik untuk memeriksa apakah ada jadwal backup aktif di `device_backup_schedules` yang nilai `next_run`-nya telah terlewati. Jika cocok, scheduler memicu thread pool untuk menarik konfigurasi switch target.

Sistem backup—baik yang dieksekusi secara otomatis oleh scheduler maupun yang dipicu secara manual oleh pengguna (melalui router API `device_backup.py`)—dilengkapi dengan mekanisme **Deteksi Perubahan Konfigurasi**. Sebelum menyimpan versi baru ke database:
1. Sistem membandingkan output konfigurasi saat ini dengan versi pencadangan sukses terakhir di tabel `device_config_backups`.
2. Jika tidak terdeteksi adanya perbedaan baris konfigurasi, sistem akan melewati (*skip*) proses penyimpanan versi baru, sehingga nomor versi tidak bertambah. Kejadian ini dicatat dalam log audit dengan status `DEVICE_BACKUP_SKIPPED`.
3. Jika terdapat perubahan, versi baru disimpan dan dicatat dalam log audit sebagai `DEVICE_BACKUP_SUCCESS` dengan referensi nama pengguna yang memicunya (untuk backup manual) atau nama pengguna `"system"` (untuk backup terjadwal).

### E. MIB Parser & Resolver (mib_parser.py)
NetX menyediakan parser asinkron khusus yang bertugas membersihkan komentar berkas MIB (sintaks `--`) dan mem-parsing blok definisi `OBJECT-TYPE` serta `OBJECT IDENTIFIER` menjadi representasi data terstruktur (nama, syntax, parent, subid, description). OID relatif yang diperoleh (misal: `{ enterprises 9 }`) kemudian dirunut secara rekursif hingga membentuk absolute dotted OID menggunakan daftar standard root OID bawaan dan referensi antar-MIB dari database untuk mendukung dependensi antar berkas MIB.

### F. Anomaly Detection Service (anomaly_detector.py)
Mesin detektor asinkron yang memantau switch jaringan dengan polling SNMP periodik (setiap 60 detik) untuk mendeteksi:
- **Broadcast/Multicast/Unicast Storms**: Menganalisis laju paket per detik (pps) delta.
- **Port Flapping**: Melacak frekuensi transisi status interface `up/down` dalam jendela waktu 5 menit.
- **L2 STP Topology Changes**: Mengawasi kenaikan counter `dot1dStpTopChanges`.
- **MAC Flapping**: Mendeteksi jika MAC address yang sama berpindah antarantarmuka dalam waktu kurang dari 15 menit.

### G. Syslog Server (syslog_server.py)
Server Syslog UDP asinkron terintegrasi yang mendengarkan pada port standard **514** (atau fallback port **5140**). Server ini melakukan:
- **Real-Time Parser**: Memecah log menjadi PRIVAL, severity, facility, program tag, dan message body.
- **Real-Time Anomaly Trigger**: Membaca isi syslog secara real-time dan langsung memicu alert keamanan/flapping ketika log link status atau auth failure terdeteksi.
- **Automatic Retention Cleanup**: Scheduler background asinkron yang berjalan harian untuk menghapus data log yang berumur lebih dari 30 hari guna menghemat ruang penyimpanan SQLite.

---

## 4. Alur Kerja Port Mapping (Heuristic Resolver)

Fungsi paling bernilai dari NetX adalah **Port-to-Host Resolver** yang terdapat pada router `devices.py`. Alur resolver ini berjalan sebagai berikut untuk setiap perangkat (switch):

```text
[Request Device Port Map]
       │
       ├─► 1. Ambil MAC addresses yang dipelajari di switch (mac_addresses)
       │
       ├─► 2. Ambil cache ARP global (arp_cache) untuk merelasikan MAC ke IP
       │
       ├─► 3. Ambil cache LLDP & CDP untuk mendeteksi link ketetanggaan (Uplink)
       │
       ▼
[Looping untuk Setiap Port Switch]
       │
       ├─► Apakah port ini terhubung ke tetangga LLDP/CDP?
       │   ├── YA  ──► Tandai sebagai UPLINK (Ungu di UI)
       │   └── TIDAK ──► Lanjutkan
       │
       ├─► Temukan semua MAC Address yang aktif di port ini
       │   ├── Hubungkan MAC dengan tabel ARP untuk mendapatkan IP Address
       │   ├── Cari Nama Manufaktur (OUI) berdasarkan awalan MAC
       │   └── Masukkan daftar Host ini ke dalam port (Hijau/Biru di UI)
       │
       ▼
[Return Port Map JSON Structured Array]
```

---

## 5. Struktur Frontend (React SPA)

Frontend dibangun menggunakan **Vite** + **React** (Javascript SPA) dengan CSS murni berkualitas premium (vanilla CSS + glassmorphic dark mode).

### A. Halaman Utama (Pages)
1. **`Dashboard`**: Menyediakan metrik ringkasan (Total perangkat, online/offline, statistik distribusi manufaktur perangkat terhubung, log backup terbaru).
2. **`DeviceDetail`**: Halaman paling detail yang menampilkan:
   - Panel switch faceplate (visualisasi port ganjil di atas, genap di bawah).
   - Tabel interaktif port map dengan fitur pencarian real-time untuk MAC/IP/Vendor/Neighbor.
   - Tab riwayat konfigurasi backup dengan fitur komparasi visual (Diff Viewer) antar versi.
   - Sesi terminal SSH interaktif di web browser.
3. **`Topology`**: Memetakan hubungan fisik antar switch menggunakan visualisasi grafis SVG. Node dapat digeser dan koordinat posisi disimpan ke backend SQLite agar layout tidak berubah saat dimuat kembali.
4. **`MacInvestigation`**: Memungkinkan administrator melacak jejak MAC address tertentu; mendeteksi di switch mana dan port mana MAC tersebut aktif dari waktu ke waktu.
5. **`MibManagement`**: Dashboard pengunggahan berkas MIB (serta parsing otomatis), pengelolaan aktivasi, dan pemetaan vendor perangkat. Menampilkan list objek hasil parsing dalam drawer interaktif.
6. **`SnmpTester`**: Menyediakan panel pengetesan SNMP dasar (sysDescr / sysUpTime) dan tab kueri kustom OID. Tab kueri kustom ini memuat variabel OID aktif yang dicocokkan otomatis berdasarkan vendor dari perangkat terdaftar yang dipilih.
7. **`NetworkAnomalies`**: Dasbor pusat untuk memantau status kesehatan jaringan dengan pemisahan anomali kritis/peringatan (storms, flapping, security auth fail) yang aktif saat ini serta daftar pencarian log anomali historis.
8. **`SyslogViewer`**: Layar log log terpusat terpaginasi dengan pemilahan level severity syslog (RFC 3164), pencarian teks penuh, toggle auto-refresh 5 detik, dan pembersihan log massal.

### B. Komponen Visualisasi Port Switch (PortMapper.jsx)
Komponen ini bertanggung jawab untuk merender visual panel port fisik switch.
* **Heuristik Filtrasi**: Port dikelompokkan menjadi fisik vs virtual menggunakan regex nama antarmuka. Port virtual seperti `Vlan1`, `Loopback0`, atau `Null0` dikeluarkan dari gambar faceplate.
* **Logika Grid Ganjil-Genap**:
  Port diurutkan secara natural menggunakan komparator lokal, lalu baris ganjil dipisahkan ke baris atas dan genap di baris bawah untuk mensimulasikan panel fisik switch di rak server secara nyata.
* **Gaya Warna Dinamis**:
  - **Abu-abu / Slate**: Port berstatus `down` (kosong).
  - **Ungu**: Port terdeteksi memiliki tetangga LLDP/CDP (Uplink utama switch-to-switch).
  - **Hijau**: Port aktif dan dihuni oleh minimal 1 host/klien.
  - **Biru**: Port aktif (`up`) namun belum mempelajari MAC address klien.

---

## 6. Integrasi PostgreSQL & Translasi Query Dinamis (database.py)

NetX menyematkan modul **Database Driver Wrapping** di dalam [database.py](file:///c:/Code/Auto/NetX/backend/app/database.py) agar aplikasi tetap berbasis kode tunggal (Single-Codebase) namun mampu melayani dua database engine yang berbeda:

*   **`PostgreSQLConnectionWrapper` & `PostgreSQLCursorWrapper`**:
    Ketika menggunakan driver `psycopg2` untuk PostgreSQL, cursor wrapper akan mencegat (*intercept*) pemanggilan query SQL secara transparan sebelum dikirim ke database:
    1.  **Konversi Parameter**: Mengubah otomatis placeholder penanda parameter SQLite (`?`) menjadi format PostgreSQL (`%s`).
    2.  **Modifikasi Kueri**: Menghapus opsi collation khusus SQLite (`COLLATE NOCASE`), mengubah operator `LIKE` menjadi `ILIKE` demi pencarian case-insensitive, serta mendeteksi query `INSERT OR REPLACE INTO interface_stats_latest` lalu menulis ulang ke klausul PostgreSQL native `ON CONFLICT (...) DO UPDATE SET...` (UPSERT).
    3.  **Simulasi `lastrowid`**: Menjalankan query internal `SELECT lastval();` pada akhir eksekusi `INSERT` untuk mensimulasikan properti `lastrowid` SQLite.
*   **`DictLikeRow`**:
    Subclass `dict` kustom yang menyusun hasil baris query. Class ini dirancang agar mendukung pemanggilan data mirip dictionary (`row["ip"]`) dan pemanggilan berbasis index posisi kolom (`row[0]`) secara bersamaan. Hal ini memelihara kompatibilitas penuh dengan kode logic bawaan NetX.

---

## 7. Pipeline Diagnosa & Kesehatan Mandiri (Self-Health Monitor)

Sistem **Self-Health Monitoring** berjalan secara real-time untuk menjamin operator tidak terganggu oleh degradasi performa server:

*   **Pengumpul Diagnosa ([health_monitor.py](file:///c:/Code/Auto/NetX/backend/app/services/health_monitor.py))**:
    Sebuah *singleton service* di backend yang memantau metrik berikut:
    -   **DB Query Latency**: Diukur langsung di dalam decorator wrapper `SQLiteCursorWrapper` dan `PostgreSQLCursorWrapper` dengan menghitung selisih durasi `perf_counter()` sebelum dan sesudah eksekusi query.
    -   **Event Loop Lag**: Sebuah tugas asinkron (`start_event_loop_monitor`) di event loop utama yang tidur setiap 2 detik dan mengukur selisih waktu bangun riil (sleep drift).
    -   **Throughput Scan**: Analyzer mencatat scan yang selesai (`record_scan_completed`) untuk menghitung rata-rata laju scan per menit.
    -   **Disk Usage**: Menggunakan modul python `shutil` untuk memantau kapasitas penyimpanan media disk dan ukuran file database SQLite.
*   **Peta Alur Data Diagnosa**:
    ```text
    [Cursor Wrapper Latency] ──┐
    [Loop Monitor Sleep]      ──┼─► [health_monitor.py] ─► [health.py API] ─► [SystemHealth.jsx UI]
    [Scanner Completes]       ──┤
    [shutil.disk_usage()]     ──┘
    ```
