// SPDX-License-Identifier: EUPL-1.2
function imageInfo(data) {
  if (!Buffer.isBuffer(data) || data.length < 12) throw new Error('Billedet kunne ikke læses. Vælg PNG eller JPEG.');
  let mime, width, height;
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    if (data.length < 33 || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG-billedet er ugyldigt.');
    mime = 'image/png'; width = data.readUInt32BE(16); height = data.readUInt32BE(20);
    let at = 8, complete = false;
    for (; at + 12 <= data.length;) {
      const length = data.readUInt32BE(at), end = at + length + 12;
      if (end > data.length) throw new Error('PNG-billedet er ufuldstændigt.');
      const tag = data.toString('ascii', at + 4, at + 8);
      if (tag === 'acTL') throw new Error('Animerede billeder kan ikke bruges som screenshots.');
      if (tag === 'IEND') { if (length !== 0) throw new Error('PNG-billedet er ugyldigt.'); complete = true; }
      at = end;
    }
    if (!complete || at !== data.length) throw new Error('PNG-billedet er ufuldstændigt.');
  } else if (data[0] === 0xff && data[1] === 0xd8) {
    mime = 'image/jpeg'; let at = 2;
    while (at + 3 < data.length) {
      if (data[at++] !== 0xff) throw new Error('JPEG-billedet er ugyldigt.');
      while (data[at] === 0xff) at++;
      const marker = data[at++];
      if ([0xd9, 0xda].includes(marker)) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const length = data.readUInt16BE(at);
      if (length < 2 || at + length > data.length) throw new Error('JPEG-billedet er ufuldstændigt.');
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 7) throw new Error('JPEG-billedet er ugyldigt.');
        height = data.readUInt16BE(at + 3); width = data.readUInt16BE(at + 5); break;
      }
      at += length;
    }
  }

  if (!mime || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 24_000_000) throw new Error('Vælg et billede på højst 8192 × 8192 pixels og 24 megapixels.');
  return { mime, width, height };
}

module.exports = { imageInfo };
