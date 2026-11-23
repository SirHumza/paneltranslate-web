# Browser engines

Images and dialogue enter local Web Workers. The first recognition and translation runs fetch runtimes and weights from jsDelivr and Hugging Face over HTTPS. Model requests contain static asset paths. Tesseract uses IndexedDB for trained data and Transformers.js uses the browser Cache API for model files. Browser storage quotas, private browsing, cache eviction, or unavailable CDNs can prevent reloading a model.

## Recognition

Tesseract.js 6.0.1 and tesseract.js-core 6.0.0 run the LSTM engine in WebAssembly. Language data is the 4.0.0_best_int variant of each @tesseract.js-data package at version 1.0.0. The engine returns raw paragraphs with original line breaks, coordinates, word boxes and OCR confidence on the 0–100 scale. Automatic page segmentation works best on clear, horizontal printed text. The selected OCR language applies to the entire canvas. Review any missed, merged, vertical or stylized lettering. [Tesseract.js, Apache-2.0](https://github.com/naptha/tesseract.js) · [Tesseract data](https://github.com/tesseract-ocr/tessdata_best)

## Translation

Transformers.js 2.17.2 uses ONNX Runtime Web and a single WASM thread, allowing static hosting without cross-origin isolation. One model is held in memory per tab. A dedicated module worker keeps translation off the UI thread. The Marian models translate one region at a time. Source language, OCR accuracy and context affect the result. English passes through directly. Downloads below cover the two quantized ONNX graphs, plus several additional MB for tokenizers and runtime files. The exact model revisions are pinned in engine.js. [Transformers.js, Apache-2.0](https://github.com/huggingface/transformers.js) · [ONNX Runtime, MIT](https://github.com/microsoft/onnxruntime)

| Source | ONNX conversion by Xenova | Original Helsinki-NLP model and license | Graph size |
|---|---|---|---|
| Indonesian | [id-en](https://huggingface.co/Xenova/opus-mt-id-en) | [Apache-2.0](https://huggingface.co/Helsinki-NLP/opus-mt-id-en) | 103 MB |
| Korean | [ko-en](https://huggingface.co/Xenova/opus-mt-ko-en) | [Apache-2.0](https://huggingface.co/Helsinki-NLP/opus-mt-ko-en) | 113 MB |
| Japanese | [ja-en](https://huggingface.co/Xenova/opus-mt-ja-en) | [Apache-2.0](https://huggingface.co/Helsinki-NLP/opus-mt-ja-en) | 109 MB |
| Chinese, Simplified or Traditional OCR | [zh-en](https://huggingface.co/Xenova/opus-mt-zh-en) | [CC BY 4.0](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en) | 113 MB |
| Spanish, French, Portuguese, Vietnamese, Thai, Russian | [mul-en](https://huggingface.co/Xenova/opus-mt-mul-en) | [Apache-2.0](https://huggingface.co/Helsinki-NLP/opus-mt-mul-en) | 112 MB |

Weights are downloaded directly from the named upstream revisions. Language availability records a configured route. Quality still needs evaluation by language and artwork style.
