"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { askAboutInterpretation, type AnalyzeOptions, type InterpretationLanguage } from "@/lib/api";
import {
  COUNTER_FROM,
  MAX_QUESTION_CHARS,
  answerBlocks,
  chatFull,
  chatProblem,
  withAnswer,
  withQuestion,
  type ChatMessage,
} from "@/lib/interpretation-chat";
import type { InterpretationChoice } from "@/lib/interpretation-choice";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

interface Props {
  datasetId: string;
  /** The analysis on screen, with its factor count: what the stored interpretation is for. */
  options: AnalyzeOptions;
  language: InterpretationLanguage;
  /** The model and effort of the interpretation shown, and of every question. */
  choice: InterpretationChoice;
  /** The text of an error of the API in the UI language. */
  errorText: (e: unknown, fallback: string) => string;
}

/**
 * Follow-up questions about the interpretation on screen. The conversation lives in this
 * component's state only; the parent gives it a `key` made of everything the interpretation
 * depends on, so it starts again when one of them changes.
 */
export function InterpretationChat({ datasetId, options, language, choice, errorText }: Props) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputId = useId();
  const counterId = useId();
  const noteId = useId();

  // A conversation that goes away (analysis, language or choice changed) takes its request along.
  useEffect(() => () => abortRef.current?.abort(), []);

  const full = chatFull(messages);
  const problem = chatProblem(messages, draft);
  const canSend = !pending && !full && problem === null;

  const send = async () => {
    if (!canSend) return;
    const question = draft;
    const history = withQuestion(messages, question);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPending(true);
    setError(null);
    // The question shows at once; it stays in the box until the answer is there, so that an error
    // leaves it to try again.
    setMessages(history);
    try {
      const res = await askAboutInterpretation(datasetId, options, language, choice, history, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setMessages(withAnswer(history, res.answer));
      setDraft("");
    } catch (e) {
      if (ctrl.signal.aborted) return;
      // Back to the conversation before this question; the question stays in the box.
      setMessages(messages);
      setError(errorText(e, t("factor.interpretation.chat.failed")));
    } finally {
      if (!ctrl.signal.aborted) {
        setPending(false);
        inputRef.current?.focus();
      }
    }
  };

  const clear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setDraft("");
    setError(null);
    setPending(false);
    inputRef.current?.focus();
  };

  // The newest message comes into view.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, pending]);

  const tooLong = draft.length > MAX_QUESTION_CHARS;

  return (
    <section aria-labelledby={`${inputId}-title`} className="space-y-3 pt-2">
      <div className="space-y-1">
        <h3 id={`${inputId}-title`} className="text-sm font-semibold">
          {t("factor.interpretation.chat.title")}
        </h3>
        <p id={noteId} className="text-xs text-muted max-w-3xl">
          {t("factor.interpretation.chat.note")}
        </p>
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={t("factor.interpretation.chat.log")}
        tabIndex={messages.length > 0 ? 0 : undefined}
        className={cn("space-y-3 max-w-3xl", messages.length > 0 && "max-h-[28rem] overflow-y-auto pr-1")}
      >
        {messages.map((m, i) => (
          <Message key={i} message={m} />
        ))}
        {pending && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {t("factor.interpretation.chat.pending")}
          </p>
        )}
      </div>

      {error && (
        <Notice tone="error" size="sm" role="alert" className="max-w-3xl">
          {error}
        </Notice>
      )}
      {full && !pending && (
        <Notice size="sm" role="status" className="max-w-3xl">
          {t("factor.interpretation.chat.full")}
        </Notice>
      )}

      <div className="space-y-2 max-w-3xl">
        <label htmlFor={inputId} className="sr-only">
          {t("factor.interpretation.chat.label")}
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          value={draft}
          rows={3}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line; not while an input method composes.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={t("factor.interpretation.chat.placeholder")}
          aria-describedby={`${noteId} ${counterId}`}
          aria-invalid={tooLong || undefined}
          className="w-full rounded-md bg-tile px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition disabled:opacity-60 resize-y"
        />
        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" onClick={() => void send()} disabled={!canSend} aria-busy={pending || undefined}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
            {pending ? t("factor.interpretation.chat.sending") : t("factor.interpretation.chat.send")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={clear}
            disabled={messages.length === 0 && draft === "" && !error}
          >
            {t("factor.interpretation.chat.clear")}
          </Button>
          <span className="text-xs text-muted">{t("factor.interpretation.chat.keys")}</span>
          <span
            id={counterId}
            className={cn("ml-auto text-xs tabular-nums", tooLong ? "text-danger-ink" : "text-muted")}
            aria-live="off"
          >
            {draft.length >= COUNTER_FROM || tooLong
              ? t("factor.interpretation.chat.counter", { used: draft.length, max: MAX_QUESTION_CHARS })
              : ""}
          </span>
        </div>
      </div>
    </section>
  );
}

/** A question as typed; an answer as paragraphs and lists of text. */
function Message({ message }: { message: ChatMessage }) {
  const t = useT();
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-accent/10 px-3 py-2 text-sm">
          <span className="sr-only">{t("factor.interpretation.chat.you")}: </span>
          {message.content}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-tile px-3 py-2 text-sm leading-relaxed space-y-2 break-words">
      <span className="sr-only">{t("factor.interpretation.chat.claude")}: </span>
      {answerBlocks(message.content).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{b.text}</p>
        ) : (
          <ul key={i} className="list-disc pl-5 space-y-1">
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
