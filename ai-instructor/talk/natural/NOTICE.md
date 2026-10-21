# Natural voice - components and licences (needs a licence review before wide release)
- Voice model: Piper "en_US-ljspeech-medium" (trained on LJ Speech, public domain; https://keithito.com/LJ-Speech-Dataset/). Obtained from the sherpa-onnx tts-models release.
- Piper TTS / piper-phonemize: MIT (https://github.com/rhasspy/piper). Phonemizer worker and wasm taken unmodified from the npm package piper-tts-web 1.1.2 (MIT).
- espeak-ng (inside piper_phonemize.wasm / .data): GPL-3.0 (https://github.com/espeak-ng/espeak-ng). Distributing it carries GPL obligations; confirm with counsel before wide release.
- onnxruntime-web 1.22.0: MIT (Microsoft).
Everything here is served from our own site; nothing is fetched from a third party at run time.
- Accent voices: Piper "en_GB-cori-medium" (British; recordings from LibriVox, public domain) and "en_GB-alba-medium" (Scottish; Alba voice dataset, University of Edinburgh, licensed CC BY 4.0, https://datashare.ed.ac.uk/handle/10283/3270, attribution required). Both obtained from the sherpa-onnx tts-models release.
