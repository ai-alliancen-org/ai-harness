// SPDX-License-Identifier: EUPL-1.2
function externalURL(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>k!=='url') || typeof value.url!=='string' || value.url.length>4096 || /[\u0000-\u0020\u007f]/.test(value.url)) throw Error('Vælg et almindeligt http- eller https-link.');
  let url;try{url=new URL(value.url);if(/[\u0000-\u001f\u007f]/.test(decodeURIComponent(value.url)))throw Error();}catch{throw Error('Linkets adresse er ugyldig.');}
  if(!['https:','http:'].includes(url.protocol)||!url.hostname||url.username||url.password)throw Error('Kun http- og https-links uden loginoplysninger kan åbnes.');
  return url.href;
}
module.exports = { externalURL };
