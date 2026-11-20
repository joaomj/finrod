#!/usr/bin/env python3
"""Print the timed speech segments of one audio file as JSON. Finrod runs this while a recording is still arriving
and once more when it ends (FINROD_TRANSCRIBE_COMMAND).

    transcribe.py AUDIO [--from SECONDS]

Prints {"duration": seconds, "segments": [{"start", "end", "text"}]}. Times count from the start of AUDIO, and only
speech after --from is transcribed. A recording that is still arriving ends in a cut packet; the audio before the cut
is used.

Needs: pip install faster-whisper av numpy. Audio is decoded with PyAV first because faster-whisper 1.2.1 cannot
open files through PyAV 19, and PyAV also decodes the Opus and AAC that phone browsers record.
"""
import argparse
import json
import os
import sys

import av
import numpy as np
from faster_whisper import WhisperModel

RATE = 16000


def decode(path: str) -> np.ndarray:
    resampler = av.AudioResampler(format="flt", layout="mono", rate=RATE)
    parts = []
    try:
        with av.open(path) as container:
            for frame in container.decode(audio=0):
                parts.extend(out.to_ndarray().reshape(-1) for out in resampler.resample(frame))
    except av.error.FFmpegError as error:
        if not parts:
            raise
        print(f"warning: {path} ends in a cut packet ({error}); using the audio before it", file=sys.stderr)
    else:
        parts.extend(out.to_ndarray().reshape(-1) for out in resampler.resample(None))
    if not parts:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(parts).astype(np.float32)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--from", dest="start", type=float, default=0.0)
    args = parser.parse_args()

    audio = decode(args.audio)
    duration = len(audio) / RATE
    tail = audio[int(args.start * RATE) :]
    segments = []
    if len(tail) >= RATE // 2:
        model = WhisperModel(os.environ.get("FINROD_STT_MODEL", "small"), device="cpu", compute_type="int8")
        found, _ = model.transcribe(tail, language=os.environ.get("FINROD_STT_LANGUAGE", "pt"))
        segments = [
            {"start": round(args.start + s.start, 2), "end": round(args.start + s.end, 2), "text": s.text.strip()}
            for s in found
            if s.text.strip()
        ]
    json.dump({"duration": round(duration, 2), "segments": segments}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
