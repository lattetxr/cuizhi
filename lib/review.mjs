export const REVIEW_INTERVALS = [1, 3, 7, 21];

function daysFromNow(days) {
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

export function createReviewPlan(cards) {
  const now = Date.now();
  return {
    intervals: REVIEW_INTERVALS,
    nextReviewAt: daysFromNow(1),
    milestones: REVIEW_INTERVALS.map((days) => ({
      day: days,
      dueAt: daysFromNow(days),
    })),
    cards: cards.map((card) => ({
      id: card.id,
      level: 0,
      dueAt: daysFromNow(1),
      reviews: [],
    })),
  };
}

export function applyGrade(pkg, cardId, grade) {
  const record = pkg.reviewPlan?.cards?.find((item) => item.id === cardId);
  if (!record) throw new Error('卡片不存在');
  const now = Date.now();
  const valid = ['again', 'hard', 'good'];
  if (!valid.includes(grade)) throw new Error('无效的自评结果');

  if (grade === 'again') {
    record.level = 0;
    record.dueAt = now;
  } else if (grade === 'hard') {
    record.dueAt = daysFromNow(REVIEW_INTERVALS[record.level]);
  } else {
    record.level = Math.min(REVIEW_INTERVALS.length - 1, record.level + 1);
    record.dueAt = daysFromNow(REVIEW_INTERVALS[record.level]);
  }
  record.reviews.push({ at: now, grade, level: record.level });
  pkg.reviewPlan.nextReviewAt = Math.min(
    ...pkg.reviewPlan.cards.map((item) => item.dueAt),
  );
  pkg.reviewPlan.progress = packageProgress(pkg);
  return pkg;
}

export function packageProgress(pkg) {
  const records = pkg.reviewPlan?.cards || [];
  const total = records.length;
  const reviewed = records.filter((item) => item.reviews.length > 0).length;
  const weak = records.filter((item) => {
    const last = item.reviews.at(-1);
    return last && last.grade !== 'good';
  }).length;
  const dueNow = records.filter((item) => item.dueAt <= Date.now()).length;
  return {
    total,
    reviewed,
    weak,
    dueNow,
    percent: total ? Math.round((reviewed / total) * 100) : 0,
  };
}
