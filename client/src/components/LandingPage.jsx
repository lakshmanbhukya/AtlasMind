import { useState, useEffect, useRef } from "react";
import { motion, useInView, useScroll, useTransform, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, ScatterChart, Scatter, ComposedChart, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";
import {
  Shield, Zap, Database, Brain, ChevronRight, Terminal,
  Activity, Lock, Eye, AlertTriangle, CheckCircle, Menu, X,
  ArrowRight, Cpu, Layers, TrendingUp, ChevronUp, Settings
} from "lucide-react";
import { cn } from "../lib/utils";
import api from '../services/api';

const GREEN = "#00ED64";
const DARK = "#0D1117";

// ─── Data ───────────────────────────────────────────────────────────────────
const revenueData = [
  { month: "Jan", v: 42000 }, { month: "Feb", v: 58000 }, { month: "Mar", v: 51000 },
  { month: "Apr", v: 73000 }, { month: "May", v: 89000 }, { month: "Jun", v: 95000 },
  { month: "Jul", v: 104000 }, { month: "Aug", v: 118000 },
];
const scatterData = Array.from({ length: 30 }, (_, i) => ({
  x: Math.random() * 100, y: Math.random() * 100, z: Math.random() * 30 + 5,
}));
const composedData = [
  { name: "Q1", queries: 4000, latency: 180, success: 98 },
  { name: "Q2", queries: 6200, latency: 140, success: 99 },
  { name: "Q3", queries: 8900, latency: 110, success: 99.5 },
  { name: "Q4", queries: 12400, latency: 90, success: 99.8 },
];

// ─── Animated Terminal ───────────────────────────────────────────────────────
const lines = [
  { type: "input", text: "> Show me monthly revenue trends by region", delay: 0 },
  { type: "system", icon: "settings", text: "Profiling schema... found 2.4M documents", delay: 1200 },
  { type: "system", icon: "zap", text: "Groq LPU generating MQL pipeline...", delay: 2000 },
  { type: "code", text: 'db.orders.aggregate([{$group:{_id:"$region",total:{$sum:"$amount"}}}])', delay: 2800 },
  { type: "success", icon: "check", text: "Safety validated • 187ms • Rendering chart...", delay: 3600 },
];

function TerminalWindow() {
  const [visibleLines, setVisibleLines] = useState([]);
  const [active, setActive] = useState(true);
  useEffect(() => {
    lines.forEach((line) => {
      setTimeout(() => setVisibleLines((p) => [...p, line]), line.delay);
    });
    setTimeout(() => setActive(false), 4500);
  }, []);
  const colors = { input: "#e2e8f0", system: "#64748b", code: GREEN, success: "#34d399" };
  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#0a0e14]"
      style={{ boxShadow: `0 0 60px ${GREEN}20, 0 0 120px ${GREEN}08` }}>
      {/* title bar */}
      <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border-b border-white/10">
        <div className="w-3 h-3 rounded-full bg-red-500/80" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
        <div className="w-3 h-3 rounded-full bg-green-500/80" />
        <span className="ml-3 text-xs font-mono text-slate-400">atlasmind — query</span>
        {active && <motion.div className="ml-auto w-2 h-2 rounded-full bg-green-400"
          animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} />}
      </div>
      <div className="p-5 font-mono text-sm min-h-[200px] space-y-2">
        {visibleLines.map((line, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
            style={{ color: colors[line.type] || "#fff" }}
            className={cn(
              "flex items-center gap-2",
              line.type === "code" ? "pl-4 border-l-2 border-green-500/50 text-xs overflow-x-auto" : ""
            )}>
            {line.icon === "settings" && <Settings size={14} className="shrink-0" />}
            {line.icon === "zap" && <Zap size={14} className="shrink-0" fill={colors.success} stroke={colors.success} />}
            {line.icon === "check" && <CheckCircle size={14} className="shrink-0" />}
            <span>{line.text}</span>
          </motion.div>
        ))}
        {active && <motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.8 }}
          className="inline-block w-2 h-4 bg-green-400" />}
      </div>
    </div>
  );
}

