import assert from 'node:assert/strict';
import test from 'node:test';

const { createAnkiApkg } = await import('../server/lib/anki.mjs');

test('Anki .apkg 是合法 ZIP 且包含 collection.anki2', () => {
  const buffer = createAnkiApkg([
    { front: '问题', back: '答案', sourceUrl: 'https://www.zhihu.com/answer/1' },
  ]);
  assert.equal(buffer[0], 0x50);
  assert.equal(buffer[1], 0x4b);
  const text = buffer.toString('latin1');
  assert.match(text, /collection\.anki2/);
  assert.match(text, /media/);
});
