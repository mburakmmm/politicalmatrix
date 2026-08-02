"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { SimulationState } from "@/lib/types";

type LlmProvider = "lm_studio" | "openrouter";

type ModelItem = {
  id: string;
  name?: string;
  curated?: boolean;
  tools?: boolean;
};

export default function SettingsPage() {
  const [state, setState] = useState<SimulationState | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelItems, setModelItems] = useState<ModelItem[]>([]);
  const [lmError, setLmError] = useState<string | null>(null);
  const [providerConnected, setProviderConnected] = useState(false);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("lm_studio");
  const [modelMap, setModelMap] = useState<Record<string, string>>({
    left: "",
    center: "",
    right: "",
  });
  const [prompts, setPrompts] = useState<
    Array<{ slug: string; name: string; system_prompt: string }>
  >([]);
  const [lmBaseUrl, setLmBaseUrl] = useState("http://127.0.0.1:1234/v1");
  const [openrouterBaseUrl, setOpenrouterBaseUrl] = useState(
    "https://openrouter.ai/api/v1"
  );
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [seed, setSeed] = useState("");
  const [scenarioId, setScenarioId] = useState("balanced");
  const [tickMode, setTickMode] = useState("hybrid");
  const [observerModelId, setObserverModelId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [manualModel, setManualModel] = useState("");

  const loadModels = useCallback(async () => {
    setModelsBusy(true);
    try {
      const modelsRes = await fetch("/api/lm/models", { cache: "no-store" });
      const m = await modelsRes.json();
      setModels(m.models || []);
      setModelItems(m.model_items || []);
      setProviderConnected(Boolean(m.connected));
      setLmError(m.connected ? null : m.error || "Sağlayıcı bağlantısı yok");
    } catch (err) {
      setProviderConnected(false);
      setLmError(err instanceof Error ? err.message : String(err));
    } finally {
      setModelsBusy(false);
    }
  }, []);

  const load = useCallback(async () => {
    const stateRes = await fetch("/api/state", { cache: "no-store" });
    const s = (await stateRes.json()) as SimulationState;
    setState(s);
    setLlmProvider(s.settings.llm_provider || s.llmProvider || "lm_studio");
    setModelMap({
      left: s.settings.model_map.left || s.settings.model_map.reformist || "",
      center: s.settings.model_map.center || s.settings.model_map.populist || "",
      right: s.settings.model_map.right || s.settings.model_map.kingmaker || "",
    });
    setLmBaseUrl(s.settings.lm_base_url);
    setOpenrouterBaseUrl(
      s.settings.openrouter_base_url || "https://openrouter.ai/api/v1"
    );
    setOpenrouterApiKey(s.settings.openrouter_api_key || "");
    setPrompts(
      s.parties.map((p) => ({
        slug: p.slug,
        name: p.name,
        system_prompt: p.system_prompt,
      }))
    );
    setScenarioId(s.simulation.scenario_id || "balanced");
    setTickMode(String(s.simulation.tick_mode || "hybrid"));
    setObserverModelId(s.settings.observer_model_id || "");
    await loadModels();
  }, [loadModels]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async (opts?: { reloadModels?: boolean }) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llm_provider: llmProvider,
          lm_base_url: lmBaseUrl,
          openrouter_base_url: openrouterBaseUrl,
          openrouter_api_key: openrouterApiKey,
          model_map: modelMap,
          party_prompts: prompts,
          tick_mode: tickMode,
          observer_model_id: observerModelId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kayıt başarısız");
      setState(data.state);
      setMessage("Ayarlar kaydedildi.");
      if (opts?.reloadModels !== false) {
        await loadModels();
      }
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const switchProvider = async (next: LlmProvider) => {
    setLlmProvider(next);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llm_provider: next,
          lm_base_url: lmBaseUrl,
          openrouter_base_url: openrouterBaseUrl,
          openrouter_api_key: openrouterApiKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sağlayıcı kaydı başarısız");
      setState(data.state);
      setMessage(
        next === "openrouter"
          ? "OpenRouter seçildi — model listesi yenileniyor."
          : "LM Studio seçildi — model listesi yenileniyor."
      );
      await loadModels();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const newGame = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llm_provider: llmProvider,
          model_map: modelMap,
          lm_base_url: lmBaseUrl,
          openrouter_base_url: openrouterBaseUrl,
          openrouter_api_key: openrouterApiKey,
        }),
      });
      const res = await fetch("/api/sim/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed: seed ? Number(seed) : undefined,
          modelMap,
          scenarioId,
          tickMode,
          observerModelId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sıfırlama başarısız");
      setState(data.state);
      setMessage("Yeni simülasyon oluşturuldu.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const exportSnapshot = () => {
    window.location.href = "/api/snapshot";
  };

  const importSnapshot = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch("/api/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "İçe aktarma başarısız");
      setMessage("Snapshot yüklendi.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const applySameModel = (modelId: string) => {
    setModelMap({
      left: modelId,
      center: modelId,
      right: modelId,
    });
  };

  const applyManualModel = () => {
    const id = manualModel.trim();
    if (!id) return;
    applySameModel(id);
    if (!models.includes(id)) {
      setModels((prev) => [id, ...prev]);
      setModelItems((prev) => [{ id, name: id, curated: true }, ...prev]);
    }
  };

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p style={{ color: "var(--muted)" }}>Ayarlar yükleniyor…</p>
      </main>
    );
  }

  const partySlots = [
    { slug: "left", label: "Sol Parti" },
    { slug: "center", label: "Merkez Parti" },
    { slug: "right", label: "Sağ Parti" },
  ];

  const curated = modelItems.filter((m) => m.curated);
  const live = modelItems.filter((m) => !m.curated);
  const providerName =
    llmProvider === "openrouter" ? "OpenRouter" : "LM Studio";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p
            className="text-xs tracking-[0.2em] uppercase"
            style={{ color: "var(--gold)" }}
          >
            PoliticalMatrix
          </p>
          <h1
            className="text-2xl"
            style={{ fontFamily: "var(--font-display), serif" }}
          >
            Ayarlar
          </h1>
        </div>
        <Link href="/" className="btn btn-ghost">
          Dashboard
        </Link>
      </div>

      {message && (
        <div
          className="mb-4 border border-[var(--line)] px-3 py-2 text-sm"
          style={{ background: "rgba(212,175,55,0.08)" }}
        >
          {message}
        </div>
      )}

      <section className="panel mb-4 p-5">
        <h2
          className="mb-3 text-sm tracking-[0.12em] uppercase"
          style={{ color: "var(--gold-soft)" }}
        >
          LLM Sağlayıcı
        </h2>
        <label className="label">Sağlayıcı</label>
        <select
          className="select mb-3"
          value={llmProvider}
          disabled={busy}
          onChange={(e) => void switchProvider(e.target.value as LlmProvider)}
        >
          <option value="lm_studio">LM Studio (yerel)</option>
          <option value="openrouter">OpenRouter (bulut)</option>
        </select>

        {llmProvider === "lm_studio" ? (
          <>
            <label className="label">LM Studio Base URL</label>
            <input
              className="input mb-3"
              value={lmBaseUrl}
              onChange={(e) => setLmBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:1234/v1"
            />
          </>
        ) : (
          <>
            <label className="label">
              OpenRouter API Key{" "}
              <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                (opsiyonel — model listesi için gerekmez)
              </span>
            </label>
            <input
              className="input mb-3"
              type="password"
              autoComplete="off"
              value={openrouterApiKey}
              onChange={(e) => setOpenrouterApiKey(e.target.value)}
              placeholder="sk-or-v1-… (isteğe bağlı)"
            />
            <label className="label">OpenRouter Base URL</label>
            <input
              className="input mb-3"
              value={openrouterBaseUrl}
              onChange={(e) => setOpenrouterBaseUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
            />
            <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
              Katalog herkese açık listelenir. Anahtar yalnızca chat/tool
              çağrıları için; istersen Ayarlar’da veya{" "}
              <code>OPENROUTER_API_KEY</code> ile koy.
            </p>
          </>
        )}

        {lmError ? (
          <p
            className="mb-3 text-sm"
            style={{ color: providerConnected ? "#d4a017" : "#e8c8c0" }}
          >
            {providerName} · {lmError}
            {llmProvider === "openrouter" && models.length > 0
              ? " · Önerilen modeller yine de combolarda."
              : ""}
          </p>
        ) : (
          <p className="mb-3 text-sm" style={{ color: "#3d9a6a" }}>
            {providerName} bağlı · {models.length} model
          </p>
        )}

        <div className="mb-3 flex flex-wrap gap-2">
          <button
            className="btn"
            disabled={busy || modelsBusy}
            onClick={() => void saveSettings()}
          >
            Bağlantı ayarlarını kaydet
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy || modelsBusy}
            onClick={() => void loadModels()}
          >
            {modelsBusy ? "Yenileniyor…" : "Model listesini yenile"}
          </button>
        </div>

        {models.length > 0 && (
          <div className="mb-3">
            <label className="label">Tüm partilere aynı modeli ata</label>
            <select
              className="select"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) applySameModel(e.target.value);
              }}
            >
              <option value="">Seçin…</option>
              {curated.length > 0 && (
                <optgroup label="Önerilen">
                  {curated.map((m) => (
                    <option key={`all-c-${m.id}`} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))}
                </optgroup>
              )}
              {live.length > 0 && (
                <optgroup
                  label={
                    llmProvider === "openrouter"
                      ? "OpenRouter (tool-capable)"
                      : "Yüklü modeller"
                  }
                >
                  {live.map((m) => (
                    <option key={`all-l-${m.id}`} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))}
                </optgroup>
              )}
              {curated.length === 0 &&
                live.length === 0 &&
                models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
            </select>
          </div>
        )}

        {llmProvider === "openrouter" && (
          <div>
            <label className="label">
              Model ID elle gir (provider/model)
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                className="input flex-1"
                value={manualModel}
                onChange={(e) => setManualModel(e.target.value)}
                placeholder="örn. anthropic/claude-sonnet-4"
              />
              <button
                className="btn"
                type="button"
                disabled={!manualModel.trim()}
                onClick={applyManualModel}
              >
                Tümüne uygula
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel mb-4 p-5">
        <h2
          className="mb-3 text-sm tracking-[0.12em] uppercase"
          style={{ color: "var(--gold-soft)" }}
        >
          Parti → Model Eşlemesi
        </h2>
        <div className="space-y-4">
          {partySlots.map((slot) => (
            <div key={slot.slug}>
              <label className="label">
                {slot.label} ({slot.slug})
              </label>
              <select
                className="select"
                value={modelMap[slot.slug] || ""}
                onChange={(e) =>
                  setModelMap((prev) => ({
                    ...prev,
                    [slot.slug]: e.target.value,
                  }))
                }
              >
                <option value="">Model seçin</option>
                {curated.length > 0 && (
                  <optgroup label="Önerilen">
                    {curated.map((m) => (
                      <option key={`${slot.slug}-c-${m.id}`} value={m.id}>
                        {m.name || m.id}
                      </option>
                    ))}
                  </optgroup>
                )}
                {live.length > 0 && (
                  <optgroup
                    label={
                      llmProvider === "openrouter"
                        ? "OpenRouter kataloğu"
                        : "Yüklü modeller"
                    }
                  >
                    {live.map((m) => (
                      <option key={`${slot.slug}-l-${m.id}`} value={m.id}>
                        {m.name || m.id}
                      </option>
                    ))}
                  </optgroup>
                )}
                {curated.length === 0 &&
                  live.length === 0 &&
                  models.map((m) => (
                    <option key={`${slot.slug}-${m}`} value={m}>
                      {m}
                    </option>
                  ))}
                {modelMap[slot.slug] &&
                  !models.includes(modelMap[slot.slug]) && (
                    <option value={modelMap[slot.slug]}>
                      {modelMap[slot.slug]} (listede yok)
                    </option>
                  )}
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="panel mb-4 p-5">
        <h2
          className="mb-3 text-sm tracking-[0.12em] uppercase"
          style={{ color: "var(--gold-soft)" }}
        >
          System Prompt’lar
        </h2>
        <div className="space-y-5">
          {prompts.map((p, idx) => (
            <div key={p.slug}>
              <label className="label">{p.name}</label>
              <input
                className="input mb-2"
                value={p.name}
                onChange={(e) => {
                  const next = [...prompts];
                  next[idx] = { ...p, name: e.target.value };
                  setPrompts(next);
                }}
              />
              <textarea
                className="textarea"
                value={p.system_prompt}
                onChange={(e) => {
                  const next = [...prompts];
                  next[idx] = { ...p, system_prompt: e.target.value };
                  setPrompts(next);
                }}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="panel mb-4 p-5">
        <h2
          className="mb-3 text-sm tracking-[0.12em] uppercase"
          style={{ color: "var(--gold-soft)" }}
        >
          Senaryo / Tick / Spiker
        </h2>
        <label className="label">Senaryo paketi</label>
        <select
          className="select mb-3"
          value={scenarioId}
          onChange={(e) => setScenarioId(e.target.value)}
        >
          {(state.scenarios || []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.description}
            </option>
          ))}
        </select>
        <label className="label">Tick modu</label>
        <select
          className="select mb-3"
          value={tickMode}
          onChange={(e) => setTickMode(e.target.value)}
        >
          <option value="sequential">Sıralı (en tutarlı siyaset)</option>
          <option value="hybrid">Hibrit (iktidar sıra, muhalefet paralel)</option>
          <option value="parallel_intent">Paralel (hızlı, çakışma riski)</option>
        </select>
        <label className="label">Spiker / analist modeli (opsiyonel)</label>
        <select
          className="select mb-3"
          value={observerModelId}
          onChange={(e) => setObserverModelId(e.target.value)}
        >
          <option value="">Kapalı</option>
          {curated.length > 0 && (
            <optgroup label="Önerilen">
              {curated.map((m) => (
                <option key={`obs-c-${m.id}`} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </optgroup>
          )}
          {live.length > 0 && (
            <optgroup label="Katalog">
              {live.map((m) => (
                <option key={`obs-l-${m.id}`} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </optgroup>
          )}
          {curated.length === 0 &&
            live.length === 0 &&
            models.map((m) => (
              <option key={`obs-${m}`} value={m}>
                {m}
              </option>
            ))}
          {observerModelId && !models.includes(observerModelId) && (
            <option value={observerModelId}>
              {observerModelId} (listede yok)
            </option>
          )}
        </select>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Yeni simülasyon ile senaryo uygulanır. Rejim serbestliği her senaryoda
          açıktır.
        </p>
      </section>

      <section className="panel mb-4 p-5">
        <h2
          className="mb-3 text-sm tracking-[0.12em] uppercase"
          style={{ color: "var(--gold-soft)" }}
        >
          Yeni Oyun / Snapshot
        </h2>
        <label className="label">Seed (opsiyonel)</label>
        <input
          className="input mb-3"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="örn. 42"
        />
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-solid"
            disabled={busy}
            onClick={() => void saveSettings()}
          >
            Ayarları Kaydet
          </button>
          <button className="btn" disabled={busy} onClick={() => void newGame()}>
            Yeni Simülasyon
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={exportSnapshot}
          >
            Snapshot İndir
          </button>
          <label className="btn btn-ghost cursor-pointer">
            Snapshot Yükle
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importSnapshot(file);
              }}
            />
          </label>
        </div>
      </section>
    </main>
  );
}
