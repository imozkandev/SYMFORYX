import {
  estimateTokens,
  normalizeTr,
  type ChatChunk,
  type ChatRequest,
  type CostEstimate,
  type ImageRequest,
  type ImageResult,
  type ModelInfo,
  type ProviderAdapter,
  type SymMessage,
} from "@symforyx/core";
import { flattenMessageText, sleep } from "./helpers.ts";

export const DEMO_MODELS: ModelInfo[] = [
  {
    id: "demo-claude",
    providerId: "demo",
    displayName: "Claude (Demo)",
    capabilities: ["chat", "vision", "tools", "reasoning"],
    contextWindow: 200000,
    maxOutputTokens: 16384,
    pricing: { inputPerMTok: 0, outputPerMTok: 0 },
    local: true,
    visible: true,
  },
  {
    id: "demo-gpt",
    providerId: "demo",
    displayName: "GPT (Demo)",
    capabilities: ["chat", "vision", "tools", "json_mode"],
    contextWindow: 128000,
    maxOutputTokens: 16384,
    pricing: { inputPerMTok: 0, outputPerMTok: 0 },
    local: true,
    visible: true,
  },
  {
    id: "demo-gemini",
    providerId: "demo",
    displayName: "Gemini (Demo)",
    capabilities: ["chat", "vision", "tools", "reasoning"],
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    pricing: { inputPerMTok: 0, outputPerMTok: 0 },
    local: true,
    visible: true,
  },
  {
    id: "demo-fast",
    providerId: "demo",
    displayName: "Ekonomi Hızlı (Demo)",
    capabilities: ["chat", "tools"],
    contextWindow: 64000,
    maxOutputTokens: 4096,
    pricing: { inputPerMTok: 0, outputPerMTok: 0 },
    local: true,
    visible: true,
  },
  {
    id: "demo-image",
    providerId: "demo",
    displayName: "Görsel Stüdyo (Demo)",
    capabilities: ["image.generate", "image.edit"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0 },
    local: true,
    visible: true,
  },
];

/**
 * Built-in Zero-Key Demo Provider so new users can immediately test the complete
 * 5-minute SYMFORYX workflow (@gorsel -> Gönder ▸ @claude -> Canlı Önizleme,
 * Compare, Council, Chain, Agent, Flows) before entering paid API keys.
 */
export class SymforyxDemoAdapter implements ProviderAdapter {
  id = "demo";
  displayName = "SYMFORYX Demo (Ücretsiz Simülasyon)";
  auth: "none" = "none";
  badgeColor = "#6D5EF6";
  badgeLetter = "S";

  async validateCredentials() {
    return {
      ok: true,
      message: "SYMFORYX Demo sağlayıcısı hazır (API anahtarı gerekmez).",
      models: DEMO_MODELS,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return DEMO_MODELS;
  }

  toProviderFormat(messages: SymMessage[]) {
    return messages.map((m) => ({ role: m.role, text: flattenMessageText(m) }));
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const prompt = lastUser ? flattenMessageText(lastUser) : "Merhaba";
    const norm = normalizeTr(prompt);
    const hasImage = lastUser?.parts.some((p) => p.type === "image") || norm.includes("aktarim notu");

    const reply = buildSmartDemoReply(req.modelId, prompt, norm, hasImage, req.messages.length);
    const inputTokens = estimateTokens(req.messages.map(flattenMessageText).join("\n"));

    // Stream word-by-word smoothly (~12ms/chunk)
    const tokens = reply.match(/\S+\s*/g) ?? [reply];
    let emitted = 0;
    for (const chunk of tokens) {
      if (signal.aborted) break;
      yield { type: "text", text: chunk };
      emitted++;
      if (emitted % 3 === 0) {
        await sleep(14, signal).catch(() => {});
      }
    }

    yield {
      type: "usage",
      inputTokens,
      outputTokens: estimateTokens(reply),
    };
    yield { type: "done" };
  }

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const start = Date.now();
    const svg = buildDesignMockupSvg(req.prompt);
    const base64 = Buffer.from(svg, "utf8").toString("base64");
    return {
      mime: "image/svg+xml",
      base64,
      revisedPrompt: `SYMFORYX Görsel Tasarım Mockup: ${req.prompt}`,
      costUsd: 0,
      latencyMs: Math.max(180, Date.now() - start),
    };
  }