// ─── Chart Components ────────────────────────────────────────────────────────
function AnimatedBarChart() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7 }} className="glass-card p-5">
      <p className="text-xs text-slate-400 mb-1 font-mono">Monthly Revenue</p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={revenueData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
          <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip contentStyle={{ background: "#0D1117", border: "1px solid #00ED6440", borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: GREEN }} itemStyle={{ color: "#e2e8f0" }} />
          <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={inView}>
            {revenueData.map((_, i) => (
              <Cell key={i} fill={`rgba(0,237,100,${0.3 + (i / revenueData.length) * 0.7})`} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

function AnimatedScatter() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay: 0.15 }} className="glass-card p-5">
      <p className="text-xs text-slate-400 mb-1 font-mono">User Cohort Clusters</p>
      <ResponsiveContainer width="100%" height={160}>
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
          <XAxis type="number" dataKey="x" hide />
          <YAxis type="number" dataKey="y" hide />
          <Tooltip contentStyle={{ background: "#0D1117", border: "1px solid #00ED6440", borderRadius: 8, fontSize: 11 }} />
          <Scatter data={scatterData} fill={GREEN} fillOpacity={0.6} isAnimationActive={inView} />
        </ScatterChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

function AnimatedComposed() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay: 0.3 }} className="glass-card p-5">
      <p className="text-xs text-slate-400 mb-1 font-mono">Query Performance Over Time</p>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={composedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
          <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip contentStyle={{ background: "#0D1117", border: "1px solid #00ED6440", borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: GREEN }} />
          <Area type="monotone" dataKey="queries" fill="#00ED6415" stroke={GREEN} strokeWidth={2} isAnimationActive={inView} />
          <Line type="monotone" dataKey="latency" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={inView} />
        </ComposedChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

// ─── Section fade wrapper ────────────────────────────────────────────────────
function Reveal({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 40 }} animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }} className={className}>
      {children}
    </motion.div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function LandingPage({ onConnected }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [connStr, setConnStr] = useState("");
  const [dbName, setDbName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [availableDbs, setAvailableDbs] = useState([]);

  const { scrollY } = useScroll();
  const navOpacity = useTransform(scrollY, [0, 80], [0, 1]);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const checkScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener("scroll", checkScroll);
    return () => window.removeEventListener("scroll", checkScroll);
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const handleConnect = async (e) => {
    if (e) e.preventDefault();
    if (!connStr || !dbName) {
      setError("Please provide both connection string and database name.");
      return;
    }
    setAnalyzing(true);
    setError(null);
    setAvailableDbs([]);
    try {
      // POST /api/connections/connect — server validates DB, then sets httpOnly JWT cookie
      await api.post('connections/connect', {
        connectionString: connStr,
        dbName,
        label: 'My Database',
      });
      // Tell App.jsx to re-check /api/auth/me → will navigate to Playground
      onConnected();
    } catch (err) {
      // Check if the server returned available databases (wrong dbName)
      const rawErr = err?.response?.data || err;
      if (rawErr?.availableDatabases?.length > 0) {
        setAvailableDbs(rawErr.availableDatabases);
      }
      const msg = rawErr?.error?.message || err.message || 'Failed to connect. Please check your details.';
      setError(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0D1117; color: #e2e8f0; font-family: 'DM Sans', sans-serif; overflow-x: hidden; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0D1117; }
        ::-webkit-scrollbar-thumb { background: #00ED6440; border-radius: 99px; }
        .font-syne { font-family: 'Syne', sans-serif; }
        .font-mono-jet { font-family: 'JetBrains Mono', monospace; }
        .glass-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 16px;
          backdrop-filter: blur(12px);
        }
        .green-glow { box-shadow: 0 0 30px #00ED6430; }
        .grid-bg {
          background-image: linear-gradient(rgba(0,237,100,0.04) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(0,237,100,0.04) 1px, transparent 1px);
          background-size: 60px 60px;
        }
        .noise::after {
          content: '';
          position: fixed; inset: 0; z-index: 999; pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
          opacity: 0.3;
        }
        input:focus { outline: none; }
        .pulse-ring {
          animation: pulseRing 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
        }
        @keyframes pulseRing {
          0% { box-shadow: 0 0 0 0 rgba(0,237,100,0.4); }
          70% { box-shadow: 0 0 0 14px rgba(0,237,100,0); }
          100% { box-shadow: 0 0 0 0 rgba(0,237,100,0); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }
        .float { animation: float 4s ease-in-out infinite; }
      `}</style>

      <div className="noise" style={{ minHeight: "100vh" }}>
        {/* ── NAV ─────────────────────────────────────────────── */}
        <motion.nav style={{ background: useTransform(navOpacity, v => `rgba(13,17,23,${v * 0.9})`) }}
          className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl border-b border-white/5">
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 80 }}>
            <div className="flex items-center gap-2">
              <div style={{ width: 32, height: 32, borderRadius: 8, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Brain size={18} color="#000" />
              </div>
              <span className="font-syne" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>AtlasMind</span>
            </div>
            <div className="hidden md:flex items-center gap-10 h-full">
              {[
                { name: "How it works", id: "how-it-works" },
                { name: "Guardrails", id: "guardrails" },
                { name: "Graphs", id: "graphs" }
              ].map(item => (
                <a key={item.name} href={`#${item.id}`} className="flex items-center transition-colors h-full" style={{ color: "#64748b", fontSize: 14, fontWeight: 500 }}
                  onMouseEnter={e => e.target.style.color = "#e2e8f0"} onMouseLeave={e => e.target.style.color = "#64748b"}>
                  {item.name}
                </a>
              ))}
            </div>
            <div className="hidden md:flex items-center gap-6 h-full">
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                onClick={() => document.getElementById('connect')?.scrollIntoView({ behavior: 'smooth' })}
                style={{ background: GREEN, color: "#000", border: "none", borderRadius: 9, padding: "10px 22px", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
                className="flex items-center gap-2">
                Connect Atlas <ArrowRight size={14} strokeWidth={2.5} />
              </motion.button>
            </div>
            <button className="md:hidden" onClick={() => setMenuOpen(!menuOpen)}
              style={{ background: "none", border: "none", color: "#e2e8f0", cursor: "pointer" }}>
              {menuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </motion.nav>

        {/* ── MOBILE MENU ─────────────────────────────────────── */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              style={{ position: "fixed", top: 80, left: 0, right: 0, zIndex: 49, background: "#0D1117", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "24px" }}>
              {[
                { name: "How it works", id: "how-it-works" },
                { name: "Guardrails", id: "guardrails" },
                { name: "Graphs", id: "graphs" }
              ].map(item => (
                <a key={item.name} href={`#${item.id}`} onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", color: "#94a3b8", fontSize: 15, textDecoration: "none" }}>{item.name}</a>
              ))}
              <button style={{ width: "100%", marginTop: 24, background: GREEN, color: "#000", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                Connect Atlas
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── HERO ────────────────────────────────────────────── */}
        <section className="grid-bg" style={{ paddingTop: 130, paddingBottom: 120, minHeight: "100vh", display: "flex", alignItems: "center", position: "relative", overflow: "hidden" }}>
          {/* ambient glow */}
          <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", width: 700, height: 400, background: `radial-gradient(ellipse, ${GREEN}12 0%, transparent 70%)`, pointerEvents: "none" }} />
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", width: "100%" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center" }}
              className="hero-grid" >
              <style>{`@media(max-width:1024px){.hero-grid{grid-template-columns:1fr!important; text-align: center;}}`}</style>
              {/* Left */}
              <div className="flex flex-col items-center lg:items-start text-center lg:text-left">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: `${GREEN}15`, border: `1px solid ${GREEN}30`, borderRadius: 99, padding: "4px 12px", fontSize: 12, color: GREEN, marginBottom: 32 }}
                    className="font-mono-jet">
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN, display: "inline-block" }} />
                    Sub-200ms • Zero-ETL • MQL-Native
                  </span>
                </motion.div>
                <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}
                  className="font-syne" style={{ fontSize: "clamp(34px, 6vw, 60px)", fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.03em", marginBottom: 32 }}>
                  Talk to your<br />
                  <span style={{ color: GREEN }}>data.</span> Directly.
                </motion.h1>
                <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.2 }}
                  style={{ fontSize: 18, color: "#94a3b8", lineHeight: 1.7, marginBottom: 44, maxWidth: 480 }}>
                  The zero-ETL conversational BI platform that transforms natural language into high-performance MQL in <strong style={{ color: "#e2e8f0" }}>sub-200ms</strong>.
                </motion.p>
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.3 }}
                  style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "flex-start" }}>
                  <motion.button whileHover={{ scale: 1.04, boxShadow: `0 0 30px ${GREEN}50` }} whileTap={{ scale: 0.97 }}
                     onClick={() => document.getElementById('connect')?.scrollIntoView({ behavior: 'smooth' })}
                    style={{ background: GREEN, color: "#000", border: "none", borderRadius: 12, padding: "16px 32px", fontSize: 16, fontWeight: 700, fontFamily: "'Syne',sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                    Get Started Free <ArrowRight size={18} />
                  </motion.button>
                  <motion.button whileHover={{ scale: 1.04, borderColor: `${GREEN}60` }} whileTap={{ scale: 0.97 }}
                    style={{ background: "transparent", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "16px 32px", fontSize: 16, fontWeight: 500, fontFamily: "inherit", cursor: "pointer" }}>
                    View Docs
                  </motion.button>
                </motion.div>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
                  style={{ display: "flex", gap: 40, marginTop: 48, justifyContent: "flex-start" }}>
                  {[["10M+", "Queries/day"], ["187ms", "Avg latency"], ["99.8%", "Uptime"]].map(([val, label]) => (
                    <div key={label}>
                      <div className="font-syne" style={{ fontSize: 28, fontWeight: 700, color: GREEN }}>{val}</div>
                      <div style={{ fontSize: 13, color: "#475569", fontWeight: 500 }}>{label}</div>
                    </div>
                  ))}
                </motion.div>
              </div>

              {/* Right - Terminal */}
              <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, delay: 0.2 }} className="float">
                <TerminalWindow />
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── CONNECTION SEEDED ────────────────────────────────── */}
        <section id="connect" style={{ padding: "120px 24px", background: "rgba(0,237,100,0.02)" }}>
          <div style={{ maxWidth: 840, margin: "0 auto" }}>
            <Reveal>
              <p className="font-mono-jet" style={{ fontSize: 11, color: GREEN, textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 12, textAlign: "center" }}>
                — connect your cluster —
              </p>
              <h2 className="font-syne" style={{ fontSize: "clamp(32px, 5vw, 48px)", fontWeight: 700, textAlign: "center", marginBottom: 16, letterSpacing: "-0.02em" }}>
                One string. Instant intelligence.
              </h2>
              <p style={{ color: "#64748b", textAlign: "center", marginBottom: 48, fontSize: 16, maxWidth: 600, margin: "0 auto 48px" }}>
                Paste your MongoDB Atlas connection string and database name to profile your schema.
              </p>
            </Reveal>

            <Reveal delay={0.15}>
                <div className="space-y-4 max-w-2xl mx-auto">
                    {/* Connection String Pill */}
                    <div className="glass-card" style={{ padding: 6, position: "relative" }}>
                        <div style={{ position: "absolute", inset: 0, borderRadius: 16, background: `linear-gradient(135deg, ${GREEN}08, transparent 60%)`, pointerEvents: "none" }} />
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", paddingLeft: 16 }}>
                                <Lock size={16} style={{ color: GREEN }} />
                            </div>
                            <input type="password" value={connStr} onChange={e => setConnStr(e.target.value)}
                                placeholder="mongodb+srv://user:password@cluster0.mongodb.net"
                                style={{ flex: 1, background: "transparent", border: "none", color: "#e2e8f0", fontSize: 14, padding: "16px 8px", fontFamily: "'JetBrains Mono', monospace" }} />
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: 12 }} className="flex-col sm:flex-row">
                        {/* Database Name Pill */}
                        <div className="glass-card flex-1" style={{ padding: 6, position: "relative" }}>
                            <div style={{ position: "absolute", inset: 0, borderRadius: 16, background: `linear-gradient(135deg, ${GREEN}08, transparent 60%)`, pointerEvents: "none" }} />
                            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                <div style={{ display: "flex", alignItems: "center", paddingLeft: 16 }}>
                                    <Database size={16} style={{ color: GREEN }} />
                                </div>
                                <input type="text" value={dbName} onChange={e => setDbName(e.target.value)}
                                    placeholder="Database Name"
                                    style={{ flex: 1, background: "transparent", border: "none", color: "#e2e8f0", fontSize: 14, padding: "16px 8px", fontFamily: "'JetBrains Mono', monospace" }} />
                            </div>
                        </div>

                        {/* Analyze Button */}
                        <motion.button onClick={handleConnect} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                          disabled={analyzing}
                          className="pulse-ring"
                          style={{
                                background: GREEN,
                                color: "#000",
                                border: "none",
                                borderRadius: 16,
                                padding: "0 32px",
                                height: 60,
                                fontSize: 15,
                                fontWeight: 700,
                                fontFamily: "'Syne',sans-serif",
                                cursor: analyzing ? "not-allowed" : "pointer"
                            }}>
                          {analyzing ? (
                            <motion.span animate={{ opacity: [1, 0.5, 1] }} transition={{ repeat: Infinity, duration: 0.8 }}>
                              Analyzing...
                            </motion.span>
                          ) : "Analyze →"}
                        </motion.button>
                    </div>

                    {error && (
                      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                        style={{ color: "#ef4444", fontSize: 14, textAlign: "center", marginTop: 16, background: "rgba(239,68,68,0.1)", padding: "12px", borderRadius: "12px", border: "1px solid rgba(239,68,68,0.2)" }}>
                        {error}
                      </motion.div>
                    )}

                    {/* Available databases suggestion */}
                    {availableDbs.length > 0 && (
                      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                        style={{ marginTop: 12, background: "rgba(0,237,100,0.05)", border: "1px solid rgba(0,237,100,0.15)", borderRadius: 12, padding: "14px 16px" }}>
                        <p style={{ fontSize: 12, color: GREEN, fontWeight: 600, marginBottom: 8 }}>
                          Available databases on this cluster:
                        </p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {availableDbs.map((db) => (
                            <button
                              key={db.name}
                              onClick={() => { setDbName(db.name); setError(null); setAvailableDbs([]); }}
                              style={{
                                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: 8, padding: "8px 12px", cursor: "pointer", textAlign: "left",
                                color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                transition: "all 0.15s",
                              }}
                              onMouseEnter={e => { e.target.style.borderColor = GREEN; e.target.style.background = "rgba(0,237,100,0.08)"; }}
                              onMouseLeave={e => { e.target.style.borderColor = "rgba(255,255,255,0.1)"; e.target.style.background = "rgba(255,255,255,0.04)"; }}
                            >
                              <span>{db.name}</span>
                              <span style={{ fontSize: 11, color: "#94a3b8" }}>{db.collectionCount} collections</span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                </div>
              
              <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 24, opacity: 0.5 }}>
                 <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 500, color: "#94a3b8" }} className="font-mono-jet">
                   <Shield size={12} /> AES-256 ENCRYPTED
                 </div>
                 <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 500, color: "#94a3b8" }} className="font-mono-jet">
                   <Lock size={12} /> READ-ONLY ACCESS
                 </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── AI ORCHESTRATION STEPS ──────────────────────────── */}
        <section id="how-it-works" style={{ padding: "120px 24px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <Reveal style={{ textAlign: "center", marginBottom: 80 }}>
              <span className="font-mono-jet" style={{ fontSize: 11, color: GREEN, letterSpacing: "0.15em", textTransform: "uppercase" }}>How it works</span>
              <h2 className="font-syne" style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 700, marginTop: 16, marginBottom: 20, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                From natural language<br />to production-grade MQL
              </h2>
            </Reveal>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 32 }}>
              {[
                { icon: <Layers size={28} />, num: "01", title: "Profile", subtitle: "Auto-Schema Intelligence", desc: "AtlasMind scans your collections in milliseconds, building a rich semantic map of every field, type, and relationship—including nested BSON structures." },
                { icon: <Cpu size={28} />, num: "02", title: "Synthesize", subtitle: "Groq LPU Acceleration", desc: "Your natural language query is converted into a verified MQL aggregation pipeline using Groq's Language Processing Unit—hardware-accelerated inference." },
                { icon: <TrendingUp size={28} />, num: "03", title: "Visualize", subtitle: "Recharts-Driven Insights", desc: "Results are rendered as interactive charts, tables, or raw data views—streamed in real time without any data leaving your infrastructure." },
              ].map((step, i) => (
                <Reveal key={step.num} delay={i * 0.12}>
                  <motion.div className="glass-card" whileHover={{ borderColor: `${GREEN}40`, y: -8 }}
                    style={{ padding: 40, height: "100%", transition: "border-color 0.3s, transform 0.3s", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: -20, right: -10, fontFamily: "'Syne',sans-serif", fontSize: 96, fontWeight: 800, color: "rgba(255,255,255,0.02)", lineHeight: 1 }}>{step.num}</div>
                    <div style={{ width: 56, height: 56, borderRadius: 14, background: `${GREEN}15`, border: `1px solid ${GREEN}30`, display: "flex", alignItems: "center", justifyContent: "center", color: GREEN, marginBottom: 28 }}>
                      {step.icon}
                    </div>
                    <p className="font-mono-jet" style={{ fontSize: 10, color: "#475569", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>{step.subtitle}</p>
                    <h3 className="font-syne" style={{ fontSize: 26, fontWeight: 700, marginBottom: 16, letterSpacing: "-0.01em" }}>{step.title}</h3>
                    <p style={{ color: "#64748b", lineHeight: 1.8, fontSize: 15 }}>{step.desc}</p>
                  </motion.div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── SAFETY GUARD ────────────────────────────────────── */}
        <section id="guardrails" style={{ padding: "120px 24px", background: "rgba(0,0,0,0.3)" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 100, alignItems: "center" }}
              className="safety-grid">
              <style>{`@media(max-width:768px){.safety-grid{grid-template-columns:1fr!important;}}`}</style>
              <Reveal>
                <span className="font-mono-jet" style={{ fontSize: 11, color: "#f87171", letterSpacing: "0.15em", textTransform: "uppercase" }}>Safety Layer</span>
                <h2 className="font-syne" style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 700, marginTop: 16, marginBottom: 28, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                  AI with deterministic<br />safety boundaries.
                </h2>
                <p style={{ color: "#64748b", lineHeight: 1.8, fontSize: 16, marginBottom: 36 }}>
                  Every generated MQL pipeline passes through our deterministic Runtime Safety Validation layer before execution. Destructive operations are intercepted at the hardware level.
                </p>
                {[
                  "Blocks db.drop(), deleteMany(), and updateMany()",
                  "Enforces read-only connection states at the kernel level",
                  "Prohibits full collection scans on un-indexed fields",
                  "Comprehensive audit logging of all AI activity",
                ].map((item, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                    style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: `${GREEN}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                        <CheckCircle size={14} style={{ color: GREEN }} />
                    </div>
                    <span style={{ fontSize: 15, color: "#94a3b8", lineHeight: 1.5 }}>{item}</span>
                  </motion.div>
                ))}
              </Reveal>
              <Reveal delay={0.2}>
                <div style={{ position: "relative" }}>
                  <div className="glass-card" style={{ padding: 40, background: "rgba(13,17,23,0.4)" }}>
                    <div style={{ textAlign: "center", marginBottom: 32 }}>
                      <motion.div animate={{ boxShadow: ["0 0 20px #ef444440", "0 0 40px #ef444430", "0 0 20px #ef444440"] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                        style={{ display: "inline-flex", padding: 20, borderRadius: "50%", background: "#ef444410", marginBottom: 16, border: "1px solid rgba(239,68,68,0.2)" }}>
                        <Shield size={36} style={{ color: "#f87171" }} />
                      </motion.div>
                      <div className="font-mono-jet" style={{ fontSize: 12, color: "#f87171", fontWeight: 600, letterSpacing: "0.1em" }}>SAFETY THREAT BLOCKED</div>
                    </div>
                    {[
                      { text: 'db.users.deleteMany({})', type: "blocked" },
                      { text: 'db.orders.drop()', type: "blocked" },
                      { text: 'db.sales.aggregate([...])', type: "allowed" },
                      { text: 'db.products.find({...})', type: "allowed" },
                    ].map((q, i) => (
                      <motion.div key={i} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", marginBottom: 10, borderRadius: 12, background: q.type === "blocked" ? "rgba(239,68,68,0.06)" : "rgba(0,237,100,0.04)", border: `1px solid ${q.type === "blocked" ? "rgba(239,68,68,0.15)" : "rgba(0,237,100,0.1)"}` }}>
                        <code style={{ fontSize: 12, color: q.type === "blocked" ? "#fca5a5" : "#86efac", fontFamily: "'JetBrains Mono', monospace" }}>{q.text}</code>
                        {q.type === "blocked"
                          ? <AlertTriangle size={15} style={{ color: "#ef4444", flexShrink: 0 }} />
                          : <CheckCircle size={15} style={{ color: GREEN, flexShrink: 0 }} />}
                      </motion.div>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── INTERACTIVE CHARTS ──────────────────────────────── */}
        <section id="graphs" style={{ padding: "120px 24px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <Reveal style={{ textAlign: "center", marginBottom: 80 }}>
              <span className="font-mono-jet" style={{ fontSize: 11, color: GREEN, letterSpacing: "0.15em", textTransform: "uppercase" }}>Visualization Engine</span>
              <h2 className="font-syne" style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 700, marginTop: 16, letterSpacing: "-0.02em" }}>
                Interactive answers, real-time depth.
              </h2>
            </Reveal>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 24 }}>
              <AnimatedBarChart />
              <AnimatedScatter />
              <AnimatedComposed />
            </div>
          </div>
        </section>

        {/* ── CTA ─────────────────────────────────────────────── */}
        <section style={{ padding: "120px 24px 160px" }}>
          <div style={{ maxWidth: 840, margin: "0 auto", textAlign: "center" }}>
            <Reveal>
              <div className="glass-card" style={{ padding: "80px 48px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 50% 0%, ${GREEN}15, transparent 70%)`, pointerEvents: "none" }} />
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 30, ease: "linear" }}
                  style={{ position: "absolute", top: -80, right: -80, width: 240, height: 240, borderRadius: "50%", border: `1px solid ${GREEN}10` }} />
                
                <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: `${GREEN}10`, marginBottom: 32 }}>
                    <Zap size={44} style={{ color: GREEN }} />
                </div>
                
                <h2 className="font-syne" style={{ fontSize: "clamp(32px, 7vw, 36px)", fontWeight: 800, marginBottom: 24, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                  Your MongoDB data has<br />stories to tell. Access them.
                </h2>
                <p style={{ color: "#64748b", fontSize: 18, lineHeight: 1.7, marginBottom: 48, maxWidth: 600, margin: "0 auto 48px" }}>
                  Join the next generation of data-driven teams. Profile your MongoDB Atlas cluster in 60 seconds.
                </p>
                <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
                  <motion.button whileHover={{ scale: 1.05, boxShadow: `0 0 50px ${GREEN}60` }} whileTap={{ scale: 0.97 }}
                    onClick={() => document.getElementById('connect')?.scrollIntoView({ behavior: 'smooth' })}
                    className="pulse-ring"
                    style={{ background: GREEN, color: "#000", border: "none", borderRadius: 14, padding: "20px 44px", fontSize: 16, fontWeight: 700, fontFamily: "'Syne',sans-serif", cursor: "pointer" }}>
                    Get Started Free →
                  </motion.button>
                  <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                    style={{ background: "transparent", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: "20px 44px", fontSize: 16, fontFamily: "inherit", cursor: "pointer" }}>
                    Talk to Sales
                  </motion.button>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── FOOTER ──────────────────────────────────────────── */}
        <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "48px 24px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Brain size={16} color="#000" />
              </div>
              <span className="font-syne" style={{ fontSize: 16, fontWeight: 700, color: "#64748b" }}>AtlasMind</span>
            </div>
            <p style={{ fontSize: 13, color: "#334155", fontWeight: 500 }} className="font-mono-jet">© 2026 AtlasMind, Inc. Secure Private Intelligence.</p>
            <div style={{ display: "flex", gap: 32 }}>
              {["Privacy", "Terms", "Status", "Security"].map(link => (
                <a key={link} href="#" style={{ fontSize: 12, color: "#475569", textDecoration: "none", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em" }}>{link}</a>
              ))}
            </div>
          </div>
        </footer>

        {/* ── FLOATING SCROLL TO TOP ────────────────────────── */}
        <AnimatePresence>
          {showScrollTop && (
            <motion.button
              initial={{ opacity: 0, scale: 0.5, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.5, y: 20 }}
              whileHover={{ scale: 1.1, boxShadow: `0 0 25px ${GREEN}40` }}
              whileTap={{ scale: 0.9 }}
              onClick={scrollToTop}
              style={{
                position: "fixed",
                bottom: 32,
                right: 32,
                zIndex: 49,
                width: 50,
                height: 50,
                borderRadius: "50%",
                background: DARK,
                color: GREEN,
                border: `1px solid ${GREEN}40`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                backdropFilter: "blur(8px)",
              }}
              className="pulse-ring"
            >
              <ChevronUp size={24} strokeWidth={2.5} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
