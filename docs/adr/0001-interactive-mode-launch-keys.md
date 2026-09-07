# ADR-0001: Interactive Mode'un tek tuşluk `claude` çağrıları

Tarih: 2026-09-07
Durum: kabul edildi
Bağlam: [spec §10.3 / §10.5](../../.scratch/multi-account-cli/spec.md),
[issue 07](../../.scratch/cswitch-tui/issues/07-liste-ekraninda-komut-tuslari.md)

## Bağlam

Interactive Mode'un Profile listesinde Enter, seçili Profile ile düz `claude` başlatıyordu.
`claude`'un günlük kullanımdaki diğer çağrıları da Profile'a bağlıdır — doğru
`CLAUDE_CONFIG_DIR` olmadan yanlış Account'ın oturumunu sürdürür ya da yanlış Account'ın MCP
yapılandırmasını gösterirler. Bu yüzden listeden tek tuşla başlatılabilmeleri gerekiyordu.
Soru, hangi çağrıların tuş hak ettiğiydi.

## Karar

Üç tuş eklendi. Tuş→komut tablosu `src/interactive-actions.ts`'te tek kaynak olarak yaşar;
footer ipuçları ve keypress dispatch'i aynı tablodan üretilir.

| Tuş | Komut               |
| --- | ------------------- |
| `c` | `claude --continue` |
| `r` | `claude --resume`   |
| `m` | `claude mcp list`   |

`m` bilinçli olarak `claude mcp` değil `claude mcp list`'tir: argümansız `mcp` yardım metnini
basıp çıkar, ve §10.5'in "Interactive Mode kendini yeniden açmaz" sözleşmesiyle birleşince tuş
"yardım göster ve terminalden düş" anlamına gelirdi.

Tuşlar Default Profile dahil her satırda çalışır. `d`'nin Default Profile istisnası
`~/.claude`'a dokunmamak içindir; bu tuşlar ona dokunmuyor, sadece onu okuyan bir process
başlatıyor.

## `--dangerously-skip-permissions` sete girmiyor

Yaygın bir bayrak, ama tek tuşla, onay sorulmadan, yanlış Profile seçiliyken basılabilecek bir
tuşa bağlanamaz. Bu ekranda yıkıcı olabilecek tek eylem (`d`) bile y/n soruyor; izin kontrollerini
kapatan bir çağrının ondan daha ucuz olması tutarsız olurdu. İsteyen
`cswitch <profil> -- claude --dangerously-skip-permissions` yazar — oradaki sürtünme özelliktir,
kusur değil.

## Kapsam dışı bırakılanlar

- `claude update` / `claude doctor` — günlük akış değil, nadir bakım; flag-tabanlı çağrı yeterli.
- Oturum içi slash komutları — Claude Code'un kendi işi, `claude "prompt"` ile tohumlamak dışında
  dışarıdan başlatılamaz.
- `config.json`'a kullanıcı tanımlı `commands` alanı — şemayı v1'den kaydırır, gerçek talep
  gelmeden değmez.
- `cswitch continue` gibi üst düzey subcommand'lar — Profile adı ile subcommand adı çakışma riski.
- `?` yardım ekranı — dördüncü bir ekran durumu, altı satırlık bir footer için fazla.

## Sonuçları

- Footer bir satırda yedi ipucu taşıyor: `[enter] run   [c]ontinue   [r]esume   [m]cp   [a]dd
  [d] remove   [esc] quit`. 40 sütunluk terminalde sarar; §10.2'nin "sıkışır ama kırılmaz"
  kabulünün içinde kalır.
- Sete yeni bir komut eklemek `LAUNCH_ACTIONS`'a bir satır eklemektir: footer ve dispatch
  birlikte güncellenir, ayrı ayrı unutulamaz.
