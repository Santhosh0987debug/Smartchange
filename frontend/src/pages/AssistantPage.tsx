import { useState } from 'react';
import { Bot, Send, ChevronDown, Database, TriangleAlert } from 'lucide-react';
import { API, getApiError, type AiAnswer } from '../api';
import { useAiStatus } from '../queries';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import StatusBadge from '../components/StatusBadge';

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
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold flex items-center gap-2">
            <Bot size={16} /> AI SOP Assistant
          </h3>
          {status.isLoading ? (
            <span className="text-xs text-slate-500">checking provider…</span>
          ) : status.isError ? (
            <span className="text-xs text-red-300">provider status unavailable</span>
          ) : (
            <span
              className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300"
              title={`Retrieval: ${status.data?.retrieval}; approved docs: ${status.data?.documents_approved}`}
            >
              Provider: {provider?.name}
              {provider?.configured ? ' (configured)' : ' (not configured — excerpts only)'} ·{' '}
              {status.data?.documents_approved} approved docs
            </span>
          )}
        </div>
        <div className="text-xs text-amber-200/90 mt-1 flex gap-1">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          Documentation guidance only — verify against the approved SOP revision and workflow. This
          assistant never approves configurations or authorizes readiness.
        </div>
        {err && (
          <div className="mt-2">
            <ErrorState error={err} />
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ask();
            }}
            placeholder="Ask about approved procedures…"
            aria-label="Assistant question"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"
          />
          <button
            onClick={() => ask()}
            disabled={asking || !q.trim()}
            className="bg-amber-400 text-slate-950 font-semibold rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 flex items-center gap-1"
          >
            <Send size={14} /> {asking ? 'Asking…' : 'Ask'}
          </button>
        </div>
        <div className="flex gap-1.5 flex-wrap mt-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setQ(ex);
                ask(ex);
              }}
              className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full px-2.5 py-1 text-slate-300"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {asking && <Loading label="Retrieving approved passages…" />}

      <div className="space-y-2">
        {chat.length === 0 && !asking && (
          <div className="text-sm text-slate-500">
            No questions yet. Answers cite document title, revision, and section — and the assistant
            abstains when approved documentation does not cover the question.
          </div>
        )}
        {chat.map((c, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm">
            <div className="text-slate-400 text-xs">Q: {c.q}</div>
            <div className="whitespace-pre-line mt-1">{c.answer}</div>
            {c.live_data && (
              <div className="mt-2 border border-sky-800 bg-sky-950/40 rounded-lg p-2 text-xs">
                <div className="font-semibold text-sky-200 flex items-center gap-1">
                  <Database size={12} /> Live backend data (not document guidance)
                </div>
                <pre className="whitespace-pre-wrap mt-1 text-slate-300">
                  {JSON.stringify(c.live_data, null, 1)}
                </pre>
              </div>
            )}
            <div className="mt-2">
              <div className="text-xs text-slate-400 mb-1">
                Sources ({c.sources.length}) · grounded: {String(c.grounded)}
              </div>
              {c.sources.length === 0 && (
                <div className="text-xs text-slate-500">No approved source retrieved.</div>
              )}
              {c.sources.map((s, j) => {
                const key = `${i}-${j}`;
                return (
                  <div key={j} className="border border-slate-700 rounded-lg mb-1.5">
                    <button
                      onClick={() => toggleExcerpt(key)}
                      className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-xs"
                      aria-expanded={openExcerpts.has(key)}
                    >
                      <ChevronDown
                        size={13}
                        className={`transition-transform ${openExcerpts.has(key) ? 'rotate-180' : ''}`}
                      />
                      <span className="font-medium">
                        {s.title} {s.revision}
                      </span>
                      <StatusBadge value="APPROVED" />
                      <span className="text-slate-400 ml-auto">{s.section}</span>
                    </button>
                    {openExcerpts.has(key) && (
                      <div className="px-2.5 pb-2 text-xs text-slate-300 border-t border-slate-800 pt-1.5">
                        {c.excerpts[j] ?? 'Excerpt unavailable.'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {c.limitations.length > 0 && (
              <div className="text-xs text-amber-200 mt-1">
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
        ))}
      </div>
    </div>
  );
}
