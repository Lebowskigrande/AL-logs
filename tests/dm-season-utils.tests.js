'use strict';

const assert = require('node:assert/strict');
const dmSeasonUtils = require('../scripts/dm-season-utils');

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
  ['allocationSeasonEligibleForLevelAccrual rejects pre-season 11', () => {
    assert.equal(dmSeasonUtils.allocationSeasonEligibleForLevelAccrual('Pre-Season 11'), false);
    assert.equal(dmSeasonUtils.allocationSeasonEligibleForLevelAccrual('Season 11'), true);
  }],
  ['normalizeSeasonGroup handles season labels', () => {
    assert.equal(dmSeasonUtils.normalizeSeasonGroup('Season 12A'), 'season-12');
    assert.equal(dmSeasonUtils.normalizeSeasonGroup('Seasonal (Holiday)'), 'seasonal');
  }],
  ['allocationGrantsLevelToPool uses parser contract', () => {
    const parser = () => ({ levelsSpent: 1, itemTokens: ['wand'], downtimeSpent: null, goldSpent: null, recipients: [] });
    const grants = dmSeasonUtils.allocationGrantsLevelToPool('Season 12', '1 level to Alice + Wand', null, { interpretAllocationDetails: parser });
    assert.equal(grants, true);
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
