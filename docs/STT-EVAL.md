# STT eval: local faster-whisper small vs OpenRouter transcription

**Date:** 2026-10-19. **Current decision:** v0.3.0 has no voice
input (decided 2026-10-26). See the
voice decision in [PRD-v030](PRD-v030.md). These results stay for a later
voice feature.

## Method

- 3 pt-BR clips from Fleurs `pt_br` test (read speech, 17.8s / 13.6s / 8.4s),
  with reference transcripts. Logs: `/tmp/finrod-stt-eval/` on the mini PC
  (script `eval.py`, `results.jsonl`).
- Local: faster-whisper `small`, int8, CPU, `language="pt"`, on the mini PC
  (i5-7500T, 4 cores). WER/CER lowercased, punctuation stripped.
- Provider: OpenRouter `/audio/transcriptions` under
  `provider.data_collection: deny` (ZDR filter).
- Key handling: OpenRouter key read from a password manager,
  piped into the remote process environment.
  Never written to disk, logs, or the repo.

## Results

| Clip | Local small (WER / time) | Provider (WER / time) |
| --- | --- | --- |
| 17.8s | 0.083 / 2.6s (0.14x RT) | 0.028 / 2.8s (`qwen3-asr-0.6b`, ZDR) |
| 13.6s | 0.130 / 2.3s (0.17x RT) | 0.217 / 1.0s (`qwen3-asr-0.6b`, ZDR) |
| 8.4s | 0.267 / 1.9s (0.23x RT) | 0.267 / 1.5s (`qwen3-asr-0.6b`, ZDR) |

Accuracy is a wash: provider wins one clip, local wins one, tie on the
names-heavy clip (both fail "Giancarlo Fisichella"). Local runs ~2s per
clip on the i5, so nothing justifies sending audio out on quality
or speed grounds.

## Provider routing notes

- `qwen/qwen3-asr-0.6b` is the only tested model that routes under the
  ZDR filter. First call took 86s cold, then 1–3s.
- `deepgram/nova-3` and `openai/gpt-transcribe` refuse the ZDR filter
  ("no allowed providers"). OpenRouter docs name `openai/whisper-1`,
  but it is not actually served (404).
- Groq (self-serve ZDR toggle, Whisper models) was not tested. It is the
  first fallback if a provider path is ever needed.

## Local environment notes

- faster-whisper 1.2.1 is incompatible with PyAV 19: it passes
  `metadata_errors="ignore"` to `av.open`, which no longer accepts it.
  Workaround used: decode audio to a float32 array first (PyAV directly),
  then pass the array to `transcribe`. Keep this path: it also decodes
  Opus audio with no ffmpeg dependency.
- Sample sourcing was brittle: Common Voice is gone from the Hub,
  and `datasets` audio decoding needs torch/torchcodec (CUDA-linked,
  unusable on this CPU box). Fleurs + manual PyAV decode works.

## Caveats

- 3 clips of read speech, not spontaneous voice notes. Re-test on real
  voice messages once V1 runs daily.
- Short-clip behavior only. Long audio was not evaluated.

## References

- [PRD-v030](PRD-v030.md): transcription decision.
- [V3 sketch](V3-MEMORY.md): raw logs keep audio plus transcript.
