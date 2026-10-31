// Planen og AI'ens spørgsmål i en form, brugeren kan overskue. Rene funktioner uden DOM, så de kan afprøves i Node.
(root => {
  // AI'en bliver bedt om at skrive planen under fire faste overskrifter. Andre overskrifter vises, som de er.
  const known = [['bygger', /^det bygger vi$/i], ['design', /^sådan skal det se ud$/i], ['teknik', /^teknik og data$/i], ['proev', /^det skal du prøve(?:\s*\([^\n()]+\)|\s+i forhåndsvisningen)?$/i]];
  function headingOf(line) {
    const markdown = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    const text = (markdown ? markdown[1] : line).trim().replace(/^(\*\*|__)(.+)\1$/, '$2').replace(/[:：]\s*$/, '').trim();
    const key = known.find(([, pattern]) => pattern.test(text))?.[0] || null;
    return markdown || key ? { title: text, key } : null;
  }
  function parsePlan(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const sections = []; let intro = [], current = null, inCode = false;
    for (const line of lines) {
      if (/^\s*```/.test(line)) inCode = !inCode;
      const heading = !inCode && headingOf(line);
      if (heading) { current = { title: heading.title, key: heading.key, body: [] }; sections.push(current); continue; }
      (current ? current.body : intro).push(line);
    }
    const trim = body => body.join('\n').replace(/^\n+|\n+$/g, '');
    const result = { intro: trim(intro), sections: sections.map(section => ({ title: section.title, key: section.key, body: trim(section.body) })).filter(section => section.body || section.key) };
    result.structured = result.sections.some(section => section.key);
    return result;
  }
  // Én kort linje til samtalens kort: første afsnit under Det bygger vi, ellers planens første tekst.
  function planSummary(text, max = 220) {
    const plan = parsePlan(text);
    const source = plan.sections.find(section => section.key === 'bygger')?.body || plan.intro || plan.sections[0]?.body || '';
    const first = source.split(/\n\s*\n/)[0].replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
    return first.length <= max ? first : first.slice(0, max).replace(/[\s,.;:]+\S*$/, '') + ' …';
  }
  // Et kort overblik supplerer resuméet; den fulde plan og dens id ændres aldrig.
  function planOutline(text) {
    const parsed = parsePlan(text);
    return ['design', 'proev'].flatMap(key => {
      const section = parsed.sections.find(item => item.key === key && item.body.trim());
      return section ? [{ title: section.title, text: planSummary(section.body, 160) }] : [];
    });
  }
  // Svarmuligheder fra question-værktøjet. Et anbefalet svar markeres og står først; etiketten sendes uændret tilbage.
  const recommendedPattern = /\s*[([]\s*(anbefalet|anbefales|recommended)\s*[)\]]\s*$/i;
  function answerOptions(options) {
    const list = (options || []).filter(option => option && typeof option.label === 'string' && option.label.trim()).map(option => ({ label: option.label, text: option.label.replace(recommendedPattern, '').trim() || option.label, description: typeof option.description === 'string' ? option.description : '', recommended: recommendedPattern.test(option.label) }));
    const first = list.findIndex(option => option.recommended);
    if (first > 0) list.unshift(...list.splice(first, 1));
    return list;
  }
  const api = { parsePlan, planSummary, planOutline, answerOptions };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.PlanView = api;
})(typeof window === 'object' ? window : globalThis);
