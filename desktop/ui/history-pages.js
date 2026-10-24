// Display-only pages of records already retained by Aura. No model/IPC calls.
(function(root) {
  const PAGE_SIZE = 20, PAGE_CHARACTERS = 60000;
  function takePrevious(remaining) {
    if (!Array.isArray(remaining)) throw new TypeError('Expected stored messages');
    let index = remaining.length, characters = 0, count = 0;
    while (index > 0 && count < PAGE_SIZE) {
      const length = String(remaining[index - 1]?.text || '').length;
      if (count && characters + length > PAGE_CHARACTERS) break;
      characters += length; count++; index--;
    }
    return { older:remaining.slice(0,index), recent:remaining.slice(index) };
  }
  const api = Object.freeze({ takePrevious, PAGE_SIZE, PAGE_CHARACTERS });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HistoryPages = api;
})(typeof window === 'undefined' ? globalThis : window);
