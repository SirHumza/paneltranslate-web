const CDN = 'https://cdn.jsdelivr.net/npm';
const TESSERACT = CDN + '/tesseract.js@6.0.1/dist';
const LANGUAGES = {
  id: 'ind', ko: 'kor', ja: 'jpn', zh: 'chi_sim', 'zh-cn': 'chi_sim',
  'zh-hans': 'chi_sim', 'zh-tw': 'chi_tra', 'zh-hant': 'chi_tra',
  en: 'eng', es: 'spa', fr: 'fra', pt: 'por', vi: 'vie', th: 'tha', ru: 'rus',
};
const REVISIONS = {
  id: 'c38ef36c843b71177da903442835c3c870975fd6',
  ko: 'd9fa1ac6008242100fecb4fff9b0a5917a1be81f',
  ja: '1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16',
  zh: '39d480d52a9ea3065a1f117adfe4dbc55de10e6f',
  mul: '72a05e47cee89c718a9db4dc70d02fef3bc39de8',
};

function language(code) {
  const key = String(code).toLowerCase();
  const entry = Object.entries(LANGUAGES).find(([iso, pack]) => iso === key || pack === key);
  if (!entry) throw new Error('Choose a source language before running recognition or translation.');
  return entry;
}

function serial() {
  let previous = Promise.resolve();
  return (operation) => {
    const result = previous.then(operation);
    previous = result.catch(() => {});
    return result;
  };
}

const queueOCR = serial();
let recognizer;
let currentPack;
let reportOCR;
const box = ({x0, y0, x1, y1}) => [x0, y0, x1 - x0, y1 - y0];

export function recognize(canvas, lang, progress = () => {}) {
  return queueOCR(async () => {
    const [, pack] = language(lang);
    reportOCR = progress;
    try {
      if (pack !== currentPack || !recognizer) {
        if (recognizer) await recognizer.terminate();
        recognizer = null;
        currentPack = null;
        progress('Loading recognition engine…');
        const {default: tesseract} = await import(TESSERACT + '/tesseract.esm.min.js');
        recognizer = await tesseract.createWorker(pack, 1, {
          workerPath: TESSERACT + '/worker.min.js',
          corePath: CDN + '/tesseract.js-core@6.0.0',
          langPath: CDN + '/@tesseract.js-data/' + pack + '@1.0.0/4.0.0_best_int',
          logger: ({status, progress: fraction}) =>
            reportOCR?.(status + ' ' + Math.round((fraction || 0) * 100) + '%'),
        });
        await recognizer.setParameters({tessedit_pageseg_mode: tesseract.PSM.AUTO});
        currentPack = pack;
      }
      const {data} = await recognizer.recognize(canvas, {}, {text: true, blocks: true});
      const paragraphs = (data.blocks || []).flatMap(block => block.paragraphs || []);
      const regions = paragraphs.filter(p => p.text.trim()).map(p => ({
        text: p.text.trim(),
        box: box(p.bbox),
        confidence: p.confidence,
        words: p.lines.flatMap(line => line.words.map(w => ({text: w.text, box: box(w.bbox)}))),
      }));
      if (!regions.length && data.text.trim()) throw new Error('OCR produced text without usable coordinates.');
      return regions;
    } finally {
      reportOCR = undefined;
    }
  });
}

let model;
let modelName;
async function infer(text, lang, progress) {
  const {env, pipeline} = await import(CDN + '/@xenova/transformers@2.17.2/dist/transformers.min.js');
  env.allowLocalModels = false;
  env.backends.onnx.wasm.numThreads = 1;
  const key = lang.startsWith('zh') ? 'zh' : lang in REVISIONS ? lang : 'mul';
  if (modelName !== key || !model) {
    if (model) await model.dispose();
    model = null;
    modelName = null;
    progress('Loading English translation model…');
    model = await pipeline('translation', 'Xenova/opus-mt-' + key + '-en', {
      revision: REVISIONS[key],
      quantized: true,
      progress_callback: event => {
        if (event.status === 'progress' && Number.isFinite(event.progress)) {
          progress(event.file.split('/').pop() + ' ' + Math.round(event.progress) + '%');
        }
      },
    });
    modelName = key;
  }
  if (model.tokenizer(text).input_ids.dims.at(-1) > 512) {
    throw new Error('This region exceeds the model input limit. Split the text before translating.');
  }
  progress('Translating dialogue…');
  const decode = async input => {
    const [result] = await model(input, {num_beams: 3, max_new_tokens: 512});
    if (!result?.translation_text?.trim()) throw new Error('The local model returned empty English text.');
    return result.translation_text.trim();
  };
  const result = await decode(text);
  const sentences = (value, locale) => Array.from(
    new Intl.Segmenter(locale, {granularity:'sentence'}).segment(value.replace(/\s+/g,' ')),
    part => part.segment.trim()
  ).filter(Boolean);
  const parts = sentences(text, lang);
  if (parts.length > sentences(result, 'en').length) {
    progress('Checking sentence coverage…');
    const retry = [];
    for (const part of parts) retry.push(await decode(part));
    return retry.join(' ');
  }
  return result;
}

let translatorWorker;
const queueTranslation = serial();
export function translate(source, languageCode, progress = () => {}) {
  return queueTranslation(async () => {
    const [lang] = language(languageCode);
    const text = String(source ?? '').trim();
    if (!text) throw new Error('Enter source dialogue first.');
    if (lang === 'en') return text;
    translatorWorker ??= new Worker(new URL('./engine.js', import.meta.url), {type: 'module'});
    return new Promise((resolve, reject) => {
      translatorWorker.onmessage = ({data}) => {
        if ('progress' in data) progress(data.progress);
        else if (data.error) reject(new Error(data.error));
        else resolve(data.text);
      };
      translatorWorker.onerror = event => {
        translatorWorker.terminate();
        translatorWorker = null;
        reject(new Error(event.message || 'Translation worker failed to start.'));
      };
      translatorWorker.postMessage({text, lang});
    });
  });
}

if (typeof DedicatedWorkerGlobalScope !== 'undefined' && self instanceof DedicatedWorkerGlobalScope) {
  self.onmessage = async ({data}) => {
    try {
      const text = await infer(data.text, data.lang, progress => self.postMessage({progress}));
      self.postMessage({text});
    } catch (error) {
      self.postMessage({error: error.message || String(error)});
    }
  };
}
