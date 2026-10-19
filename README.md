# Biya Nutrisi

Aplikasi pemantau kecukupan nutrisi untuk pasien yang menjalani **diet cair** (mis. Nutrican dan Fresubin). Dipakai bersama oleh pasien dan pendamping di HP masing-masing, dengan data yang tersinkron.

> Aplikasi ini alat bantu pemantauan, **bukan pengganti dokter**. Target dari dokter/ahli gizi selalu didahulukan di atas hasil rumus.

## Fitur

- **Target harian** energi, protein, dan cairan dihitung dari berat dan tinggi badan, usia, aktivitas, dan kondisi medis (fungsi ginjal, diabetes, batasan cairan, risiko *refeeding*). Bisa diganti dengan target dari dokter.
- **Catat minum** per ml atau per porsi. Kalori, protein, karbohidrat, lemak, vitamin, dan mineral dihitung otomatis dari data produk.
- **Foto label produk → AI** membaca tabel Informasi Nilai Gizi. Hasilnya diperiksa dulu sebelum disimpan, dan bisa diubah kapan saja bila formula produk berubah.
- **Minum berikutnya**: saran jam, produk, dan jumlah ml supaya target tercapai, dengan batas volume sekali minum.
- **Pengingat** di jam jadwal, pengingat sekali ("ingatkan 2 jam lagi"), dan **peringatan ke pendamping** bila jadwal terlewat.
- **Catatan gejala** (mual, muntah, begah, diare, nyeri) dan **tanda bahaya**. Tanda bahaya langsung mengirim notifikasi ke anggota keluarga lain.
- **Evaluasi AI** kecukupan nutrisi (hari ini + tren 7 hari, berat badan, gejala, lab) dan **saran AI** untuk minum berikutnya.
- Riwayat berat badan, hasil lab, dan tren kecukupan 7/14/30 hari.

## Dasar perhitungan

| Komponen | Rumus | Sumber |
|---|---|---|
| Energi | 25 / 28 / 30 kkal/kg (berbaring / terbatas / aktif) | ESPEN 2021, pasien kanker: 25–30 kkal/kg/hari |
| Protein | 1,2 g/kg (rentang 1,0–1,5); gangguan ginjal 1,0; dialisis 1,2–1,5 | ESPEN 2021 |
| Cairan | 35 ml/kg (≤55 th), 30 (56–75 th), 25 (>75 th); dibatasi bila ada batasan dokter | Praktik klinis umum |
| Berat untuk rumus | BB aktual; bila IMT ≥30 memakai BB terkoreksi | — |
| Risiko refeeding | Kriteria NICE; risiko tinggi → mulai 10 kkal/kg (sangat tinggi 5 kkal/kg), naik bertahap 5–7 hari | NICE CG32 |
| Kaheksia | Turun BB >5% dalam 6 bulan, atau >2% dengan IMT <20 | Fearon dkk. 2011 |
| Vitamin & mineral | AKG 2019 perempuan sesuai usia | Permenkes No. 28/2019 |

Rumus ada di `src/shared/targets.ts` dan tabel AKG di `src/shared/akg.ts`. Mohon nilai AKG dicocokkan dengan dokumen Permenkes sebelum dijadikan acuan klinis.

## Arsitektur

- **Aplikasi web (PWA)** React + Vite. Di iPhone dipasang lewat *Tambahkan ke Layar Utama* sehingga bisa menerima notifikasi (iOS 16.4+).
- **Server**: Cloudflare Workers + database D1 (paket gratis). Server menyimpan data bersama, menjalankan pengecekan pengingat setiap menit, mengirim Web Push, dan memanggil API Anthropic.
- **API key Anthropic disimpan sebagai secret di server**, tidak pernah dikirim ke HP.
- Login memakai satu **kata sandi keluarga**. Setiap orang memilih nama dan peran (pasien/pendamping).

## Cara pasang (tanpa komputer, lewat GitHub)

### 1. Siapkan akun & kunci

