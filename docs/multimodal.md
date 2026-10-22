# Experimental multimodal inputs (feature branch)

The OpenAI-compatible server supports `POST /v1/chat/completions` with a text, Base64 image and/or audio payload in the **last user turn**. This is a prototype; Chrome runtime inference has not been verified. Earlier message history is text-only. Unsupported media is rejected instead of silently discarded.

## Image example

```json
{"model":"gemini-nano","messages":[{"role":"user","content":[{"type":"text","text":"Read the text in this image"},{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,BASE64_IMAGE"}}]}]}
```

## Audio example

```json
{"model":"gemini-nano","messages":[{"role":"user","content":[{"type":"text","text":"Transcribe the audio"},{"type":"input_audio","input_audio":{"format":"wav","data":"BASE64_AUDIO"}}]}]}
```

Supported image MIME types: `image/jpeg`, `image/png`, `image/webp`. Audio: `wav`, `mp3` (decoded into an AudioBuffer inside Chrome). Remote image URLs are **not** accepted: the gateway does not download external addresses. Up to five media parts and twelve total parts can be sent per request. Set `MAX_BODY_BYTES` to adjust the default 15 MiB JSON body limit.

## Tests

```bash
node --test tests/multimodal.test.js
node --check server/mapping.js
node --check server/index.js
node --check server/page.js
```

## Limitations and security

- Requires a Chrome build and device with multimodal `LanguageModel` support. Audio requires suitable GPU support.
- `expectedInputs` is declared for the media types used. The model may respond with `NotSupportedError`.
- Native Prompt API only generates text. This change does not implement speech generation, PDFs, DOCX, video or standalone transcription endpoints.
- No remote fetching is implemented, avoiding SSRF risk.
- Suitable authentication, rate limiting, input-content verification, per-file decoding limits, runtime error handling and hardware integration tests are still needed before exposure outside localhost.
- Chrome Prompt API reference: https://developer.chrome.com/docs/ai/prompt-api
