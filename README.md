# PoliticalMatrix.js — Otonom Meclis Simulator

**LM Studio** (yerel) veya **OpenRouter** (bulut) üzerinde çalışan **3 otonom AI parti** ile TBMM tarzı yasama, koalisyon, miting, medya ve seçim simülasyonu.

Saf izleyici modu: partileri sen yönetmezsin; modeller tool-calling ile meclisi işletir, sen dashboard’dan izlersin.

## Gereksinimler

- Node.js 20+
- Tool-calling destekli modeller
- Ya [LM Studio](https://lmstudio.ai/) local server **veya** [OpenRouter](https://openrouter.ai/) API anahtarı

## Kurulum

```bash
npm install
cp .env.example .env.local
npm run dev
```

Tarayıcı: [http://localhost:3000](http://localhost:3000)

### Sağlayıcı seçimi (Ayarlar)

**Ayarlar → LLM Sağlayıcı** combo’sundan `LM Studio` veya `OpenRouter` seçin. Aynı parti/spiker model comboları aktif sağlayıcının listesini kullanır.

#### LM Studio

1. LM Studio → **Developer** → Local Server’ı başlat (`http://127.0.0.1:1234`)
2. Tool use destekli bir veya daha fazla model yükle
3. Ayarlar’da her partiye model ata → **Ayarları Kaydet**
4. Dashboard’da **Başlat**

```env
LLM_PROVIDER=lm_studio
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
LM_STUDIO_API_KEY=lm-studio
```

#### OpenRouter

1. [openrouter.ai](https://openrouter.ai/) → API key oluştur
2. Ayarlar’da sağlayıcıyı **OpenRouter** yap, anahtarı yapıştır (veya `.env.local`)
3. Önerilen / katalog combolarından parti modellerini seç → kaydet
4. Dashboard’da **Başlat**

```env
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
```

Anahtar Ayarlar UI’dan da SQLite’a kaydedilebilir; env ile override edilebilir.

## Rejim serbestliği

Ülke demokraside kilitli **değil**. Partiler tool’larla şunlara dönüşebilir:

- parlamenter / başkanlık cumhuriyet  
- anayasal veya **mutlak monarşi (krallık)**  
- **teokrasi / hilafet**  
- sosyalist cumhuriyet / **komünist devlet**  
- **faşist devlet** / askeri cunta / tek parti  
- anarko-komün, teknokrasi, konfederasyon  

Araçlar: `proposeRegimeChange`, `seizePower`, `declareEmergency`, anayasal/devrimci yasalar.

## v2 derinlik

- Bakanlıklar + çok turlu koalisyon müzakeresi  
- Gensoru / güvenoyu  
- Gecikmeli yasama (komisyon)  
- Bölgesel seçmen + miting etkisi  
- İdeoloji vektörü (kayabilir) + parti dönem özeti  
- Hibrit/paralel tick, spiker modeli  
- Ay diff / kürsü / karar paneli / latency  
- Senaryo paketleri (ekonomik çöküş, dini dalga, devrimci sol…)


Veri **lokal SQLite** dosyasında tutulur: `data/politicalmatrix.sqlite`  
Şema: `migrations/001_init.sql`

## Kontroller

- **Başlat / Duraklat** — otomatik ay tick döngüsü
- **Tek Ay İlerlet** — manuel tick
- **0.5x–4x** — simülasyon hızı
- **Ayarlar** — model eşleme, prompt düzenleme, yeni oyun seed, snapshot export/import

## Mimari

- Next.js 15 (App Router) + TypeScript + Tailwind
- `better-sqlite3` kalıcılık
- OpenAI-compatible client → LM Studio veya OpenRouter `/v1/chat/completions` + tools
- SSE: `/api/sim/events`
- D3 hemicycle koltuk grafiği, Recharts anket trendi

## Önerilen modeller

Tool-calling’i iyi olan küçük/orta modeller (Qwen2.5, Llama-3.1/3.3 Instruct, Mistral, vb.). Üç parti için VRAM yetmiyorsa **aynı modeli üç slota** atayın; ideoloji system prompt ile ayrılır.

## Lisans

MIT
