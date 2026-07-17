# Swotly — iPhone'da Çalıştırma Rehberi

Notlarını AI ile analiz edip günlük spaced-repetition seansları üreten British English çalışma uygulaması. Bu rehber seni sıfırdan, uygulamayı kendi iPhone'unda çalışır hâle getirir. Yaklaşık 20 dakika sürer, Mac şart değil (Windows da olur).

## 1. Gerekenler (bir kere)

1. **Node.js** kur: https://nodejs.org → "LTS" sürümünü indir, kur.
2. iPhone'una App Store'dan **Expo Go** uygulamasını indir (ücretsiz).
3. Bilgisayar ve iPhone **aynı Wi-Fi ağında** olsun.
4. **Anthropic API anahtarı** al: https://console.anthropic.com → API Keys → Create Key. (`sk-ant-` ile başlar; analiz başına maliyet birkaç kuruş.)

## 2. Projeyi oluştur

Terminal'i aç (Windows'ta PowerShell) ve sırayla:

```bash
npx create-expo-app swotly --template blank-typescript
cd swotly
npx expo install @react-native-async-storage/async-storage expo-secure-store expo-notifications expo-speech expo-image-picker expo-document-picker expo-file-system expo-audio expo-haptics expo-linear-gradient
npm install pdf-lib
```

## 3. Kodu yerleştir

Bu zip'ten çıkan dosyaları proje klasörüne kopyala:

- `App.tsx` → proje kökündeki `App.tsx` **üzerine yaz**
- `src/` klasörü → proje köküne aynen kopyala

Klasör yapısı şöyle görünmeli:

```
swotly/
  App.tsx          ← bizimki
  src/             ← bizimki
    ai.ts, planner.ts, srs.ts, storage.ts, theme.ts, types.ts, notifications.ts
    components/UI.tsx
    screens/ (Today, AddNotes, Session, Library, Settings)
  package.json     ← create-expo-app'in oluşturduğu
  ...
```

## 4. Çalıştır

```bash
npx expo start
```

Terminalde bir QR kod belirir. iPhone kamerasıyla okut → "Expo Go'da aç" → uygulama telefonunda açılır. Kodda her değişiklik anında telefona yansır (hot reload).

## 5. İlk kullanım

1. **Settings** sekmesi → Anthropic API anahtarını yapıştır → Save key. (Anahtar iPhone'un güvenli keychain'inde saklanır, cihazdan çıkmaz.)
2. **Settings** → Daily reminder'ı aç, saat seç (ör. 18:00).
3. **Add notes** → ders notlarını yapıştır → Analyse.
4. **Today** → Start session. 🎉

## Bilinen sınırlar (bu sürüm)

- **Bildirimler:** Yerel bildirimler Expo Go içinde çalışır; ama Expo Go kapalıyken güvenilirlik için ileride "development build" yapacağız (tek komut, sonraki aşama).
- **Google Docs senkronu:** Henüz yok — sıradaki büyük özellik (OAuth kurulumu benimle birlikte yapılacak).
- **Sesli pratik:** İngiliz aksanı seslendirme (TTS) ve "dinle-kur" egzersizleri var; konuşma tanıma (senin telaffuzunu değerlendirme) yol haritasında.

## Sorun giderme

- **QR okutunca bağlanmıyor:** İkisi de aynı Wi-Fi'da mı? Değilse `npx expo start --tunnel` dene.
- **"NO_KEY" hatası:** Settings'e API anahtarı girilmemiş.
- **Analiz hata veriyor:** console.anthropic.com'da kredin var mı kontrol et.

Bir sonraki adımları Claude ile konuşarak ilerletebilirsin — bu proje onunla birlikte, adım adım büyüyor.
