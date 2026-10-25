# 🧛 Vampir & Köylü

Basit, mobil uyumlu, tarayıcıda çalışan çok oyunculu Vampir-Köylü (Mafia/Werewolf tarzı) oyunu.

## Özellikler

- 3-16 oyuncu
- Vampir sayısı seçilebilir
- Oda kodu / link ile katılım
- Gece: Vampirler ortak oy ile birini öldürür
- Gündüz: Tartışma süresi + oylama
- **Demo Modu**: Tek başına botlarla test edebilme
- Dark mode, sade arayüz
- Mobil öncelikli tasarım

## Kurulum (Yerel)

```bash
# Bağımlılıkları yükle
npm install

# Sunucuyu başlat
npm start
```

Tarayıcıda aç: **http://localhost:3000**

### Demo ile test etme
1. Ana menüden **"Demo Modu (Botlarla Test)"** butonuna tıkla
2. İsim gir
3. Oyun otomatik başlar, botlar seninle oynar
4. Vampir çıktıysan gece oyunu kullan, köylüysen tartışma + oy ver

### Gerçek çok oyunculu
1. Bir kişi **Oda Kur** → isim + ayarları seç → Odayı Oluştur
2. Çıkan **oda kodunu** veya **Linki Kopyala** ile diğerlerine gönder
3. Diğerleri **Odaya Katıl** → isim + kod gir
4. Herkes gelince Host **Oyunu Başlat** der

Aynı Wi-Fi'de veya localhost'ta birden fazla sekme/cihaz ile test edebilirsin.

## GitHub'a Yükleme & Yayınlama

1. Bu klasörü bir GitHub reposuna yükle
2. Backend için ücretsiz servis kullan (önerilen):
   - [Render.com](https://render.com) (ücretsiz Web Service)
   - [Railway.app](https://railway.app)
   - [Fly.io](https://fly.io)

### Render ile örnek:
- New → Web Service
- Repo'yu bağla
- Build: `npm install`
- Start: `npm start`
- Environment: `PORT` otomatik gelir

Sonra çıkan URL üzerinden herkes oynayabilir.

## Oyun Akışı

1. **Lobi** → Oyuncular katılır
2. **Rol Açıklama** (5 sn) → Vampirler birbirini görür
3. **Gece** → Sadece vampirler bir köylü seçer
4. **Tartışma** → Herkes konuşur (süre host tarafından kısaltılabilir)
5. **Oylama** → Çoğunluk oyuyla biri elenir
6. Kazanan belli olana kadar 3-5 tekrarı

**Kazanma:**
- Tüm vampirler elenirse → Köylüler kazanır
- Vampir sayısı ≥ kalan köylü sayısı olursa → Vampirler kazanır

## Teknoloji

- Node.js + Express
- Socket.io (gerçek zamanlı)
- Saf HTML / CSS / JS (framework yok)

---

İyi eğlenceler! 🩸
