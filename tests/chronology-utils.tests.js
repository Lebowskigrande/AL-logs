'use strict';

const assert = require('node:assert/strict');
const chrono = require('../scripts/chronology-utils');

function run(name,fn){
  try{
    fn();
    console.log(`PASS: ${name}`);
    return true;
  }catch(error){
    console.error(`FAIL: ${name}`);
    console.error(error && error.stack ? error.stack : String(error));
    return false;
  }
}

const checks = [
  ['parseYmdString parses valid date', () => {
    const out = chrono.parseYmdString('2026-02-26');
    assert.deepEqual(out, { year: 2026, month: 2, day: 26 });
  }],
  ['fmtDate formats date-only values', () => {
    const out = chrono.fmtDate('2026-02-26');
    assert.equal(typeof out, 'string');
    assert.equal(out.length > 0, true);
  }],
  ['computeChronologicalDate allocates later same-day timestamp', () => {
    const collection = [{ date: '2026-02-26T09:00:00.000Z' }];
    const out = chrono.computeChronologicalDate('2026-02-26', { collection, wasNew: true, stepHours: 1 });
    assert.equal(typeof out, 'string');
    assert.equal(out.includes('T'), true);
  }]
];

let failures = 0;
checks.forEach(([name,fn])=>{
  if(!run(name,fn)){
    failures += 1;
  }
});

if(failures > 0){
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} tests passed.`);
