import { useState, useEffect, useRef } from "react";

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

const STORES = {
  costco:      { label: "Costco",       color: "#E8002D", light: "#FFF0F0" },
  food_basics: { label: "Food Basics",  color: "#009B3A", light: "#F0FFF5" },
  sale:        { label: "Watch Sales",  color: "#FF6B00", light: "#FFF5F0" },
  anywhere:    { label: "Best Deal",    color: "#7C3AED", light: "#F5F0FF" },
};

const getRec = (notes = "") => {
  const n = notes.toLowerCase();
  if (n.includes("always costco")) return "costco";
  if (n.includes("always food basics") || n.includes("always fb")) return "food_basics";
  if (n.includes("wherever")) return "anywhere";
  return "sale";
};

const fmt = (p) => {
  if (!p && p !== 0) return "—";
  return p < 0.1 ? `$${p.toFixed(4)}` : p < 1 ? `$${p.toFixed(3)}` : `$${p.toFixed(2)}`;
};

const CATEGORY_EMOJI = {
  "Meat": "🥩", "Dairy": "🧀", "Frozen": "🧊", "Produce": "🥦",
  "Other": "🛍️", "Non-Perishable": "🥫", "Household": "🧻",
};

function useCountUp(target, duration = 1200) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!target) return;
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setVal(target * ease);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target]);
  return val;
}

