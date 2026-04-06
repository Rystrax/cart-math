import { useState, useEffect } from "react";

const SUPABASE_URL = "https://tvmunokrxcbcdvkwrnkp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2bXVub2tyeGNiY2R2a3dybmtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzOTYyNDQsImV4cCI6MjA5MDk3MjI0NH0.0FE9-XFDAcZgkuxhGIZjS7PQRU-3v_q3tZTFUYjUOXA";

const db = async (endpoint, options = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

const STORE_COLORS = {
  costco:      { bg: "#E8002D", text: "#fff", label: "Costco" },
  food_basics: { bg: "#009B3A", text: "#fff", label: "Food Basics" },
  sale:        { bg: "#FF6B00", text: "#fff", label: "Watch for Sales" },
  anywhere:    { bg: "#6B21A8", text: "#fff", label: "Best Deal Wins" },
};

const getRec = (notes = "") => {
  const n = notes.toLowerCase();
  if (n.includes("always costco")) return "costco";
  if (n.includes("always food basics") || n.includes("always fb")) return "food_basics";
  if (n.includes("wherever")) return "anywhere";
  return "sale";
};

const fmtPrice = (p) => p < 0.1 ? p.toFixed(4) : p < 1 ? p.toFixed(3) : p.toFixed(2);

export default function CartMath() {
  const [tab, setTab] = useState("lookup");
  const [products, setProducts] = useState([]);
  const [stores, setStores] = useState([]);
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [selected, setSelected] = useState(null);

  const [listItems, setListItems] = useState([]);
  const [maxStores, setMaxStores] = useState(2);
  const [listBuilt, setListBuilt] = useState(false);

  const [submitStep, setSubmitStep] = useState(0);
  const [submitData, setSubmitData] = useState({ item: "", store: "", price: "", unit: "", isSale: false });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [prods, strs, prcs] = await Promise.all([
          db("products?select=*&order=category,name"),
          db("stores?select=*"),
          db("prices?select=*"),
        ]);
        setProducts(prods);
        setStores(strs);
        setPrices(prcs);
      } catch (e) {
        setError("Couldn't load data. Check your connection.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const enriched = products.map(p => {
    const productPrices = prices.filter(pr => pr.product_id === p.id);
    const storePrices = {};
    productPrices.forEach(pr => {
      const store = stores.find(s => s.id === pr.store_id);
      if (store) storePrices[store.chain] = pr.price_per_unit;
    });
    const rec = getRec(p.notes);
    const costco = storePrices["costco"];
    const fb = storePrices["food_basics"];
    const bestPrice = costco && fb ? Math.min(costco, fb) : costco || fb;
    const worstPrice = costco && fb ? Math.max(costco, fb) : bestPrice;
    const savingsPct = bestPrice && worstPrice && worstPrice !== bestPrice
      ? Math.round(((worstPrice - bestPrice) / worstPrice) * 100) : 0;
    return { ...p, storePrices, rec, costco, fb, bestPrice, worstPrice, savingsPct };
  });

  const categories = ["All", ...Array.from(new Set(products.map(p => p.category)))];

  const filtered = enriched.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === "All" || p.category === filterCat;
    return matchSearch && matchCat;
  });

  const toggleListItem = (product) => {
    setListBuilt(false);
    setListItems(prev =>
      prev.find(i => i.id === product.id)
        ? prev.filter(i => i.id !== product.id)
        : [...prev, product]
    );
  };

  const costcoItems = listItems.filter(i => i.rec === "costco" || (i.rec === "sale" && i.costco <= (i.fb || Infinity)));
  const fbItems = listItems.filter(i => i.rec === "food_basics" || (i.rec === "sale" && i.fb < (i.costco || Infinity)));
  const anyItems = listItems.filter(i => i.rec === "anywhere");

  const totalCostco = costcoItems.reduce((s, i) => s + (i.costco || 0), 0);
  const totalFB = fbItems.reduce((s, i) => s + (i.fb || 0), 0);
  const totalSavings = listItems.reduce((s, i) => {
    if (!i.costco || !i.fb) return s;
    return s + (Math.max(i.costco, i.fb) - Math.min(i.costco, i.fb));
  }, 0);

  const handleSubmit = async () => {
    if (!submitData.item || !submitData.store || !submitData.price) return;
    setSubmitting(true);
    try {
      const matchedStore = stores.find(s =>
        s.name.toLowerCase().includes(submitData.store.toLowerCase()) ||
        s.chain.toLowerCase().includes(submitData.store.toLowerCase())
      );
      const matchedProduct = products.find(p =>
        p.name.toLowerCase().includes(submitData.item.toLowerCase())
      );
      if (matchedProduct && matchedStore) {
        await db("prices", {
          method: "POST",
          body: JSON.stringify({
            product_id: matchedProduct.id,
            store_id: matchedStore.id,
            price_per_unit: parseFloat(submitData.price),
            is_sale: submitData.isSale,
            source: "community",
            province: "ON",
            date_recorded: new Date().toISOString().split("T")[0],
            submitted_by: "community",
          }),
        });
      }
      setSubmitStep(2);
    } catch (e) {
      setSubmitStep(2);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div style={{ background: "#0A0A0A", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap'); @keyframes load{0%{width:0%}50%{width:100%}100%{width:0%}}`}</style>
      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 36, color: "#BAFF39", letterSpacing: 3 }}>CART MATH</div>
      <div style={{ color: "#333", fontSize: 12, letterSpacing: 2, fontFamily: "monospace" }}>LOADING PRICES...</div>
      <div style={{ width: 120, height: 2, background: "#1a1a1a", borderRadius: 2, overflow: "hidden", marginTop: 8 }}>
        <div style={{ height: "100%", background: "#BAFF39", animation: "load 1.2s ease-in-out infinite", borderRadius: 2 }} />
      </div>
    </div>
  );

  if (error) return (
    <div style={{ background: "#0A0A0A", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>
      <div style={{ color: "#E8002D", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⚠</div>
        <div>{error}</div>
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: "'DM Mono','Courier New',monospace", background: "#0A0A0A", minHeight: "100vh", display: "flex", justifyContent: "center" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        ::-webkit-scrollbar{display:none;}
        .btn{transition:all 0.15s ease;cursor:pointer;}
        .btn:active{transform:scale(0.96);}
        .card{transition:all 0.2s ease;cursor:pointer;}
        .card:active{transform:scale(0.98);opacity:0.9;}
        input{outline:none;}
        input::placeholder{color:#333;}
        @keyframes slideUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
        .slide-up{animation:slideUp 0.25s ease forwards;}
        .fade-in{animation:fadeIn 0.2s ease forwards;}
      `}</style>

      <div style={{ width: "100%", maxWidth: 390, minHeight: "100vh", background: "#0A0A0A", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ padding: "52px 20px 16px", borderBottom: "1px solid #1C1C1C", position: "sticky", top: 0, background: "#0A0A0A", zIndex: 100 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 32, color: "#BAFF39", letterSpacing: 2, lineHeight: 1 }}>CART MATH</div>
              <div style={{ color: "#333", fontSize: 11, letterSpacing: 1, marginTop: 2 }}>ONTARIO · LIVE DATA</div>
            </div>
            <div style={{ background: "#141414", borderRadius: 20, padding: "4px 12px", fontSize: 11, color: "#BAFF39", letterSpacing: 0.5 }}>
              {products.length} items tracked
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", background: "#111", borderBottom: "1px solid #1C1C1C" }}>
          {[
            { key: "lookup", icon: "⌕", label: "LOOKUP" },
            { key: "list",   icon: "≡", label: `LIST${listItems.length ? ` (${listItems.length})` : ""}` },
            { key: "submit", icon: "+", label: "SUBMIT" },
          ].map(t => (
            <button key={t.key} className="btn" onClick={() => setTab(t.key)} style={{
              flex: 1, background: "none", border: "none",
              borderBottom: tab === t.key ? "2px solid #BAFF39" : "2px solid transparent",
              color: tab === t.key ? "#BAFF39" : "#444",
              padding: "12px 4px", fontSize: 10, letterSpacing: 1.5, fontFamily: "inherit", fontWeight: 500,
            }}>
              <span style={{ fontSize: 14, display: "block", marginBottom: 2 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 40 }}>

          {/* ── LOOKUP ── */}
          {tab === "lookup" && (
            <div className="fade-in">
              <div style={{ padding: "16px 16px 8px" }}>
                <div style={{ background: "#141414", border: "1px solid #222", borderRadius: 12, display: "flex", alignItems: "center", padding: "10px 14px", gap: 10 }}>
                  <span style={{ color: "#444", fontSize: 16 }}>⌕</span>
                  <input
                    value={search}
                    onChange={e => { setSearch(e.target.value); setSelected(null); }}
                    placeholder="search any grocery item..."
                    style={{ background: "none", border: "none", color: "#fff", fontSize: 14, flex: 1, fontFamily: "inherit" }}
                  />
                  {search && <button className="btn" onClick={() => setSearch("")} style={{ background: "none", border: "none", color: "#444", fontSize: 18, padding: 0 }}>×</button>}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, padding: "4px 16px 12px", overflowX: "auto" }}>
                {categories.map(cat => (
                  <button key={cat} className="btn" onClick={() => setFilterCat(cat)} style={{
                    background: filterCat === cat ? "#BAFF39" : "#141414",
                    color: filterCat === cat ? "#000" : "#555",
                    border: "none", borderRadius: 20, padding: "6px 14px",
                    fontSize: 11, fontFamily: "inherit", whiteSpace: "nowrap",
                    letterSpacing: 0.5, fontWeight: filterCat === cat ? 500 : 400,
                  }}>{cat}</button>
                ))}
              </div>

              {selected && (
                <div className="slide-up" style={{ margin: "0 16px 16px", background: "#111", border: "1px solid #222", borderRadius: 16, overflow: "hidden" }}>
                  <div style={{ background: STORE_COLORS[selected.rec]?.bg || "#333", padding: "16px 20px" }}>
                    <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.8, color: "#fff" }}>BEST BUY</div>
                    <div style={{ fontSize: 22, fontFamily: "'Bebas Neue'", color: "#fff", letterSpacing: 1, marginTop: 2 }}>{STORE_COLORS[selected.rec]?.label}</div>
                    <div style={{ color: "#fff", opacity: 0.85, fontSize: 12, marginTop: 4 }}>{selected.notes}</div>
                  </div>
                  <div style={{ padding: "16px 20px" }}>
                    <div style={{ fontSize: 18, color: "#fff", fontFamily: "'Bebas Neue'", letterSpacing: 1, marginBottom: 16 }}>{selected.name}</div>
                    <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                      {[{ label: "COSTCO", price: selected.costco }, { label: "FOOD BASICS", price: selected.fb }].map(s => (
                        <div key={s.label} style={{ flex: 1, background: "#1a1a1a", borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>{s.label}</div>
                          <div style={{ fontSize: 20, color: s.price ? "#fff" : "#333", marginTop: 4 }}>{s.price ? `$${fmtPrice(s.price)}` : "—"}</div>
                          <div style={{ fontSize: 10, color: "#444" }}>/{selected.unit_type}</div>
                        </div>
                      ))}
                    </div>
                    {selected.savingsPct > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: "#555", letterSpacing: 1 }}>SAVINGS</span>
                          <span style={{ fontSize: 11, color: "#BAFF39" }}>{selected.savingsPct}% cheaper</span>
                        </div>
                        <div style={{ height: 4, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${selected.savingsPct}%`, background: "linear-gradient(90deg,#BAFF39,#39FF87)", borderRadius: 2 }} />
                        </div>
                      </div>
                    )}
                    <button className="btn" onClick={() => toggleListItem(selected)} style={{
                      width: "100%",
                      background: listItems.find(i => i.id === selected.id) ? "#1a1a1a" : "#BAFF39",
                      color: listItems.find(i => i.id === selected.id) ? "#BAFF39" : "#000",
                      border: listItems.find(i => i.id === selected.id) ? "1px solid #BAFF39" : "none",
                      borderRadius: 10, padding: "12px", fontSize: 12, letterSpacing: 1.5, fontFamily: "inherit", fontWeight: 500,
                    }}>
                      {listItems.find(i => i.id === selected.id) ? "✓ ON YOUR LIST" : "+ ADD TO LIST"}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.length === 0 && (
                  <div style={{ textAlign: "center", color: "#333", padding: "40px 0", fontSize: 13 }}>no results — submit this item?</div>
                )}
                {filtered.map(p => (
                  <button key={p.id} className="card" onClick={() => setSelected(selected?.id === p.id ? null : p)} style={{
                    background: selected?.id === p.id ? "#161616" : "#111",
                    border: `1px solid ${selected?.id === p.id ? "#BAFF39" : "#1C1C1C"}`,
                    borderRadius: 12, padding: "14px 16px",
                    display: "flex", alignItems: "center", gap: 12, textAlign: "left", width: "100%",
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: STORE_COLORS[p.rec]?.bg || "#555", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#fff", fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                      <div style={{ color: "#444", fontSize: 11, marginTop: 2 }}>{p.category}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: STORE_COLORS[p.rec]?.bg }}>{STORE_COLORS[p.rec]?.label}</div>
                      {p.savingsPct > 0 && <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{p.savingsPct}% savings</div>}
                    </div>
                    {listItems.find(i => i.id === p.id) && <div style={{ color: "#BAFF39", fontSize: 12 }}>✓</div>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── LIST ── */}
          {tab === "list" && (
            <div className="fade-in" style={{ padding: 16 }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: "#555", fontSize: 11, letterSpacing: 1, marginBottom: 8 }}>MAX STORES TO VISIT</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[1, 2, 3].map(n => (
                    <button key={n} className="btn" onClick={() => { setMaxStores(n); setListBuilt(false); }} style={{
                      flex: 1, background: maxStores === n ? "#BAFF39" : "#141414",
                      color: maxStores === n ? "#000" : "#555",
                      border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontFamily: "inherit",
                    }}>{n} {n === 1 ? "store" : "stores"}</button>
                  ))}
                </div>
              </div>

              {listItems.length === 0 ? (
                <div style={{ background: "#111", border: "1px dashed #222", borderRadius: 16, padding: "48px 24px", textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🛒</div>
                  <div style={{ color: "#333", fontSize: 13 }}>your list is empty</div>
                  <div style={{ color: "#222", fontSize: 11, marginTop: 6 }}>search & add items from the Lookup tab</div>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    {listItems.map(item => (
                      <div key={item.id} style={{ background: "#111", border: "1px solid #1C1C1C", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: STORE_COLORS[item.rec]?.bg || "#555", flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ color: "#fff", fontSize: 13 }}>{item.name}</div>
                          <div style={{ color: "#444", fontSize: 11, marginTop: 2 }}>{item.notes}</div>
                        </div>
                        <button className="btn" onClick={() => toggleListItem(item)} style={{ background: "none", border: "none", color: "#333", fontSize: 20, padding: "0 4px" }}>×</button>
                      </div>
                    ))}
                  </div>

                  <button className="btn" onClick={() => setListBuilt(true)} style={{
                    width: "100%", background: "#BAFF39", color: "#000", border: "none",
                    borderRadius: 12, padding: "16px", fontSize: 13, letterSpacing: 2,
                    fontFamily: "inherit", fontWeight: 500, marginBottom: 16,
                  }}>BUILD SHOPPING PLAN →</button>

                  {listBuilt && (
                    <div className="slide-up">
                      <div style={{ color: "#555", fontSize: 11, letterSpacing: 1, marginBottom: 12 }}>YOUR OPTIMIZED PLAN</div>

                      {totalSavings > 0 && (
                        <div style={{ background: "#0D1F00", border: "1px solid #BAFF39", borderRadius: 14, padding: "16px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 11, color: "#BAFF39", letterSpacing: 1, opacity: 0.7 }}>ESTIMATED SAVINGS</div>
                            <div style={{ fontSize: 28, color: "#BAFF39", fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>${totalSavings.toFixed(2)} / unit</div>
                          </div>
                          <div style={{ fontSize: 32 }}>💸</div>
                        </div>
                      )}

                      {[
                        { items: costcoItems, label: "COSTCO", bg: "#E8002D", total: totalCostco },
                        { items: fbItems, label: "FOOD BASICS", bg: "#009B3A", total: totalFB },
                      ].map(section => section.items.length > 0 && (
                        <div key={section.label} style={{ background: "#111", border: "1px solid #1C1C1C", borderRadius: 14, overflow: "hidden", marginBottom: 10 }}>
                          <div style={{ background: section.bg, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ color: "#fff", fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 1 }}>{section.label}</div>
                            <div style={{ color: "#fff", fontSize: 11, opacity: 0.85 }}>${section.total.toFixed(2)} est.</div>
                          </div>
                          {section.items.map(i => (
                            <div key={i.id} style={{ padding: "10px 16px", borderBottom: "1px solid #1A1A1A", display: "flex", justifyContent: "space-between" }}>
                              <span style={{ color: "#ccc", fontSize: 13 }}>{i.name}</span>
                              <span style={{ color: "#555", fontSize: 12 }}>
                                ${fmtPrice(section.label === "COSTCO" ? i.costco : i.fb)}/{i.unit_type}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}

                      {anyItems.length > 0 && (
                        <div style={{ background: "#111", border: "1px solid #1C1C1C", borderRadius: 14, overflow: "hidden", marginBottom: 10 }}>
                          <div style={{ background: "#6B21A8", padding: "10px 16px" }}>
                            <div style={{ color: "#fff", fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 1 }}>WATCH FOR SALES</div>
                          </div>
                          {anyItems.map(i => (
                            <div key={i.id} style={{ padding: "10px 16px", borderBottom: "1px solid #1A1A1A", display: "flex", justifyContent: "space-between" }}>
                              <span style={{ color: "#ccc", fontSize: 13 }}>{i.name}</span>
                              <span style={{ color: "#555", fontSize: 11 }}>check flyers</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── SUBMIT ── */}
          {tab === "submit" && (
            <div className="fade-in" style={{ padding: 16 }}>
              <div style={{ color: "#555", fontSize: 11, letterSpacing: 1, marginBottom: 16 }}>SUBMIT A PRICE — HELP THE COMMUNITY</div>

              {submitStep === 0 && (
                <div className="slide-up" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="btn" style={{ background: "#111", border: "1px dashed #222", borderRadius: 16, padding: "48px 24px", textAlign: "center" }}
                    onClick={() => setSubmitStep(1)}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
                    <div style={{ color: "#fff", fontSize: 14, marginBottom: 6 }}>Take a photo of the price tag</div>
                    <div style={{ color: "#444", fontSize: 12 }}>We'll read the price automatically</div>
                  </div>
                  <div style={{ textAlign: "center", color: "#333", fontSize: 12 }}>— or enter manually —</div>
                  <button className="btn" onClick={() => setSubmitStep(1)} style={{
                    background: "#141414", border: "1px solid #222", borderRadius: 12,
                    padding: "14px", color: "#888", fontSize: 13, fontFamily: "inherit",
                  }}>Enter price manually →</button>
                </div>
              )}

              {submitStep === 1 && (
                <div className="slide-up" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { key: "item",  label: "ITEM NAME", placeholder: "e.g. Chicken Breast" },
                    { key: "store", label: "STORE",     placeholder: "e.g. Walmart, No Frills..." },
                    { key: "price", label: "PRICE",     placeholder: "e.g. 14.99" },
                    { key: "unit",  label: "UNIT",      placeholder: "e.g. /kg, /100g, /L" },
                  ].map(f => (
                    <div key={f.key}>
                      <div style={{ color: "#444", fontSize: 10, letterSpacing: 1.5, marginBottom: 6 }}>{f.label}</div>
                      <input
                        value={submitData[f.key]}
                        onChange={e => setSubmitData({ ...submitData, [f.key]: e.target.value })}
                        placeholder={f.placeholder}
                        style={{ width: "100%", background: "#111", border: "1px solid #1C1C1C", borderRadius: 10, padding: "14px 16px", color: "#fff", fontSize: 14, fontFamily: "inherit" }}
                      />
                    </div>
                  ))}

                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0" }}>
                    <div className="btn" onClick={() => setSubmitData({ ...submitData, isSale: !submitData.isSale })} style={{
                      width: 44, height: 24, borderRadius: 12,
                      background: submitData.isSale ? "#BAFF39" : "#1C1C1C",
                      position: "relative", transition: "background 0.2s",
                    }}>
                      <div style={{
                        position: "absolute", top: 3,
                        left: submitData.isSale ? 23 : 3,
                        width: 18, height: 18, borderRadius: "50%",
                        background: submitData.isSale ? "#000" : "#333",
                        transition: "left 0.2s",
                      }} />
                    </div>
                    <span style={{ color: "#666", fontSize: 13 }}>This is a sale price</span>
                  </div>

                  <div style={{ background: "#111", border: "1px solid #1C1C1C", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 18 }}>📍</span>
                    <div>
                      <div style={{ color: "#666", fontSize: 12 }}>Location captured automatically</div>
                      <div style={{ color: "#333", fontSize: 11, marginTop: 2 }}>Ontario, Canada</div>
                    </div>
                  </div>

                  <button className="btn" onClick={handleSubmit} disabled={submitting} style={{
                    width: "100%", background: submitting ? "#333" : "#BAFF39",
                    color: submitting ? "#666" : "#000", border: "none",
                    borderRadius: 12, padding: "16px", fontSize: 13,
                    letterSpacing: 2, fontFamily: "inherit", fontWeight: 500, marginTop: 4,
                  }}>
                    {submitting ? "SUBMITTING..." : "SUBMIT PRICE →"}
                  </button>
                </div>
              )}

              {submitStep === 2 && (
                <div className="slide-up" style={{ textAlign: "center", padding: "48px 24px" }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
                  <div style={{ fontFamily: "'Bebas Neue'", fontSize: 28, color: "#BAFF39", letterSpacing: 2, marginBottom: 8 }}>PRICE SUBMITTED</div>
                  <div style={{ color: "#444", fontSize: 13, marginBottom: 32 }}>Thanks for helping the community save money.</div>
                  <button className="btn" onClick={() => { setSubmitStep(0); setSubmitData({ item: "", store: "", price: "", unit: "", isSale: false }); }} style={{
                    background: "#141414", border: "1px solid #222", borderRadius: 12,
                    padding: "14px 24px", color: "#888", fontSize: 13, fontFamily: "inherit",
                  }}>Submit another →</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
