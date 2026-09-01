import assert from 'node:assert/strict';
import test from 'node:test';

const { createReviewPlan, applyGrade, packageProgress } = await import('../lib/review.mjs');

test('复习计划按 1/3/7/21 天生成', () => {
  const cards = [
    { id: 'a', front: 'A', back: 'a' },
    { id: 'b', front: 'B', back: 'b' },
  ];
  const plan = createReviewPlan(cards);
  assert.deepEqual(plan.intervals, [1, 3, 7, 21]);
  assert.equal(plan.cards.length, 2);
  assert.ok(plan.cards[0].dueAt > Date.now());
});

test('薄弱卡片提前出现，熟练卡片延后', () => {
  const pkg = {
    cards: [
      { id: 'a', front: 'A', back: 'a' },
      { id: 'b', front: 'B', back: 'b' },
    ],
  };
  pkg.reviewPlan = createReviewPlan(pkg.cards);
  applyGrade(pkg, 'a', 'good');
  applyGrade(pkg, 'b', 'again');
  const progress = packageProgress(pkg);
  assert.equal(progress.reviewed, 2);
  assert.equal(progress.weak, 1);
  const cardA = pkg.reviewPlan.cards.find((item) => item.id === 'a');
  const cardB = pkg.reviewPlan.cards.find((item) => item.id === 'b');
  assert.equal(cardA.level, 1);
  assert.equal(cardB.level, 0);
  assert.ok(cardB.dueAt <= cardA.dueAt);
});

test('无效自评结果会被拒绝', () => {
  const pkg = {
    cards: [{ id: 'a', front: 'A', back: 'a' }],
  };
  pkg.reviewPlan = createReviewPlan(pkg.cards);
  assert.throws(() => applyGrade(pkg, 'a', 'maybe'), /无效的自评结果/);
});
