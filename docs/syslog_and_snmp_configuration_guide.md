# Panduan Konfigurasi Syslog dan SNMP Perangkat Jaringan (Cisco, Allied Telesis, Juniper, Ruijie)

Untuk memastikan platform **NetX** dapat menerima pesan Syslog secara real-time dan melakukan kueri SNMP untuk mendeteksi anomali jaringan, Anda harus mengonfigurasi pengaturan logging (syslog) dan SNMP pada setiap perangkat switch/router di jaringan Anda.

Berikut adalah langkah-langkah konfigurasi pada berbagai vendor perangkat populer, serta persiapan di sisi server NetX.

---

## 1. Persiapan Server NetX

### A. Konfigurasi Port & Hak Akses
1. **Windows Server**: Server NetX akan secara otomatis mendengarkan pada port UDP **514**. Pastikan port ini tidak digunakan oleh aplikasi syslog server lain. Jika Anda tidak memiliki hak akses administrator, server akan mencoba mengikat ke port alternatif UDP **5140**.
2. **Linux Server**: Pada sistem Linux/Unix, port di bawah 1024 (termasuk 514) adalah port istimewa (*privileged*). Anda harus menjalankan server FastAPI menggunakan hak akses `sudo` (atau memetakan port 514 ke 5140 menggunakan iptables).

### B. Konfigurasi Firewall Server
Anda harus membuka port-port berikut di Firewall Server NetX agar dapat menerima trafik:
- **UDP Port 514** (atau **5140**): Untuk menerima Syslog masuk dari perangkat jaringan.
- **UDP Port 161**: Untuk lalu lintas kueri SNMP (SNMP GET/WALK) antara server NetX dan perangkat jaringan.

---

## 2. Panduan Konfigurasi Perangkat (Switch / Router)

Ganti teks `<IP_SERVER_NETX>` dengan alamat IP dari server NetX Anda, dan `<COMMUNITY_STRING>` dengan kata sandi komunitas SNMP yang Anda tentukan (misalnya: `public` atau `netx_read`).

### A. Cisco IOS / IOS-XE
Masuk ke mode konfigurasi global (`configure terminal`) pada CLI Cisco, lalu jalankan perintah berikut:

```text
! 1. Konfigurasi Syslog (Logging)
logging host <IP_SERVER_NETX>
logging trap informational
logging source-interface <INTERFACE_MANAGEMENT_IP>
service timestamps log datetime msec

! 2. Konfigurasi SNMP (Read-Only)
snmp-server community <COMMUNITY_STRING> RO
```

*Catatan: `logging trap informational` memastikan perangkat mengirimkan log link status (up/down) yang memiliki tingkat severity 3 s.d 5 ke server NetX.*

---

### B. Allied Telesis (AlliedWare Plus / AW+)
Masuk ke mode konfigurasi global (`configure terminal`) pada CLI Allied Telesis, lalu jalankan perintah berikut:

```text
! 1. Konfigurasi Syslog (Logging)
log host <IP_SERVER_NETX>
log host <IP_SERVER_NETX> level informational

! 2. Konfigurasi SNMP (Read-Only)
snmp-server community <COMMUNITY_STRING> ro
```

---

### C. Juniper Networks (Junos OS)
Masuk ke mode konfigurasi (`configure`) di CLI Juniper Junos, lalu jalankan perintah berikut:

```text
# 1. Konfigurasi Syslog (Logging)
set system syslog host <IP_SERVER_NETX> any informational
set system syslog host <IP_SERVER_NETX> match ".*"

# 2. Konfigurasi SNMP (Read-Only)
set snmp community <COMMUNITY_STRING> authorization read-only
```
Setelah selesai, ketik `commit` untuk menerapkan perubahan.

---

### D. Ruijie Networks (RGOS)
Masuk ke mode konfigurasi global (`configure terminal`) pada CLI Ruijie, lalu jalankan perintah berikut:

```text
! 1. Konfigurasi Syslog (Logging)
logging server <IP_SERVER_NETX>
logging severity informational

! 2. Konfigurasi SNMP (Read-Only)
snmp-server community <COMMUNITY_STRING> ro
```

---

## 3. Cara Kerja Deteksi Anomali Real-Time via Syslog pada NetX

Ketika Anda selesai mengonfigurasi petunjuk di atas, setiap kali terjadi kejadian di bawah ini, perangkat akan langsung mengirimkan paket log UDP ke NetX, yang kemudian segera dianalisis secara real-time oleh server:

1. **Port Flapping (Link Up/Down)**:
   Saat kabel dicabut atau port dimatikan, log status port akan dikirim. NetX akan mencatat anomali port down secara instan. Jika port berulang kali naik dan turun (flapping) sebanyak 3 kali dalam waktu 5 menit, status anomali port flapping akan naik level menjadi alert.
2. **Layer 2 Spanning Tree (STP) Topology Change**:
   Jika ada perangkat switch tambahan dicolokkan tanpa konfigurasi yang benar dan memicu kalkulasi ulang pohon Spanning Tree (TCN), syslog akan ditangkap dan NetX akan memicu anomali `stp_tcn` agar operator segera waspada akan adanya potensi loop.
3. **Authentication Failure (Kegagalan Login / Serangan Bruteforce)**:
   Bila ada upaya login ilegal ke CLI switch dengan password salah, pesan kegagalan autentikasi (`IA_AUTH_FAIL` atau `authentication failed`) akan dikirimkan. NetX akan segera menaikkan anomali keamanan dengan Severity tingkat **Critical**.
