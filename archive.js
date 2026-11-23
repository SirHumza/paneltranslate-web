// @zip.js/zip.js 2.25.0, BSD-3-Clause. The vendored core uses the browser's
// native deflate implementation and reads archives directly from sliced Blobs.
import './vendor/zip-2.25.0/zip-core.mjs';

const {BlobReader, BlobWriter, ZipReader, ZipWriter} = globalThis.zip;
const MIB = 1024 * 1024;
const MAX_PAGE = 64 * MIB;
const MAX_CHAPTER = 384 * MIB;
const MAX_ENTRIES = 2000;
const MAX_ARCHIVE = MAX_CHAPTER + 4 * MIB;
const types = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif'
};
const order = new Intl.Collator('en', {numeric: true, sensitivity: 'base'});
const options = {useWebWorkers: false, useCompressionStream: true};

function checkName(raw, seen) {
  const name = raw.normalize('NFC');
  const parts = name.split('/');
  if (name.length > 1024 || /[\\:\x00-\x1f\x7f]/u.test(name) ||
      parts.some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/iu.test(part))) {
    throw new Error('Unsafe chapter filename: ' + raw);
  }
  const key = name.toLowerCase();
  if (seen.has(key)) throw new Error('Duplicate chapter filename: ' + name);
  seen.add(key);
  return name;
}

function account(size, budget) {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_PAGE) throw new Error('Page exceeds the 64 MiB limit.');
  budget.bytes += size;
  if (budget.bytes > MAX_CHAPTER) throw new Error('Chapter exceeds the 384 MiB expanded limit.');
}

function count(budget) {
  if (++budget.count > MAX_ENTRIES) throw new Error('A selection may contain at most 2,000 entries.');
}

async function readArchive(file, prefix, results, seen, budget) {
  if (file.size > MAX_ARCHIVE) throw new Error('Compressed chapter exceeds the 388 MiB limit.');
  const reader = new ZipReader(new BlobReader(file), {...options, strictness: 'strict'});
  const names = new Set();
  const start = results.length;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      count(budget);
      const path = checkName(entry.filename.replace(/\/$/u, ''), names);
      const ext = path.split('.').pop().toLowerCase();
      if (entry.directory || !Object.hasOwn(types, ext) ||
          path.split('/').some(part => part.startsWith('.') || part === '__MACOSX')) continue;
      if (entry.encrypted) throw new Error('Encrypted chapter page: ' + path);
      account(entry.uncompressedSize, budget);
      const name = checkName(prefix + path, seen);
      const chunks = [];
      let bytes = 0;
      await entry.getData(new WritableStream({
        write(chunk) {
          bytes += chunk.byteLength;
          if (bytes > entry.uncompressedSize || bytes > MAX_PAGE) throw new Error('Expanded page exceeds its declared size.');
          chunks.push(chunk);
        }
      }), {...options, checkSignature: true, checkOverlappingEntry: true});
      if (bytes !== entry.uncompressedSize) throw new Error('Incomplete chapter page: ' + path);
      results.push(new File(chunks, name, {type:types[ext]}));
    }
    if (results.length === start) throw new Error('No supported image pages in ' + file.name);
  } finally {
    await reader.close();
  }
}

export async function expandFiles(files) {
  const selected = Array.from(files);
  const results = [], seen = new Set(), selectedNames = new Set(), budget = {count:0, bytes:0};
  for (const file of selected) {
    const name = checkName(file.webkitRelativePath || file.name, selectedNames);
    if (/\.(cbz|zip)$/iu.test(name)) {
      await readArchive(file, selected.length > 1 ? name + '/' : '', results, seen, budget);
    } else {
      count(budget);
      account(file.size, budget);
      checkName(name, seen);
      results.push(name === file.name ? file : new File([file], name, {type:file.type}));
    }
  }
  return results.sort((a,b) => order.compare(a.name, b.name));
}

export async function createChapter(entries) {
  if (!entries.length) throw new Error('No pages to export.');
  const seen = new Set(), budget = {count:0, bytes:0};
  const validated = entries.map(({name, blob}) => {
    count(budget);
    if (!(blob instanceof Blob)) throw new Error('Missing page data.');
    account(blob.size, budget);
    return {name:checkName(name, seen), blob};
  });
  const archive = new ZipWriter(new BlobWriter('application/vnd.comicbook+zip'), options);
  for (const {name, blob} of validated) {
    // Raster images are already compressed. Storage mode avoids re-encoding each page.
    await archive.add(name, new BlobReader(blob), {level:0});
  }
  return archive.close();
}
