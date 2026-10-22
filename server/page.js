// Owns the single Chrome tab that all chat completion requests run against,
// and the JS expressions that drive LanguageModel from there.

const { newTarget, listTargets, evaluate, evaluateStreaming } = require("../tools/cdp-client");
const { ensureChromeReady } = require("../tools/chrome");

let pageTargetId = null;

// The cached tab can disappear out from under us: closed by hand, by another
// script driving the same Chrome instance, or by Chrome itself. Every call
// verifies it's still a live target before reusing it.
async function getPageTarget(log) {
  await ensureChromeReady({ log });
  if (pageTargetId) {
    const targets = await listTargets();
    if (!targets.some((t) => t.id === pageTargetId)) pageTargetId = null;
  }
  if (!pageTargetId) {
    const target = await newTarget("https://example.com");
    pageTargetId = target.id;
  }
  return pageTargetId;
}

function buildCreateOptionsLiteral({ initialPrompts, temperature, topK }) {
  const opts = {};
  if (initialPrompts.length > 0) opts.initialPrompts = initialPrompts;
  if (temperature !== undefined && topK !== undefined) {
    opts.temperature = temperature;
    opts.topK = topK;
  }
  return JSON.stringify(opts);
}

// temperature/topK must be supplied as a pair, and may not be honored at all
// outside an Origin Trial or extension context. Falling back to a plain
// create() keeps the request working either way instead of failing it.
function buildExpression({ initialPrompts, promptText, promptParts, responseConstraint, temperature, topK }, streamingBindingName) {
  const createOptsWithSampling = buildCreateOptionsLiteral({ initialPrompts, temperature, topK });
  const createOptsPlain = JSON.stringify(initialPrompts.length > 0 ? { initialPrompts } : {});
  const promptOpts = responseConstraint ? JSON.stringify({ responseConstraint }) : "{}";
  const promptLiteral = JSON.stringify(promptText);
  const media = (promptParts || []).some((p) => p.type !== "text");
  const partsLiteral = JSON.stringify(promptParts || [{type:"text", text:promptText}]);
  const mediaCreateOptions = JSON.stringify({
    ...(initialPrompts.length ? { initialPrompts } : {}),
    expectedInputs: [
      { type: "text", languages: ["en"] },
      ...((promptParts || []).some(p => p.type === "image") ? [{type:"image"}] : []),
      ...((promptParts || []).some(p => p.type === "audio") ? [{type:"audio"}] : [])
    ],
    expectedOutputs: [{type:"text", languages:["en"]}]
  });
  const mediaSetup = `
    const wireParts = ${partsLiteral};
    const content = [];
    for (const p of wireParts) {
      if (p.type === "text") content.push({type:"text", value:p.text});
      else if (p.type === "image") {
        const blob = await fetch(p.dataUrl).then(r => r.blob());
        content.push({type:"image", value:blob});
      } else if (p.type === "audio") {
        const mime = p.format === "mp3" ? "audio/mpeg" : "audio/wav";
        const bytes = await fetch("data:" + mime + ";base64," + p.data).then(r => r.arrayBuffer());
        const ctx = new AudioContext();
        try {
          const buffer = await ctx.decodeAudioData(bytes);
          content.push({type:"audio", value:buffer});
        } finally { await ctx.close(); }
      }
    }
    const input = [{role:"user", content}];
  `;
  const inputLiteral = media ? "input" : promptLiteral;

  const generation = streamingBindingName
    ? `
      const stream = session.promptStreaming(${inputLiteral}, ${promptOpts});
      let text = '';
      for await (const chunk of stream) {
        text += chunk;
        window.${streamingBindingName}(chunk);
      }
    `
    : `
      const text = await session.prompt(${inputLiteral}, ${promptOpts});
    `;

  return `
    (async () => {
      let session;
      ${media ? `session = await LanguageModel.create(${mediaCreateOptions});` : `
      try {
        session = await LanguageModel.create(${createOptsWithSampling});
      } catch (e) {
        session = await LanguageModel.create(${createOptsPlain});
      }`}
      ${media ? mediaSetup : ""}
      const before = session.contextUsage;
      ${generation}
      const after = session.contextUsage;
      session.destroy();
      return {
        text,
        promptTokens: before,
        completionTokens: Math.max(0, after - before),
        totalTokens: after,
      };
    })()
  `;
}

async function runChatCompletion(request, log) {
  const targetId = await getPageTarget(log);
  const expr = buildExpression(request, null);
  return evaluate(targetId, expr);
}

async function runChatCompletionStreaming(request, onChunk, log) {
  const targetId = await getPageTarget(log);
  const bindingName = "__ggn_emit_" + Math.random().toString(36).slice(2);
  const expr = buildExpression(request, bindingName);
  return evaluateStreaming(targetId, expr, bindingName, onChunk);
}

async function checkAvailability(log) {
  const targetId = await getPageTarget(log);
  return evaluate(targetId, "LanguageModel.availability()");
}

module.exports = { runChatCompletion, runChatCompletionStreaming, checkAvailability };
