(function(global){
  'use strict';

  const GLOBAL_SCOPE = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const ALLOWED_KINDS = new Set(['adventure','Downtime Activity']);
  let adventureUidCounter = 0;

  function nextAdventureUid(){
    adventureUidCounter += 1;
    return `adv-${adventureUidCounter}`;
  }

function pushIssue(issues,{ severity='error', code='unknown', message='', path='', charKey=null, adventureId=null, adventureIndex=null, field=null }){
  issues.push({
    severity,
    code,
    message: message || code,
    path,
    charKey: charKey || null,
    adventureId: adventureId || null,
    adventureIndex: typeof adventureIndex === 'number' ? adventureIndex : null,
    field: field || null
  });
}

  function coerceString(value,{ fallback='', maxLength=null, allowNull=false }={}){
    if(value == null){
      return allowNull ? null : fallback;
    }
    let text = '';
    if(typeof value === 'string'){
      text = value;
    }else if(typeof value === 'number' && Number.isFinite(value)){
      text = String(value);
    }else{
      text = String(value || '');
    }
    text = text.trim();
    if(maxLength != null && text.length > maxLength){
      text = text.slice(0, maxLength);
    }
    if(!text && !allowNull){
      return fallback;
    }
    return text;
  }

  function coerceMultiline(value){
    if(value == null) return '';
    const text = String(value).replace(/\r\n?/g,'\n');
    return text.trim();
  }

  function splitListInput(value){
    if(value == null) return [];
    if(Array.isArray(value)){
      return value
        .map(item => coerceString(item, { fallback:'', allowNull:false }))
        .map(item => item.trim())
        .filter(item => item.length>0);
    }
    const text = coerceMultiline(value);
    if(!text) return [];
    const hasNewlines = text.includes('\n');
    const hasSemicolon = text.includes(';');
    const hasBullet = text.includes('•');
    let parts = [text];
    if(hasNewlines){
      parts = text.split(/\n+/);
    }else if(hasSemicolon){
      parts = text.split(/\s*;\s*/);
    }else if(hasBullet){
      parts = text.split(/•+/);
    }else if(text.includes(',')){
      parts = text.split(/,+/);
    }
    return parts
      .map(part => part.trim())
      .filter(part => part.length>0);
  }

  function normItemName(value){
    return coerceString(value,{ fallback:'' }).trim();
  }

  function parseAcquisitionName(value){
    const text = coerceString(value,{ fallback:'' });
    const match = text.match(/^\((.*)\)$/);
    if(match){
      return { name: match[1].trim(), acquired:false };
    }
    const prefixedRemoval = text.match(/^(?:-|lost\s*:|remove\s*:|traded\s*(?:away)?\s*:?)\s*(.+)$/i);
    if(prefixedRemoval){
      return { name: prefixedRemoval[1].trim(), acquired:false };
    }
    return { name: text.trim(), acquired:true };
  }

  function parseItemList(value){
    if(Array.isArray(value)){
      return value.map(normItemName).filter(Boolean);
    }
    return splitListInput(value);
  }

  function buildAdventureInventoryOperation(adv){
    const operation = { adds:[], removes:[] };
    if(!adv || typeof adv !== 'object'){
      return operation;
    }

    const pushAddition = (raw)=>{
      const parsed = parseAcquisitionName(raw);
      const cleaned = normItemName(parsed.name);
      if(!cleaned) return;
      const key = cleaned.toLowerCase();
      if(parsed.acquired){
        operation.adds.push(key);
      }else{
        operation.removes.push(key);
      }
    };

    const pushRemoval = (raw)=>{
      const cleaned = normItemName(raw);
      if(!cleaned) return;
      operation.removes.push(cleaned.toLowerCase());
    };

    parseItemList(adv && adv.perm_items).forEach(pushAddition);
    parseItemList(adv && adv.lost_perm_item).forEach(pushRemoval);

    const tradeInfo = adv && typeof adv.trade === 'object' ? adv.trade : null;
    const receivedList = parseItemList(tradeInfo && tradeInfo.received);
    const givenList = parseItemList(tradeInfo && tradeInfo.given);
    const legacyGiven = parseItemList(adv && adv.traded_item);
    const legacyGivenAlt = parseItemList(adv && adv.itemTraded);

    receivedList.forEach(pushAddition);
    givenList.forEach(pushRemoval);
    legacyGiven.forEach(pushRemoval);
    legacyGivenAlt.forEach(pushRemoval);

    return operation;
  }

  function cloneInventoryCounts(source){
    const clone = new Map();
    if(!source) return clone;
    source.forEach((value,key)=>{
      if(Number.isFinite(value) && value>0){
        clone.set(key,value);
      }
    });
    return clone;
  }

  function canApplyInventoryOperation(operation,inventory){
    if(!operation || !Array.isArray(operation.removes) || !operation.removes.length){
      return true;
    }
    const needed = new Map();
    operation.removes.forEach((key)=>{
      const current = needed.get(key)||0;
      needed.set(key,current+1);
    });
    for(const [key,count] of needed.entries()){
      if((inventory.get(key)||0)<count){
        return false;
      }
    }
    return true;
  }

  function applyInventoryOperation(inventory,operation){
    if(!inventory || !operation) return;
    if(Array.isArray(operation.removes)){
      operation.removes.forEach((key)=>{
        const current = inventory.get(key)||0;
        if(current<=1){
          inventory.delete(key);
        }else{
          inventory.set(key,current-1);
        }
      });
    }
    if(Array.isArray(operation.adds)){
      operation.adds.forEach((key)=>{
        const current = inventory.get(key)||0;
        inventory.set(key,current+1);
      });
    }
  }

  function orderChronoGroup(entries,inventory){
    if(!Array.isArray(entries) || entries.length<=1){
      return Array.isArray(entries) ? entries.slice() : [];
    }
    const sorted = entries
      .map(entry => ({
        adv: entry.adv,
        index: entry.index,
        baseTime: entry.baseTime,
        ops: entry.ops
      }))
      .sort((a,b)=>a.index-b.index);

    const used = new Array(sorted.length).fill(false);
    const sequence = [];

    const attemptOrder = (currentInventory)=>{
      if(sequence.length===sorted.length){
        return true;
      }
      for(let i=0;i<sorted.length;i+=1){
        if(used[i]) continue;
        const candidate = sorted[i];
        if(!canApplyInventoryOperation(candidate.ops,currentInventory)){
          continue;
        }
        used[i]=true;
        sequence.push(candidate);
        const nextInventory = cloneInventoryCounts(currentInventory);
        applyInventoryOperation(nextInventory,candidate.ops);
        if(attemptOrder(nextInventory)){
          return true;
        }
        sequence.pop();
        used[i]=false;
      }
      return false;
    };

    const success = attemptOrder(cloneInventoryCounts(inventory));
    if(success){
      return sequence.slice();
    }
    return sorted;
  }

  const MIN_TIME = -8640000000000000;

  function parseAdventureBaseTime(adv){
    if(!adv || typeof adv !== 'object') return MIN_TIME;
    const raw = adv.date;
    if(raw instanceof Date){
      const t = raw.getTime();
      return Number.isFinite(t) ? t : MIN_TIME;
    }
    if(typeof raw === 'number' && Number.isFinite(raw)){
      return raw;
    }
    if(raw!=null){
      const parsed = new Date(raw).getTime();
      if(Number.isFinite(parsed)){
        return parsed;
      }
    }
    return MIN_TIME;
  }

  function stampCharacterChronology(adventures){
    if(!Array.isArray(adventures) || adventures.length<=0){
      return;
    }

    const decorated = adventures.map((adv,idx)=>({
      adv,
      index: idx,
      baseTime: parseAdventureBaseTime(adv),
      ops: buildAdventureInventoryOperation(adv)
    }));

    const groupsByTime = new Map();
    decorated.forEach((entry)=>{
      const key = Number.isFinite(entry.baseTime) ? String(entry.baseTime) : '__invalid__';
      if(!groupsByTime.has(key)){
        groupsByTime.set(key,[]);
      }
      groupsByTime.get(key).push(entry);
    });

    const groups = Array.from(groupsByTime.values()).sort((a,b)=>{
      const timeA = Math.min(...a.map(entry=>Number.isFinite(entry.baseTime)?entry.baseTime:MIN_TIME));
      const timeB = Math.min(...b.map(entry=>Number.isFinite(entry.baseTime)?entry.baseTime:MIN_TIME));
      if(timeA!==timeB){
        return timeA-timeB;
      }
      const idxA = Math.min(...a.map(entry=>entry.index));
      const idxB = Math.min(...b.map(entry=>entry.index));
      return idxA-idxB;
    });

    const inventory = new Map();
    let chronoCounter = 0;
    groups.forEach((group)=>{
      const ordered = orderChronoGroup(group,inventory);
      ordered.forEach((entry,pos)=>{
        const base = Number.isFinite(entry.baseTime) ? entry.baseTime : MIN_TIME;
        const hint = Number.isFinite(base) ? base + pos : MIN_TIME + pos;
        entry.adv.chrono_timestamp = hint;
        entry.adv.chrono_index = chronoCounter++;
        applyInventoryOperation(inventory,entry.ops);
      });
    });
  }

  function coerceNumber(value,{ fallback=0, allowNull=false }={}, issues, context){
  const { path='', charKey=null, adventureId=null, adventureIndex=null, field=null } = context || {};
    if(value == null || value === ''){
      return allowNull ? null : fallback;
    }
    if(typeof value === 'number' && Number.isFinite(value)){
      return value;
    }
    if(typeof value === 'string'){
      const trimmed = value.trim();
      if(!trimmed){
        return allowNull ? null : fallback;
      }
      const normalized = trimmed
        .replace(/,/g,'')
        .replace(/\s+/g,' ')
        .toLowerCase();
      const unitMatch = normalized.match(/^(?<numeric>[-+]?\d+(?:\.\d+)?)(?<unit>\s*(gp|dtd|dt|hrs?|hours?)?)$/);
      if(unitMatch && unitMatch.groups && unitMatch.groups.numeric){
        const parsed = Number(unitMatch.groups.numeric);
        if(Number.isFinite(parsed)){
          return parsed;
        }
      }
    }
    if(issues){
      pushIssue(issues,{
        severity:'error',
        code:'invalid_number',
        message:`Unable to parse numeric value for ${field || path || 'field'}.`,
        path,
        charKey,
        adventureId,
        adventureIndex,
        field
      });
    }
    return allowNull ? null : fallback;
  }

function normalizeDate(value,{ issues, charKey, adventureId, adventureIndex=null, path='date', field='date' }){
    if(!value){
      pushIssue(issues,{
        severity:'error',
        code:'missing_date',
        message:'Adventure date is required.',
        path,
        charKey,
        adventureId,
        adventureIndex,
        field
      });
      return '';
    }
    let text = String(value).trim();
    if(!text){
      pushIssue(issues,{
        severity:'error',
        code:'missing_date',
        message:'Adventure date is required.',
        path,
        charKey,
        adventureId,
        adventureIndex,
        field
      });
      return '';
    }
    if(ISO_DATE_RE.test(text)){
      return text;
    }
    const parsed = new Date(text);
    if(Number.isNaN(parsed.getTime())){
      pushIssue(issues,{
        severity:'error',
        code:'invalid_date',
        message:`Invalid adventure date: ${text}`,
        path,
        charKey,
        adventureId,
        adventureIndex,
        field
      });
      return '';
    }
    try{
      return parsed.toISOString().slice(0,10);
    }catch(err){
      pushIssue(issues,{
        severity:'error',
        code:'invalid_date',
        message:`Invalid adventure date: ${text}`,
        path,
        charKey,
        adventureId,
        adventureIndex,
        field
      });
      return '';
    }
  }

  function normalizeIdentity(raw){
    if(!raw || typeof raw !== 'object') return {};
    const out = {};
    if(raw.race != null) out.race = coerceString(raw.race);
    if(raw.classes != null) out.classes = coerceString(raw.classes);
    if(raw.lineage != null) out.lineage = coerceString(raw.lineage);
    if(raw.background != null) out.background = coerceString(raw.background);
    return out;
  }

  function sanitizeInventoryList(value){
    if(Array.isArray(value)){
      return value
        .map(item => coerceString(item,{ fallback:'', allowNull:false }))
        .map(item => item.trim())
        .filter(item => item.length>0);
    }
    if(value == null){
      return [];
    }
    return sanitizeInventoryList([value]);
  }

  function normalizeInventoryState(raw){
    if(!raw || typeof raw !== 'object') return null;
    const active = sanitizeInventoryList(raw.active);
    const common = sanitizeInventoryList(raw.common);
    const activeLower = new Set(active.map(item => item.toLowerCase()));
    const attuned = sanitizeInventoryList(raw.attuned)
      .filter(item => activeLower.has(item.toLowerCase()))
      .slice(0,3);
    if(!(active.length || attuned.length || common.length)){
      return null;
    }
    return { active, attuned, common };
  }

  function readTradeValue(sources, keys){
    for(const source of sources){
      if(!source || typeof source !== 'object') continue;
      for(const key of keys){
        if(Object.prototype.hasOwnProperty.call(source,key)){
          const text = coerceString(source[key],{ fallback:'' });
          if(text){
            return text;
          }
        }
      }
    }
    return '';
  }

  function normalizeTrade(raw,{ isDowntime=false }={}){
    if(!raw || typeof raw !== 'object') return null;
    const tradeSources = [];
    if(raw.trade && typeof raw.trade === 'object'){ tradeSources.push(raw.trade); }
    tradeSources.push(raw);
    const given = readTradeValue(tradeSources,[
      'given','itemGiven','itemTraded','tradeItemGiven','tradeItem','traded_item'
    ]);
    const received = readTradeValue(tradeSources,[
      'received','itemReceived','tradeItemReceived'
    ]);
    const counterpartyCharacter = readTradeValue(tradeSources,[
      'counterpartyCharacter','character','withCharacter','tradeCharacterName'
    ]);
    const counterpartyPlayer = readTradeValue(tradeSources,[
      'counterpartyPlayer','player','withPlayer','tradePlayerName'
    ]);
    if(!(given || received || counterpartyCharacter || counterpartyPlayer)){
      return null;
    }
    if(!isDowntime && !given && !received){
      return null;
    }
    const trade = {};
    if(given){ trade.given = given; }
    if(received){ trade.received = received; }
    if(counterpartyCharacter){ trade.counterpartyCharacter = counterpartyCharacter; }
    if(counterpartyPlayer){ trade.counterpartyPlayer = counterpartyPlayer; }
    return Object.keys(trade).length ? trade : null;
  }

  function normalizeAdventure(raw,{ charKey, index, issues }){
    const pathBase = `characters.${charKey}.adventures[${index}]`;
    const adventureId = (raw && typeof raw === 'object' && typeof raw.__uid === 'string') ? raw.__uid : nextAdventureUid();
    const adv = {};
    Object.defineProperty(adv,'__uid',{ value:adventureId, enumerable:false, configurable:true });

    adv.title = coerceString(raw && raw.title, { fallback:'' });
    if(!adv.title){
      pushIssue(issues,{
        severity:'error',
        code:'missing_title',
        message:'Adventure is missing a title.',
        path:`${pathBase}.title`,
        charKey,
        adventureId,
        adventureIndex:index,
        field:'title'
      });
    }

    adv.date = normalizeDate(raw && raw.date,{
      issues,
      charKey,
      adventureId,
      adventureIndex:index,
      path:`${pathBase}.date`,
      field:'date'
    });

    adv.code = coerceString(raw && raw.code,{ fallback:'' }).toUpperCase();
    adv.dm = coerceString(raw && raw.dm,{ fallback:'', allowNull:true }) || '';

    const kindRaw = coerceString(raw && raw.kind,{ fallback:'adventure' });
    const kindLower = kindRaw.toLowerCase();
    let kindNormalized = 'adventure';
    if(kindLower === 'downtime activity' || kindLower === 'downtime' || kindLower === 'downtime_activity'){
      kindNormalized = 'Downtime Activity';
    }
    if(kindNormalized.toLowerCase() !== kindLower){
      pushIssue(issues,{
        severity:'warning',
        code:'normalized_kind',
        message:`Entry kind "${kindRaw}" normalized to "${kindNormalized}".`,
        path:`${pathBase}.kind`,
        charKey,
        adventureId,
        adventureIndex:index,
        field:'kind'
      });
    }
    adv.kind = kindNormalized;

    adv.gp_plus = coerceNumber(raw && raw.gp_plus,{ fallback:0 }, issues,{
      path:`${pathBase}.gp_plus`,
      charKey,
      adventureId,
      adventureIndex:index,
      field:'gp_plus'
    });
    adv.gp_minus = coerceNumber(raw && raw.gp_minus,{ fallback:0 }, issues,{
      path:`${pathBase}.gp_minus`,
      charKey,
      adventureId,
      adventureIndex:index,
      field:'gp_minus'
    });
    const gpTotals = {
      earned: adv.gp_plus,
      spent: adv.gp_minus,
      net: adv.gp_plus - adv.gp_minus
    };
    adv.gp_net = gpTotals.net;

    adv.dtd_plus = coerceNumber(raw && raw.dtd_plus,{ fallback:0 }, issues,{
      path:`${pathBase}.dtd_plus`,
      charKey,
      adventureId,
      adventureIndex:index,
      field:'dtd_plus'
    });
    adv.dtd_minus = coerceNumber(raw && raw.dtd_minus,{ fallback:0 }, issues,{
      path:`${pathBase}.dtd_minus`,
      charKey,
      adventureId,
      adventureIndex:index,
      field:'dtd_minus'
    });
    const downtimeTotals = {
      earned: adv.dtd_plus,
      spent: adv.dtd_minus,
      net: adv.dtd_plus - adv.dtd_minus
    };
    adv.dtd_net = downtimeTotals.net;

    adv.level_plus = coerceNumber(raw && raw.level_plus,{ fallback:0 }, issues,{
      path:`${pathBase}.level_plus`,
      charKey,
      adventureId,
      adventureIndex:index,
      field:'level_plus'
    });

    adv.totals = {
      gp: gpTotals,
      downtime: downtimeTotals,
      level: {
        gained: adv.level_plus
      }
    };

    adv.perm_items = splitListInput(raw && raw.perm_items);
    adv.lost_perm_item = splitListInput(raw && raw.lost_perm_item);
    adv.consumable_items = splitListInput(raw && raw.consumable_items);
    adv.supernatural_gifts = splitListInput(raw && raw.supernatural_gifts);
    adv.story_awards = splitListInput(raw && raw.story_awards);

    adv.notes = coerceMultiline(raw && raw.notes);

    const trade = normalizeTrade(raw,{ isDowntime: adv.kind !== 'adventure' });
    if(trade){
      adv.trade = trade;
    }

    if(raw && typeof raw === 'object'){
      const passthroughKeys = ['custom','season','tier','location','__meta'];
      passthroughKeys.forEach((key)=>{
        if(Object.prototype.hasOwnProperty.call(raw,key) && adv[key] == null){
          adv[key] = raw[key];
        }
      });
    }

    return adv;
  }

  function normalizeCharacter(raw,charKey,{ issues }){
    const pathBase = `characters.${charKey}`;
    const out = {};
    const display = coerceString(raw && raw.display_name,{ fallback:'' });
    const sheet = coerceString(raw && raw.sheet,{ fallback:'' });
    out.display_name = display || sheet || charKey;
    out.sheet = sheet || out.display_name || charKey;
    out.avatar = coerceString(raw && raw.avatar,{ fallback:'' });
    out.notes = coerceMultiline(raw && raw.notes);
    out.identity = normalizeIdentity(raw && raw.identity);
    out.adventures = [];

    const sourceAdventures = Array.isArray(raw && raw.adventures) ? raw.adventures : [];
    sourceAdventures.forEach((entry,idx)=>{
      const normalized = normalizeAdventure(entry,{ charKey, index:idx, issues });
      out.adventures.push(normalized);
    });

    stampCharacterChronology(out.adventures);

    if(raw && typeof raw === 'object'){
      const passthrough = ['consumables','consumable_uses','tags','portrait','pronouns'];
      passthrough.forEach((key)=>{
        if(Object.prototype.hasOwnProperty.call(raw,key)){
          out[key] = raw[key];
        }
      });
    }

    const inventoryState = normalizeInventoryState(raw && raw.inventory_state);
    if(inventoryState){
      out.inventory_state = inventoryState;
    }

    return out;
  }

  function sanitizeMeta(raw){
    const meta = {};
    if(raw && typeof raw === 'object'){
      meta.source_file = coerceString(raw.source_file || raw.sourceFile,{ fallback:'' });
      const generated = raw.generated || raw.generatedAt || raw.generated_at || '';
      const stamp = coerceString(generated,{ fallback:'' });
      if(stamp){
        const parsed = new Date(stamp);
        if(Number.isNaN(parsed.getTime())){
          meta.generated = new Date().toISOString();
        }else{
          meta.generated = parsed.toISOString();
        }
      }else{
        meta.generated = new Date().toISOString();
      }
      if(Array.isArray(raw.problems)){
        meta.problems = raw.problems.map(item => coerceString(item,{ fallback:'' })).filter(Boolean);
      }else{
        meta.problems = [];
      }
    }else{
      meta.source_file = '';
      meta.generated = new Date().toISOString();
      meta.problems = [];
    }
    return meta;
  }

  function normalizeStats(raw){
    if(!raw || typeof raw !== 'object') return {};
    const out = {};
    Object.entries(raw).forEach(([key,value])=>{
      if(!value || typeof value !== 'object'){ return; }
      const stats = {
        sessions: coerceNumber(value.sessions,{ fallback:0 }),
        net_gp: coerceNumber(value.net_gp,{ fallback:0 }),
        net_dtd: coerceNumber(value.net_dtd,{ fallback:0 }),
        level_ups: coerceNumber(value.level_ups,{ fallback:0 }),
        perm_count: coerceNumber(value.perm_count,{ fallback:0 }),
        cons_count: coerceNumber(value.cons_count,{ fallback:0 }),
        gifts_count: coerceNumber(value.gifts_count,{ fallback:0 })
      };
      out[key] = stats;
    });
    return out;
  }

  function normalizeYears(raw){
    if(!raw || typeof raw !== 'object') return {};
    const out = {};
    Object.entries(raw).forEach(([key,value])=>{
      if(!Array.isArray(value)) return;
      out[key] = value
        .map((item)=>{
          const num = Number(item);
          return Number.isFinite(num) ? num : null;
        })
        .filter((item)=>item!=null)
        .sort((a,b)=>a-b);
    });
    return out;
  }

  function normalizeData(raw){
    const issues = [];
    adventureUidCounter = 0;
    const normalized = {
      characters: {},
      stats: {},
      years: {},
      meta: sanitizeMeta(raw && raw.meta),
      dm_allocations: Array.isArray(raw && raw.dm_allocations) ? raw.dm_allocations.slice() : []
    };

    if(!raw || typeof raw !== 'object' || !raw.characters || typeof raw.characters !== 'object'){
      pushIssue(issues,{
        severity:'error',
        code:'missing_characters',
        message:'No characters found in data/data.js payload.',
        path:'characters'
      });
    }else{
      Object.entries(raw.characters).forEach(([charKey,charValue])=>{
        const normalizedChar = normalizeCharacter(charValue,charKey,{ issues });
        normalized.characters[charKey] = normalizedChar;
      });
    }

    normalized.stats = normalizeStats(raw && raw.stats);
    normalized.years = normalizeYears(raw && raw.years);

    return { data: normalized, issues };
  }

  function isPlainObject(value){
    if(!value || typeof value !== 'object' || Array.isArray(value)){
      return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function isValidIsoDateText(value){
    if(typeof value !== 'string' || !ISO_DATE_RE.test(value)){
      return false;
    }
    const parsed = new Date(value);
    if(Number.isNaN(parsed.getTime())){
      return false;
    }
    try{
      return parsed.toISOString().slice(0,10) === value;
    }catch(err){
      return false;
    }
  }

  function pushSchemaIssue(issues,{ code='schema_violation', message='', path='', charKey=null, adventureIndex=null, field=null }){
    pushIssue(issues,{
      severity:'error',
      code,
      message,
      path,
      charKey,
      adventureIndex,
      field
    });
  }

  function validateStringArray(value,issues,{ path, code, message, charKey=null, adventureIndex=null, field=null }){
    if(!Array.isArray(value)){
      pushSchemaIssue(issues,{ code, message, path, charKey, adventureIndex, field });
      return false;
    }
    let valid = true;
    value.forEach((item,itemIndex)=>{
      if(typeof item !== 'string' || !item.trim()){
        valid = false;
        pushSchemaIssue(issues,{
          code:'invalid_array_item',
          message:`${field || path} must contain non-empty strings.`,
          path:`${path}[${itemIndex}]`,
          charKey,
          adventureIndex,
          field
        });
      }
    });
    return valid;
  }

  function validateTradeShape(trade,issues,{ path, charKey=null, adventureIndex=null }){
    if(trade == null){
      return;
    }
    if(!isPlainObject(trade)){
      pushSchemaIssue(issues,{
        code:'invalid_trade_shape',
        message:'trade must be an object when present.',
        path,
        charKey,
        adventureIndex,
        field:'trade'
      });
      return;
    }
    const allowedKeys = new Set(['given','received','counterpartyCharacter','counterpartyPlayer']);
    const keys = Object.keys(trade);
    if(!keys.length){
      pushSchemaIssue(issues,{
        code:'invalid_trade_shape',
        message:'trade must include at least one field.',
        path,
        charKey,
        adventureIndex,
        field:'trade'
      });
      return;
    }
    keys.forEach((key)=>{
      const keyPath = `${path}.${key}`;
      if(!allowedKeys.has(key)){
        pushSchemaIssue(issues,{
          code:'invalid_trade_field',
          message:`trade field "${key}" is not allowed.`,
          path:keyPath,
          charKey,
          adventureIndex,
          field:'trade'
        });
        return;
      }
      if(typeof trade[key] !== 'string' || !trade[key].trim()){
        pushSchemaIssue(issues,{
          code:'invalid_trade_shape',
          message:'trade values must be non-empty strings.',
          path:keyPath,
          charKey,
          adventureIndex,
          field:'trade'
        });
      }
    });
  }

  function validateInventoryStateShape(inventoryState,issues,{ path, charKey=null }){
    if(inventoryState == null){
      return;
    }
    if(!isPlainObject(inventoryState)){
      pushSchemaIssue(issues,{
        code:'invalid_inventory_state',
        message:'inventory_state must be an object when present.',
        path,
        charKey,
        field:'inventory_state'
      });
      return;
    }
    const activeOk = validateStringArray(inventoryState.active,issues,{
      path:`${path}.active`,
      code:'invalid_inventory_state',
      message:'inventory_state.active must be an array of strings.',
      charKey,
      field:'inventory_state.active'
    });
    const attunedOk = validateStringArray(inventoryState.attuned,issues,{
      path:`${path}.attuned`,
      code:'invalid_inventory_state',
      message:'inventory_state.attuned must be an array of strings.',
      charKey,
      field:'inventory_state.attuned'
    });
    validateStringArray(inventoryState.common,issues,{
      path:`${path}.common`,
      code:'invalid_inventory_state',
      message:'inventory_state.common must be an array of strings.',
      charKey,
      field:'inventory_state.common'
    });
    if(attunedOk && inventoryState.attuned.length > 3){
      pushSchemaIssue(issues,{
        code:'invalid_inventory_state',
        message:'inventory_state.attuned cannot contain more than 3 items.',
        path:`${path}.attuned`,
        charKey,
        field:'inventory_state.attuned'
      });
    }
    if(activeOk && attunedOk){
      const active = new Set(inventoryState.active.map(item => item.toLowerCase()));
      inventoryState.attuned.forEach((item,itemIndex)=>{
        if(!active.has(item.toLowerCase())){
          pushSchemaIssue(issues,{
            code:'invalid_inventory_state',
            message:'inventory_state.attuned items must also exist in inventory_state.active.',
            path:`${path}.attuned[${itemIndex}]`,
            charKey,
            field:'inventory_state.attuned'
          });
        }
      });
    }
  }

  function validateNormalizedData(data){
    const issues = [];
    if(!isPlainObject(data)){
      pushSchemaIssue(issues,{
        code:'invalid_data',
        message:'Data must be an object.',
        path:''
      });
      return { issues };
    }
    if(!isPlainObject(data.characters)){
      pushSchemaIssue(issues,{
        code:'invalid_characters_object',
        message:'characters must be an object keyed by character id.',
        path:'characters',
        field:'characters'
      });
      return { issues };
    }

    Object.entries(data.characters).forEach(([charKey,character])=>{
      const charPath = `characters.${charKey}`;
      if(!isPlainObject(character)){
        pushSchemaIssue(issues,{
          code:'invalid_character',
          message:'Character payload must be an object.',
          path:charPath,
          charKey
        });
        return;
      }
      if(!Array.isArray(character.adventures)){
        pushSchemaIssue(issues,{
          code:'invalid_adventures_array',
          message:'Character adventures must be an array.',
          path:`${charPath}.adventures`,
          charKey,
          field:'adventures'
        });
        return;
      }
      validateInventoryStateShape(character.inventory_state,issues,{
        path:`${charPath}.inventory_state`,
        charKey
      });
      character.adventures.forEach((adventure,adventureIndex)=>{
        const advPath = `${charPath}.adventures[${adventureIndex}]`;
        if(!isPlainObject(adventure)){
          pushSchemaIssue(issues,{
            code:'invalid_adventure',
            message:'Adventure payload must be an object.',
            path:advPath,
            charKey,
            adventureIndex
          });
          return;
        }
        const requiredFields = [
          'title','date','kind','gp_plus','gp_minus','gp_net','dtd_plus','dtd_minus','dtd_net',
          'level_plus','perm_items','lost_perm_item','consumable_items','supernatural_gifts','story_awards','notes'
        ];
        requiredFields.forEach((field)=>{
          if(!Object.prototype.hasOwnProperty.call(adventure,field)){
            pushSchemaIssue(issues,{
              code:'missing_required_field',
              message:`Adventure missing required field "${field}".`,
              path:`${advPath}.${field}`,
              charKey,
              adventureIndex,
              field
            });
          }
        });

        if(typeof adventure.title !== 'string' || !adventure.title.trim()){
          pushSchemaIssue(issues,{
            code:'invalid_title',
            message:'Adventure title must be a non-empty string.',
            path:`${advPath}.title`,
            charKey,
            adventureIndex,
            field:'title'
          });
        }
        if(typeof adventure.date !== 'string' || !isValidIsoDateText(adventure.date)){
          pushSchemaIssue(issues,{
            code:'invalid_iso_date',
            message:'Adventure date must be an ISO date string (YYYY-MM-DD).',
            path:`${advPath}.date`,
            charKey,
            adventureIndex,
            field:'date'
          });
        }
        if(typeof adventure.kind !== 'string' || !ALLOWED_KINDS.has(adventure.kind)){
          pushSchemaIssue(issues,{
            code:'invalid_kind',
            message:'Adventure kind must be one of: adventure, Downtime Activity.',
            path:`${advPath}.kind`,
            charKey,
            adventureIndex,
            field:'kind'
          });
        }

        ['gp_plus','gp_minus','gp_net','dtd_plus','dtd_minus','dtd_net','level_plus'].forEach((field)=>{
          const value = adventure[field];
          if(typeof value !== 'number' || !Number.isFinite(value)){
            pushSchemaIssue(issues,{
              code:'invalid_number',
              message:`Adventure field "${field}" must be a finite number.`,
              path:`${advPath}.${field}`,
              charKey,
              adventureIndex,
              field
            });
          }
        });

        validateStringArray(adventure.perm_items,issues,{
          path:`${advPath}.perm_items`,
          code:'invalid_item_array',
          message:'perm_items must be an array of strings.',
          charKey,
          adventureIndex,
          field:'perm_items'
        });
        validateStringArray(adventure.lost_perm_item,issues,{
          path:`${advPath}.lost_perm_item`,
          code:'invalid_item_array',
          message:'lost_perm_item must be an array of strings.',
          charKey,
          adventureIndex,
          field:'lost_perm_item'
        });
        validateStringArray(adventure.consumable_items,issues,{
          path:`${advPath}.consumable_items`,
          code:'invalid_item_array',
          message:'consumable_items must be an array of strings.',
          charKey,
          adventureIndex,
          field:'consumable_items'
        });
        validateStringArray(adventure.supernatural_gifts,issues,{
          path:`${advPath}.supernatural_gifts`,
          code:'invalid_item_array',
          message:'supernatural_gifts must be an array of strings.',
          charKey,
          adventureIndex,
          field:'supernatural_gifts'
        });
        validateStringArray(adventure.story_awards,issues,{
          path:`${advPath}.story_awards`,
          code:'invalid_item_array',
          message:'story_awards must be an array of strings.',
          charKey,
          adventureIndex,
          field:'story_awards'
        });

        if(typeof adventure.notes !== 'string'){
          pushSchemaIssue(issues,{
            code:'invalid_notes',
            message:'Adventure notes must be a string.',
            path:`${advPath}.notes`,
            charKey,
            adventureIndex,
            field:'notes'
          });
        }
        if(adventure.code != null && typeof adventure.code !== 'string'){
          pushSchemaIssue(issues,{
            code:'invalid_code',
            message:'Adventure code must be a string when present.',
            path:`${advPath}.code`,
            charKey,
            adventureIndex,
            field:'code'
          });
        }
        if(adventure.dm != null && typeof adventure.dm !== 'string'){
          pushSchemaIssue(issues,{
            code:'invalid_dm',
            message:'Adventure dm must be a string when present.',
            path:`${advPath}.dm`,
            charKey,
            adventureIndex,
            field:'dm'
          });
        }
        validateTradeShape(adventure.trade,issues,{
          path:`${advPath}.trade`,
          charKey,
          adventureIndex
        });
      });
    });

    return { issues };
  }

  function tokenize(value){
    if(value == null) return [];
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    const stripped = text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-zA-Z0-9+]+/g,' ')
      .toLowerCase();
    return stripped
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length>0);
  }

  function buildAdventureSearchText(adv,charKey,{ includeCharacterInfo=false, character=null }={}){
    if(!adv || typeof adv !== 'object') return '';
    const tokens = new Set();
    const pushTokens = (value)=>{
      tokenize(value).forEach(token => tokens.add(token));
    };
    pushTokens(adv.title);
    pushTokens(adv.code);
    pushTokens(adv.notes);
    pushTokens(adv.dm);
    if(adv.trade && typeof adv.trade === 'object'){
      pushTokens(adv.trade.given);
      pushTokens(adv.trade.received);
      pushTokens(adv.trade.counterpartyCharacter);
      pushTokens(adv.trade.counterpartyPlayer);
    }
    pushTokens(adv.lost_perm_item);
    pushTokens(adv.perm_items);
    pushTokens(adv.consumable_items);
    pushTokens(adv.supernatural_gifts);
    if(includeCharacterInfo){
      const charObj = character || null;
      if(charObj){
        pushTokens(charObj.display_name);
        pushTokens(charObj.sheet);
      }
      pushTokens(charKey);
    }
    return Array.from(tokens).join(' ');
  }

  function prepareForSave(data){
    function scrub(value){
      if(Array.isArray(value)){
        return value.map(item => scrub(item)).filter(item => item !== undefined);
      }
      if(value && typeof value === 'object'){
        const out = {};
        Object.entries(value).forEach(([key,val])=>{
          if(key.startsWith('__')) return;
          const cleaned = scrub(val);
          if(cleaned !== undefined){
            out[key] = cleaned;
          }
        });
        return out;
      }
      return value;
    }
    return scrub(data);
  }

  function validateData(data){
    if(!data || typeof data !== 'object'){
      return { issues:[{ severity:'error', code:'invalid_data', message:'Data is empty.', path:'' }] };
    }
    try{
      const result = normalizeData(data);
      const schema = validateNormalizedData(result.data);
      return { issues: result.issues.concat(schema.issues || []) };
    }catch(err){
      return { issues:[{ severity:'error', code:'validation_failure', message: String(err) }] };
    }
  }

  const api = {
    normalizeData,
    normalizeTrade,
    parseAcquisitionName,
    parseItemList,
    buildAdventureInventoryOperation,
    stampCharacterChronology,
    buildAdventureSearchText,
    prepareForSave,
    validateData,
    validateNormalizedData
  };

  Object.defineProperty(api,'tokenize',{ value:tokenize, enumerable:true });

  if(GLOBAL_SCOPE){
    GLOBAL_SCOPE.AL_DATA_PIPELINE = api;
  }
  if(typeof module === 'object' && module && typeof module.exports === 'object'){
    module.exports = api;
  }
})(this);
