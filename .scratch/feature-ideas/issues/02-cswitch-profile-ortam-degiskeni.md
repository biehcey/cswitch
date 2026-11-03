# Launcher çocuk process'e `CSWITCH_PROFILE` versin + statusLine örneği

Kaynak: [research/ozellik-fikirleri.md](../research/ozellik-fikirleri.md) — Fikir 3
Type: task
Status: done

## Ne

Launcher, başlattığı çocuk process'in ortamına `CSWITCH_PROFILE=<Profile adı>` ekler. Böylece
`claude` içinden çalışan bir script (özellikle `statusLine`) hangi Profile'da olduğunu güvenilir
şekilde öğrenir. Default Profile'da `CLAUDE_CONFIG_DIR` silindiği için bugün bu bilgi yok.

README'ye, ortak `~/.cswitch/settings.json`'a konabilecek kısa bir `statusLine` örneği eklenir
(PowerShell ve sh).

## Doğrulama (2026-11-03)

Ortamı dosyaya yazan bir script `statusLine` olarak verildi
(`$env:TEST_VAR='x'; claude --settings <test-settings.json>`, Windows / PowerShell).
Status line `TEST_VAR=x` gösterdi; script'in yazdığı dosyada `"TEST_VAR": "x"` vardı.
Sonuç: status line script'i `claude`'un ortam değişkenlerini miras alıyor.

## Kararlar

- **Ad:** `CSWITCH_PROFILE` (mevcut `CSWITCH_QUIET`, `CSWITCH_NO_SETTINGS` ile aynı düzen).
- **Default Profile'da değer:** `config.json`'daki gerçek Profile adı, sabit bir `"default"` değil.
- **Her zaman yazılır:** çağıran shell'den miras kalan eski bir `CSWITCH_PROFILE` varsa
  (ör. iç içe başlatma) üzerine yazılır.
- **README örneği:** sadece Profile adını gösterir. `CSWITCH_PROFILE` yoksa (cswitch dışında
  açılmış `claude`) boş kalır.
- Launcher yalnızca çocuk process'in ortamını kurar; çağıran shell'e dokunmaz.

## Kabul kriterleri

- [x] `buildChildEnv`, normal Profile için `CSWITCH_PROFILE=<ad>` ayarlar.
- [x] `buildChildEnv`, Default Profile için de `CSWITCH_PROFILE=<ad>` ayarlar.
- [x] Miras kalan eski `CSWITCH_PROFILE` değeri üzerine yazılır.
- [x] README'de PowerShell ve sh için `statusLine` örneği var.
- [x] CHANGELOG'da bir satır var.
