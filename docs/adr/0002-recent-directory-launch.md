# ADR-0002: Recent Directory satırından başlatma Binding'i geçersiz kılar

Tarih: 2026-11-02
Durum: kabul edildi
Bağlam: [issue 01](../../.scratch/recent-directories/issues/01-son-calisilanlar.md)

## Bağlam

Interactive Mode'a "Son çalışılanlar" bölümü ekleniyor. Her satır bir **Recent Directory**:
(dizin, Profile, son kullanım zamanı). Satır seçilince `claude` o dizinde başlatılıyor.

Launcher'ın Profile seçme kuralı bugüne kadar şuydu: açık Profile adı verilmişse o, yoksa
`cwd`'ye uyan en uzun Binding öneki, o da yoksa Default Profile. Recent Directory satırı ise
dizinin **kendisini** de taşıyor. Bu da yeni bir durum doğuruyor: satırın Profile'ı, o dizinin
Binding'inin gösterdiği Profile'dan farklı olabilir. Örneğin şirket reposunda bir kez kişisel
Profile ile çalışılmış olabilir.

## Karar

Satırdaki Profile kazanır. Satırı seçmek, Profile listesinden bir Profile seçmekle aynı
anlama gelir. Bu açık bir seçimdir ve mevcut kurallarda da açık seçim Binding'in önüne geçer.

Çelişki gizlenmez. O dizinin Binding'i başka bir Profile'ı gösteriyorsa satırda `≠binding`
işareti çıkar.

Kalıcı durum yazılmaz. Satırdan başlatmak Binding oluşturmaz ya da değiştirmez. Kalıcılık
isteyen kullanıcı yine `bind` komutunu kullanır.

## Reddedilen alternatif

**Binding kazansın.** Listede `batu-personal` yazan bir satırı seçip `sirket` Profile'ının
oturumuna düşmek, ekranda görünenle olanın farklı olması demek. Bu durumda `--continue`
yanlış Account'ın son oturumunu açar.

## Sonuçları

- Launcher'a alt process için `cwd` parametresi ekleniyor. Çağıran shell'in dizini yine
  değişmez; `claude` bitince kullanıcı eski dizinindedir.
- `d` tuşu Recent Directory satırlarında çalışmaz. Dizin satırındayken Profile silmek, ekranda
  görünen nesneyle silinen nesnenin farklı olması demek.