  estimateCost(req: { modelId: string; inputTokens: number; outputTokens?: number }): CostEstimate {
    return {
      estimatedInputTokens: req.inputTokens,
      estimatedOutputTokens: req.outputTokens ?? 350,
      estimatedCostUsd: 0,
    };
  }
}

function buildSmartDemoReply(
  modelId: string,
  prompt: string,
  norm: string,
  hasImage: boolean,
  turnCount: number
): string {
  // 0a. App Store / Play Store 5-Screen Visual Kit
  if (norm.includes("magaza gorseli") || norm.includes("app store") && norm.includes("ekran")) {
    const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>App Store 5'li Mağaza Görseli Seti</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Inter,-apple-system,sans-serif;background:#0D0D10;color:#F4F4F0;padding:28px}
  h1{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#9A9AA4;margin-bottom:18px}
  .strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}
  .shot{background:#16161B;border:1px solid #2A2A34;border-radius:20px;padding:18px;display:flex;flex-direction:column;justify-content:space-between;min-height:390px}
  .tag{font-family:monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#EB7A47}
  h2{font-size:20px;line-height:1.15;letter-spacing:-.02em;margin:8px 0 6px}
  p{font-size:12px;color:#A1A1AA;line-height:1.45}
  .phone{margin-top:16px;background:#0B0B0D;border:1px solid #2E2E38;border-radius:16px;padding:12px;height:185px;display:flex;flex-direction:column;justify-content:space-between}
  .bar{height:8px;border-radius:4px;background:#262630;width:62%}
  .kpi{font-family:monospace;font-size:26px;font-weight:700;color:#5B82FF}
  .pill{display:inline-block;padding:4px 8px;border-radius:6px;background:#1F4BF422;color:#8EA8FF;font-size:10px;font-family:monospace}
</style>
</head>
<body>
  <h1>App Store & Google Play · 5 Ekran Mağaza Seti</h1>
  <div class="strip">
    <section class="shot"><div><span class="tag">01 / HERO</span><h2>Tek ekranda tüm kontrol</h2><p>Dağınık araçları kapat, odaklı çalış.</p></div><div class="phone"><div class="bar"></div><div class="kpi">99.4%</div><span class="pill">Canlı Senkron</span></div></section>
    <section class="shot"><div><span class="tag">02 / HIZ</span><h2>Saniyeler içinde sonuç</h2><p>Akıllı iş akışlarıyla tekrar eden işleri otomatikleştir.</p></div><div class="phone"><div class="bar"></div><div class="kpi">1.2s</div><span class="pill">Anlık Akış</span></div></section>
    <section class="shot"><div><span class="tag">03 / REFERANS</span><h2>Görsel ve fikir referansı</h2><p>Stilini ve kısıtlarını tek tıkla ekle.</p></div><div class="phone"><div class="bar"></div><div class="kpi">∞</div><span class="pill">Sıfır Kısıt</span></div></section>
    <section class="shot"><div><span class="tag">04 / ŞEFFAF</span><h2>Kota ve maliyet canlı</h2><p>Ne kadar kaldığını ve sıfırlanma süresini gör.</p></div><div class="phone"><div class="bar"></div><div class="kpi">$0.004</div><span class="pill">Prompt Bazlı</span></div></section>
    <section class="shot"><div><span class="tag">05 / BAŞLA</span><h2>Ücretsiz dene, hemen kur</h2><p>Yerel gizlilik öncelikli mimari.</p></div><div class="phone"><div class="bar"></div><div class="kpi">5★</div><span class="pill">iOS · macOS</span></div></section>
  </div>
</body>
</html>`;
    return `5 ekranlık **App Store & Google Play Mağaza Görseli Seti** üretildi ve sağdaki **Artefakt Paneli → Önizleme** sekmesinde açıldı.

\`\`\`html store-screenshots.html
${html}
\`\`\`

> İstediğin ekranın metnini veya renk şemasını alttaki **Düzenle** kutusundan anında güncelleyebilirsin.`;
  }

  // 0b. ASO Optimization Package
  if (norm.includes("aso ") || norm.includes("app title") || norm.includes("anahtar kelime")) {
    return `### ASO (App Store & Google Play) Optimizasyon Paketi

#### 1. iOS App Store Metadata (Karakter Limitine Tam Uyumlu)
- **App Name (28/30):** \`FocusPulse: Derin Çalışma\`
- **Subtitle (29/30):** \`Pomodoro, Odak & Akıllı Takip\`
- **Keyword Field (96/100):** \`pomodoro,odak,zamanlayici,verimlilik,ders,calisma,takip,aliskanlik,gorev,planlayici,timer,focus\`

#### 2. Google Play Store Metadata
- **Short Description (74/80):** \`Dikkatini topla, Pomodoro seanslarını yönet ve günlük odak raporunu gör.\`
- **A/B Test Hipotezleri:**
  1. İlk ekran görselinde koyu zemin + büyük sayısal KPI kullanımı dönüşümü +%14 artırabilir.
  2. Alt başlıkta "Pomodoro" kelimesini öne almak organik aramada ilk 5'e girişi hızlandırır.

#### 3. Öncelikli Anahtar Kelime Matrisi
| Anahtar Kelime | Niyet | Rekabet | Öncelik |
| --- | --- | --- | --- |
| pomodoro zamanlayıcı | Yüksek | Orta | P0 |
| derin çalışma uygulaması | Yüksek | Düşük | P0 |
| odaklanma sayacı | Orta | Düşük | P1 |
| focus timer minimal | Yüksek | Orta | P0 |`;
  }

  // 0c. 3D Model Interactive Preview + Blender Script
  if (norm.includes("3d model") || norm.includes("3d sahne") || norm.includes("meshy") || norm.includes("blender")) {
    const html3d = `<!doctype html>
<html lang="tr">
<head><meta charset="utf-8"/><title>3D Etkileşimli Sahne Önizleme</title>
<style>body{margin:0;background:#0B0B0E;color:#EDEDEA;font-family:monospace;overflow:hidden}canvas{display:block;width:100vw;height:100vh}.hud{position:fixed;top:12px;left:14px;font-size:11px;background:#16161Ccc;padding:6px 10px;border:1px solid #2A2A34;border-radius:6px}</style>
</head>
<body>
<div class="hud">SYMFORYX 3D ÖNİZLEME · Fareyle döndür · Wireframe + Shading</div>
<canvas id="c"></canvas>
<script>
const c=document.getElementById('c'),x=c.getContext('2d');
let w,h,rx=0.5,ry=0.6,drag=false,lx=0,ly=0;
const resize=()=>{w=c.width=innerWidth;h=c.height=innerHeight};resize();addEventListener('resize',resize);
c.onpointerdown=e=>{drag=true;lx=e.clientX;ly=e.clientY};addEventListener('pointerup',()=>drag=false);
addEventListener('pointermove',e=>{if(!drag)return;ry+=(e.clientX-lx)*0.01;rx+=(e.clientY-ly)*0.01;lx=e.clientX;ly=e.clientY});
const pts=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1],[0,1.8,0]];
const edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7],[2,8],[3,8],[6,8],[7,8]];
function proj([px,py,pz]){
  const cy=Math.cos(ry),sy=Math.sin(ry),cx=Math.cos(rx),sx=Math.sin(rx);
  let x1=px*cy-pz*sy,z1=px*sy+pz*cy;
  let y2=py*cx-z1*sx,z2=py*sx+z1*cx;
  const s=260/(z2+4.5);return [w/2+x1*s,h/2-y2*s];
}
function loop(){
  if(!drag)ry+=0.008;
  x.fillStyle='#0B0B0E';x.fillRect(0,0,w,h);
  const p=pts.map(proj);
  x.strokeStyle='#5B82FF';x.lineWidth=1.8;
  for(const [a,b] of edges){x.beginPath();x.moveTo(p[a][0],p[a][1]);x.lineTo(p[b][0],p[b][1]);x.stroke();}
  for(const [px,py] of p){x.fillStyle='#EB7A47';x.beginPath();x.arc(px,py,3.5,0,Math.PI*2);x.fill();}
  requestAnimationFrame(loop);
}loop();
</script></body></html>`;
    return `### 3D Model Paketi (Etkileşimli Önizleme + Meshy/Tripo Prompt + Blender Betiği)

- **Meshy-4 / Tripo3D Prompt:** \`Clean architectural low-poly centerpiece sculpture, brushed anodized aluminum and matte obsidian ceramic, crisp chamfered edges, studio PBR textures, game-ready quad topology\`

\`\`\`html preview-3d.html
${html3d}
\`\`\`

\`\`\`python blender_setup.py
import bpy
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.2)
mat = bpy.data.materials.new("SymforyxPBR")
mat.use_nodes = True
bpy.context.active_object.data.materials.append(mat)
\`\`\``;
  }

  // 0d. Music & Audio Synth Player + Suno/Udio Prompts
  if (norm.includes("muzik") || norm.includes("suno") || norm.includes("udio") || norm.includes("web audio")) {
    const htmlAudio = `<!doctype html>
<html lang="tr">
<head><meta charset="utf-8"/><title>SYMFORYX Müzik & Synth Stüdyo</title>
<style>body{margin:0;background:#101014;color:#F1F1EE;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.box{width:100%;max-width:460px;background:#17171D;border:1px solid #2A2A34;border-radius:12px;padding:22px}.tag{font-family:monospace;font-size:10px;color:#EB7A47;letter-spacing:.08em}h2{font-size:18px;margin:6px 0 4px}p{font-size:12px;color:#9A9AA4;margin-bottom:16px}button{background:#1F4BF4;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:600;cursor:pointer;margin-right:8px}button.sec{background:#24242E}.bars{display:flex;gap:4px;height:44px;align-items:flex-end;margin:16px 0}.bars span{flex:1;background:#5B82FF;border-radius:2px;height:20%;transition:height .15s}</style>
</head>
<body>
<div class="box">
  <div class="tag">SYMFORYX · WEB AUDIO SYNTH PREVIEW · 108 BPM · D MINOR</div>
  <h2>Ambient Studio Pulse</h2>
  <p>Tarayıcıda gerçek zamanlı Web Audio API sentezleyici ile üretildi.</p>
  <div class="bars" id="bars">${"<span></span>".repeat(16)}</div>
  <button onclick="start()">▶ Çal</button><button class="sec" onclick="stop()">■ Durdur</button>
</div>
<script>
let ctx,timer;const notes=[293.66,349.23,440,523.25,440,392,349.23,329.63];let step=0;
function start(){stop();ctx=new (window.AudioContext||window.webkitAudioContext)();
  timer=setInterval(()=>{const o=ctx.createOscillator(),g=ctx.createGain();
    o.type=step%4===0?'triangle':'sine';o.frequency.value=notes[step%notes.length];
    g.gain.setValueAtTime(0.14,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.36);
    o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+0.38);
    document.querySelectorAll('#bars span').forEach((s,i)=>s.style.height=(15+Math.random()*85)+'%');
    step++;
  },275);
}
function stop(){if(timer)clearInterval(timer);if(ctx)ctx.close();}
</script></body></html>`;
    return `### Müzik & Ses Prodüksiyon Paketi

- **Suno v4 / Udio Prompt:** \`Minimalist ambient electronic, warm analog Rhodes chords, subtle sub-bass pulse, 108 BPM, D minor, clean studio mastering, no vocals\`
- **SFX Listesi:** UI Hover (soft marimba click, 40ms), Success Confirm (warm fifth harmonic chime, 180ms), Transition Whoosh (filtered pink noise, 240ms).

\`\`\`html synth-preview.html
${htmlAudio}
\`\`\`

Sağdaki **Artefakt Paneli → Önizleme** sekmesinden **▶ Çal** butonuna basarak parçayı hemen dinleyebilirsin.`;
  }

  // 0e. Video & Promo Storyboard
  if (norm.includes("video promo") || norm.includes("storyboard") || norm.includes("runway") || norm.includes("kling")) {
    return `### 30 Saniyelik Video & Promo Storyboard

| Zaman | Sahne | Kamera / Hareket | Video AI Prompt (Kling / Veo / Runway) | Seslendirme (VO) |
| --- | --- | --- | --- | --- |
| \`00:00-00:05\` | **Hook:** Kaotik 12 tarayıcı sekmesi tek dokunuşla kapanır | Hızlı push-in, 24fps | \`Minimalist overhead desk shot, cluttered digital tabs collapsing into one clean dark interface, crisp studio lighting\` | "On sekme, beş abonelik, sıfır odak." |
| \`00:05-00:15\` | **Çözüm:** Görsel + Kod + 3D + Ses tek stüdyoda akar | Akıcı makro pan | \`Sleek macOS studio app generating architectural UI mockup and live code preview side by side, razor sharp typography\` | "Her model, her araç, tek çalışma tezgâhında." |
| \`00:15-00:25\` | **Şeffaflık:** Canlı kota ve prompt maliyeti görünür | Sabit close-up | \`Clean Swiss tabular telemetry dashboard showing live API quotas and cost per prompt in dark graphite theme\` | "Ne kadar kullandın, ne kadar kaldı, hep gözünün önünde." |
| \`00:25-00:30\` | **CTA:** SYMFORYX logosu ve indirme ekranı | Yavaş zoom-out | \`Minimalist typographic end card on matte obsidian background, clean geometric mark\` | "SYMFORYX. Kontrol sende." |`;
  }

  // 1. Code generation / Image-to-Code / HTML+Tailwind preview
  if (
    hasImage ||
    norm.includes("kodla") ||
    norm.includes("html") ||
    norm.includes("react") ||
    norm.includes("tailwind") ||
    norm.includes("acilis sayfasi") ||
    norm.includes("ana ekran") ||
    norm.includes("uygulama")
  ) {
    const theme = norm.includes("kahve")
      ? {
          title: "Roast & Craft — Kahve Dükkânı",
          badge: "Taze Kavrulmuş · İstanbul",
          hero: "Her fincanda zanaat ve sıcaklık.",
          sub: "Seçilmiş tek köken çekirdekler, günlük artizan tatlılar ve sakin bir çalışma ortamı.",
          cta: "Menüyü Keşfet",
          accent: "#B45309",
          bg: "#FAF7F2",
          card1: ["Flat White", "₺135", "Kadifemsi süt köpüğü, Etiyopya çekirdeği"],
          card2: ["V60 Pour Over", "₺150", "Çiçeksi notalar, hafif asidite"],
          card3: ["Bademli Kruvasan", "₺120", "Her sabah taş fırından sıcak"],
        }
      : norm.includes("hava")
      ? {
          title: "AeroCast — Hava Durumu",
          badge: "İstanbul · Canlı",
          hero: "22° Parçalı Bulutlu",
          sub: "Nem %54 · Rüzgâr 14 km/s · UV İndeksi 4 (Orta)",
          cta: "7 Günlük Tahmin",
          accent: "#16A34A",
          bg: "#F0FDF4",
          card1: ["14:00", "23°", "Güneşli, hafif esinti"],
          card2: ["18:00", "19°", "Açık akşam"],
          card3: ["22:00", "16°", "Serin ve berrak"],
        }
      : {
          title: "SYMFORYX Studio",
          badge: "Modern Arayüz · Canlı Önizleme",
          hero: "Fikirden çalışan ürüne dakikalar içinde.",
          sub: "Temiz tipografi, erişilebilir kontrast ve mobil uyumlu yerleşim ile hazır arayüz.",
          cta: "Hemen Başla",
          accent: "#6D5EF6",
          bg: "#F8F8FC",
          card1: ["Hızlı Kurulum", "01", "Tek tıkla önizle ve düzenle"],
          card2: ["Çoklu Model", "02", "Görselden koda kesintisiz aktarım"],
          card3: ["Erişilebilir", "03", "WCAG AA kontrast ve klavye desteği"],
        };

    const html = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${theme.title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, system-ui, -apple-system, sans-serif; background: ${theme.bg}; color: #18181B; line-height: 1.5; padding: 24px; }
    .shell { max-width: 880px; margin: 0 auto; background: #fff; border-radius: 20px; border: 1px solid #E4E4E7; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.06); }
    header { display: flex; justify-content: space-between; align-items: center; padding: 18px 28px; border-bottom: 1px solid #F4F4F5; }
    .brand { font-weight: 700; letter-spacing: -0.02em; display: flex; align-items: center; gap: 10px; }
    .dot { width: 10px; height: 10px; border-radius: 999px; background: ${theme.accent}; }
    nav { display: flex; gap: 18px; font-size: 14px; color: #52525B; }
    .hero { padding: 48px 28px 36px; text-align: left; }
    .pill { display: inline-block; padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; background: ${theme.accent}18; color: ${theme.accent}; margin-bottom: 14px; }
    h1 { font-size: clamp(28px, 4vw, 42px); letter-spacing: -0.03em; line-height: 1.12; margin-bottom: 12px; }
    p.sub { color: #52525B; max-width: 56ch; margin-bottom: 24px; font-size: 16px; }
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 12px; border: none; background: ${theme.accent}; color: #fff; font-weight: 600; font-size: 14px; cursor: pointer; transition: transform 150ms ease, opacity 150ms ease; }
    .btn:hover { transform: translateY(-1px); opacity: 0.94; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; padding: 0 28px 32px; }
    .card { padding: 18px; border-radius: 14px; background: #FAFAFA; border: 1px solid #ECECEE; transition: border-color 150ms ease; }
    .card:hover { border-color: ${theme.accent}; }
    .card-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
    .card h3 { font-size: 15px; font-weight: 600; }
    .price { font-size: 13px; font-weight: 700; color: ${theme.accent}; }
    .card p { font-size: 13px; color: #71717A; }
    footer { padding: 14px 28px; border-top: 1px solid #F4F4F5; font-size: 12px; color: #71717A; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand"><span class="dot"></span> ${theme.title}</div>
      <nav><span>Öne Çıkanlar</span><span>Hakkında</span><span>İletişim</span></nav>
    </header>
    <section class="hero">
      <span class="pill">${theme.badge}</span>
      <h1>${theme.hero}</h1>
      <p class="sub">${theme.sub}</p>
      <button class="btn" onclick="alert('${theme.cta} tıklandı!')">${theme.cta} →</button>
    </section>
    <section class="grid">
      <article class="card"><div class="card-top"><h3>${theme.card1[0]}</h3><span class="price">${theme.card1[1]}</span></div><p>${theme.card1[2]}</p></article>
      <article class="card"><div class="card-top"><h3>${theme.card2[0]}</h3><span class="price">${theme.card2[1]}</span></div><p>${theme.card2[2]}</p></article>
      <article class="card"><div class="card-top"><h3>${theme.card3[0]}</h3><span class="price">${theme.card3[1]}</span></div><p>${theme.card3[2]}</p></article>
    </section>
    <footer><span>Erişilebilir & Mobil Uyumlu</span><span>SYMFORYX Canlı Önizleme</span></footer>
  </div>
</body>
</html>`;

    return `Tasarımı analiz edip temiz, mobil uyumlu ve doğrudan **Canlı Önizleme** panelinde çalışan tek dosyalık arayüzü hazırladım.

\`\`\`html index.html
${html}
\`\`\`

### Öne çıkan kararlar
- **Erişilebilir kontrast:** Gövde metni WCAG AA (>7:1) kontrast oranıyla ayarlandı.
- **Duyarlı ızgara:** Kartlar masaüstü, tablet ve mobil genişliklere otomatik uyum sağlar.
- **Canlı önizleme:** Sağdaki **Artefakt Paneli → Önizleme** sekmesinden masaüstü / tablet / mobil boyutlarda hemen deneyebilirsin.`;
  }

  // 2. TypeScript / Algorithm / SQL / Programming questions
  if (
    norm.includes("rate limiter") ||
    norm.includes("typescript") ||
    norm.includes("sql") ||
    norm.includes("python") ||
    norm.includes("fonksiyon") ||
    norm.includes("test")
  ) {
    if (modelId === "demo-claude") {
      return `**Claude (Demo) — Temiz Mimari Yaklaşımı**

Token Bucket algoritması hem patlama (burst) trafiğine izin verir hem de ortalama hızı garanti eder:

\`\`\`ts rate-limiter.ts
export class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(private capacity: number, private refillPerSec: number) {}

  allow(key: string, cost = 1): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefill: now };
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
    bucket.lastRefill = now;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.buckets.set(key, bucket);
      return true;
    }
    this.buckets.set(key, bucket);
    return false;
  }
}
\`\`\`

**Artıları:** \`O(1)\` zaman/bellek karmaşıklığı, sıfır dış bağımlılık, kolay test edilebilir.`;
    }
    if (modelId === "demo-gpt") {
      return `**GPT (Demo) — Üretim & Ölçeklenebilirlik Yaklaşımı**

Çoklu sunucu ortamında tutarlılık için **Sliding Window Counter** önerilir:

\`\`\`ts sliding-window.ts
export function createSlidingWindow(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): { ok: boolean; remaining: number } => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((ts) => now - ts < windowMs);
    if (recent.length >= limit) return { ok: false, remaining: 0 };
    recent.push(now);
    hits.set(key, recent);
    return { ok: true, remaining: limit - recent.length };
  };
}
\`\`\`

> **İpucu:** Sunucu kümesi büyüdüğünde bu yapıyı Redis Lua betiğine taşıyarak atomik hız sınırlama elde edebilirsin.`;
    }
    return `**Gemini (Demo) — Performans & Edge Analizi**

Yüksek eşzamanlılıkta bellek sızıntısını önlemek için **TTL temizlikli sabit pencere** yaklaşımı verimlidir:
1. Her pencere anahtarını \`userId:Math.floor(now / windowMs)\` olarak tut.
2. Eski pencereleri periyodik olarak temizle.
3. Yanıt başlıklarına \`X-RateLimit-Remaining\` ve \`Retry-After\` ekleyerek istemci deneyimini iyileştir.`;
  }

  // 3. Summarize / Economy
  if (norm.includes("ozet") || modelId === "demo-fast") {
    return `**Hızlı Özet (${turnCount} mesajlık bağlam)**

- **Ana konu:** ${prompt.slice(0, 120)}
- **Önerilen sonraki adım:** İlgili modeli \`@claude\`, \`@gpt\` veya \`@gorsel\` ile etiketleyebilir ya da sağ paneldeki artefaktı doğrudan sonraki modele aktarabilirsin.`;
  }

  // 4. General distinct responses per model
  const persona =
    modelId === "demo-claude"
      ? "Claude (Demo) — yapısal netlik ve derinlik odaklı"
      : modelId === "demo-gemini"
      ? "Gemini (Demo) — sentez ve çok yönlü araştırma odaklı"
      : "GPT (Demo) — pratik ve eyleme dönük";

  return `**${persona}**

İsteğini aldım: *${prompt.slice(0, 160)}*

### Önerilen yaklaşım
1. **Hedefi netleştir:** Çıktının formatını (görsel, kod, rapor veya akış) seç.
2. **Orkestrayı kullan:**
   - Tasarım için \`@gorsel\` yazıp sağ panelde görseli gör.
   - Koda çevirmek için kartın altındaki **Gönder ▸ Claude** düğmesine bas.
   - Farklı bakış açıları için **Karşılaştır** veya **Konsey** moduna geç.
3. **Gerçek modellerle çalış:** **Ayarlar → Sağlayıcılar** ekranından OpenAI, Anthropic, Google API anahtarını ekleyebilir veya yerel **Ollama** modellerini ücretsiz bağlayabilirsin.`;
}

function buildDesignMockupSvg(prompt: string): string {
  const norm = normalizeTr(prompt);
  const safePrompt = prompt.replace(/[<>&"]/g, "").slice(0, 56);

  // Choose theme palette based on prompt keywords
  let bg = "#F6F6F9";
  let card = "#FFFFFF";
  let primary = "#6D5EF6";
  let accent = "#FF8A3D";
  let title = "SYMFORYX Tasarım";
  let subtitle = safePrompt || "Modern arayüz konsepti";

  if (norm.includes("kahve")) {
    bg = "#FAF6F0";
    primary = "#9A5B25";
    accent = "#D97706";
    title = "Roast & Craft Coffee";
    subtitle = "Minimalist, sıcak tonlu kahve dükkânı";
  } else if (norm.includes("hava") || norm.includes("yesil")) {
    bg = "#ECFDF5";
    primary = "#16A34A";
    accent = "#0EA5E9";
    title = "AeroCast · 22°";
    subtitle = "İstanbul · Parçalı Bulutlu · Nem %54";
  } else if (norm.includes("dis") || norm.includes("klinik") || norm.includes("mavi")) {
    bg = "#EFF6FF";
    primary = "#2563EB";
    accent = "#06B6D4";
    title = "Nova Diş Kliniği";
    subtitle = "Güven veren beyaz-mavi açılış sayfası";
  } else if (norm.includes("logo")) {
    bg = "#0E0E12";
    card = "#17171D";
    primary = "#6D5EF6";
    accent = "#FF8A3D";
    title = "Marka Kimliği & Logo";
    subtitle = safePrompt;
  }

  const isDark = bg === "#0E0E12";
  const fg = isDark ? "#F4F4F5" : "#18181B";
  const muted = isDark ? "#A1A1AA" : "#71717A";
  const border = isDark ? "#27272A" : "#E4E4E7";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" width="800" height="520">
  <defs>
    <linearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${accent}" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000000" flood-opacity="0.08"/>
    </filter>
  </defs>
  <rect width="800" height="520" rx="20" fill="${bg}" />
  <!-- Top Browser/App Frame -->
  <rect x="44" y="36" width="712" height="448" rx="18" fill="${card}" stroke="${border}" stroke-width="1.5" filter="url(#shadow)" />
  <circle cx="72" cy="60" r="5" fill="#E5484D"/>
  <circle cx="90" cy="60" r="5" fill="#E2A400"/>
  <circle cx="108" cy="60" r="5" fill="#22A06B"/>
  <rect x="260" y="51" width="280" height="18" rx="9" fill="${bg}" />
  <line x1="44" y1="82" x2="756" y2="82" stroke="${border}" stroke-width="1" />

  <!-- Hero Section -->
  <rect x="76" y="106" width="132" height="24" rx="12" fill="${primary}" fill-opacity="0.14"/>
  <text x="92" y="122" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="600" fill="${primary}">SYMFORYX · UI</text>
  <text x="76" y="168" font-family="Inter, system-ui, sans-serif" font-size="30" font-weight="700" fill="${fg}">${title}</text>
  <text x="76" y="196" font-family="Inter, system-ui, sans-serif" font-size="14" fill="${muted}">${subtitle}</text>

  <!-- CTA Buttons -->
  <rect x="76" y="216" width="136" height="40" rx="10" fill="url(#heroGrad)" />
  <text x="112" y="241" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" fill="#FFFFFF">Keşfet →</text>
  <rect x="224" y="216" width="116" height="40" rx="10" fill="none" stroke="${border}" stroke-width="1.5" />
  <text x="252" y="241" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="500" fill="${fg}">Detaylar</text>

  <!-- Visual Accent Card -->
  <rect x="492" y="106" width="232" height="156" rx="16" fill="url(#heroGrad)" fill-opacity="0.92" />
  <circle cx="670" cy="146" r="36" fill="#FFFFFF" fill-opacity="0.18" />
  <circle cx="548" cy="212" r="26" fill="#FFFFFF" fill-opacity="0.14" />
  <text x="516" y="160" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">Öne Çıkan</text>
  <text x="516" y="184" font-family="Inter, system-ui, sans-serif" font-size="12" fill="#FFFFFF" fill-opacity="0.88">Erişilebilir · Modern</text>
  <rect x="516" y="212" width="96" height="28" rx="8" fill="#FFFFFF" fill-opacity="0.22" />
  <text x="536" y="230" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="600" fill="#FFFFFF">Canlı Önizle</text>

  <!-- 3 Feature Cards -->
  <rect x="76" y="294" width="204" height="154" rx="14" fill="${bg}" stroke="${border}" />
  <rect x="94" y="314" width="34" height="34" rx="10" fill="${primary}" fill-opacity="0.16" />
  <circle cx="111" cy="331" r="7" fill="${primary}" />
  <text x="94" y="376" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="600" fill="${fg}">Sade Yerleşim</text>
  <text x="94" y="398" font-family="Inter, system-ui, sans-serif" font-size="11.5" fill="${muted}">8px ızgara ritmi ve</text>
  <text x="94" y="416" font-family="Inter, system-ui, sans-serif" font-size="11.5" fill="${muted}">temiz tipografi</text>

  <rect x="298" y="294" width="204" height="154" rx="14" fill="${bg}" stroke="${border}" />
  <rect x="316" y="314" width="34" height="34" rx="10" fill="${accent}" fill-opacity="0.18" />
  <rect x="326" y="324" width="14" height="14" rx="4" fill="${accent}" />
  <text x="316" y="376" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="600" fill="${fg}">Hızlı Etkileşim</text>
  <text x="316" y="398" font-family="Inter, system-ui, sans-serif" font-size="11.5" fill="${muted}">Duyarlı bileşenler ve</text>
  <text x="316" y="416" font-family="Inter, system-ui, sans-serif" font-size="11.5" fill="${muted}">anında geri bildirim</text>

  <rect x="520" y="294" width="204" height="154" rx="14" fill="${bg}" stroke="${border}" />
  <rect x="538" y="314" width="34" height="34" rx="10" fill="#22A06B" fill-opacity="0.16" />
  <polygon points="555,323 563,339 547,339" fill="#22A06B" />
  <text x="538" y="376" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="600" fill="${fg}">Koda Hazır</text>
  <text x="538" y="398" font-family="Inter, system-ui, sans-serif" font-size="11.5" fill="${muted}">Gönder ▸ Claude ile</text>
  <text x="538" y="416" font-family="Inter, system-ui, sans-serif" font-size="11.5" fill="${muted}">HTML/React üret</text>
</svg>`;
}
