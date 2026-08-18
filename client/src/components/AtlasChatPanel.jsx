import { useState, useRef, useEffect, useCallback } from "react";
import { Send, ChevronDown, ChevronRight, Shield, AlertTriangle, Loader2, Mic, MicOff, Plus, Database, BarChart3, Check, Search, Zap, Target, Bot, User } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { useChat } from "../hooks/useChat";
import { useVoice } from "../hooks/useVoice";
import { sendVoice, pinToDashboard } from "../services/api";
import ChartRenderer from "./ChartRenderer";
import { MagicCard } from "./ui/magic-card";
import { ShimmerButton } from "./ui/shimmer-button";

/**
 * CollapsibleCodeBlock — toggleable MQL pipeline code block.
 */
/**
 * CollapsibleCodeBlock — toggleable MQL pipeline or context code block.
 */
function CollapsibleCodeBlock({ code, label = "View Generated MQL" }) {
  const [open, setOpen] = useState(false);
  const codeStr = typeof code === 'string' 
    ? code 
    : JSON.stringify(code, null, 2);

  return (
    <div className="mt-2.5 first:mt-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span className="font-medium">{label}</span>
      </button>
      {open && (
        <pre className="mt-2 rounded-[12px] bg-black/40 border border-white/5 p-4 text-[12px] font-mono text-primary/90 overflow-x-auto animate-atlas-scale-in shadow-inner max-h-[300px]">
          <code>{codeStr}</code>
        </pre>
      )}
    </div>
  );
}

/**
 * LoadingIndicator — 3-stage progress indicator while AI processes.
 */
