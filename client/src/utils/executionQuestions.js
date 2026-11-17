export function searchAuditQuestions(sections, query) {
  const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (sections || []).flatMap((section, sectionIndex) => (section._checkpoints || [])
    .filter(question => {
      const text = [question.text, question.clause, question.tip, section.title, section.clause, section.stdId].join(' ').toLowerCase();
      return words.every(word => text.includes(word));
    })
    .map(question => ({ question, section, sectionIndex })));
}
