/**
 * Prompt injection is an attack on the product, not an edge case
 * (ARCHITECTURE-DECISIONS §7). This module recognises text in collected
 * material that is addressed to an AI system rather than to a human reader.
 *
 * A match never blocks collection or hides evidence: it marks the evidence,
 * so a report can say its content resembles instructions and was treated as
 * data, and it arms the output guard (./guards.ts), which rejects an answer
 * that repeats the instruction-like text.
 *
 * The patterns are deliberately about the ADDRESS of the text (to an AI, to
 * "your" instructions, chat-template markup), not its topic, so ordinary
 * reporting about AI systems does not match. The CI corpus
 * (test/injection-corpus.test.ts) holds known payloads and ordinary text.
 */

export interface InjectionPattern {
  readonly id: string;
  readonly regex: RegExp;
}

export const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  {
    id: "override-instructions",
    regex:
      /\b(ignore|disregard|forget|override|bypass|skip)\b[^.\n]{0,40}\b(previous|prior|above|earlier|preceding|all|any|your|the system'?s?)\b[^.\n]{0,25}\b(instructions?|prompts?|rules|directions|guidelines|directives|context|constraints)\b/i,
  },
  {
    id: "role-reassignment",
    regex:
      /\b(you are now|you are no longer|from now on,? you|pretend (to be|you are)|act as (an?|the) (unfiltered|unrestricted|different|new|jailbroken)|enter (developer|debug|god) mode)\b/i,
  },
  {
    id: "prompt-disclosure",
    regex:
      /\b(reveal|print|repeat|output|show|display|leak|dump)\b[^.\n]{0,30}\b(your|the)\b[^.\n]{0,15}\b(system prompt|system message|initial instructions|hidden instructions|prompt)\b/i,
  },
  {
    id: "chat-template-markup",
    regex:
      /<\|(im_start|im_end|system|assistant|user|endoftext|start_header_id|end_header_id|eot_id)\|>|\[\/?INST\]|<<\/?SYS>>|<\/?(system|assistant|instructions?)>|^\s*#{0,3}\s*(system|assistant)\s*(prompt)?\s*:/im,
  },
  {
    id: "addressed-to-ai",
    regex:
      /\b(note|message|instructions?|attention|notice|reminder)\s+(to|for)\s+(any\s+|all\s+)?(ai|llms?|language models?|assistants?|chatbots?|gpts?|bots?|models?|crawlers?|summari[sz]ers?)\s*[:,–—-]|\b(dear|hey|hello)\s+(ai|assistant|chatgpt|llm|model|bot)\b|\bif you are an? (ai|llm|language model|assistant|bot)\b/i,
  },
  {
    id: "directive-to-ai",
    regex:
      /\b(ai|llms?|language models?|assistants?|chatbots?|summari[sz]ers?)\b[^.\n]{0,40}\b(must|should|shall|are required to|are instructed to|need to)\s+(always\s+|never\s+|only\s+)?(say|state|report|describe|conclude|write|include|mention|rate|classify|recommend|output|summari[sz]e|label)\b/i,
  },
  {
    id: "response-steering",
    regex:
      /\b(in|when writing|when generating) (your|the) (response|reply|answer|summary|report|output|analysis)\b[^.\n]{0,60}\b(say|state|write|include|mention|describe|conclude|claim|add)\b|\b(respond|reply|answer) (only )?with\b[^.\n]{0,30}\b(json|exactly|the following|this)\b/i,
  },
  {
    id: "new-instructions",
    regex:
      /\b(new|updated|additional|hidden|secret|real|actual|important) (system )?(instructions?|directives?|orders|task)\s*(:|follow|are|below)/i,
  },
  {
    id: "exfiltration-link",
    regex:
      /!\[[^\]]*\]\(\s*https?:\/\/[^)]*\)|\b(send|post|forward|upload|exfiltrate|transmit)\b[^.\n]{0,40}\b(to|at)\b[^.\n]{0,20}(https?:\/\/|[\w.+-]+@[\w-]+\.)/i,
  },
];

/**
 * The text a model would read, with hidden characters made visible:
 * zero-width characters removed, and Unicode tag characters (U+E0020 to
 * U+E007E, invisible when rendered, read by models as ASCII: "ASCII
 * smuggling") decoded to the ASCII they encode.
 */
export function revealHidden(text: string): string {
  return text
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
    .replace(/[\u{E0020}-\u{E007E}]/gu, (tag) =>
      String.fromCharCode((tag.codePointAt(0) ?? 0xe0020) - 0xe0000),
    )
    .replace(/[\u{E0000}-\u{E007F}]/gu, "");
}

export interface InjectionFinding {
  readonly pattern: string;
  /** The matched text, trimmed to 160 characters. */
  readonly excerpt: string;
}

/** Instruction-like text in one string, one finding per pattern that matched. */
export function scanText(text: string): InjectionFinding[] {
  const visible = revealHidden(text);
  const findings: InjectionFinding[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.regex.exec(visible);
    if (match !== null) {
      findings.push({ pattern: pattern.id, excerpt: match[0].slice(0, 160) });
    }
  }
  return findings;
}

/**
 * The sentences of `text` around each finding: the stretch the output guard
 * compares an answer against. A payload is usually a sentence or two, so the
 * guard looks for an answer repeating any run of words from it.
 */
export function instructionSpans(text: string): string[] {
  const visible = revealHidden(text);
  const spans: string[] = [];
  const sentences = visible.split(/(?<=[.!?\n])\s+/);
  for (const sentence of sentences) {
    if (scanText(sentence).length > 0) spans.push(sentence);
  }
  // A payload split across sentences still matched as a whole: keep the whole text.
  if (spans.length === 0 && scanText(visible).length > 0) spans.push(visible);
  return spans;
}