function LoadingIndicator() {
  const [stage, setStage] = useState(0);
  const stages = ["Profiling schema…", "Retrieving contextual examples…", "Generating MQL…"];

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 1200);
    const t2 = setTimeout(() => setStage(2), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="flex items-start gap-3 animate-atlas-fade-in">
      <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
        <Loader2 className="h-4 w-4 text-primary animate-spin" />
      </div>
      <div className="atlas-glass rounded-2xl rounded-tl-sm px-4 py-3 max-w-lg">
        <div className="space-y-1.5">
          {stages.map((s, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2 text-sm transition-opacity duration-300",
                i <= stage ? "opacity-100" : "opacity-0"
              )}
            >
              {i < stage ? (
                <Check className="h-3 w-3 text-primary" />
              ) : i === stage ? (
                <Loader2 className="h-3 w-3 text-primary animate-spin" />
              ) : null}
              <span className="text-muted-foreground">{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * ResultsCard — renders chart/table results (or a 0-results notice) below the AI bubble.
 *
 * Renders when:
 *   - results.length > 0  → full ChartRenderer with type switcher + pin button
 *   - results.length === 0 AND pipeline.length > 0 → "No matching results" card
 */
function ResultsCard({ msg, onPin }) {
  const hasResults   = msg.results?.length > 0;
  const ranPipeline  = !hasResults && msg.pipeline?.length > 0 && !msg.isError;

  // If no results and no pipeline was run, render nothing
  if (!hasResults && !ranPipeline) return null;

  return (
    <div className="mt-3 ml-11 animate-atlas-fade-in">
      {/* Results header */}
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 className="h-3.5 w-3.5 text-primary/70" />
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/70">
          Results
        </span>
        {hasResults && (
          <span className="text-[11px] font-mono text-muted-foreground/40">
            ({msg.results.length} {msg.results.length === 1 ? "document" : "documents"})
          </span>
        )}
      </div>

      {hasResults ? (
        /* Chart renderer — full available width */
        <div className="rounded-2xl overflow-hidden border border-white/[0.07] shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <ChartRenderer
            data={msg.results}
            chartType={msg.chartType || "bar"}
            query={msg.naturalLanguage || msg.content}
            onPin={onPin ? (pinData) => onPin({ ...pinData, collection: msg.collection, pipeline: msg.pipeline }) : undefined}
          />
        </div>
      ) : (
        /* 0-results feedback card — prevents silent failure UX */
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] shadow-[0_4px_16px_rgba(0,0,0,0.3)] px-5 py-4 flex items-start gap-4">
          <div className="p-2 rounded-xl bg-white/5 border border-white/5 mt-0.5">
            <Search className="h-5 w-5 text-muted-foreground/40" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-foreground/80">No matching results</p>
            <p className="text-[12px] text-muted-foreground/60 mt-0.5 leading-relaxed">
              The query ran successfully but returned 0 documents. This usually means the
              generated pipeline used field names that don't match your data, or your collection
              doesn't have records matching those criteria. Try rephrasing your query with
              more specific field names.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * AtlasChatPanel — main chat area bridging useChat + useVoice to Lovable layout.
 *
 * Aligned to backend response structure:
 *   - safetyStatus: "read-only" → green verified badge
 *   - safetyStatus: "approval-required" → amber badge
 *   - pipeline/mql → collapsible code block
 *   - results → inline ChartRenderer (bar/line/pie/area/table)
 *   - executionTimeMs, confidenceScore, similarQueriesCount → metadata line
 *   - Voice: records audio → POST /api/voice (transcribes + executes) → addVoiceResult()
 */
const AVAILABLE_MODELS = [
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 Versatile',
    provider: 'Meta',
    desc: 'Default balanced model. Superior MQL translation and schema reasoning.',
    badge: '70B Params',
    badgeColor: 'bg-primary/20 text-primary border border-primary/30',
    speed: 'Fast'
  },
  {
    id: 'moonshotai/kimi-k2-instruct',
    name: 'Kimi K2 Instruct',
    provider: 'Moonshot AI',
    desc: 'Frontier agentic model excelling at complex reasoning and multi-step MQL generation.',
    badge: 'Kimi K2',
    badgeColor: 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30',
    speed: 'Ultra'
  },
  {
    id: 'openai/gpt-oss-120b',
    name: 'GPT OSS 120B',
    provider: 'OpenAI Community',
    desc: 'Enormous open model with extreme deep multi-stage pipeline precision.',
    badge: '120B Params',
    badgeColor: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
    speed: 'Balanced'
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 Instant',
    provider: 'Meta',
    desc: 'Ultra-low latency model for rapid MQL prototyping and lightweight query tasks.',
    badge: '8B Instant',
    badgeColor: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    speed: 'Fastest'
  },
  {
    id: 'groq/compound',
    name: 'Groq Compound',
    provider: 'Groq Labs',
    desc: 'Multi-model agent router compiling safety validation and generation.',
    badge: 'Hybrid Router',
    badgeColor: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    speed: 'Sub-150ms'
  }
];

export default function AtlasChatPanel({ onLastMessage, onNewQuery, onPinAdded, highlightedMessageId, onQuerySuccess }) {
  const { 
    messages, 
    isLoading, 
    selectedModel, 
    setSelectedModel, 
    sendMessage, 
    approveWrite, 
    addVoiceResult, 
    setMessages 
  } = useChat(highlightedMessageId, onQuerySuccess);
  const { isRecording, startRecording, stopRecording, error: voiceError } = useVoice();
  const [input, setInput] = useState("");
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    // Only auto-scroll on new messages if there is no pending sidebar highlight interaction active
    if (!highlightedMessageId) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading, highlightedMessageId]);

  // Scroll and focus highlight animation requested by Left Sidebar clicking
  useEffect(() => {
    if (highlightedMessageId) {
      const targetId = `msg-${highlightedMessageId}`;
      const element = document.getElementById(targetId) || 
                      document.getElementById(`msg-user-${highlightedMessageId}`) || 
                      document.getElementById(`msg-assistant-${highlightedMessageId}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        
        // Premium scale & glowing highlight transition
        element.classList.add("ring-2", "ring-[#00ed64]", "ring-offset-8", "ring-offset-background", "p-2", "bg-[#00ed64]/5", "rounded-2xl", "scale-[1.02]");
        setTimeout(() => {
          element.classList.remove("ring-2", "ring-[#00ed64]", "ring-offset-8", "ring-offset-background", "p-2", "bg-[#00ed64]/5", "rounded-2xl", "scale-[1.02]");
        }, 2500);
      }
    }
  }, [highlightedMessageId]);

  // Notify parent of the latest assistant message (for Inspector panel)
  useEffect(() => {
    if (onLastMessage) {
      const last = [...messages].reverse().find((m) => m.role === "assistant" && !m.isError);
      onLastMessage(last || null);
    }
  }, [messages, onLastMessage]);

  const handleSend = () => {
    if (!input.trim() || isLoading || voiceLoading) return;
    sendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Voice: toggle recording
  const handleVoiceToggle = async () => {
    if (isRecording) {
      const blob = await stopRecording();
      if (!blob) return;

      setVoiceLoading(true);
      try {
        const response = await sendVoice(blob);
        addVoiceResult(response);
      } catch (err) {
        console.error("[Voice] Error:", err.message);
      } finally {
        setVoiceLoading(false);
      }
    } else {
      await startRecording();
    }
  };

  const [pinToast, setPinToast] = useState(null);

  // Pin a chart to the dashboard
  const handlePin = useCallback(async ({ query, chartType, results, collection, pipeline }) => {
    try {
      await pinToDashboard({ query, chartType, results, collection, pipeline });
      if (onPinAdded) onPinAdded();
      setPinToast("Pinned to Dashboard");
      setTimeout(() => setPinToast(null), 3000);
    } catch (err) {
      console.error("[Pin] Failed to pin:", err.message);
    }
  }, [onPinAdded]);

  // Map message metadata to badge type
  const getSafetyBadge = (msg) => {
    if (msg.role !== "assistant" || msg.isError) return null;
    if (!msg.pipeline?.length && !msg.safetyStatus) return null;

    const status = msg.safetyStatus || (msg.safetyBlocked ? "approval-required" : "read-only");
    return status;
  };

  const suggestionChips = [
    "Show total sales by region",
    "Find top 10 customers by order value",
    "Analyze monthly revenue trends",
    "Count documents by status",
  ];

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Empty state */}
        {messages.length === 0 && !isLoading && (
          <div className="chat-welcome flex flex-col items-center justify-center h-full text-center px-6 py-12 gap-6">
            <div className="chat-welcome-icon mb-4">
              <div className="relative flex items-center justify-center w-28 h-28 rounded-[40px] bg-gradient-to-br from-primary/30 to-primary/5 border border-primary/20 shadow-[0_0_50px_rgba(0,237,100,0.15)] backdrop-blur-2xl">
                <Database className="h-12 w-12 text-primary drop-shadow-[0_0_20px_rgba(0,237,100,0.8)]" />
                <div className="absolute inset-0 rounded-[40px] border border-white/5 pointer-events-none" />
              </div>
            </div>
            <h2 className="font-display font-syne text-4xl sm:text-5xl tracking-tight text-foreground leading-tight">
              Talk to your <span className="font-syne text-primary">data.</span>
            </h2>
            <p className="max-w-[500px] text-muted-foreground text-base sm:text-lg leading-relaxed">
              AtlasMind transforms your natural language into production-grade MQL in <span className="text-foreground font-medium">sub-200ms</span>.
            </p>
            <div className="chat-suggestions flex flex-wrap justify-center gap-3 mt-4">
              {suggestionChips.map((s) => (
                <button
                  key={s}
                  className="chat-suggestion px-5 py-2.5 rounded-2xl bg-white/5 border border-white/10 text-sm font-medium hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-all duration-300"
                  onClick={() => sendMessage(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg) => {
          const safetyBadge = getSafetyBadge(msg);
          const isUser = msg.role === "user";

          return (
            <div
              key={msg.id}
              id={`msg-${msg.id}`}
              className={cn("flex flex-col animate-atlas-fade-in transition-all duration-500", isUser ? "items-end" : "items-start")}
            >
              {isUser ? (
                /* User bubble — right aligned */
                <div className="flex flex-col items-end gap-1 max-w-md">
                  {msg.isVoice && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Mic className="h-3 w-3" /> Voice query
                    </span>
                  )}
                  <div className="bg-primary text-primary-foreground rounded-[20px] rounded-tr-[4px] px-4 py-2.5 shadow-[0_2px_10px_rgba(0,237,100,0.2)]">
                    <p className="text-[15px] font-medium text-primary-foreground leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ) : (
                /* AI response group — bubble + optional chart below */
                <div className="w-full max-w-3xl">
                  {/* AI bubble */}
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 mt-0.5 shadow-sm backdrop-blur-md">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="atlas-glass rounded-[20px] rounded-tl-[4px] px-5 py-4 flex-1 shadow-sm border border-white/5">
                      <p className="text-[15px] text-foreground/90 leading-relaxed">{msg.content}</p>

                      {/* Safety badge */}
                      {safetyBadge && (
                        <div className="mt-2.5">
                          {safetyBadge === "read-only" ? (
                            <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/20 gap-1 text-[11px]">
                              <Shield className="h-3 w-3" />
                              Read-Only Verified
                            </Badge>
                          ) : (
                            <Badge className="bg-warning/15 text-warning border-warning/30 hover:bg-warning/20 gap-1 text-[11px]">
                              <AlertTriangle className="h-3 w-3" />
                              Approval Required
                            </Badge>
                          )}
                        </div>
                      )}

                      {/* AI Code Blocks (Context and MQL) */}
                      {(msg.schemaContext || msg.pipeline?.length > 0) && (
                        <div className="mt-3 flex flex-col">
                          {/* 1. Context (if available) - Before MQL */}
                          {msg.schemaContext && (
                            <CollapsibleCodeBlock 
                              code={msg.schemaContext} 
                              label="View Context" 
                            />
                          )}

                          {/* 2. Generated MQL (if available) */}
                          {msg.pipeline?.length > 0 && (
                            <CollapsibleCodeBlock 
                              code={msg.pipeline} 
                              label="View Generated MQL" 
                            />
                          )}
                        </div>
                      )}

                      {/* Staged Write HITL Intercept Panel */}
                      {msg.safetyStatus === 'approval-required' && msg.approvalToken && (
                        <div className="mt-4 max-w-xl animate-atlas-fade-in relative z-25">
                          <MagicCard
                            className="p-5 flex flex-col gap-4 border border-amber-500/30 bg-neutral-950/60"
                            gradientColor="#f59e0b"
                            gradientOpacity={0.25}
                          >
                            <div className="flex items-start gap-3">
                              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 mt-0.5">
                                <AlertTriangle className="h-5 w-5 animate-pulse" />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-foreground tracking-tight">Supervisor Authorization Required</h4>
                                <p className="text-[12px] text-muted-foreground/90 mt-1 leading-relaxed">
                                  This request involves executing a mutating database write operation on the <span className="font-mono text-[#00ed64] font-bold">"{msg.collection}"</span> collection. Under session safety rules, this action has been safely staged in draft form.
                                </p>
                              </div>
                            </div>

                            <div className="rounded-xl border border-white/5 bg-black/60 p-3.5 font-mono text-[11px] text-[#00ed64]/90 overflow-x-auto max-h-[160px]">
                              <code>{JSON.stringify(msg.pipeline, null, 2)}</code>
                            </div>

                            <div className="flex items-center gap-3 mt-1.5">
                              <ShimmerButton
                                onClick={() => approveWrite(msg.id, msg.approvalToken)}
                                disabled={isLoading}
                                shimmerColor="#00ed64"
                                background="#042f1a"
                                borderRadius="12px"
                                className="px-5 py-2 text-[12px] h-9.5 font-bold shadow-[0_4px_25px_rgba(0,237,100,0.2)] flex items-center gap-2"
                              >
                                {isLoading ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5 stroke-[3px]" />
                                )}
                                Authorize & Commit Changes
                              </ShimmerButton>

                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  // Discard token and restore to read-only clean slate
                                  setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, approvalToken: null, content: '❌ Mutating database draft operation discarded.' } : m));
                                }}
                                disabled={isLoading}
                                className="text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 h-9.5 rounded-xl px-4"
                              >
                                Discard Draft
                              </Button>
                            </div>
                          </MagicCard>
                        </div>
                      )}

                      {/* Metadata row */}
                      {(msg.executionTimeMs || msg.confidenceScore || msg.similarQueriesCount) && (
                        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground border-t border-border/30 pt-2">
                          {msg.executionTimeMs != null && (
                            <span title="Query execution time" className="flex items-center gap-1">
                              <Zap className="h-3 w-3 text-primary/70" fill="currentColor" /> {msg.executionTimeMs}ms
                            </span>
                          )}
                          {msg.confidenceScore != null && (
                            <span title="AI confidence score" className="flex items-center gap-1">
                              <Target className="h-3 w-3 text-primary/70" /> {msg.confidenceScore}% confidence
                            </span>
                          )}
                          {msg.similarQueriesCount != null && (
                            <span title="Similar examples used for few-shot prompting" className="flex items-center gap-1">
                              <Search className="h-3 w-3 text-primary/70" /> {msg.similarQueriesCount} similar examples
                            </span>
                          )}
                          {msg.results?.length > 0 && (
                            <span title="Number of results returned" className="flex items-center gap-1">
                              <BarChart3 className="h-3 w-3 text-primary/70" /> {msg.results.length} results
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Results / Chart — rendered BELOW the bubble, full width of the message group */}
                  {!msg.isError && msg.results?.length > 0 && (
                    <ResultsCard msg={msg} onPin={handlePin} />
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Loading indicator */}
        {(isLoading || voiceLoading) && <LoadingIndicator />}
        <div ref={messagesEndRef} className="h-1" />
      </div>

      {/* Voice error */}
      {voiceError && (
        <div className="px-4 pb-1 text-xs text-destructive">{voiceError}</div>
      )}

      {/* Input bar - Floating Premium Pill */}
      <div className="p-8 shrink-0 relative">
        {pinToast && (
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-full mb-2 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded shadow-lg z-50">
            {pinToast}
          </div>
        )}
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-t from-background via-background/90 to-transparent pointer-events-none" />
        <div className="relative flex items-center gap-4 atlas-glass rounded-[32px] px-5 py-4 w-full max-w-4xl mx-auto shadow-[0_15px_50px_rgba(0,0,0,0.5)] border border-white/10 transition-all duration-500 focus-within:border-primary/60 focus-within:shadow-[0_0_40px_rgba(0,237,100,0.12)] focus-within:ring-1 focus-within:ring-primary/20">
          {/* New Query button */}
          <Button
            size="icon"
            variant="ghost"
            onClick={onNewQuery}
            className="h-11 w-11 rounded-2xl text-muted-foreground hover:text-primary hover:bg-primary/10 border border-transparent hover:border-primary/20 shrink-0 transition-all duration-300"
            aria-label="New Query"
          >
            <Plus className="h-6 w-6 stroke-[2.5px]" />
          </Button>
          
          {/* Dynamic LLM Model Swapper */}
          <div className="relative shrink-0 select-none">
            <button
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              className="flex items-center gap-2 pl-2.5 pr-2 h-9 rounded-xl bg-white/[0.06] border border-white/[0.08] hover:bg-white/10 hover:border-primary/30 transition-all duration-200 shrink-0 outline-none select-none group"
              title="Switch AI model"
            >
              {/* Accent dot */}
              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 shadow-[0_0_6px_rgba(0,237,100,0.7)]" />
              <span className="hidden md:inline text-[12px] font-semibold text-foreground/80 group-hover:text-foreground transition-colors max-w-[110px] truncate">
                {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name || "Llama 3.3"}
              </span>
              <ChevronDown className={cn("h-3 w-3 text-muted-foreground/50 transition-transform duration-200 shrink-0", modelDropdownOpen && "rotate-180")} />
            </button>
            {/* Vertical separator */}
            <div className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-px h-5 bg-white/10" />

            {modelDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setModelDropdownOpen(false)}
                />
                <div className="absolute bottom-12 left-0 w-[360px] bg-[#0c1118] border border-white/15 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.9)] z-50 animate-atlas-slide-in-bottom overflow-hidden">
                  {/* Dropdown Header */}
                  <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Select Model</p>
                    <span className="text-[10px] text-primary/60 font-mono bg-primary/5 px-2 py-0.5 rounded border border-primary/10">
                      {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.speed}
                    </span>
                  </div>
                  {/* Model list */}
                  <div className="flex flex-col gap-0.5 p-2 max-h-[380px] overflow-y-auto">
                    {AVAILABLE_MODELS.map((m) => {
                      const isCurrent = m.id === selectedModel;
                      return (
                        <button
                          key={m.id}
                          onClick={() => { setSelectedModel(m.id); setModelDropdownOpen(false); }}
                          className={cn(
                            "w-full text-left px-3 py-3 rounded-xl flex items-start gap-3 transition-all duration-150 border",
                            isCurrent
                              ? "bg-primary/10 border-primary/20"
                              : "border-transparent hover:bg-white/[0.04] hover:border-white/5"
                          )}
                        >
                          {/* Active indicator */}
                          <div className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", isCurrent ? "bg-primary shadow-[0_0_6px_rgba(0,237,100,0.7)]" : "bg-white/10")} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className={cn("text-[13px] font-semibold", isCurrent ? "text-primary" : "text-foreground/85")}>{m.name}</span>
                              <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 font-mono", m.badgeColor)}>{m.badge}</span>
                            </div>
                            {/* <p className="text-[11px] text-muted-foreground/60 leading-relaxed mt-1">{m.desc}</p> */}
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <span className="text-[9.5px] text-muted-foreground/40 font-medium">{m.provider}</span>
                              <span className="text-[9px] text-muted-foreground/25">·</span>
                              <span className="text-[9.5px] text-primary/60 font-semibold">{m.speed}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {isRecording ? (
            /* Voice wave indicator while recording */
            <div className="flex-1 flex items-center gap-3">
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <span
                    key={i}
                    className="inline-block w-0.5 bg-destructive/80 rounded-full animate-pulse"
                    style={{
                      height: `${12 + Math.random() * 12}px`,
                      animationDelay: `${i * 120}ms`,
                      animationDuration: '0.6s',
                    }}
                  />
                ))}
              </div>
              <span className="text-sm text-destructive/80 font-medium animate-pulse">Listening…</span>
              <button
                type="button"
                onClick={handleVoiceToggle}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask AtlasMind anything…"
              className="flex-1 bg-transparent text-[15px] font-medium text-foreground placeholder:text-muted-foreground/70 outline-none w-full"
              disabled={isLoading || voiceLoading}
            />
          )}

          {/* Keyboard shortcut hint */}
          {!isRecording && input.trim() && !isLoading && (
            <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0 hidden sm:block">⏎</span>
          )}

          {/* Send button — visible when there's input */}
          {!isRecording && input.trim() && (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={isLoading || voiceLoading}
              className="h-10 w-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 shadow-[0_0_15px_rgba(0,237,100,0.3)] transition-all duration-300"
              aria-label="Send query"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}

          {/* Voice/Mic button */}
          <button
            type="button"
            onClick={handleVoiceToggle}
            disabled={voiceLoading || isLoading}
            title={isRecording ? "Stop recording" : "Start voice query"}
            aria-label={isRecording ? "Stop recording" : "Start voice query"}
            className={cn(
              "h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-300",
              isRecording
                ? "bg-destructive/90 text-destructive-foreground animate-atlas-pulse-dot shadow-[0_0_20px_rgba(239,68,68,0.4)]"
                : "bg-primary/20 text-primary hover:bg-primary hover:text-primary-foreground"
            )}
          >
            {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
