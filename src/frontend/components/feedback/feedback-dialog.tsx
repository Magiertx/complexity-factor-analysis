"use client";

import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { HttpError, sendFeedback, type FeedbackKind } from "@/lib/api";
import { MAX_CONTACT, MAX_MESSAGE, technicalDetails } from "@/lib/feedback";
import { plainFailure } from "@/lib/factor-analysis";
import { useLocale, useT, useTMaybe } from "@/lib/i18n";
import { lastErrorCode } from "@/lib/last-error";
import { Button } from "@/components/ui/button";
import { ChoiceMark } from "@/components/ui/choice";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { useToasts } from "@/components/ui/toasts";

export interface Draft {
  kind: FeedbackKind;
  message: string;
  contact: string;
  /** Whether the technical details go along. On unless the sender turns it off. */
  technical: boolean;
}

const KINDS: FeedbackKind[] = ["bug", "idea", "other"];

/** The feedback form as a panel at the right edge: a modal dialog like the fact sheet of a measure. */
export function FeedbackDialog({
  request,
  draft,
  onDraft,
  onSent,
  onClose,
}: {
  request: { errorCode: string | null; from: HTMLElement | null } | null;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  onSent: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <Sheet open={request !== null} labelledBy={titleId} onClose={onClose} from={request?.from}>
      {request && (
        <FeedbackForm
          titleId={titleId}
          errorCode={request.errorCode}
          draft={draft}
          onDraft={onDraft}
          onSent={onSent}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

function FeedbackForm({
  titleId,
  errorCode,
  draft,
  onDraft,
  onSent,
  onClose,
}: {
  titleId: string;
  errorCode: string | null;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  onSent: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const tMaybe = useTMaybe();
  const { locale } = useLocale();
  const { notify } = useToasts();
  const pathname = usePathname();
  const formId = useId();
  const messageId = useId();
  const contactId = useId();
  const counterId = useId();
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ text: string; details: string | null } | null>(null);

  // Read while the dialog is open, so the list shows what a send would carry now.
  const details = technicalDetails({
    pathname,
    search: window.location.search,
    language: locale,
    userAgent: navigator.userAgent,
    errorCode: errorCode ?? lastErrorCode(),
  });
  const set = (patch: Partial<Draft>) => onDraft({ ...draft, ...patch });
  const message = draft.message.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message || sending) return;
    setSending(true);
    setFailure(null);
    try {
      await sendFeedback({
        kind: draft.kind,
        message,
        contact: draft.contact.trim(),
        context: draft.technical ? details : null,
        website,
      });
      notify({ key: "feedback-sent", tone: "success", message: t("feedback.thanks") });
      onSent();
      onClose();
    } catch (err) {
      if (err instanceof HttpError) {
        // The limit of this form is hourly; the general sentence would say "wait a moment".
        const code = err.code === "rate_limited" ? "feedback_rate_limited" : err.code;
        setFailure(plainFailure(tMaybe, { code, params: err.params, message: err.message }, t("feedback.failed")));
      } else {
        setFailure(plainFailure(tMaybe, { message: err instanceof Error ? err.message : null }, t("feedback.failed")));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-border shrink-0">
        <h2 id={titleId} className="flex-1 text-base font-semibold">
          {t("feedback.title")}
        </h2>
        <IconButton icon={X} name={t("common.close")} keyCap="Esc" size="sm" onClick={onClose} />
      </div>

      <form id={formId} onSubmit={submit} className="relative flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
        <Segmented
          aria-label={t("feedback.kind_label")}
          value={draft.kind}
          onChange={(kind) => set({ kind })}
          options={KINDS.map((kind) => ({ value: kind, label: t(`feedback.kind.${kind}`) }))}
        />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={messageId}>{t("feedback.message_label")}</Label>
            <span id={counterId} className="text-xs tabular-nums text-muted">
              {t("feedback.counter", { n: draft.message.length, max: MAX_MESSAGE })}
            </span>
          </div>
          <textarea
            id={messageId}
            data-autofocus
            value={draft.message}
            onChange={(e) => set({ message: e.target.value })}
            maxLength={MAX_MESSAGE}
            rows={7}
            placeholder={t(`feedback.message_placeholder.${draft.kind}`)}
            aria-describedby={counterId}
            className="w-full min-h-[8rem] resize-y rounded-md bg-tile px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={contactId}>{t("feedback.contact_label")}</Label>
          <Input
            id={contactId}
            value={draft.contact}
            onChange={(e) => set({ contact: e.target.value })}
            maxLength={MAX_CONTACT}
            placeholder={t("feedback.contact_placeholder")}
            autoComplete="off"
          />
        </div>

        <div className="flex min-h-6 items-center gap-1.5">
          <label className="flex min-h-6 cursor-pointer items-center gap-2 rounded-md text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
            <input
              type="checkbox"
              className="sr-only"
              checked={draft.technical}
              onChange={(e) => set({ technical: e.target.checked })}
            />
            <ChoiceMark checked={draft.technical} />
            {t("feedback.technical")}
          </label>
          <InfoTip topic={t("feedback.technical_topic")} text={t("feedback.technical_info")} width={340}>
            <p>{t("feedback.technical_info")}</p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <Row name={t("feedback.technical_version")} value={t("feedback.technical_version_value")} />
              <Row name={t("feedback.technical_page")} value={details.route} />
              <Row name={t("feedback.technical_step")} value={details.step} none={t("feedback.technical_none")} />
              <Row name={t("feedback.technical_language")} value={details.language} />
              <Row name={t("feedback.technical_browser")} value={details.user_agent} />
              <Row name={t("feedback.technical_error")} value={details.error_code} none={t("feedback.technical_none")} />
            </dl>
          </InfoTip>
        </div>

        {/* For bots that fill every field; out of sight and out of the tab order for people. */}
        <div aria-hidden className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        {failure && (
          <Notice tone="error" size="sm" role="alert">
            <span className="inline-flex items-start gap-1.5">
              {failure.text}
              {failure.details && <InfoTip size="xs" topic={t("feedback.details")} text={failure.details} />}
            </span>
          </Notice>
        )}
      </form>

      <div className="shrink-0 flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <p className="min-w-0 text-xs text-muted">{t("feedback.anonymous")}</p>
        <Button type="submit" form={formId} disabled={!message || sending}>
          {sending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {sending ? t("feedback.sending") : t("feedback.send")}
        </Button>
      </div>
    </>
  );
}

function Row({ name, value, none }: { name: string; value?: string; none?: string }) {
  return (
    <>
      <dt className="text-muted">{name}</dt>
      <dd className="min-w-0 break-words">{value ?? none}</dd>
    </>
  );
}