export default function CartMath() {
  const [screen, setScreen] = useState("home");
  const [products, setProducts] = useState([]);
  const [stores, setStores] = useState([]);
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [listItems, setListItems] = useState([]);
  const [maxStores, setMaxStores] = useState(2);
  const [listBuilt, setListBuilt] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [submitStep, setSubmitStep] = useState(0);
  const [submitData, setSubmitData] = useState({ item: "", store: "", price: "", unit: "", isSale: false });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [prods, strs, prcs] = await Promise.all([
          db("products?select=*&order=category,name"),
          db("stores?select=*"),
          db("prices?select=*"),
        ]);
        setProducts(prods);
        setStores(strs);
        setPrices(prcs);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const enriched = products.map(p => {
    const pp = prices.filter(pr => pr.product_id === p.id);
    const sp = {};
    pp.forEach(pr => {
      const s = stores.find(s => s.id === pr.store_id);
      if (s) sp[s.chain] = pr.price_per_unit;
    });
    const rec = getRec(p.notes);
    const costco = sp["costco"];
    const fb = sp["food_basics"];
    const best = costco && fb ? Math.min(costco, fb) : costco || fb;
    const worst = costco && fb ? Math.max(costco, fb) : best;
    const savingsPct = best && worst && worst !== best ? Math.round(((worst - best) / worst) * 100) : 0;
    const savingsAbs = best && worst ? worst - best : 0;
    return { ...p, costco, fb, rec, best, worst, savingsPct, savingsAbs };
  });

  const topDeals = [...enriched].sort((a, b) => b.savingsPct - a.savingsPct).slice(0, 5);
  const totalPotentialSavings = enriched.reduce((s, p) => s + (p.savingsAbs || 0), 0);
  const categories = ["All", ...Array.from(new Set(products.map(p => p.category)))];

  const filtered = enriched.filter(p => {
    const ms = p.name.toLowerCase().includes(search.toLowerCase());
    const mc = filterCat === "All" || p.category === filterCat;
    return ms && mc;
  });

  const toggleList = (p) => {
    setListBuilt(false);
    setListItems(prev => prev.find(i => i.id === p.id) ? prev.filter(i => i.id !== p.id) : [...prev, p]);
  };

  const costcoItems = listItems.filter(i => i.rec === "costco" || (i.rec === "sale" && (i.costco || 0) <= (i.fb || Infinity)));
  const fbItems = listItems.filter(i => i.rec === "food_basics" || (i.rec === "sale" && (i.fb || 0) < (i.costco || Infinity)));
  const anyItems = listItems.filter(i => i.rec === "anywhere");
  const listSavings = listItems.reduce((s, i) => s + (i.savingsAbs || 0), 0);

  const handleSubmit = async () => {
    if (!submitData.item || !submitData.store || !submitData.price) return;
    setSubmitting(true);
    try {
      const ms = stores.find(s => s.name.toLowerCase().includes(submitData.store.toLowerCase()) || s.chain.toLowerCase().includes(submitData.store.toLowerCase()));
      const mp = products.find(p => p.name.toLowerCase().includes(submitData.item.toLowerCase()));
      if (mp && ms) {
        await db("prices", {
          method: "POST",
          body: JSON.stringify({
            product_id: mp.id, store_id: ms.id,
            price_per_unit: parseFloat(submitData.price),
            is_sale: submitData.isSale, source: "community",
            province: "ON", date_recorded: new Date().toISOString().split("T")[0],
            submitted_by: "community",
          }),
        });
      }
      setSubmitStep(2);
    } catch { setSubmitStep(2); }
    finally { setSubmitting(false); }
  };

  if (loading) return (
    <div style={{ background: "#FAFAF7", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap'); @keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ fontSize: 48 }}>🛒</div>
      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, color: "#1A1A1A" }}>Cart Math</div>
      <div style={{ color: "#999", fontSize: 14 }}>Crunching the numbers...</div>
      <div style={{ width: 32, height: 32, border: "3px solid #E8E8E0", borderTopColor: "#C8F135", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  return (
    <div style={{ background: "#FAFAF7", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", display: "flex", justifyContent: "center" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        ::-webkit-scrollbar{display:none;}
        .tap{transition:transform 0.12s ease,opacity 0.12s ease;cursor:pointer;}
        .tap:active{transform:scale(0.96);opacity:0.85;}
        input,textarea{outline:none;font-family:inherit;}
        input::placeholder{color:#BCBCB0;}
        @keyframes slideUp{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
        @keyframes popIn{from{opacity:0;transform:scale(0.92);}to{opacity:1;transform:scale(1);}}
        .su{animation:slideUp 0.3s ease forwards;}
        .fi{animation:fadeIn 0.25s ease forwards;}
        .pi{animation:popIn 0.2s ease forwards;}
      `}</style>

      <div style={{ width: "100%", maxWidth: 430, minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative" }}>

        {/* ── HOME / DASHBOARD ── */}
        {screen === "home" && <HomeScreen enriched={enriched} topDeals={topDeals} totalPotentialSavings={totalPotentialSavings} products={products} listItems={listItems} setScreen={setScreen} setSelected={setSelected} toggleList={toggleList} />}

        {/* ── LOOKUP ── */}
        {screen === "lookup" && <LookupScreen enriched={enriched} filtered={filtered} search={search} setSearch={setSearch} filterCat={filterCat} setFilterCat={setFilterCat} categories={categories} selected={selected} setSelected={setSelected} listItems={listItems} toggleList={toggleList} setScreen={setScreen} />}

        {/* ── ITEM DETAIL ── */}
        {screen === "detail" && selected && <DetailScreen item={selected} listItems={listItems} toggleList={toggleList} setScreen={setScreen} />}

        {/* ── LIST ── */}
        {screen === "list" && <ListScreen listItems={listItems} toggleList={toggleList} maxStores={maxStores} setMaxStores={setMaxStores} listBuilt={listBuilt} setListBuilt={setListBuilt} costcoItems={costcoItems} fbItems={fbItems} anyItems={anyItems} listSavings={listSavings} setScreen={setScreen} />}

        {/* ── SUBMIT ── */}
        {screen === "submit" && <SubmitScreen submitStep={submitStep} setSubmitStep={setSubmitStep} submitData={submitData} setSubmitData={setSubmitData} submitting={submitting} handleSubmit={handleSubmit} setScreen={setScreen} />}

        {/* ── BOTTOM NAV ── */}
        <BottomNav screen={screen} setScreen={setScreen} listCount={listItems.length} />
      </div>
    </div>
  );
}

function BottomNav({ screen, setScreen, listCount }) {
  const tabs = [
    { key: "home",   icon: "⊞", label: "Home" },
    { key: "lookup", icon: "⌕", label: "Browse" },
    { key: "list",   icon: "≡", label: "My List", badge: listCount },
    { key: "submit", icon: "+", label: "Submit" },
  ];
  return (
    <div style={{ position: "sticky", bottom: 0, background: "#fff", borderTop: "1px solid #EBEBEB", display: "flex", padding: "8px 0 20px", zIndex: 200, boxShadow: "0 -4px 20px rgba(0,0,0,0.06)" }}>
      {tabs.map(t => (
        <button key={t.key} className="tap" onClick={() => setScreen(t.key)} style={{
          flex: 1, background: "none", border: "none", display: "flex", flexDirection: "column",
          alignItems: "center", gap: 3, padding: "6px 0", position: "relative",
        }}>
          <span style={{ fontSize: 20, filter: screen === t.key ? "none" : "grayscale(1) opacity(0.4)" }}>{t.icon}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: screen === t.key ? "#1A1A1A" : "#BCBCB0", letterSpacing: 0.3 }}>{t.label}</span>
          {t.badge > 0 && (
            <div style={{ position: "absolute", top: 2, right: "calc(50% - 18px)", background: "#C8F135", color: "#1A1A1A", borderRadius: 10, fontSize: 9, fontWeight: 700, padding: "1px 5px", minWidth: 16, textAlign: "center" }}>{t.badge}</div>
          )}
          {screen === t.key && <div style={{ position: "absolute", bottom: -8, width: 4, height: 4, borderRadius: "50%", background: "#C8F135" }} />}
        </button>
      ))}
    </div>
  );
}

function HomeScreen({ enriched, topDeals, totalPotentialSavings, products, listItems, setScreen, setSelected, toggleList }) {
  const animated = useCountUp(totalPotentialSavings);
  const grouped = {};
  enriched.forEach(p => { if (!grouped[p.category]) grouped[p.category] = []; grouped[p.category].push(p); });

  return (
    <div className="fi" style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
      {/* Hero */}
      <div style={{ background: "#1A1A1A", padding: "56px 24px 32px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -40, right: -40, width: 180, height: 180, borderRadius: "50%", background: "#C8F135", opacity: 0.12 }} />
        <div style={{ position: "absolute", bottom: -20, left: -20, width: 100, height: 100, borderRadius: "50%", background: "#C8F135", opacity: 0.08 }} />
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 30, fontWeight: 800, color: "#fff", lineHeight: 1.1, marginBottom: 6 }}>
          Cart Math 🛒
        </div>
        <div style={{ color: "#999", fontSize: 13, marginBottom: 28 }}>Ontario · Turns out math was useful after all.</div>
        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 16, padding: "18px 20px", border: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ color: "#888", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>If you bought everything optimally</div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 38, fontWeight: 800, color: "#C8F135", lineHeight: 1 }}>
            ${animated.toFixed(2)}
          </div>
          <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>in savings vs always shopping at one store</div>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ padding: "20px 20px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { icon: "⌕", label: "Browse items", sub: `${products.length} products tracked`, action: () => setScreen("lookup"), accent: "#C8F135" },
            { icon: "≡", label: "Build a list", sub: `${listItems.length ? listItems.length + " items added" : "Plan your shop"}`, action: () => setScreen("list"), accent: "#A8EDBC" },
          ].map(a => (
            <button key={a.label} className="tap" onClick={a.action} style={{
              background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "18px 16px",
              textAlign: "left", boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>{a.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#1A1A1A", marginBottom: 2 }}>{a.label}</div>
              <div style={{ fontSize: 11, color: "#999" }}>{a.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Top deals */}
      <div style={{ padding: "24px 20px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: "#1A1A1A" }}>🏆 Best savings right now</div>
          <button className="tap" onClick={() => setScreen("lookup")} style={{ background: "none", border: "none", color: "#999", fontSize: 12, fontWeight: 600 }}>See all →</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {topDeals.map((p, i) => (
            <DealCard key={p.id} p={p} rank={i + 1} onTap={() => { setSelected(p); setScreen("detail"); }} onAdd={() => toggleList(p)} inList={!!listItems.find(l => l.id === p.id)} />
          ))}
        </div>
      </div>

      {/* Categories */}
      <div style={{ padding: "24px 20px 0" }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: "#1A1A1A", marginBottom: 14 }}>🗂 Browse by category</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {Object.entries(CATEGORY_EMOJI).map(([cat, emoji]) => {
            const count = enriched.filter(p => p.category === cat).length;
            if (!count) return null;
            return (
              <button key={cat} className="tap" onClick={() => { setScreen("lookup"); }} style={{
                background: "#fff", border: "1px solid #EBEBEB", borderRadius: 14, padding: "14px 16px",
                textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
              }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{emoji}</div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#1A1A1A" }}>{cat}</div>
                <div style={{ fontSize: 11, color: "#BBB", marginTop: 2 }}>{count} items</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DealCard({ p, rank, onTap, onAdd, inList }) {
  const store = STORES[p.rec] || STORES.anywhere;
  return (
    <div className="tap" style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }} onClick={onTap}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: "#F5F5F0", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, color: "#1A1A1A", flexShrink: 0 }}>
        {rank}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: "#1A1A1A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <span style={{ background: store.color, color: "#fff", borderRadius: 20, fontSize: 10, fontWeight: 700, padding: "2px 8px" }}>{store.label}</span>
          <span style={{ fontSize: 11, color: "#999" }}>{fmt(p.best)}/{p.unit_type}</span>
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ background: "#C8F135", color: "#1A1A1A", borderRadius: 8, fontSize: 13, fontWeight: 800, padding: "4px 10px" }}>{p.savingsPct}%</div>
        <div style={{ fontSize: 10, color: "#BBB", marginTop: 3 }}>cheaper</div>
      </div>
      <button className="tap" onClick={e => { e.stopPropagation(); onAdd(); }} style={{
        width: 32, height: 32, borderRadius: 10, border: `2px solid ${inList ? "#C8F135" : "#EBEBEB"}`,
        background: inList ? "#C8F135" : "#fff", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {inList ? "✓" : "+"}
      </button>
    </div>
  );
}

function LookupScreen({ enriched, filtered, search, setSearch, filterCat, setFilterCat, categories, selected, setSelected, listItems, toggleList, setScreen }) {
  return (
    <div className="fi" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: "52px 20px 12px", background: "#FAFAF7", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: "#1A1A1A", marginBottom: 12 }}>Browse {enriched.length} products</div>
        <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 14, display: "flex", alignItems: "center", padding: "10px 14px", gap: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <span style={{ fontSize: 18, color: "#CCC" }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chicken, eggs, almonds..." style={{ background: "none", border: "none", color: "#1A1A1A", fontSize: 15, flex: 1 }} />
          {search && <button className="tap" onClick={() => setSearch("")} style={{ background: "none", border: "none", color: "#CCC", fontSize: 20, padding: 0 }}>×</button>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
          {categories.map(cat => (
            <button key={cat} className="tap" onClick={() => setFilterCat(cat)} style={{
              background: filterCat === cat ? "#1A1A1A" : "#fff",
              color: filterCat === cat ? "#fff" : "#888",
              border: "1px solid " + (filterCat === cat ? "#1A1A1A" : "#EBEBEB"),
              borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", fontFamily: "inherit",
            }}>{cat}</button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 100px", display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#CCC" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🤷</div>
            <div style={{ fontWeight: 600, color: "#999" }}>Nothing here.</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Maybe submit it?</div>
          </div>
        )}
        {filtered.map(p => {
          const store = STORES[p.rec] || STORES.anywhere;
          const inList = !!listItems.find(i => i.id === p.id);
          return (
            <div key={p.id} className="tap" style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
              onClick={() => { setSelected(p); setScreen("detail"); }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: store.light, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                {CATEGORY_EMOJI[p.category] || "🛒"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#1A1A1A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                  <span style={{ background: store.color, color: "#fff", borderRadius: 20, fontSize: 10, fontWeight: 700, padding: "2px 8px" }}>{store.label}</span>
                  {p.savingsPct > 0 && <span style={{ fontSize: 11, color: "#BBB" }}>save {p.savingsPct}%</span>}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1A1A1A" }}>{fmt(p.best)}</div>
                <div style={{ fontSize: 11, color: "#BBB" }}>/{p.unit_type}</div>
              </div>
              <button className="tap" onClick={e => { e.stopPropagation(); toggleList(p); }} style={{
                width: 34, height: 34, borderRadius: 10, border: `2px solid ${inList ? "#C8F135" : "#EBEBEB"}`,
                background: inList ? "#C8F135" : "#FAFAF7", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                {inList ? "✓" : "+"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailScreen({ item, listItems, toggleList, setScreen }) {
  const store = STORES[item.rec] || STORES.anywhere;
  const inList = !!listItems.find(i => i.id === item.id);
  const saving = item.costco && item.fb ? Math.abs(item.costco - item.fb).toFixed(2) : null;

  return (
    <div className="fi" style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
      {/* Back */}
      <div style={{ padding: "52px 20px 0" }}>
        <button className="tap" onClick={() => setScreen("lookup")} style={{ background: "none", border: "none", display: "flex", alignItems: "center", gap: 6, color: "#999", fontSize: 14, fontWeight: 600, padding: 0 }}>
          ← Back
        </button>
      </div>

      {/* Hero card */}
      <div style={{ margin: "16px 20px 0", background: store.color, borderRadius: 24, padding: "24px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
        <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Best buy</div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: "#fff", marginBottom: 4 }}>{store.label}</div>
        <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 14 }}>{item.notes}</div>
        {saving && (
          <div style={{ marginTop: 16, background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "10px 14px", display: "inline-block" }}>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>Save ${saving}/{item.unit_type} vs the other option</span>
          </div>
        )}
      </div>

      {/* Price comparison */}
      <div style={{ margin: "16px 20px 0" }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 800, color: "#1A1A1A", marginBottom: 12 }}>{item.name}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { label: "Costco", price: item.costco, chain: "costco" },
            { label: "Food Basics", price: item.fb, chain: "food_basics" },
          ].map(s => {
            const isBest = (s.chain === "costco" && item.rec === "costco") || (s.chain === "food_basics" && item.rec === "food_basics");
            return (
              <div key={s.label} style={{
                background: isBest ? "#1A1A1A" : "#fff",
                border: `2px solid ${isBest ? "#1A1A1A" : "#EBEBEB"}`,
                borderRadius: 16, padding: "16px",
              }}>
                {isBest && <div style={{ fontSize: 10, fontWeight: 700, color: "#C8F135", letterSpacing: 1, marginBottom: 4 }}>BEST ✓</div>}
                <div style={{ fontSize: 11, fontWeight: 600, color: isBest ? "#888" : "#BBB", marginBottom: 6 }}>{s.label.toUpperCase()}</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: isBest ? "#fff" : "#1A1A1A" }}>{fmt(s.price)}</div>
                <div style={{ fontSize: 12, color: isBest ? "#666" : "#CCC", marginTop: 2 }}>per {item.unit_type}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Savings bar */}
      {item.savingsPct > 0 && (
        <div style={{ margin: "16px 20px 0", background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: "#1A1A1A" }}>Price difference</span>
            <span style={{ fontWeight: 800, fontSize: 14, color: "#1A1A1A" }}>{item.savingsPct}% cheaper</span>
          </div>
          <div style={{ height: 8, background: "#F0F0EB", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${item.savingsPct}%`, background: "linear-gradient(90deg, #C8F135, #A8EDA8)", borderRadius: 4, transition: "width 0.5s ease" }} />
          </div>
        </div>
      )}

      {/* Add to list */}
      <div style={{ margin: "16px 20px 0" }}>
        <button className="tap" onClick={() => toggleList(item)} style={{
          width: "100%", background: inList ? "#1A1A1A" : "#C8F135",
          color: inList ? "#C8F135" : "#1A1A1A",
          border: "none", borderRadius: 16, padding: "18px",
          fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 800, letterSpacing: 0.3,
        }}>
          {inList ? "✓ On your list — tap to remove" : "+ Add to my list"}
        </button>
      </div>
    </div>
  );
}

function ListScreen({ listItems, toggleList, maxStores, setMaxStores, listBuilt, setListBuilt, costcoItems, fbItems, anyItems, listSavings, setScreen }) {
  return (
    <div className="fi" style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
      <div style={{ padding: "52px 20px 16px" }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: "#1A1A1A", marginBottom: 4 }}>My List</div>
        <div style={{ color: "#999", fontSize: 13 }}>{listItems.length === 0 ? "Nothing here yet." : `${listItems.length} item${listItems.length !== 1 ? "s" : ""} · tap to plan your route`}</div>
      </div>

      {listItems.length === 0 ? (
        <div style={{ margin: "0 20px", background: "#fff", border: "2px dashed #EBEBEB", borderRadius: 20, padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🛒</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#1A1A1A", marginBottom: 6 }}>Your list is empty</div>
          <div style={{ color: "#BBB", fontSize: 14, marginBottom: 20 }}>Math doesn't work on nothing, unfortunately.</div>
          <button className="tap" onClick={() => setScreen("lookup")} style={{ background: "#C8F135", border: "none", borderRadius: 12, padding: "12px 24px", fontFamily: "inherit", fontWeight: 700, fontSize: 14, color: "#1A1A1A" }}>Browse items →</button>
        </div>
      ) : (
        <div style={{ padding: "0 20px" }}>
          {/* Max stores */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#999", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>How many stores are you willing to visit?</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[1, 2, 3].map(n => (
                <button key={n} className="tap" onClick={() => { setMaxStores(n); setListBuilt(false); }} style={{
                  flex: 1, background: maxStores === n ? "#1A1A1A" : "#fff",
                  color: maxStores === n ? "#fff" : "#999",
                  border: `2px solid ${maxStores === n ? "#1A1A1A" : "#EBEBEB"}`,
                  borderRadius: 12, padding: "12px", fontFamily: "inherit", fontWeight: 700, fontSize: 14,
                }}>{n} {n === 1 ? "store" : "stores"}</button>
              ))}
            </div>
          </div>

          {/* Items */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {listItems.map(item => {
              const store = STORES[item.rec] || STORES.anywhere;
              return (
                <div key={item.id} style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: store.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#1A1A1A" }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: "#BBB", marginTop: 2 }}>{item.notes}</div>
                  </div>
                  <button className="tap" onClick={() => toggleList(item)} style={{ background: "none", border: "none", color: "#DDD", fontSize: 22, padding: "0 4px", lineHeight: 1 }}>×</button>
                </div>
              );
            })}
          </div>

          <button className="tap" onClick={() => setListBuilt(true)} style={{
            width: "100%", background: "#C8F135", color: "#1A1A1A", border: "none",
            borderRadius: 16, padding: "18px", fontFamily: "'Syne', sans-serif",
            fontWeight: 800, fontSize: 16, marginBottom: 20,
          }}>Build my shopping plan →</button>

          {listBuilt && (
            <div className="su">
              {listSavings > 0 && (
                <div style={{ background: "#1A1A1A", borderRadius: 20, padding: "20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: 1, textTransform: "uppercase" }}>You save approx.</div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 800, color: "#C8F135" }}>${listSavings.toFixed(2)}</div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>per unit vs the worse option</div>
                  </div>
                  <div style={{ fontSize: 40 }}>💸</div>
                </div>
              )}

              {[
                { items: costcoItems, label: "Costco", color: "#E8002D", total: costcoItems.reduce((s, i) => s + (i.costco || 0), 0), priceKey: "costco" },
                { items: fbItems, label: "Food Basics", color: "#009B3A", total: fbItems.reduce((s, i) => s + (i.fb || 0), 0), priceKey: "fb" },
              ].map(section => section.items.length > 0 && (
                <div key={section.label} style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, overflow: "hidden", marginBottom: 10 }}>
                  <div style={{ background: section.color, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 16, color: "#fff" }}>{section.label}</div>
                    <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 600 }}>${section.total.toFixed(2)} est.</div>
                  </div>
                  {section.items.map(i => (
                    <div key={i.id} style={{ padding: "11px 16px", borderBottom: "1px solid #F5F5F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14, color: "#1A1A1A", fontWeight: 500 }}>{i.name}</span>
                      <span style={{ fontSize: 13, color: "#BBB", fontWeight: 600 }}>{fmt(i[section.priceKey])}/{i.unit_type}</span>
                    </div>
                  ))}
                </div>
              ))}

              {anyItems.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, overflow: "hidden", marginBottom: 10 }}>
                  <div style={{ background: "#7C3AED", padding: "12px 16px" }}>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 16, color: "#fff" }}>Watch for Sales</div>
                  </div>
                  {anyItems.map(i => (
                    <div key={i.id} style={{ padding: "11px 16px", borderBottom: "1px solid #F5F5F0", display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 14, color: "#1A1A1A", fontWeight: 500 }}>{i.name}</span>
                      <span style={{ fontSize: 12, color: "#BBB" }}>check flyers</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubmitScreen({ submitStep, setSubmitStep, submitData, setSubmitData, submitting, handleSubmit, setScreen }) {
  return (
    <div className="fi" style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
      <div style={{ padding: "52px 20px 20px" }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: "#1A1A1A", marginBottom: 4 }}>Submit a Price</div>
        <div style={{ color: "#999", fontSize: 13 }}>Spotted a deal? Help the community.</div>
      </div>

      <div style={{ padding: "0 20px" }}>
        {submitStep === 0 && (
          <div className="su" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button className="tap" onClick={() => setSubmitStep(1)} style={{
              background: "#1A1A1A", border: "none", borderRadius: 20, padding: "40px 24px",
              textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            }}>
              <div style={{ fontSize: 48 }}>📷</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, color: "#fff" }}>Photo a price tag</div>
              <div style={{ color: "#666", fontSize: 13 }}>We'll OCR the price automatically</div>
              <div style={{ background: "#C8F135", color: "#1A1A1A", borderRadius: 20, padding: "8px 20px", fontWeight: 700, fontSize: 13, marginTop: 6 }}>Open Camera →</div>
            </button>
            <div style={{ textAlign: "center", color: "#CCC", fontSize: 13 }}>— or —</div>
            <button className="tap" onClick={() => setSubmitStep(1)} style={{
              background: "#fff", border: "2px solid #EBEBEB", borderRadius: 16, padding: "16px",
              color: "#999", fontSize: 14, fontWeight: 600, fontFamily: "inherit",
            }}>Enter manually instead</button>
          </div>
        )}

        {submitStep === 1 && (
          <div className="su" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { key: "item",  label: "Item name",  placeholder: "e.g. Chicken Breast" },
              { key: "store", label: "Store",       placeholder: "e.g. Walmart, No Frills..." },
              { key: "price", label: "Price",       placeholder: "e.g. 14.99" },
              { key: "unit",  label: "Unit",        placeholder: "e.g. /kg, /100g, /L" },
            ].map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#999", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{f.label}</div>
                <input
                  value={submitData[f.key]}
                  onChange={e => setSubmitData({ ...submitData, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  style={{ width: "100%", background: "#fff", border: "2px solid #EBEBEB", borderRadius: 12, padding: "14px 16px", color: "#1A1A1A", fontSize: 15 }}
                />
              </div>
            ))}

            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0" }}>
              <div className="tap" onClick={() => setSubmitData({ ...submitData, isSale: !submitData.isSale })} style={{
                width: 48, height: 26, borderRadius: 13,
                background: submitData.isSale ? "#C8F135" : "#E8E8E0",
                position: "relative", transition: "background 0.2s", flexShrink: 0,
              }}>
                <div style={{
                  position: "absolute", top: 3, left: submitData.isSale ? 25 : 3,
                  width: 20, height: 20, borderRadius: "50%",
                  background: submitData.isSale ? "#1A1A1A" : "#fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  transition: "left 0.2s",
                }} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}>This is a sale price</span>
            </div>

            <div style={{ background: "#fff", border: "2px solid #EBEBEB", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 20 }}>📍</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}>Location captured automatically</div>
                <div style={{ fontSize: 12, color: "#BBB", marginTop: 2 }}>Ontario, Canada</div>
              </div>
            </div>

            <button className="tap" onClick={handleSubmit} disabled={submitting} style={{
              width: "100%", background: submitting ? "#E8E8E0" : "#C8F135",
              color: submitting ? "#BBB" : "#1A1A1A", border: "none",
              borderRadius: 16, padding: "18px", fontFamily: "'Syne', sans-serif",
              fontWeight: 800, fontSize: 16, marginTop: 4,
            }}>
              {submitting ? "Submitting..." : "Submit price →"}
            </button>
          </div>
        )}

        {submitStep === 2 && (
          <div className="pi" style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: "#1A1A1A", marginBottom: 8 }}>Submitted!</div>
            <div style={{ color: "#999", fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
              The community thanks you.<br />You're basically a hero. No big deal.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="tap" onClick={() => { setSubmitStep(0); setSubmitData({ item: "", store: "", price: "", unit: "", isSale: false }); }} style={{
                background: "#C8F135", border: "none", borderRadius: 14, padding: "14px", fontFamily: "inherit", fontWeight: 700, fontSize: 14, color: "#1A1A1A",
              }}>Submit another</button>
              <button className="tap" onClick={() => setScreen("home")} style={{
                background: "#fff", border: "2px solid #EBEBEB", borderRadius: 14, padding: "14px", fontFamily: "inherit", fontWeight: 600, fontSize: 14, color: "#999",
              }}>Back to home</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