1. **Cloudflare**: daftar gratis di <https://dash.cloudflare.com>. Buka menu **Workers & Pages** sekali supaya subdomain `*.workers.dev` dibuat.
2. **Account ID Cloudflare**: ada di halaman *Workers & Pages* (kolom kanan) atau di URL dashboard.
3. **API Token Cloudflare**: *My Profile → API Tokens → Create Token →* template **Edit Cloudflare Workers**. Tambahkan izin **Account → D1 → Edit**, lalu buat token.
4. **API key Anthropic**: <https://console.anthropic.com> → *API Keys*. Isi saldo/kredit di sana.
5. Tentukan **kata sandi keluarga** yang kuat (minimal 12 karakter).

### 2. Simpan sebagai secret di GitHub

Repo ini → **Settings → Secrets and variables → Actions → New repository secret**, isi keempatnya:

| Nama | Isi |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token dari langkah 1.3 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID dari langkah 1.2 |
| `ANTHROPIC_API_KEY` | API key Anthropic |
| `FAMILY_PASSWORD` | kata sandi keluarga |

### 3. Deploy

Tab **Actions → Deploy ke Cloudflare → Run workflow**. Setelah selesai (±2 menit), alamat aplikasi tercantum di log langkah *Deploy Worker*, misalnya `https://biya-nutrition.<nama-anda>.workers.dev`.

Jalankan workflow yang sama setiap kali ada pembaruan kode atau setelah mengganti secret.

### 4. Pasang di iPhone (lakukan di kedua HP)

1. Buka alamat aplikasi di **Safari**.
2. Tekan tombol **Bagikan** → **Tambahkan ke Layar Utama**.
3. Buka **Biya Nutrisi** dari ikon di Layar Utama, lalu masuk dengan nama, peran, dan kata sandi keluarga.
4. Menu **Jadwal → Aktifkan notifikasi → Izinkan**, lalu tekan **Kirim tes**.
5. Pastikan mode Fokus/Jangan Ganggu tidak memblokir notifikasi aplikasi ini.

### 5. Langkah pertama di aplikasi

1. **Pasien**: isi usia, tinggi badan, BB biasa sebelum sakit, aktivitas, kondisi medis, dan target dokter bila ada. Catat **berat badan** hari ini, dan bila ingat, BB 1–6 bulan lalu.
2. **Produk → Foto label (AI)**: foto tabel gizi Nutrican dan Fresubin yang dipakai, periksa angkanya, lalu simpan. Untuk produk bubuk, isi **volume siap minum** setelah dilarutkan.
3. **Jadwal → Otomatis**: buat jadwal dari jam bangun sampai tidur. Jumlah ml per jadwal dihitung dari target.
4. Setiap selesai minum: **Hari Ini → Catat minum** (atau *Catat sesuai saran*).

## Biaya

- **Cloudflare**: paket gratis cukup untuk satu keluarga (100.000 request/hari). Bila suatu saat muncul error batas CPU, naikkan ke Workers Paid (USD 5/bulan).
- **Anthropic API**: dibayar per pemakaian. Model bawaan `claude-opus-5-5`. Perkiraan kasar: USD 0,05–0,15 per evaluasi dan USD 0,03–0,07 per foto label. Untuk menghemat sekitar separuhnya, ganti `ANTHROPIC_MODEL` di `wrangler.toml` menjadi `claude-sonnet-5-5`, lalu deploy ulang.

## Privasi

Data tersimpan di database Cloudflare D1 milik akun Anda. Saat fitur AI dipakai, ringkasan data pasien dan foto label dikirim ke API Anthropic untuk diproses. Ganti `FAMILY_PASSWORD` dan deploy ulang untuk mengeluarkan semua perangkat yang sedang masuk.

## Pengembangan lokal

```bash
npm install
cp .dev.vars.example .dev.vars       # isi FAMILY_PASSWORD & ANTHROPIC_API_KEY
npm run db:migrate:local
npm run build && npx wrangler dev --test-scheduled   # http://localhost:8787
npm test
```

Selama `wrangler dev` berjalan, `npm run dev` menjalankan Vite dengan hot reload di port 5173 (API diteruskan ke 8787). Pengecekan pengingat bisa dipicu manual lewat `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`.

Deploy dari komputer (alternatif GitHub Actions):

```bash
npx wrangler login
npx wrangler d1 create biya-nutrition         # salin database_id ke wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put FAMILY_PASSWORD
npm run deploy
```
