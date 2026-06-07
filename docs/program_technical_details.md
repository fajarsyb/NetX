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

    subgraph Database [SQLite Storage]
        I[(netx.db)]
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

## 2. Skema & Model Basis Data (SQLite)

NetX menggunakan SQLite yang dioptimalkan dengan mode **Write-Ahead Logging (WAL)** (`PRAGMA journal_mode=WAL;`) serta penegakan integritas kunci asing (`PRAGMA foreign_keys=ON;`).

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
