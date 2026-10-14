// Runs the actual current WaniKani input controller and queue against simulated
// DOM/network boundaries. Upstream source is downloaded separately, not vendored.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { correctAnswers, fillCorrectAnswer, installAnswerAssistance } = require('../wanikani-review-priority.user.js');
const enabled = !!process.env.WK_QUEUE_SOURCE_DIR;

function load(file) { return fs.readFileSync(path.join(process.env.WK_QUEUE_SOURCE_DIR, file + '.js'), 'utf8').replace(/^import .*\r?\n/gm, ''); }

class Element {
  constructor() {
    this.attributes = new Map(); this.dataset = {}; this.value = ''; this.hidden = false; this.innerText = '';
    const classes = new Set();
    this.classList = { add: s => classes.add(s), remove: s => classes.delete(s), contains: s => classes.has(s) };
  }
  addEventListener() {} removeEventListener() {} dispatchEvent() {} focus() {} setSelectionRange() {}
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k); }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }
}

function session({ level = 10, type = 'Kanji', questionType = 'meaning', studyMaterial } = {}) {
  const listeners = new Map(); const completions = []; const events = []; const reveals = []; const timers = [];
  const window = {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    dispatchEvent(event) { events.push(event); for (const listener of listeners.get(event.type) || []) listener(event); }
  };
  const eventClass = type => class { constructor(detail) { this.type = type; this.detail = detail; } };
  const Register = eventClass('registerWrapUpObserver'); Register.newObserver = value => value;
  class Checker {
    evaluate({ questionType, response }) {
      if (response === 'native-retry') return { action: 'retry', message: { type: 'answerException', text: 'Native message' } };
      return { action: response === (questionType === 'meaning' ? 'Sun' : 'にち') ? 'pass' : 'fail' };
    }
  }
  const context = {
    window, console, Controller: class {}, AnswerChecker: Checker, answerActionPass: 'pass', answerActionRetry: 'retry', answerException: 'answerException',
    normalizeReadingResponse: s => s.trim(), questionTypeAndResponseMatch: (_, s) => s !== 'invalid-type',
    dbManager: { getStudyMaterial: () => studyMaterial || Promise.resolve({ meaning_synonyms: [] }) },
    wanakana: { bind() {}, unbind() {} },
    setTimeout(fn, ms) { timers.push({ fn, ms }); },
    DidAnswerQuestionEvent: eventClass('didAnswerQuestion'), UpdateQuizProgress: eventClass('updateQuizProgress'),
    WillShowNextQuestionEvent: eventClass('willShowNextQuestion'), RegisterWrapUpObserverEvent: Register
  };
  vm.createContext(context);
  for (const [name, file] of [['CachedStats', 'cached_stats'], ['WrapUpManager', 'wrap_up_manager'], ['SRSManager', 'srs_manager'], ['QuizQueue', 'queue']]) {
    vm.runInContext(`${load('controllers_quiz_queue_' + file).replace('export default class', 'class')}\nthis.${name} = ${name};`, context);
  }
  vm.runInContext(`${load('controllers_quiz_input_controller').replace('export default class extends', 'class QuizInput extends')}\nthis.QuizInput = QuizInput;`, context);
  const subject = { id: 1, type, subject_category: type, primary_reading_type: 'onyomi', characters: '日',
    meanings: [{ kind: 'primary', text: 'Sun' }], readings: [{ kind: 'primary', type: 'onyomi', text: 'にち' }] };
  const metadata = new Map([[1, { level }]]);
  const controller = new context.QuizInput();
  for (const target of ['input', 'button', 'inputContainer', 'questionTypeContainer', 'questionType', 'category', 'exception', 'exceptionContainer', 'form']) controller[`${target}Target`] = new Element();
  controller.initialize(); controller.scrollIntoView = () => {};
  const q = new context.QuizQueue({ queue: [subject], remainingIds: [], api: { itemComplete: value => completions.push(value) },
    srsMap: { srs_ids_stage_names: [] }, completeSubjectsInOrder: false, questionOrder: '', onDone() {}, preloadCharactersContainer: {} });
  controller.hasQuizQueueOutlet = true; controller.quizQueueOutlet = q;
  installAnswerAssistance(controller, metadata, 10, { onWrong: (s, t) => reveals.push({ id: s.id, type: t, answers: correctAnswers(s, t) }) });
  q.nextItem(questionType);
  return { controller, q, subject, metadata, completions, events, reveals, timers };
}

