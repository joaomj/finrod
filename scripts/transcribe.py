#!/usr/bin/env python3
"""Print the transcript of one audio file. Finrod runs this for spoken messages (FINROD_TRANSCRIBE_COMMAND).

Needs: pip install faster-whisper av numpy. Audio is decoded with PyAV first because faster-whisper 1.2.1 cannot
open files through PyAV 19, and PyAV also decodes the Opus and AAC that phone browsers record.
"""
import os
import sys

import av
import numpy as np
from faster_whisper import WhisperModel


def decode(path: str) -> np.ndarray:
    resampler = av.AudioResampler(format="flt", layout="mono", rate=16000)
    parts = []
    with av.open(path) as container:
        for frame in container.decode(audio=0):
            parts.extend(out.to_ndarray().reshape(-1) for out in resampler.resample(frame))
    parts.extend(out.to_ndarray().reshape(-1) for out in resampler.resample(None))
    if not parts:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(parts).astype(np.float32)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: transcribe.py AUDIO_FILE", file=sys.stderr)
        return 2
    model = WhisperModel(os.environ.get("FINROD_STT_MODEL", "small"), device="cpu", compute_type="int8")
    segments, _ = model.transcribe(decode(sys.argv[1]), language=os.environ.get("FINROD_STT_LANGUAGE", "pt"))
    print(" ".join(segment.text.strip() for segment in segments))
    return 0


if __name__ == "__main__":
    sys.exit(main())
