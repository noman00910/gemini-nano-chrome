// Translates between the OpenAI chat completions wire format and what
// Chrome's LanguageModel API accepts.

const MODEL_ID = "gemini-nano";

function randomId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  }
  return "";
}

// The Prompt API takes a system/user/assistant history up front via
// initialPrompts, then a single new prompt() call for the turn you want a
// reply to. OpenAI's messages array bundles both, so the last message has to
// be split off and sent separately.
function parseMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new RequestError("messages must be a non-empty array");
  }
  const last = messages[messages.length - 1];
  if (last.role !== "user") {
    throw new RequestError("the last message must have role 'user'");
  }

  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => extractText(m.content))
    .join("\n\n");

  const history = messages
    .slice(0, -1)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: extractText(m.content) }));

  const initialPrompts = systemText
    ? [{ role: "system", content: systemText }, ...history]
    : history;

  const promptParts = parseContentParts(last.content);
  return { initialPrompts, promptText: extractText(last.content), promptParts };
}

// Reject unsupported media explicitly rather than silently treating it as text.
// Remote image URLs are intentionally excluded pending SSRF-safe retrieval.
function parseContentParts(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content) || !content.length) throw new RequestError("message.content must be text or a non-empty array");
  if (content.length > 12) throw new RequestError("too many content parts (maximum 12)");
  let mediaCount = 0;
  return content.map((part) => {
    if (!part || typeof part !== "object") throw new RequestError("invalid content part");
    if (part.type === "text" && typeof part.text === "string") return { type: "text", text: part.text };
    if (part.type === "image_url" && typeof part.image_url?.url === "string") {
      if (++mediaCount > 5) throw new RequestError("too many media parts (maximum 5)");
      const url = part.image_url.url;
      if (!/^data:image\/(png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/i.test(url)) {
        throw new RequestError("image_url must contain a Base64 data URL (JPEG, PNG, WebP); external URLs not supported");
      }
      return { type: "image", dataUrl: url };
    }
    if (part.type === "input_audio" && typeof part.input_audio?.data === "string") {
      if (++mediaCount > 5) throw new RequestError("too many media parts (maximum 5)");
      const {data, format} = part.input_audio;
      if (!["wav","mp3"].includes(format) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data) || !data.length) {
        throw new RequestError("input_audio requires valid Base64 data and wav/mp3 format");
      }
      return { type: "audio", data, format };
    }
    throw new RequestError("unsupported content part: " + (part.type ?? "unknown"));
  });
}

function mapResponseFormat(responseFormat) {
  if (!responseFormat) return undefined;
  if (responseFormat.type === "json_schema") {
    return responseFormat.json_schema?.schema;
  }
  if (responseFormat.type === "json_object") {
    return { type: "object" };
  }
  return undefined;
}

function normalizeStop(stop) {
  if (!stop) return [];
  return Array.isArray(stop) ? stop : [stop];
}

// Gemini Nano has no native stop-sequence support, so this is applied
// client-side after the fact: truncate at the first match.
function applyStop(text, stopSequences) {
  let cut = text.length;
  let hit = false;
  for (const seq of stopSequences) {
    const idx = text.indexOf(seq);
    if (idx !== -1 && idx < cut) {
      cut = idx;
      hit = true;
    }
  }
  return { text: text.slice(0, cut), hit };
}

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function buildUsage({ promptTokens, completionTokens, totalTokens }) {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function buildChatCompletionResponse({ id, text, finishReason, usage }) {
  return {
    id,
    object: "chat.completion",
    created: nowSeconds(),
    model: MODEL_ID,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: finishReason,
      },
    ],
    usage: buildUsage(usage),
  };
}

function buildChunk(id, delta, finishReason) {
  return {
    id,
    object: "chat.completion.chunk",
    created: nowSeconds(),
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function buildModelList() {
  return {
    object: "list",
    data: [{ id: MODEL_ID, object: "model", created: nowSeconds(), owned_by: "google" }],
  };
}

module.exports = {
  MODEL_ID,
  RequestError,
  randomId,
  parseMessages,
  parseContentParts,
  mapResponseFormat,
  normalizeStop,
  applyStop,
  buildChatCompletionResponse,
  buildChunk,
  buildModelList,
};
