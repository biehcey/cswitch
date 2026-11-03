# Usage Limits satırına sıfırlanma zamanı

Kaynak: [research/ozellik-fikirleri.md](../research/ozellik-fikirleri.md) — Fikir 7
Type: task
Status: ready-for-agent

## Ne

Interactive Mode'daki Usage Limits satırı bugün `5h 91% · week 40%` gösteriyor. Her pencerenin
yanına ne zaman sıfırlanacağı eklenecek: `5h 91% (1h 20m) · week 40% (3d 13h)`.
"Hangi hesabımda yer var?" sorusunun (ADR-0003 Bağlam) ikinci yarısı: "ne zaman açılacak?".

## Doğrulama (2026-11-03)

`GET /api/oauth/usage`'a gerçek bir Account'un token'ıyla istek atıldı (HTTP 200). Cevapta:

- `five_hour.resets_at` ve `seven_day.resets_at` var.
- Format **ISO 8601 metin**, UTC, mikro-saniyeli: `2026-11-03T10:50:00.083387+00:00`.
  (Status line JSON'undaki `resets_at` epoch saniyedir; bu uç nokta farklı.)
- Pencere yoksa üst alan `null` (`seven_day_opus: null` gibi) — mevcut davranış aynen kalır.

## Kararlar

- **Gösterim:** kalan süre, İngilizce kısaltma (satırın geri kalanı gibi).
  - 1 günden fazla: `3d 13h`; 1 saatten fazla: `1h 20m`; altı: `45m`; 1 dakikadan az: `<1m`.
  - Sıfır olan ikinci kısım yazılmaz: `2h`, `3d`. Dakikalar aşağı yuvarlanır.
- **Sıfırlanma zamanı geçmişse:** süre hiç gösterilmez, yalnızca yüzde kalır (`5h 91%`).
- **`resets_at` yoksa / okunamıyorsa** (null, bozuk tarih): bugünkü gibi yalnızca yüzde.
- Kalan süre, satır her çizildiğinde o anki saate göre hesaplanır; ayrı bir zamanlayıcı yok.
- Renk kuralı (%80 sarı, %95 kırmızı) değişmez.

## Kısıtlar

- ADR-0003: sıfırlanma zamanı da yüzdeler gibi yalnızca bellekte tutulur, diske yazılmaz.
- Hata görünmez kuralı: alan bozuksa satır hata vermez, süre sadece eksik kalır.

## Kabul kriterleri

- [ ] `parseUsageLimits` her pencere için `resets_at`'i okur; yoksa/bozuksa o alanı atlar.
- [ ] `formatUsageLimits` geleceğe ait sıfırlanma zamanı için `(…)` ekler, geçmiş ya da eksik için eklemez.
- [ ] Profile listesi satırı sürenin eklendiği hâli gösterir.
- [ ] Mevcut testler (yalnızca beklenen yeni alan dışında) geçmeye devam eder.

## Comments
