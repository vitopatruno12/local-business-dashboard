import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = "https://local-business-dashboard-602f.onrender.com"; // ✅ niente slash finale
const DEBUG = true; // ✅ metti false quando hai finito

function normalizePhoneToWa(phone) {
  if (!phone) return null;

  let digits = String(phone).replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && !digits.startsWith("39")) digits = "39" + digits;

  return digits.length >= 8 ? digits : null;
}

function buildWhatsAppUrl(phone, message) {
  const wa = normalizePhoneToWa(phone);
  if (!wa) return null;
  const text = encodeURIComponent(message || "");
  return `https://wa.me/${wa}?text=${text}`;
}

export default function App() {
  const [city, setCity] = useState("Casarano");
  const [category, setCategory] = useState("pizzeria");
  const [onlyNoSite, setOnlyNoSite] = useState(false);

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState(null);
  const [selectedLeadId, setSelectedLeadId] = useState(null);

  const [draft, setDraft] = useState("");
  const [savingLead, setSavingLead] = useState(false);
  const [marking, setMarking] = useState(false);

  const [apiOnline, setApiOnline] = useState(false);

  // ✅ DEBUG
  const [lastUrl, setLastUrl] = useState("");
  const [raw, setRaw] = useState(null);
  const [rawText, setRawText] = useState("");
  const [httpInfo, setHttpInfo] = useState({ status: null, contentType: "" });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        setApiOnline(res.ok);
      } catch {
        setApiOnline(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => results, [results]);

  async function handleSearch(e) {
    e.preventDefault();

    setSelected(null);
    setSelectedLeadId(null);
    setDraft("");
    setError("");
    setLoading(true);

    // reset debug
    setRaw(null);
    setRawText("");
    setHttpInfo({ status: null, contentType: "" });
    setLastUrl("");

    try {
      const qs = new URLSearchParams({
        city: city.trim(),
        category: category.trim().toLowerCase(),
        only_without_site: String(onlyNoSite),
        limit: "20",
      });

      const url = `${API_BASE}/search?${qs.toString()}`;
      setLastUrl(url);

      const res = await fetch(url);

      const contentType = res.headers.get("content-type") || "";
      setHttpInfo({ status: res.status, contentType });

      const text = await res.text();
      setRawText(text);

      if (!res.ok) throw new Error(`Errore API: ${res.status} ${text}`);

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      setRaw(data);

      let arr = [];
      if (Array.isArray(data)) arr = data;
      else if (data && typeof data === "object" && Array.isArray(data.results)) arr = data.results;

      setResults(arr);
    } catch (err) {
      setError(err?.message || "Errore di rete");
      setResults([]);
      setRaw(null);
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      alert("Messaggio copiato ✅");
    } catch {
      alert("Non riesco a copiare. Seleziona e copia manualmente.");
    }
  }

  async function saveLead(place) {
    const res = await fetch(`${API_BASE}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        place_id: place.place_id,
        name: place.name,
        address: place.address,
        phone: place.phone,
        rating: place.rating,
        website: place.website,
        city: city.trim(),
        category: category.trim().toLowerCase(),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Errore salvataggio lead: ${res.status} ${text}`);
    }

    return await res.json();
  }

  async function markContacted(leadId) {
    const res = await fetch(`${API_BASE}/leads/${leadId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "contattato" }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Errore aggiornamento stato: ${res.status} ${text}`);
    }

    return await res.json();
  }

  // ✅ Prende il messaggio dal BACKEND (così non rebuildi il frontend quando cambi testo)
  async function fetchMessageFromBackend(place) {
    const qs = new URLSearchParams({
      name: place?.name || "",
      city: city.trim(),
      category: category.trim().toLowerCase(),
    });

    // 🔁 Se il tuo endpoint ha un altro nome, cambia solo qui:
    const url = `${API_BASE}/message?${qs.toString()}`;

    const res = await fetch(url);
    const text = await res.text();

    if (!res.ok) throw new Error(`Errore messaggio: ${res.status} ${text}`);

    // può essere plain text oppure {"message":"..."}
    try {
      const j = JSON.parse(text);
      if (j && typeof j === "object" && typeof j.message === "string") return j.message;
    } catch {
      // era testo semplice
    }
    return text;
  }

  function openWhatsApp(place, messageOverride) {
    const msg = messageOverride ?? draft ?? "";
    const url = buildWhatsAppUrl(place?.phone, msg);

    if (!url) {
      alert("Numero WhatsApp non valido o mancante per questa attività.");
      return;
    }

    if (!msg.trim()) {
      alert("Prima genera il messaggio (o scrivilo nella textarea).");
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleGenerateMessage(place) {
    setError("");
    setSelected(place);
    setSelectedLeadId(null);

    setSavingLead(true);
    try {
      const message = await fetchMessageFromBackend(place);
      setDraft(message);

      const leadId = await saveLead(place);
      setSelectedLeadId(leadId);
    } catch (err) {
      setError(err?.message || "Errore generazione/salvataggio lead");
    } finally {
      setSavingLead(false);
    }
  }

  async function handleGenerateAndOpenWhatsApp(place) {
    setError("");
    setSelected(place);
    setSelectedLeadId(null);

    setSavingLead(true);
    try {
      const message = await fetchMessageFromBackend(place);
      setDraft(message);

      const leadId = await saveLead(place);
      setSelectedLeadId(leadId);

      openWhatsApp(place, message);
    } catch (err) {
      setError(err?.message || "Errore generazione/salvataggio lead");
    } finally {
      setSavingLead(false);
    }
  }

  async function handleMarkContacted() {
    if (!selectedLeadId) return;

    setError("");
    setMarking(true);
    try {
      await markContacted(selectedLeadId);
      alert("Segnato come CONTATTATO ✅");
    } catch (err) {
      setError(err?.message || "Errore aggiornamento stato");
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="app-shell">
      {/* TOP BAR */}
      <header className="topbar">
        <div className="container-xl">
          <div className="brand">
            <div className="logo">LB</div>
            <div className="brand-text">
              <div className="brand-title">Local Business Finder</div>
              <div className="brand-sub">Trova attività e prepara messaggi WhatsApp in 1 click</div>
            </div>
          </div>

          <div className="topbar-actions">
            <span className={`status-pill ${apiOnline ? "ok" : "bad"}`}>
              <span className="dot" />
              {apiOnline ? "API online" : "API offline"}
            </span>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="hero">
        <div className="container-xl">
          <div className="hero-card">
            <div className="hero-left">
              <h1>Trova clienti locali, senza stress.</h1>
              <p>
                Cerca attività per città e categoria, poi genera una bozza WhatsApp professionale e salva il lead per
                tracciarlo.
              </p>
              <div className="hero-kpi">
                <div className="kpi">
                  <div className="kpi-label">Risultati</div>
                  <div className="kpi-value">{filtered.length}</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Città</div>
                  <div className="kpi-value">{city || "—"}</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Categoria</div>
                  <div className="kpi-value">{category || "—"}</div>
                </div>
              </div>
            </div>

            <div className="hero-right">
              <div className="hint">
                <div className="hint-title">Tip rapido</div>
                <div className="hint-text">
                  Prova categorie come <b>pizzeria</b>, <b>bar</b>, <b>ristorante</b>, <b>hotel</b>.
                </div>
              </div>
              <div className="hint secondary">
                <div className="hint-title">Workflow</div>
                <div className="hint-text">1) Cerca → 2) Genera → 3) WhatsApp → 4) Segna contattato ✅</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MAIN */}
      <main className="container-xl main-grid">
        {/* LEFT: FILTERS */}
        <aside className="cardx">
          <div className="cardx-head">
            <div>
              <div className="cardx-title">Ricerca</div>
              <div className="cardx-sub">Imposta filtri e lancia la query</div>
            </div>
          </div>

          <form onSubmit={handleSearch} className="formx">
            <div className="field">
              <label>Città</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Es. Casarano" />
            </div>

            <div className="field">
              <label>Categoria</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Es. pizzeria" />
              <div className="help">Esempi: pizzeria, bar, ristorante, hotel, agenzia immobiliare…</div>
            </div>

            <label className="checkline">
              <input type="checkbox" checked={onlyNoSite} onChange={(e) => setOnlyNoSite(e.target.checked)} />
              <span>
                Mostra solo attività <b>senza sito</b>
              </span>
            </label>

            <button className="btnx primary" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" /> Cercando…
                </>
              ) : (
                <>🔎 Cerca</>
              )}
            </button>

            <div className="footnote">
              Fonte: <code>{API_BASE}</code>
            </div>
          </form>
        </aside>

        {/* RIGHT: RESULTS + DRAFT */}
        <section className="cardx">
          <div className="cardx-head split">
            <div>
              <div className="cardx-title">Risultati</div>
              <div className="cardx-sub">Genera e contatta via WhatsApp</div>
            </div>
            <div className="pill-count">{filtered.length} trovati</div>
          </div>

          {error && <div className="alertx danger">⚠️ {error}</div>}
          {loading && <div className="alertx warn">⏳ Caricamento…</div>}

          <div className="tablex-wrap">
            <table className="tablex">
              <thead>
                <tr>
                  <th>Attività</th>
                  <th>Contatti</th>
                  <th>Rating</th>
                  <th>Sito</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {filtered.map((x) => (
                  <tr key={x.place_id}>
                    <td>
                      <div className="name">{x.name}</div>
                      <div className="sub">{x.address || "Indirizzo non disponibile"}</div>
                    </td>

                    <td className="mono">{x.phone ?? <span className="muted">Non disponibile</span>}</td>

                    <td>
                      <span className="badge">{x.rating ?? "n.d."}</span>
                    </td>

                    <td>{x.website ? <span className="chip ok">🌐 Sito</span> : <span className="chip bad">🚫 No sito</span>}</td>

                    <td className="right">
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="btnx ghost" disabled={savingLead} onClick={() => handleGenerateMessage(x)}>
                          {savingLead ? "Salvo…" : "✍️ Genera"}
                        </button>

                        <button
                          className="btnx success"
                          disabled={savingLead || !x.phone}
                          title={!x.phone ? "Telefono non disponibile" : "Apri WhatsApp con messaggio pronto"}
                          onClick={() => handleGenerateAndOpenWhatsApp(x)}
                        >
                          💬 WhatsApp
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan="5" className="empty">
                      Nessun risultato. Prova una ricerca.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ✅ DEBUG PANEL */}
          {DEBUG && (
            <div style={{ padding: "12px 14px 0" }}>
              <div className="alertx warn">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>DEBUG</div>

                <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 6 }}>
                  <div>
                    <b>Last URL:</b> {lastUrl || "—"}
                  </div>
                  <div>
                    <b>HTTP status:</b> {httpInfo.status ?? "—"}
                  </div>
                  <div>
                    <b>Content-Type:</b> {httpInfo.contentType || "—"}
                  </div>
                  <div>
                    <b>results.length:</b> {results.length}
                  </div>
                  <div>
                    <b>raw type:</b> {raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw}
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>RAW TEXT (risposta server)</div>

                <pre
                  style={{
                    margin: "0 0 8px 0",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 12,
                    opacity: 0.9,
                    maxHeight: 200,
                    overflow: "auto",
                    background: "#111",
                    color: "#0f0",
                    padding: 8,
                    borderRadius: 6,
                  }}
                >
                  {rawText || "—"}
                </pre>

                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>PARSED JSON</div>

                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 12,
                    opacity: 0.9,
                    maxHeight: 200,
                    overflow: "auto",
                  }}
                >
                  {raw === null ? "—" : JSON.stringify(raw, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* DRAFT */}
          <div className="divider" />

          <div className="draft-head">
            <div>
              <div className="cardx-title sm">Bozza WhatsApp</div>
              <div className="cardx-sub">
                {selected ? (
                  <>
                    Per: <b>{selected.name}</b>
                  </>
                ) : (
                  "Seleziona un’attività e clicca “Genera”."
                )}
              </div>
            </div>

            {selectedLeadId && <div className="pill-id">Lead ID: {selectedLeadId}</div>}
          </div>

          <textarea
            className="textareax"
            rows={7}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Qui apparirà la bozza..."
          />

          <div className="actions">
            <button className="btnx success" disabled={!draft.trim()} onClick={() => copyToClipboard(draft)}>
              ✅ Copia
            </button>

            <button className="btnx ghost" disabled={!draft.trim()} onClick={() => setDraft("")}>
              🧹 Svuota
            </button>

            <button className="btnx dark" disabled={!selectedLeadId || marking} onClick={handleMarkContacted}>
              {marking ? "⏳ Aggiorno…" : "📌 Segna contattato"}
            </button>

            <button
              className="btnx success"
              disabled={!selected || !selected.phone}
              title={!selected?.phone ? "Seleziona un’attività con telefono" : "Apri WhatsApp con il testo attuale"}
              onClick={() => openWhatsApp(selected, draft)}
            >
              💬 Apri WhatsApp
            </button>
          </div>

          <div className="footnote">Consiglio: invio manuale (più risposte, zero spam).</div>
        </section>
      </main>
    </div>
  );
}
