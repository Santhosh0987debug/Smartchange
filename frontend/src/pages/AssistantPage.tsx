import { useState } from 'react';
import { Bot, Send, ChevronDown, Database, TriangleAlert, User, Sparkles, BookOpenCheck } from 'lucide-react';
import { API, getApiError, type AiAnswer } from '../api';
import { useAiStatus } from '../queries';
import ErrorState from '../components/ErrorState';
import StatusBadge from '../components/StatusBadge';
import PageHeader from '../components/PageHeader';
import { Card } from '../components/Card';
import EmptyState from '../components/EmptyState';

const EXAMPLES = [
  'What setup changes are required for Product B?',
  'Which approved document describes nozzle replacement?',
  'What is the specified operating temperature for Product B?',
  'Why did the configuration verification fail?',
];

interface ChatEntry extends AiAnswer {
  q: string;
}

export default function AssistantPage() {
  const status = useAiStatus();
  const [q, setQ] = useState('Why is the nozzle replacement required for Product B?');
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState(false);
  const [openExcerpts, setOpenExcerpts] = useState<Set<string>>(new Set());

  async function ask(question?: string) {
    const text = (question ?? q).trim();
    if (!text || asking) return;
    setErr('');
    setAsking(true);
    try {
      const res: AiAnswer = await API.aiAsk(text);
      setChat([...chat, { q: text, ...res }]);
      setQ('');
    } catch (e) {
      setErr(getApiError(e));
    } finally {
      setAsking(false);
    }
  }

  function toggleExcerpt(key: string) {
    const next = new Set(openExcerpts);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenExcerpts(next);
  }

  const provider = status.data?.provider;

  return (
    <div className="space-y-3 max-w-4xl">
      <PageHeader
        title="AI SOP Assistant"
        subtitle="Documentation guidance grounded in approved SOPs — never approves configurations or authorizes readiness."
      />
      <Card>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="card-title">
            <Bot size={16} /> Ask about approved procedures
          </span>
          {status.isLoading ? (
            <span className="text-xs text-slate-500">checking provider…</span>
          ) : status.isError ? (
            <span className="text-xs text-red-300 rounded-full border border-red-800 bg-red-950/50 px-2 py-0.5">provider status unavailable</span>
          ) : (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-800 text-slate-300 font-medium"
              title={`Retrieval: ${status.data?.retrieval}; approved docs: ${status.data?.documents_approved}`}
            >
              Provider: {provider?.name}
              {provider?.configured ? ' (configured)' : ' (not configured — excerpts only)'} ·{' '}
              {status.data?.documents_approved} approved docs
            </span>
          )}
        </div>
        <div className="text-xs text-amber-200/90 mt-1.5 flex gap-1.5 rounded-lg border border-amber-900/60 bg-amber-950/40 px-2.5 py-1.5">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          <span>
            Documentation guidance only — verify against the approved SOP revision and workflow. This
            assistant never approves configurations or authorizes readiness.
          </span>
        </div>
        {err && (
          <div className="mt-2">
            <ErrorState error={err} />
          </div>
        )}
        <div className="flex gap-2 mt-2.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ask();
            }}
            placeholder="Ask about approved procedures…"
            aria-label="Assistant question"
            className="input flex-1"
          />
          <button
            onClick={() => ask()}
            disabled={asking || !q.trim()}
            className="btn btn-primary text-sm disabled:opacity-50 flex items-center gap-1"
          >
            <Send size={14} /> {asking ? 'Asking…' : 'Ask'}
          </button>
        </div>
        <div className="flex gap-1.5 flex-wrap mt-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => ask(ex)}
              disabled={asking}
              className="text-xs bg-slate-800 hover:bg-slate-700 hover:border-slate-600 border border-slate-700 rounded-full px-2.5 py-1 text-slate-300 transition-colors disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      </Card>

      {asking && (
        <Card className="flex items-center gap-3">
          <span className="rounded-full bg-slate-800 border border-slate-700 p-2">
            <Bot size={16} className="text-cyan-300" />
          </span>
          <div>
            <div className="text-sm font-medium">Retrieving approved passages…</div>
            <div className="flex gap-1 mt-1.5" aria-hidden="true">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {chat.length === 0 && !asking && (
          <EmptyState
            icon={BookOpenCheck}
            title="No questions yet"
            detail="Answers cite document title, revision, and section — and the assistant abstains when approved documentation does not cover the question."
          />
        )}
        {chat.map((c, i) => (
          <div key={i} className="space-y-2 rise-in">
            {/* User question */}
            <div className="flex justify-end">
              <div className="bubble-user max-w-[85%] px-3.5 py-2.5 text-sm">
                <div className="flex items-center gap-1.5 text-[11px] opacity-80 mb-0.5">
                  <User size={11} /> You
                </div>
                {c.q}
              </div>
            </div>
            {/* AI answer */}
            <div className="flex">
              <div className="bubble-ai max-w-[95%] px-4 py-3 text-sm flex-1">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
                  <Sparkles size={11} className="text-cyan-300" /> SOP Assistant
                  <span className={`ml-auto rounded-full border px-1.5 py-px font-semibold ${
                    c.grounded
                      ? 'border-emerald-800 bg-emerald-950/50 text-emerald-300'
                      : 'border-amber-800 bg-amber-950/50 text-amber-300'
                  }`}>
                    {c.grounded ? 'grounded in docs' : 'AI-generated explanation'}
                  </span>
                </div>
                <div className="whitespace-pre-line text-slate-100 leading-relaxed">{c.answer}</div>
                {c.live_data && (
                  <div className="mt-2.5 border border-sky-800 bg-sky-950/40 rounded-lg p-2.5 text-xs">
                    <div className="font-semibold text-sky-200 flex items-center gap-1">
                      <Database size={12} /> Live backend data (not document guidance)
                    </div>
                    <pre className="whitespace-pre-wrap mt-1 text-slate-300 font-mono">
                      {JSON.stringify(c.live_data, null, 1)}
                    </pre>
                  </div>
                )}
                <div className="mt-2.5 pt-2 border-t border-slate-700/70">
                  <div className="text-[11px] text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">
                    Sources ({c.sources.length}) · retrieved passages, not generated text
                  </div>
                  {c.sources.length === 0 && (
                    <div className="text-xs text-slate-500">No approved source retrieved — answer is AI-generated only.</div>
                  )}
                  {c.sources.map((s, j) => {
                    const key = `${i}-${j}`;
                    const open = openExcerpts.has(key);
                    return (
                      <div key={j} className="border border-slate-700 rounded-lg mb-1.5 overflow-hidden bg-slate-800/40">
                        <button
                          onClick={() => toggleExcerpt(key)}
                          className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-xs hover:bg-slate-800/70 transition-colors"
                          aria-expanded={open}
                        >
                          <ChevronDown
                            size={13}
                            className={`transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
                          />
                          <span className="font-medium truncate">
                            {s.title} <span className="font-mono text-slate-400">{s.revision}</span>
                          </span>
                          <StatusBadge value="APPROVED" />
                          <span className="text-slate-400 ml-auto truncate">{s.section}</span>
                        </button>
                        {open && (
                          <div className="px-2.5 pb-2 text-xs text-slate-300 border-t border-slate-800 pt-1.5 leading-relaxed bg-slate-900/50">
                            <span className="eyebrow block mb-1">Retrieved excerpt — verbatim</span>
                            {c.excerpts[j] ?? 'Excerpt unavailable.'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {c.limitations.length > 0 && (
                  <div className="text-xs text-amber-200 mt-1.5 rounded-lg border border-amber-900/60 bg-amber-950/40 px-2 py-1.5">
                    {c.limitations.map((l, k) => (
                      <div key={k}>Limitations: {l}</div>
                    ))}
                  </div>
                )}
                {c.warnings.length > 0 && (
                  <div className="text-xs text-slate-500 mt-1">
                    {c.warnings.map((w, k) => (
                      <div key={k}>{w}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
