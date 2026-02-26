'use strict';

const assert = require('node:assert/strict');
const pipeline = require('../scripts/data-pipeline');

function sampleRawPayload(){
  return {
    characters: {
      hero: {
        display_name: 'Hero',
        sheet: 'Hero Sheet',
        inventory_state: {
          active: ['Sword of Testing'],
          attuned: ['Sword of Testing'],
          common: ['Cloak of Billowing']
        },
        adventures: [
          {
            title: 'A Valid Session',
            date: '2025-01-01',
            kind: 'adventure',
            gp_plus: 50,
            gp_minus: 10,
            dtd_plus: 10,
            dtd_minus: 0,
            level_plus: 1,
            perm_items: ['Sword of Testing'],
            lost_perm_item: [],
            consumable_items: ['Potion of Healing'],
            supernatural_gifts: [],
            story_awards: ['Rescued the town'],
            notes: 'All good.'
          }
        ]
      }
    },
    meta: {
      source_file: 'test',
      generated: '2026-01-01T00:00:00.000Z',
      problems: []
    }
  };
}

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
  ['validateData reports no errors for valid normalized payload', () => {
    const raw = sampleRawPayload();
    const { issues } = pipeline.validateData(raw);
    const errors = issues.filter((issue) => issue.severity === 'error');
    assert.equal(errors.length, 0);
  }],
  ['validateData reports invalid ISO date from normalized payload checks', () => {
    const raw = sampleRawPayload();
    raw.characters.hero.adventures[0].date = 'not-a-date';
    const { issues } = pipeline.validateData(raw);
    assert.ok(issues.some((issue) => issue.code === 'invalid_date'));
    assert.ok(issues.some((issue) => issue.code === 'invalid_iso_date'));
  }],
  ['validateNormalizedData enforces trade and inventory_state shape', () => {
    const normalized = pipeline.normalizeData(sampleRawPayload()).data;
    normalized.characters.hero.inventory_state.attuned = ['Missing Active Item'];
    normalized.characters.hero.adventures[0].trade = {
      given: '',
      mystery: 'nope'
    };

    const { issues } = pipeline.validateNormalizedData(normalized);
    assert.ok(issues.some((issue) => issue.code === 'invalid_inventory_state'));
    assert.ok(issues.some((issue) => issue.code === 'invalid_trade_field'));
    assert.ok(issues.some((issue) => issue.code === 'invalid_trade_shape'));
  }],
  ['validateNormalizedData rejects invalid kinds', () => {
    const normalized = pipeline.normalizeData(sampleRawPayload()).data;
    normalized.characters.hero.adventures[0].kind = 'sidequest';
    const { issues } = pipeline.validateNormalizedData(normalized);
    assert.ok(issues.some((issue) => issue.code === 'invalid_kind'));
  }],
  ['pipeline exposes extraction-ready helper APIs', () => {
    assert.equal(typeof pipeline.parseAcquisitionName, 'function');
    assert.equal(typeof pipeline.stampCharacterChronology, 'function');
  }],
  ['stampCharacterChronology assigns chronology fields', () => {
    const adventures = [
      {
        title: 'One',
        date: '2025-01-01',
        perm_items: ['Sword of Testing'],
        lost_perm_item: [],
        kind: 'adventure'
      },
      {
        title: 'Two',
        date: '2025-01-01',
        perm_items: [],
        lost_perm_item: ['Sword of Testing'],
        kind: 'adventure'
      }
    ];
    pipeline.stampCharacterChronology(adventures);
    adventures.forEach((adv) => {
      assert.equal(Number.isFinite(adv.chrono_timestamp), true);
      assert.equal(Number.isFinite(adv.chrono_index), true);
    });
  }],
  ['normalize -> prepareForSave -> normalize is stable', () => {
    const raw = sampleRawPayload();
    const first = pipeline.normalizeData(raw).data;
    const saved = pipeline.prepareForSave(first);
    const second = pipeline.normalizeData(saved).data;
    const savedAgain = pipeline.prepareForSave(second);

    assert.deepEqual(savedAgain, saved);
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
