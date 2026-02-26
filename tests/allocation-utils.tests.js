'use strict';

const assert = require('node:assert/strict');
const allocationUtils = require('../scripts/allocation-utils');

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
  ['normalizeDateString returns YYYY-MM-DD', () => {
    assert.equal(allocationUtils.normalizeDateString('2026-02-01T12:00:00Z'),'2026-02-01');
  }],
  ['interpretAllocationDetails parses levels and recipients', () => {
    const detail = allocationUtils.interpretAllocationDetails('2 levels to Alice and Bob');
    assert.ok(Number.isFinite(detail.levelsSpent));
    assert.ok(detail.levelsSpent > 0);
    assert.deepEqual(detail.recipients,['Alice','Bob']);
    assert.ok(Array.isArray(detail.tokens));
  }],
  ['buildAllocationItemSeasonIndex indexes allocation item tokens', () => {
    const map = allocationUtils.buildAllocationItemSeasonIndex([
      { type:'allocation', season:'Season 11', allocation:'Sword + Shield to Alice' }
    ]);
    assert.equal(map.has('sword'),true);
    assert.equal(map.get('sword').has('Season 11'),true);
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
