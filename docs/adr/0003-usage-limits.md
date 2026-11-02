# ADR-0003: Interactive Mode, her Account'un Usage Limits'ini Anthropic'ten okur

Tarih: 2026-11-02
Durum: kabul edildi

## Bağlam

Birden çok Account kullanmanın yaygın nedeni limitler. Bir hesabın 5 saatlik ya da haftalık
limiti dolunca diğerine geçiliyor. Bugün bunu görmenin tek yolu her Profile'da ayrı ayrı
`claude` açıp `/usage` yazmak. Interactive Mode zaten bütün Profile'ları tek ekranda
listelediği için, "hangi hesabımda limit kaldı?" sorusunun cevabı da orada olmalı.

Bu bilgi diskte yok. Claude Code'un `/usage` ekranı onu her seferinde
`GET https://api.anthropic.com/api/oauth/usage` adresinden, Account'un OAuth access token'ıyla
alıyor. Adres belgelenmemiş ve her an değişebilir. Yanıttaki `five_hour.utilization` ve
`seven_day.utilization` alanları 0–100 arası yüzde.

Bu, cswitch'in ilk kez (1) bir Account'un giriş anahtarını okuduğu ve (2) ağa çıktığı yer.
O yüzden kurallar burada yazılı.

## Karar

Interactive Mode açılınca her Profile için limitler arka planda istenir. Liste beklemez,
cevap gelen satırın sonuna `5h 37% · week 7%` eklenir. %80'den itibaren sarı, %95'ten
itibaren kırmızı yazılır.

Kurallar:

- **Sadece okunur.** Token Windows/Linux'ta `<configDir>/.credentials.json`'dan, macOS'ta
  Keychain'den (`security find-generic-password`) okunur. Hiçbir yere yazılmaz, loglanmaz.
  Yalnızca `api.anthropic.com`'a, o Account'un kendi isteğinde gider. Claude Code da aynı
  isteği atıyor.
- **Token yenilenmez.** Süresi dolmuşsa (`expiresAt`) o Profile için istek atılmaz, satır boş
  kalır. Yenilemek refresh token'ı döndürür ve Claude Code'un elindeki kopyayı geçersiz
  kılabilir. Token'ı yenilemek Claude Code'un işidir. `claude` bir kez açılınca token tazelenir.
- **Hata görünmez.** Token yoksa, ağ yoksa, adres 200 dışında bir yanıt verirse, yanıtın
  şekli değişmişse ya da 3 saniyede cevap gelmezse satır eskisi gibi görünür. Liste hiçbir
  zaman bu yüzden hata vermez ya da beklemez.
- **Terminal devredildikten sonra çizilmez.** `claude` başlatıldıktan ya da ekrandan
  çıkıldıktan sonra gelen cevap yok sayılır. Yoksa Claude Code'un ekranının üstüne çizerdi.
- **Kapatılabilir.** `CSWITCH_NO_USAGE=1` ile hiç istek atılmaz.

Sadece Interactive Mode'da gösterilir. `status` ve diğer komutlar ağa çıkmaz.

## Reddedilen alternatifler

**Diskteki token sayıları.** Her Profile'ın `projects/**/*.jsonl` kayıtlarında mesaj başına
token sayıları var. Güvenli ve ağsız, ama (1) sadece bu makinedeki kullanımı sayıyor, claude.ai
ve diğer makineler girmiyor, (2) girdi token'larının neredeyse tamamı önbellek okuması ve
yanıltıcı derecede büyük, (3) bu makinede 7 günlük toplam Profile başına 0,3–0,8 sn sürdü.
Asıl soruyu ("limit kaldı mı?") cevaplamıyor.

**Süresi dolan token'ı yenilemek.** Daha çok satırda sayı görünürdü, ama yukarıdaki nedenle
Claude Code'un oturumunu bozma riski var.

## Sonuçlar

- macOS'ta Keychain servis adı Default Profile için `Claude Code-credentials`, diğerleri için
  `keychain.ts`'teki **doğrulanmamış** tahmin (`-<sha256(configDir)[:8]>` son eki). Tahmin
  yanlışsa macOS'ta o Profile'ların satırı boş kalır. Hata vermez.
- Adres değişirse özellik sessizce kaybolur. Bunu fark etmenin yolu, limitlerin hiç
  görünmemesidir.
- Windows'ta gerçek iki Account ile denendi. macOS yolu yalnızca birim testleriyle doğrulandı.
