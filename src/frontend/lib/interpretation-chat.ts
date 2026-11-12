/**
 * Follow-up questions about an interpretation: the conversation lives in the browser only and is
 * sent whole with every question. The limits are the server's (docs/API.md).
 */

import type { InterpretationChoice } from "./interpretation-choice";

/** One message of the conversation about an interpretation, as the browser keeps it. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Of an answer: what the server signed it with. It takes no answer back without it. */
  signature?: string;
  /** Of an answer: the model that wrote it. Shown, never sent. */
  answeredBy?: string;
}

/** What the server takes of a message: its role, its content and, of an answer, the signature. */
export interface WireMessage {
  role: "user" | "assistant";
  content: string;
  signature?: string;
}

/** Longest question, in characters (the server's limit). */
export const MAX_QUESTION_CHARS = 2000;
/** Most messages in one conversation (the server's limit). */
export const MAX_MESSAGES = 20;
/** Most characters over the whole conversation (the server's limit). */
export const MAX_TOTAL_CHARS = 40_000;
/** From this length on the counter is shown. */
export const COUNTER_FROM = Math.floor(MAX_QUESTION_CHARS * 0.8);

/**
 * What the conversation was started for: the analysis, the language and the model and effort of
 * the interpretation it refers to. Another key means another interpretation, so the conversation
 * starts again.
 */
export function chatKey(
  datasetId: string,
  options: unknown,
  language: string,
  choice: InterpretationChoice,
): string {
  return JSON.stringify([datasetId, options, language, choice.model, choice.effort]);
}

/** Why a question cannot be sent. */
export type ChatProblem = "empty" | "question_too_long" | "count" | "too_long";

/**
 * Why `question` cannot be sent after `history`, or null. The server takes at most 20 messages
 * that alternate, from the user to the user, so a history of 19 is full.
 */
export function chatProblem(history: ChatMessage[], question: string): ChatProblem | null {
  if (!question.trim()) return "empty";
  if (question.length > MAX_QUESTION_CHARS) return "question_too_long";
  if (history.length + 1 > MAX_MESSAGES) return "count";
  const total = history.reduce((n, m) => n + m.content.length, 0) + question.length;
  return total > MAX_TOTAL_CHARS ? "too_long" : null;
}

/** Whether a conversation can take no further question; the visitor has to clear it. */
export function chatFull(history: ChatMessage[]): boolean {
  return chatProblem(history, "x") === "count" || chatProblem(history, "x") === "too_long";
}

/** The history with the question added; refused as `chatProblem` says. */
export function withQuestion(history: ChatMessage[], question: string): ChatMessage[] {
  return [...history, { role: "user", content: question }];
}

/**
 * The history with the answer added; the last message must be the question it answers. The
 * signature is the one the server sent with the answer.
 */
export function withAnswer(
  history: ChatMessage[],
  answer: string,
  signature: string,
  answeredBy?: string,
): ChatMessage[] {
  if (history.length === 0 || history[history.length - 1].role !== "user") return history;
  return [...history, { role: "assistant", content: answer, signature, ...(answeredBy ? { answeredBy } : {}) }];
}

/** The messages as the server takes them: nothing but role, content and the signature of an answer. */
export function toWire(history: ChatMessage[]): WireMessage[] {
  return history.map((m) =>
    m.role === "assistant" && m.signature !== undefined
      ? { role: m.role, content: m.content, signature: m.signature }
      : { role: m.role, content: m.content },
  );
}

/** A paragraph or a list of an answer. */
export type AnswerBlock = { kind: "p"; text: string } | { kind: "list"; items: string[] };

/**
 * An answer as paragraphs and `-` lists, to be shown as text. The model is told to write plain
 * paragraphs and simple lists; anything else stays a paragraph. Nothing here becomes markup.
 */
export function answerBlocks(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join(" ") });
    if (list) blocks.push({ kind: "list", items: list });
    paragraph = [];
    list = null;
  };
  for (const raw of answer.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const item = /^[-*•]\s+(.*)$/.exec(line);
    if (!line) {
      flush();
    } else if (item) {
      if (!list) {
        flush();
        list = [];
      }
      list.push(item[1]);
    } else if (list) {
      // A continuation of the last item, as models wrap long ones.
      list[list.length - 1] += ` ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
