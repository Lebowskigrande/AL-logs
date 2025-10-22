(function(global){
  'use strict';

  const GLOBAL_SCOPE = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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

  function sanitizeInventoryListInput(value){
    const list = Array.isArray(value) ? value : (value == null ? [] : [value]);
    const seen = new Set();
    const out = [];
    list.forEach((item)=>{
      const text = coerceString(item,{ fallback:'' });
      if(!text) return;
      const lower = text.toLowerCase();
      if(seen.has(lower)) return;
      seen.add(lower);
      out.push(text);
    });
    return out;
  }

  function normalizeCarriedConsumables(raw){
    if(raw == null) return null;
    const list = Array.isArray(raw) ? raw : [raw];
    const cleaned = list
      .map(item => coerceString(item, { fallback:'' }))
      .map(item => item.trim())
      .filter(item => item.length>0);
    if(!cleaned.length){
      return null;
    }
    return cleaned;
  }

  function normalizeInventoryState(raw){
    if(!raw || typeof raw !== 'object') return null;
    const hasKeys = ['active','attuned','common'].some((key)=>Object.prototype.hasOwnProperty.call(raw,key));
    const active = sanitizeInventoryListInput(raw.active);
    const common = sanitizeInventoryListInput(raw.common);
    const attunedList = sanitizeInventoryListInput(raw.attuned);
    const activeLower = new Set(active.map(name=>name.toLowerCase()));
    const attuned = attunedList.filter(name=>activeLower.has(name.toLowerCase())).slice(0,3);
    if(!hasKeys && !active.length && !attuned.length && !common.length){
      return null;
    }
    return { active, attuned, common };
  }

  function normalizeSupernaturalActive(raw){
    if(!raw || typeof raw !== 'object') return null;
    const hasKeys = ['blessing','boon'].some((key)=>Object.prototype.hasOwnProperty.call(raw,key));
    const blessing = coerceString(raw.blessing,{ fallback:'' });
    const boon = coerceString(raw.boon,{ fallback:'' });
    if(!hasKeys && !blessing && !boon){
      return null;
    }
    return { blessing, boon };
  }

function coerceNumber(value,{ fallback=0, allowNull=false }={}, issues, context){
  const { path='', charKey=null, adventureId=null, adventureIndex=null, field=null } = context || {};
    if(value == null || value === ''){
      return allowNull ? null : fallback;
    }
    if(typeof value === 'number' && Number.isFinite(value)){
      return value;
    }
    const text = String(value).trim();
    if(!text){
      return allowNull ? null : fallback;
    }
    const cleaned = text
      .replace(/,/g,'')
      .replace(/gp/ig,'')
      .replace(/dtd/ig,'')
      .replace(/[^0-9.+\-]/g,' ');
    const match = cleaned.match(/[-+]?\d+(?:\.\d+)?/);
    if(!match){
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
    const num = Number(match[0]);
    if(!Number.isFinite(num)){
      if(issues){
        pushIssue(issues,{
          severity:'error',
          code:'invalid_number',
          message:`Numeric value for ${field || path || 'field'} is not finite.`,
          path,
          charKey,
          adventureId,
          adventureIndex,
          field
        });
      }
      return allowNull ? null : fallback;
    }
    return num;
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
    adv.gp_net = adv.gp_plus - adv.gp_minus;

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
    adv.dtd_net = adv.dtd_plus - adv.dtd_minus;

    adv.level_plus = coerceNumber(raw && raw.level_plus,{ fallback:0 }, issues,{
      path:`${pathBase}.level_plus`,
      charKey,
      adventureId,
      adventureIndex:index,
      field:'level_plus'
    });

    adv.perm_items = splitListInput(raw && raw.perm_items);
    adv.lost_perm_item = splitListInput(raw && raw.lost_perm_item);
    adv.consumable_items = splitListInput(raw && raw.consumable_items);
    adv.supernatural_gifts = splitListInput(raw && raw.supernatural_gifts);
    adv.story_awards = splitListInput(raw && raw.story_awards);

    adv.notes = coerceMultiline(raw && raw.notes);

    if(adv.kind !== 'adventure'){
      const trade = normalizeTrade(raw,{ isDowntime: true });
      if(trade){
        adv.trade = trade;
      }
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

    const inventoryState = normalizeInventoryState(raw && raw.inventory_state);
    if(inventoryState){
      out.inventory_state = inventoryState;
    }

    const carriedConsumables = normalizeCarriedConsumables(raw && raw.carried_consumables);
    if(carriedConsumables){
      out.carried_consumables = carriedConsumables;
    }

    const supernaturalActive = normalizeSupernaturalActive(raw && raw.supernatural_active);
    if(supernaturalActive){
      out.supernatural_active = supernaturalActive;
    }

    if(raw && typeof raw === 'object'){
      const passthrough = ['consumables','consumable_uses','tags','portrait','pronouns'];
      passthrough.forEach((key)=>{
        if(Object.prototype.hasOwnProperty.call(raw,key)){
          out[key] = raw[key];
        }
      });
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
      const revision = coerceString(raw.revision,{ fallback:'' });
      if(revision){
        meta.revision = revision;
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
        message:'No characters found in data.js payload.',
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

  function tokenize(value){
    if(value == null) return [];
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    const stripped = text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-zA-Z0-9]+/g,' ')
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
    }else{
      pushTokens(adv.traded_item);
      pushTokens(adv.itemTraded);
      pushTokens(adv.itemReceived);
      pushTokens(adv.player);
      pushTokens(adv.character);
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
          if(key === 'gp_net' || key === 'dtd_net'){ return; }
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
      return { issues:[{ severity:'error', code:'invalid_data', message:'Data is empty.' }] };
    }
    try{
      const clone = JSON.parse(JSON.stringify(data));
      const result = normalizeData(clone);
      return { issues: result.issues };
    }catch(err){
      return { issues:[{ severity:'error', code:'validation_failure', message: String(err) }] };
    }
  }

  const api = {
    normalizeData,
    buildAdventureSearchText,
    prepareForSave,
    validateData
  };

  Object.defineProperty(api,'tokenize',{ value:tokenize, enumerable:true });

  if(GLOBAL_SCOPE){
    GLOBAL_SCOPE.AL_DATA_PIPELINE = api;
  }
  if(typeof module === 'object' && module && typeof module.exports === 'object'){
    module.exports = api;
  }
})(this);
