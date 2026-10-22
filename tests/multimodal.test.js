const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMessages, parseContentParts, RequestError } = require("../server/mapping");

test("text-only chat retains its content", () => {
  const r = parseMessages([{role:"user",content:"Hello"}]);
  assert.equal(r.promptText, "Hello");
  assert.deepEqual(r.promptParts, [{type:"text",text:"Hello"}]);
});
test("valid image Data URL is forwarded", () => {
  const parts = parseContentParts([{type:"text",text:"describe"},{type:"image_url",image_url:{url:"data:image/png;base64,aGVsbG8="}}]);
  assert.equal(parts[1].type,"image");
  assert.equal(parts[1].dataUrl,"data:image/png;base64,aGVsbG8=");
});
test("valid wav audio is forwarded", () => {
  const parts = parseContentParts([{type:"input_audio",input_audio:{data:"aGVsbG8=",format:"wav"}}]);
  assert.deepEqual(parts,[{type:"audio",data:"aGVsbG8=",format:"wav"}]);
});
test("remote images are rejected, not ignored", () => {
  assert.throws(()=>parseContentParts([{type:"image_url",image_url:{url:"https://example.com/1.jpg"}}]),RequestError);
});
test("unsupported content types are rejected", () => {
  assert.throws(()=>parseContentParts([{type:"video_url",url:"anything"}]),/unsupported content part/);
});
test("unsupported audio formats are rejected", () => {
  assert.throws(()=>parseContentParts([{type:"input_audio",input_audio:{data:"aGVsbG8=",format:"ogg"}}]),/wav\/mp3/);
});
test("limit excessive content parts", () => {
  assert.throws(()=>parseContentParts(Array.from({length:13},()=>({type:"text",text:"a"}))),/too many content parts/);
});
test("history is still text-only while newest turn can have media", () => {
  const r=parseMessages([{role:"user",content:"Hi"},{role:"assistant",content:"Hello"},{role:"user",content:[{type:"text",text:"What's here?"},{type:"image_url",image_url:{url:"data:image/png;base64,aGVsbG8="}}]}]);
  assert.equal(r.initialPrompts.length,2);
  assert.equal(r.promptParts[1].type,"image");
});
