import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGES,
  MAX_QUESTION_CHARS,
  MAX_TOTAL_CHARS,
  answerBlocks,
  chatFull,
  chatKey,
  chatProblem,
  isValidConversation,
  messagesFor,
  withAnswer,
  withQuestion,
  type ChatMessage,
} from "./interpretation-chat";

const choice = { model: "claude-opus-5-5", effort: "medium" };
const options = { n_factors: 3, rotation: "varimax" };

function conversation(n: number, size = 1): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(size),
  }));
}

describe("when the conversation starts again", () => {
  const key = chatKey("d1", options, "en", choice);

  it("keeps it for the same analysis, language and choice", () => {
    expect(chatKey("d1", { ...options }, "en", { ...choice })).toBe(key);
  });

  it.each([
    ["the dataset", chatKey("d2", options, "en", choice)],
    ["the settings", chatKey("d1", { ...options, n_factors: 4 }, "en", choice)],
    ["the language", chatKey("d1", options, "de", choice)],
    ["the model", chatKey("d1", options, "en", { ...choice, model: "claude-sonnet-5-5" })],
    ["the effort", chatKey("d1", options, "en", { ...choice, effort: "high" })],
  ])("drops it when %s changes", (_, other) => {
    expect(other).not.toBe(key);
    const kept = { key, messages: conversation(3) };
    expect(messagesFor(kept, key)).toHaveLength(3);
    expect(messagesFor(kept, other)).toEqual([]);
  });

  it("has nothing before the first question", () => {
    expect(messagesFor(null, key)).toEqual([]);
  });
});

describe("the messages", () => {
  it("alternate from the question to the answer and back", () => {
    let h: ChatMessage[] = [];
    h = withQuestion(h, "Why?");
    expect(isValidConversation(h)).toBe(true);
    h = withAnswer(h, "Because.");
    expect(h.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(isValidConversation(h)).toBe(false); // an answer last: the next question is not added yet
    h = withQuestion(h, "And?");
    expect(isValidConversation(h)).toBe(true);
  });

  it("take an answer only after a question", () => {
    expect(withAnswer([], "Hi")).toEqual([]);
    const answered = withAnswer(withQuestion([], "q"), "a");
    expect(withAnswer(answered, "again")).toBe(answered);
  });

  it("do not change the history they extend", () => {
    const h = withQuestion([], "q");
    withAnswer(h, "a");
    expect(h).toHaveLength(1);
  });

  it("are checked like the server does", () => {
    expect(isValidConversation([])).toBe(false);
    expect(isValidConversation(conversation(2))).toBe(false);
    expect(isValidConversation(conversation(3))).toBe(true);
    expect(isValidConversation([{ role: "assistant", content: "x" }])).toBe(false);
    expect(isValidConversation([{ role: "user", content: " " }])).toBe(false);
  });
});

describe("the limits", () => {
  it("refuse an empty question", () => {
    expect(chatProblem([], "")).toBe("empty");
    expect(chatProblem([], " \n ")).toBe("empty");
  });

  it("take a question of 2000 characters but not of 2001", () => {
    expect(chatProblem([], "x".repeat(MAX_QUESTION_CHARS))).toBeNull();
    expect(chatProblem([], "x".repeat(MAX_QUESTION_CHARS + 1))).toBe("question_too_long");
  });

  it("take 20 messages in all: the question after 9 pairs, not after 10 (the 21st)", () => {
    expect(chatProblem(conversation(MAX_MESSAGES - 2), "q")).toBeNull();
    expect(chatProblem(conversation(MAX_MESSAGES), "q")).toBe("count");
  });

  it("take 40000 characters in all", () => {
    const history = conversation(2, (MAX_TOTAL_CHARS - 100) / 2);
    expect(chatProblem(history, "x".repeat(100))).toBeNull();
    expect(chatProblem(history, "x".repeat(101))).toBe("too_long");
  });

  it("say when no question fits any more", () => {
    expect(chatFull(conversation(2))).toBe(false);
    expect(chatFull(conversation(MAX_MESSAGES))).toBe(true);
    expect(chatFull(conversation(2, MAX_TOTAL_CHARS / 2))).toBe(true);
  });
});

describe("the answer as blocks", () => {
  it("splits paragraphs at blank lines and joins wrapped lines", () => {
    expect(answerBlocks("First line\nstill the first.\n\nSecond.")).toEqual([
      { kind: "p", text: "First line still the first." },
      { kind: "p", text: "Second." },
    ]);
  });

  it("makes a list of lines that start with a dash", () => {
    expect(answerBlocks("Two things:\n- one\n- two\n  more of two\n\nDone.")).toEqual([
      { kind: "p", text: "Two things:" },
      { kind: "list", items: ["one", "two more of two"] },
      { kind: "p", text: "Done." },
    ]);
  });

  it("ends a paragraph where a list begins", () => {
    expect(answerBlocks("Intro\n- a")).toEqual([
      { kind: "p", text: "Intro" },
      { kind: "list", items: ["a"] },
    ]);
  });

  it("keeps markup as text", () => {
    expect(answerBlocks("<b>x</b> & <script>1</script>")).toEqual([
      { kind: "p", text: "<b>x</b> & <script>1</script>" },
    ]);
  });

  it("handles nothing", () => {
    expect(answerBlocks("")).toEqual([]);
    expect(answerBlocks(" \r\n\r\n ")).toEqual([]);
  });
});