test('native input + queue: current-level errors shake without recording mistakes; corrected answers still submit', { skip: !enabled }, async () => {
  for (const type of ['Radical', 'Kanji', 'Vocabulary', 'KanaVocabulary']) {
    for (const questionType of type === 'Radical' || type === 'KanaVocabulary' ? ['meaning'] : ['meaning', 'reading']) {
      const s = session({ type, questionType }); const c = s.controller;
      c.inputTarget.value = 'wrong'; await c.submitAnswer();
      assert.equal(c.inputContainerTarget.classList.contains('effects--shake'), true);
      assert.equal(c.inputEnabled, true); assert.equal(c.submitting, false);
      assert.equal(s.q.stats.data.size, 0); assert.equal(s.completions.length, 0);
      assert.equal(s.events.some(e => e.type === 'didAnswerQuestion'), false);
      assert.match(c.exceptionTarget.innerText, /not counted wrong/);
      assert.equal(s.reveals[0].type, questionType); assert.ok(s.reveals[0].answers.length);
      assert.equal(fillCorrectAnswer(c, s.metadata, 10), true);
      assert.equal(s.completions.length, 0); // Filling never submits.
      await c.submitAnswer();
      assert.equal(c.inputEnabled, false); assert.equal(c.inputContainerTarget.getAttribute('correct'), 'true');
      const event = s.events.find(e => e.type === 'didAnswerQuestion');
      assert.equal(event.detail.subjectWithStats.stats.meaning.incorrect + event.detail.subjectWithStats.stats.reading.incorrect, 0);
      // Finish the other half using WaniKani's real next-question path.
      if (!s.completions.length) {
        await c.submitAnswer(); assert.equal(c.inputEnabled, true);
        fillCorrectAnswer(c, s.metadata, 10); await c.submitAnswer();
      }
      assert.equal(s.completions.length, 1);
      assert.equal(s.completions[0].stats.meaning.incorrect + s.completions[0].stats.reading.incorrect, 0);
    }
  }
});

test('native input + queue: other-level wrong answers are recorded normally and revealed', { skip: !enabled }, async () => {
  const s = session({ level: 9 }); const c = s.controller;
  c.inputTarget.value = 'wrong'; await c.submitAnswer();
  assert.equal(c.inputEnabled, false); assert.equal(c.inputContainerTarget.getAttribute('correct'), 'false');
  assert.equal(s.q.stats.get(s.subject).meaning.incorrect, 1);
  assert.equal(s.events.filter(e => e.type === 'didAnswerQuestion').length, 1);
  assert.deepEqual(s.reveals[0].answers, ['Sun']);
  assert.equal(fillCorrectAnswer(c, s.metadata, 10), false);
});

test('native early validation stays editable; empty inputs do not reveal; native retry text survives', { skip: !enabled }, async () => {
  const s = session(); const c = s.controller;
  c.inputTarget.value = ''; await c.submitAnswer();
  assert.equal(c.inputEnabled, true); assert.equal(c.submitting, false); assert.equal(s.reveals.length, 0);
  c.inputTarget.value = 'invalid-type'; await c.submitAnswer();
  assert.equal(c.inputEnabled, true); assert.equal(c.submitting, false); assert.equal(s.reveals.length, 1);
  c.inputTarget.value = 'native-retry'; await c.submitAnswer();
  assert.equal(c.exceptionTarget.innerText, 'Native message'); assert.equal(s.q.stats.data.size, 0);
});

test('double tapping a current-level mistake does not queue an automatic resubmission', { skip: !enabled }, async () => {
  let resolve;
  const s = session({ studyMaterial: new Promise(r => { resolve = r; }) });
  s.controller.inputTarget.value = 'wrong';
  const first = s.controller.submitAnswer(); await s.controller.submitAnswer();
  resolve({ meaning_synonyms: [] }); await first;
  assert.equal(s.controller.inputEnabled, true); assert.equal(s.controller.nextPending, false);
  assert.equal(s.timers.length, 0); assert.equal(s.q.stats.data.size, 0);
});

test('answer choices agree with the current native helper for accepted kanji readings', { skip: !enabled }, () => {
  const context = vm.createContext({});
  vm.runInContext(load('lib_answer_checker_utils_helpers').replace(/^export \{.*\}\r?\n/gm, '').replace(/export function/g, 'function'), context);
  const subject = { type: 'Kanji', primary_reading_type: 'onyomi', readings: [
    { kind: 'primary', type: 'kunyomi', text: 'ひ' }, { kind: 'primary', type: 'onyomi', text: 'にち' },
    { kind: 'allowed', type: 'kunyomi', text: 'か' }, { kind: 'warning', type: 'onyomi', text: 'げつ' }
  ] };
  assert.deepEqual(correctAnswers(subject, 'reading'), Array.from(context.correctReadings(subject), entry => entry.text));
});
