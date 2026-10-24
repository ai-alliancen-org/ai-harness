// SPDX-License-Identifier: EUPL-1.2
// Main-only image decoding. The renderer never supplies a filesystem path.
const MAX_INPUT = 5 * 1024 * 1024;
const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_PREVIEW = 40 * 1024;

function createImageNormalizer({ nativeImage }) {
  if (typeof nativeImage?.createFromBuffer !== 'function') throw new Error('Billedbehandling kræver den native app.');
  return function normalize(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_INPUT) throw new Error('Vælg et screenshot på højst 5 MB.');
    // The attachment service validates dimensions before this decoder runs.
    // Re-encode pixels instead of forwarding EXIF, text chunks or source paths.
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) throw new Error('Billedet kunne ikke åbnes. Vælg en gyldig PNG- eller JPEG-fil.');
    const { width, height } = image.getSize();
    if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 8192) || width * height > 24_000_000) throw new Error('Billedet er for stort. Vælg et screenshot på højst 8192 pixels pr. side og 24 megapixels.');
    const data = image.toPNG();
    if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_OUTPUT) throw new Error('Det normaliserede billede er for stort. Brug et mindre screenshot.');
    const fit = Math.min(1, 320 / width, 240 / height);
    let preview = image.resize({ width: Math.max(1, Math.round(width * fit)), height: Math.max(1, Math.round(height * fit)), quality: 'good' });
    let previewData = preview.toJPEG(65);
    if (previewData.length > MAX_PREVIEW) previewData = preview.toJPEG(40);
    if (previewData.length > MAX_PREVIEW) {
      const small = preview.getSize();
      preview = preview.resize({ width: Math.max(1, Math.round(small.width / 2)), height: Math.max(1, Math.round(small.height / 2)), quality: 'good' });
      previewData = preview.toJPEG(40);
    }
    if (!Buffer.isBuffer(previewData) || !previewData.length || previewData.length > MAX_PREVIEW) throw new Error('Der kunne ikke laves en sikker forhåndsvisning af billedet.');
    return { data, mime: 'image/png', width, height, previewData, previewMime: 'image/jpeg' };
  };
}
module.exports = { createImageNormalizer };
