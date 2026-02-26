#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pipeline = require('../scripts/data-pipeline');

function loadDataModule(filePath){
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = { window: {}, globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: filePath });
  const data = sandbox.window && sandbox.window.DATA;
  if(!data || typeof data !== 'object'){
    throw new Error('Unable to locate window.DATA in provided file.');
  }
  return data;
}

function writeDataModule(filePath,data){
  const payload = `window.DATA = ${JSON.stringify(data, null, 2)};\n`;
  fs.writeFileSync(filePath, payload, 'utf8');
}

function parseEventIndex(issue){
  if(!issue || typeof issue.path !== 'string'){
    return null;
  }
  const match = issue.path.match(/item_events\[(\d+)\]/);
  if(!match){
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function coerceText(value){
  return String(value == null ? '' : value).trim();
}

function canonicalText(value){
  return coerceText(value).toLowerCase();
}

function tokenText(value){
  return canonicalText(value).replace(/[^a-z0-9]+/g,'');
}

function canonicalItems(value){
  const counts = new Map();
  pipeline.parseItemList(value).forEach((entry)=>{
    const key = canonicalText(entry);
    if(!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return JSON.stringify(Array.from(counts.entries()).sort((a,b)=>a[0].localeCompare(b[0])));
}

function findCharacterKey(characters, lookup){
  if(!lookup) return '';
  const keys = Object.keys(characters || {});
  const wanted = canonicalText(lookup);
  const exact = keys.find((key)=>canonicalText(key) === wanted);
  return exact || '';
}

function inferCharacterAlias(characters,rawName){
  const keys = Object.keys(characters || {});
  const text = coerceText(rawName);
  if(!text) return '';
  const cleaned = text.replace(/^sir\s+/i,'').trim();
  const rawToken = tokenText(cleaned);
  if(!rawToken){
    return '';
  }
  const exactToken = keys.find((key)=>tokenText(key) === rawToken);
  if(exactToken){
    return exactToken;
  }
  const containsMatches = keys.filter((key)=>{
    const t = tokenText(key);
    return t.includes(rawToken) || rawToken.includes(t);
  });
  if(containsMatches.length === 1){
    return containsMatches[0];
  }
  const distance = (a,b)=>{
    const rows = a.length + 1;
    const cols = b.length + 1;
    const dp = Array.from({ length: rows }, ()=>Array(cols).fill(0));
    for(let i=0;i<rows;i+=1) dp[i][0]=i;
    for(let j=0;j<cols;j+=1) dp[0][j]=j;
    for(let i=1;i<rows;i+=1){
      for(let j=1;j<cols;j+=1){
        const cost = a[i-1] === b[j-1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i-1][j] + 1,
          dp[i][j-1] + 1,
          dp[i-1][j-1] + cost
        );
      }
    }
    return dp[rows-1][cols-1];
  };
  const closeMatches = keys.filter((key)=>{
    const t = tokenText(key);
    if(!t) return false;
    const d = distance(rawToken,t);
    return d <= 1 || (Math.max(rawToken.length,t.length) >= 8 && d <= 2);
  });
  if(closeMatches.length === 1){
    return closeMatches[0];
  }
  return '';
}

function buildReciprocalAdventure(sourceCharKey, sourceAdventure){
  const trade = sourceAdventure && sourceAdventure.trade ? sourceAdventure.trade : null;
  if(!trade) return null;
  const given = coerceText(trade.given);
  const received = coerceText(trade.received);
  if(!(given || received)) return null;

  const itemEvents = [];
  pipeline.parseItemList(received).forEach((item)=>{
    itemEvents.push({
      type: 'acquire',
      item,
      quantity: 1,
      notes: 'cleanup:auto inferred pre-trade ownership'
    });
    itemEvents.push({
      type: 'trade_out',
      item,
      quantity: 1
    });
  });
  pipeline.parseItemList(given).forEach((item)=>{
    itemEvents.push({
      type: 'trade_in',
      item,
      quantity: 1
    });
  });

  return {
    title: `Trade (reciprocal for ${sourceCharKey})`,
    date: sourceAdventure.date || '',
    code: sourceAdventure.code || '',
    dm: sourceAdventure.dm || '',
    kind: 'adventure',
    gp_plus: 0,
    gp_minus: 0,
    gp_net: 0,
    dtd_plus: 0,
    dtd_minus: 0,
    dtd_net: 0,
    level_plus: 0,
    totals: {
      gp: { earned: 0, spent: 0, net: 0 },
      downtime: { earned: 0, spent: 0, net: 0 },
      level: { gained: 0 }
    },
    perm_items: [],
    lost_perm_item: [],
    consumable_items: [],
    supernatural_gifts: [],
    story_awards: [],
    notes: `cleanup:auto generated reciprocal trade entry for ${sourceCharKey}`,
    trade: {
      counterpartyCharacter: sourceCharKey,
      given: received,
      received: given
    },
    item_events: itemEvents
  };
}

function applyMissingAcquisitionPath(data,issue){
  if(!issue || !issue.charKey || !Number.isFinite(issue.adventureIndex)){
    return false;
  }
  const character = data.characters && data.characters[issue.charKey];
  if(!character || !Array.isArray(character.adventures)){
    return false;
  }
  const adventure = character.adventures[issue.adventureIndex];
  if(!adventure || !Array.isArray(adventure.item_events)){
    return false;
  }
  const eventIndex = parseEventIndex(issue);
  if(!Number.isFinite(eventIndex) || eventIndex < 0 || eventIndex >= adventure.item_events.length){
    return false;
  }
  const event = adventure.item_events[eventIndex];
  if(!event || !event.item){
    return false;
  }
  const outgoing = new Set(['trade_out','consume','sell','destroy','lose','gift_out']);
  if(!outgoing.has(coerceText(event.type).toLowerCase())){
    return false;
  }
  const quantity = Number(event.quantity);
  const normalizedQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const prev = eventIndex > 0 ? adventure.item_events[eventIndex - 1] : null;
  if(
    prev &&
    coerceText(prev.type).toLowerCase() === 'acquire' &&
    coerceText(prev.item).toLowerCase() === coerceText(event.item).toLowerCase() &&
    (Number(prev.quantity) || 1) === normalizedQuantity
  ){
    return false;
  }
  adventure.item_events.splice(eventIndex, 0, {
    type: 'acquire',
    item: event.item,
    quantity: normalizedQuantity,
    notes: 'cleanup:auto inferred prior acquisition'
  });
  return true;
}

function hasInverseTrade(targetCharKey,targetAdventure,sourceCharKey,sourceTrade){
  if(!targetAdventure || !targetAdventure.trade){
    return false;
  }
  const targetTrade = targetAdventure.trade;
  const sameCounterparty = canonicalText(targetTrade.counterpartyCharacter) === canonicalText(sourceCharKey);
  if(!sameCounterparty){
    return false;
  }
  const targetGiven = canonicalItems(targetTrade.given);
  const targetReceived = canonicalItems(targetTrade.received);
  const sourceGiven = canonicalItems(sourceTrade.given);
  const sourceReceived = canonicalItems(sourceTrade.received);
  return targetGiven === sourceReceived && targetReceived === sourceGiven;
}

function applyTradeReciprocity(data,issue){
  if(!issue || !issue.charKey || !Number.isFinite(issue.adventureIndex)){
    return false;
  }
  const sourceCharacter = data.characters && data.characters[issue.charKey];
  if(!sourceCharacter || !Array.isArray(sourceCharacter.adventures)){
    return false;
  }
  const sourceAdventure = sourceCharacter.adventures[issue.adventureIndex];
  if(!sourceAdventure || !sourceAdventure.trade){
    return false;
  }
  const sourceTrade = sourceAdventure.trade;
  const counterpartyKey = findCharacterKey(data.characters, sourceTrade.counterpartyCharacter);
  if(!counterpartyKey){
    return false;
  }
  const targetCharacter = data.characters[counterpartyKey];
  if(!targetCharacter || !Array.isArray(targetCharacter.adventures)){
    return false;
  }
  const sameDateInverseExists = targetCharacter.adventures.some((entry)=>{
    if(!entry || coerceText(entry.date) !== coerceText(sourceAdventure.date)){
      return false;
    }
    return hasInverseTrade(counterpartyKey,entry,issue.charKey,sourceTrade);
  });
  if(sameDateInverseExists){
    return false;
  }
  const reciprocal = buildReciprocalAdventure(issue.charKey, sourceAdventure);
  if(!reciprocal){
    return false;
  }
  targetCharacter.adventures.push(reciprocal);
  return true;
}

function summarizeIssues(issues){
  const counts = {};
  (issues || []).forEach((issue)=>{
    const code = issue && issue.code ? issue.code : 'unknown';
    counts[code] = (counts[code] || 0) + 1;
  });
  return counts;
}

function runCleanup(data){
  let normalized = pipeline.normalizeData(data).data;
  let iterations = 0;
  const stats = {
    normalizedCounterpartyAliases: 0,
    insertedAcquisitions: 0,
    addedReciprocalTrades: 0
  };

  Object.entries(normalized.characters || {}).forEach(([charKey,charValue])=>{
    if(!charValue || !Array.isArray(charValue.adventures)) return;
    charValue.adventures.forEach((adv)=>{
      if(!adv || !adv.trade || typeof adv.trade !== 'object') return;
      const existing = findCharacterKey(normalized.characters, adv.trade.counterpartyCharacter);
      if(existing){
        return;
      }
      const inferred = inferCharacterAlias(normalized.characters, adv.trade.counterpartyCharacter);
      if(inferred && inferred !== adv.trade.counterpartyCharacter){
        adv.trade.counterpartyCharacter = inferred;
        stats.normalizedCounterpartyAliases += 1;
      }
    });
  });

  while(iterations < 2000){
    iterations += 1;
    const issues = (pipeline.validateData(normalized).issues || [])
      .filter((issue)=>issue && issue.severity === 'warning');
    let changed = false;
    issues
      .filter((issue)=>issue.code === 'missing_acquisition_path')
      .forEach((issue)=>{
        if(applyMissingAcquisitionPath(normalized,issue)){
          stats.insertedAcquisitions += 1;
          changed = true;
        }
      });
    issues
      .filter((issue)=>issue.code === 'trade_reciprocity_unmatched')
      .forEach((issue)=>{
        if(applyTradeReciprocity(normalized,issue)){
          stats.addedReciprocalTrades += 1;
          changed = true;
        }
      });
    if(!changed){
      break;
    }
  }

  const unresolved = pipeline.validateData(normalized).issues || [];
  const removable = [];
  unresolved
    .filter((issue)=>issue && issue.code === 'trade_reciprocity_unmatched' && typeof issue.path === 'string')
    .forEach((issue)=>{
      const match = issue.path.match(/^characters\.(.+)\.adventures\[(\d+)\]\.trade$/);
      if(!match) return;
      const charKey = match[1];
      const index = Number(match[2]);
      const char = normalized.characters && normalized.characters[charKey];
      if(!char || !Array.isArray(char.adventures)) return;
      const adv = char.adventures[index];
      if(!adv) return;
      const isGeneratedReciprocal =
        /^Trade \(reciprocal for /i.test(coerceText(adv.title)) &&
        /cleanup:auto generated reciprocal trade entry/i.test(coerceText(adv.notes));
      if(isGeneratedReciprocal){
        removable.push({ charKey, index });
      }
    });
  if(removable.length){
    const grouped = new Map();
    removable.forEach((entry)=>{
      if(!grouped.has(entry.charKey)){
        grouped.set(entry.charKey, []);
      }
      grouped.get(entry.charKey).push(entry.index);
    });
    grouped.forEach((indexes,charKey)=>{
      const char = normalized.characters && normalized.characters[charKey];
      if(!char || !Array.isArray(char.adventures)) return;
      indexes
        .sort((a,b)=>b-a)
        .forEach((index)=>{
          if(index >= 0 && index < char.adventures.length){
            char.adventures.splice(index,1);
          }
        });
    });
  }

  normalized = pipeline.normalizeData(normalized).data;
  const postIssues = pipeline.validateData(normalized).issues || [];
  return {
    cleaned: normalized,
    stats,
    issueSummary: summarizeIssues(postIssues),
    totalIssues: postIssues.length
  };
}

function main(){
  const [, , target='data/data.js'] = process.argv;
  const absPath = path.resolve(process.cwd(), target);
  const data = loadDataModule(absPath);
  const result = runCleanup(data);
  const clean = pipeline.prepareForSave(result.cleaned);
  writeDataModule(absPath, clean);
  console.log(JSON.stringify({
    target,
    stats: result.stats,
    totalIssues: result.totalIssues,
    issueSummary: result.issueSummary
  }, null, 2));
}

if(require.main === module){
  try{
    main();
  }catch(err){
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
