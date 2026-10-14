const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { validLevel, priority, orderSubjects, installQueueOrder, levelFromDocument } = require('../wanikani-review-priority.user.js');

const item = (id, type, level) => ({ id, subject_category: type, level });
const sample = [item(1, 'Vocabulary', 10), item(2, 'Kanji', 3), item(3, 'Radical', 10), item(4, 'Radical', 2), item(5, 'Kanji', 10), item(6, 'KanaVocabulary', 10)];
const metadata = new Map(sample.map(s => [s.id, s]));

test('exact five-group order, including kana vocabulary; input is preserved', () => {
  const snapshot = JSON.stringify(sample);
  assert.deepEqual(orderSubjects(sample, metadata, 10).subjects.map(s => s.id), [3, 5, 4, 2, 1, 6]);
  assert.equal(JSON.stringify(sample), snapshot);
  assert.equal(priority({ type: 'kana_vocabulary', level: 10 }, 10), 4);
});

test('does not guess current level from a backlog of lower-level reviews', () => {
  assert.deepEqual(orderSubjects(sample, metadata, 20).subjects.map(s => s.id), [3, 4, 2, 5, 1, 6]);
});

test('ties keep their original order and every subject is retained', () => {
  const subjects = Array.from({ length: 1400 }, (_, i) => item(i + 1, ['Kanji', 'Vocabulary', 'Radical'][i % 3], i % 10 + 1));
  const result = orderSubjects(subjects, new Map(subjects.map(s => [s.id, s])), 10);
  assert.equal(new Set(result.subjects.map(s => s.id)).size, 1400);
  for (let group = 0; group < 5; group++) {
    assert.deepEqual(result.subjects.filter(s => result.ranks.get(s.id) === group), subjects.filter(s => priority(s, 10) === group));
  }
});

test('invalid or missing metadata fails before applying any queue change', () => {
  assert.throws(() => orderSubjects(sample, new Map(), 10), /unavailable/);
  assert.throws(() => orderSubjects(sample.concat(sample[0]), metadata, 10), /duplicate/);
  assert.throws(() => orderSubjects(sample, metadata, 0), /level/);
  assert.throws(() => priority({ type: 'unknown' }, 10), /Unrecognized/);
  for (const value of [0, 61, 1.5, '', null, undefined, '10abc']) assert.equal(validLevel(value), null);
  assert.equal(validLevel('60'), 60);
});

test('current level is read only from the user menu', () => {
  const root = { querySelectorAll(selector) { assert.equal(selector, '.user-summary__attribute'); return [{ textContent: 'Lifetime' }, { textContent: 'Level 17' }]; } };
  assert.equal(levelFromDocument(root), 17);
  assert.equal(levelFromDocument({ querySelectorAll: () => [{ textContent: 'Level 61' }] }), null);
});

function queueFixture() {
  return {
    activeQueue: sample.slice(0, 3), backlogQueue: sample.slice(3, 4), remainingIds: [5, 6], maxActiveQueueSize: 3,
    stats: { partiallyAnswered: true }, totalItems: 6, srsManager: {}, questionOrder: 'readingFirst', completeSubjectsInOrder: false,
    nextItem(type) { this.currentItem = this.activeQueue[0]; this.requestedType = type; return 'original-result'; }
  };
}

test('sorts beyond the preload; preserves stats, SRS, question order, and count', () => {
  const q = queueFixture(); const stats = q.stats; const srs = q.srsManager;
  const ordered = orderSubjects(sample, metadata, 10);
  installQueueOrder(q, ordered.subjects, ordered.ranks);
  assert.equal(q.currentItem.id, 3);
  assert.deepEqual(q.activeQueue.concat(q.backlogQueue).map(s => s.id), [3, 5, 4, 2, 1, 6]);
  assert.deepEqual(q.remainingIds, []);
  assert.equal(q.stats, stats); assert.equal(q.srsManager, srs); assert.equal(q.totalItems, 6);
  assert.equal(q.questionOrder, 'readingFirst'); assert.equal(q.completeSubjectsInOrder, false);
  // Simulate WaniKani moving an unanswered high-priority subject behind others.
  q.activeQueue = [sample[3], sample[4], sample[2]];
  assert.equal(q.nextItem('reading'), 'original-result');
  assert.equal(q.currentItem.id, 3); assert.equal(q.requestedType, 'reading');
});

test('changed/in-flight queues are refused and errors restore original arrays', () => {
  const ordered = orderSubjects(sample, metadata, 10);
  const q = queueFixture(); q.remainingIds.push(999);
  const old = q.activeQueue;
  assert.throws(() => installQueueOrder(q, ordered.subjects, ordered.ranks), /changed/);
  assert.equal(q.activeQueue, old);
  const inFlight = queueFixture(); inFlight.fetchingMoreItems = true;
  assert.throws(() => installQueueOrder(inFlight, ordered.subjects, ordered.ranks), /loading/);
  const broken = queueFixture(); broken.nextItem = () => { throw new Error('broken'); };
  const snapshot = { ...broken };
  assert.throws(() => installQueueOrder(broken, ordered.subjects, ordered.ranks), /broken/);
  assert.equal(broken.activeQueue, snapshot.activeQueue);
  assert.equal(broken.backlogQueue, snapshot.backlogQueue);
  assert.equal(broken.remainingIds, snapshot.remainingIds);
  assert.equal(broken.nextItem, snapshot.nextItem);
});

test('empty review queue can complete normally', () => {
  let done = false;
  const q = { activeQueue: [], backlogQueue: [], remainingIds: [], maxActiveQueueSize: 10, nextItem() { done = true; } };
  installQueueOrder(q, [], new Map());
  assert.equal(done, true);
});

test('Safari metadata has direct install/update links and no dependencies', () => {
  const script = fs.readFileSync(require.resolve('../wanikani-review-priority.user.js'), 'utf8');
  const meta = fs.readFileSync(require.resolve('../wanikani-review-priority.meta.js'), 'utf8');
  assert.equal(script.slice(0, script.indexOf('// ==/UserScript==') + 18).trim(), meta.trim());
  assert.match(meta, /@inject-into\s+page/);
  assert.match(meta, /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/WattW\/wanikani-ios\/main\/[^\s]+\.user\.js/);
  assert.match(meta, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/WattW\/wanikani-ios\/main\/[^\s]+\.meta\.js/);
  assert.doesNotMatch(meta, /@require/);
});
