export function normalizeQuizPlan(plan, count) {
  const target = Math.max(3, Math.min(20, Number(count) || 5));
  const fallbackLevels = ['understanding', 'application', 'analysis', 'inference'];
  const rawSections = Array.isArray(plan?.sections) ? plan.sections : [];
  const sections = rawSections.map((section, index) => ({
    name: String(section?.name || `المحور ${index + 1}`).slice(0, 120),
    questionCount: Math.max(0, Number(section?.questionCount) || 0),
    concepts: Array.isArray(section?.concepts) ? section.concepts.map(String).slice(0, 8) : [],
    cognitiveLevels: Array.isArray(section?.cognitiveLevels)
      ? section.cognitiveLevels.filter(level => fallbackLevels.includes(level)).slice(0, 4)
      : []
  })).filter(section => section.questionCount > 0);
  const normalizedSections = sections.length ? sections : [{
    name: 'التغطية الشاملة للمحتوى المصدر',
    questionCount: target,
    concepts: [],
    cognitiveLevels: fallbackLevels
  }];
  let total = normalizedSections.reduce((sum, section) => sum + section.questionCount, 0);
  if (total < target) normalizedSections[0].questionCount += target - total;
  if (total > target) {
    let excess = total - target;
    for (let i = normalizedSections.length - 1; i >= 0 && excess > 0; i--) {
      const reduction = Math.min(excess, Math.max(0, normalizedSections[i].questionCount - 1));
      normalizedSections[i].questionCount -= reduction;
      excess -= reduction;
    }
  }
  const distribution = plan?.distribution || {};
  const levelCounts = Object.fromEntries(fallbackLevels.map(level => [level, Number(distribution[level]) || 0]));
  const levelTotal = Object.values(levelCounts).reduce((sum, value) => sum + value, 0);
  if (levelTotal !== target) {
    levelCounts.understanding = Math.max(1, Math.round(target * 0.2));
    levelCounts.application = Math.max(1, Math.round(target * 0.3));
    levelCounts.analysis = Math.max(1, Math.round(target * 0.3));
    levelCounts.inference = Math.max(1, target - levelCounts.understanding - levelCounts.application - levelCounts.analysis);
  }
  return {
    title: String(plan?.title || 'خطة كويز موضوعي من المصدر').slice(0, 180),
    rationale: String(plan?.rationale || 'توزيع الأسئلة على فهم وتطبيق وتحليل واستنتاج مع تغطية متوازنة للمصدر.').slice(0, 400),
    objectives: Array.isArray(plan?.objectives) ? plan.objectives.map(String).slice(0, 8) : [],
    sections: normalizedSections,
    distribution: levelCounts,
    qualityGates: [
      'كل سؤال موضوعي وله إجابة صحيحة واحدة واضحة',
      'كل سؤال مرتبط باقتباس حرفي من المصدر',
      'لا تكرار في الفكرة أو ناتج التعلم',
      'وجود أسئلة فهم وتطبيق وتحليل واستنتاج'
    ]
  };
}

export function createFallbackQuizPlan(count = 5) {
  const target = Math.max(3, Math.min(20, Number(count) || 5));
  return normalizeQuizPlan({
    title: 'خطة كويز موضوعي متدرج',
    rationale: 'خطة احتياطية منظمة عند تعذر استدعاء نموذج التخطيط.',
    distribution: {
      understanding: Math.max(1, Math.round(target * 0.2)),
      application: Math.max(1, Math.round(target * 0.3)),
      analysis: Math.max(1, Math.round(target * 0.3)),
      inference: Math.max(1, target - Math.round(target * 0.2) - Math.round(target * 0.3) - Math.round(target * 0.3))
    },
    sections: [{ name: 'المحتوى العلمي كاملاً', questionCount: target, concepts: [], cognitiveLevels: ['understanding', 'application', 'analysis', 'inference'] }]
  }, target);
}
