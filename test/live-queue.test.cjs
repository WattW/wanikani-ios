// Optional integration with the actual WaniKani source, downloaded separately.
// No upstream source is redistributed. Set WK_QUEUE_SOURCE_DIR to its directory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { orderSubjects, installQueueOrder } = require('../wanikani-review-priority.user.js');

function loadQueue() {
  class Event { constructor(detail) { this.detail = detail; } }
  class RegisterEvent extends Event { static newObserver(value) { return value; } }
  const sandbox = {
    window: { addEventListener() {}, dispatchEvent() {} }, console,
    DidAnswerQuestionEvent: Event, UpdateQuizProgress: Event, WillShowNextQuestionEvent: Event,
    RegisterWrapUpObserverEvent: RegisterEvent, answerActionPass: 'pass'
  };
  vm.createContext(sandbox);
  for (const [name, file] of [['CachedStats', 'cached_stats'], ['WrapUpManager', 'wrap_up_manager'], ['SRSManager', 'srs_manager'], ['QuizQueue', 'queue']]) {
    const source = fs.readFileSync(path.join(process.env.WK_QUEUE_SOURCE_DIR, `controllers_quiz_queue_${file}.js`), 'utf8');
    const executable = source.replace(/^import .*\r?\n/gm, '').replace('export default class', 'class');
    vm.runInContext(`${executable}\nthis.${name} = ${name};`, sandbox);
  }
  return sandbox.QuizQueue;
}

test('current WaniKani queue: every group, wrong answers, both question orders, >100 items, and wrap-up', { skip: !process.env.WK_QUEUE_SOURCE_DIR }, () => {
  const QuizQueue = loadQueue();
  const types = ['Vocabulary', 'Kanji', 'Radical', 'KanaVocabulary'];
  const all = Array.from({ length: 257 }, (_, i) => ({ id: i + 1, type: types[i % 4], subject_category: types[i % 4] === 'KanaVocabulary' ? 'Vocabulary' : types[i % 4], level: i % 3 === 0 ? 10 : 5, characters: String(i) }));
  const ordered = orderSubjects(all, new Map(all.map(s => [s.id, s])), 10);
  for (const questionOrder of ['readingFirst', 'meaningFirst', '']) {
    for (const completeSubjectsInOrder of [false, true]) {
      const completed = []; let done = false;
      const q = new QuizQueue({ queue: all.slice(0, 100), remainingIds: all.slice(100).map(s => s.id),
        api: { itemComplete(result) { completed.push(result); }, fetchItems() { throw new Error('Unexpected fetch after preload'); } },
        srsMap: { srs_ids_stage_names: [] }, completeSubjectsInOrder, questionOrder,
        onDone() { done = true; }, preloadCharactersContainer: { innerText: '' } });
      installQueueOrder(q, ordered.subjects, ordered.ranks);
      const wrong = new Set(); let lastGroup = -1; let attempts = 0;
      while (!done && attempts++ < 2000) {
        const group = ordered.ranks.get(q.currentItem.id);
        assert.ok(group >= lastGroup, 'lower-priority group appeared too early'); lastGroup = group;
        const incorrect = !wrong.has(q.currentItem.id); wrong.add(q.currentItem.id);
        q.submitAnswer('test', { action: incorrect ? 'fail' : 'pass' });
        q.nextItem();
      }
      assert.equal(done, true); assert.equal(completed.length, all.length);
      assert.equal(new Set(completed.map(result => result.item.id)).size, all.length);
      assert.equal(q.remainingQueueLength, 0); assert.equal(q.totalItems, all.length);
      for (const result of completed) assert.equal(result.stats.meaning.incorrect + result.stats.reading.incorrect, 1);
    }
  }
  const q = new QuizQueue({ queue: all, remainingIds: [], api: { itemComplete() {} }, srsMap: { srs_ids_stage_names: [] }, completeSubjectsInOrder: false, questionOrder: 'meaningFirst', onDone() {}, preloadCharactersContainer: {} });
  installQueueOrder(q, ordered.subjects, ordered.ranks);
  q.wrapUpManager.wrappingUp = true;
  let completed = 0;
  while (q.activeQueue.length) {
    const before = q.activeQueue.length;
    q.submitAnswer('test', { action: 'pass' }); q.nextItem();
    if (q.activeQueue.length < before) completed++;
  }
  assert.equal(completed, 10); assert.equal(q.backlogQueue.length, 247);
  q.wrapUpManager.wrappingUp = false;
  q.onWrapUp({ isWrappingUp: false }); q.nextItem();
  assert.equal(q.activeQueue.length, 10); assert.equal(q.remainingQueueLength, 247);
});
