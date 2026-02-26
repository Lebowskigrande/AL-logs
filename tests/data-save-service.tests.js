'use strict';

const assert = require('node:assert/strict');
const service = require('../scripts/data-save-service');
const pipeline = require('../scripts/data-pipeline');

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

function sampleData(){
  return {
    characters: {
      hero: {
        display_name: 'Hero',
        sheet: 'Hero',
        adventures: [
          {
            title: 'Session',
            date: '2026-01-01',
            kind: 'adventure',
            gp_plus: 1,
            gp_minus: 0,
            dtd_plus: 0,
            dtd_minus: 0,
            level_plus: 0,
            perm_items: [],
            lost_perm_item: [],
            consumable_items: [],
            supernatural_gifts: [],
            story_awards: [],
            notes: ''
          }
        ]
      }
    },
    meta: { generated: '2026-01-01T00:00:00.000Z', source_file: 'test', problems: [] }
  };
}

const checks = [
  ['resolveSerializableData returns normalized structure', () => {
    const out = service.resolveSerializableData(sampleData(), pipeline);
    assert.equal(out.characters.hero.adventures[0].kind, 'adventure');
    assert.equal(typeof out.characters.hero.adventures[0].gp_net, 'number');
  }],
  ['buildDataJsPayload emits window.DATA assignment', () => {
    const payload = service.buildDataJsPayload(sampleData(), pipeline);
    assert.equal(payload.startsWith('window.DATA = '), true);
    assert.equal(payload.endsWith(';'), true);
  }],
  ['touchDataMetaTimestamp updates generated timestamp', () => {
    const data = sampleData();
    service.touchDataMetaTimestamp(data);
    assert.equal(typeof data.meta.generated, 'string');
    assert.equal(data.meta.generated.length > 10, true);
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
