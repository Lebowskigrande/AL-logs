(function(global){
  'use strict';

  const GLOBAL_SCOPE = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);

  function normalizeDateString(value){
    if(!value) return '';
    const text = String(value);
    if(/^\d{4}-\d{2}-\d{2}/.test(text)){
      return text.slice(0,10);
    }
    const ts = new Date(text).getTime();
    if(Number.isFinite(ts)){
      return new Date(ts).toISOString().slice(0,10);
    }
    return '';
  }

  function normalizeMatchToken(value){
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
  }

  function extractAllocationRecipientDetails(text){
    const raw = String(text || '');
    if(!raw.trim()) return [];
    const lower = raw.toLowerCase();
    const firstToIdx = lower.indexOf(' to ');
    if(firstToIdx === -1) return [];
    const leadingSegment = raw.slice(0,firstToIdx);

    const extractLevelishNumber = (segment)=>{
      if(!segment) return null;
      const sourceText = String(segment);
      const regex = /([0-9]+)/g;
      let match;
      while((match = regex.exec(sourceText))){
        const num = Number(match[1]);
        if(!Number.isFinite(num)) continue;
        const after = sourceText.slice(match.index + match[0].length);
        const afterStripped = after.replace(/^\s+/,'');
        if(!afterStripped) return num;
        const nextChar = afterStripped[0];
        if(nextChar === ',' || nextChar === '.' || nextChar === ')' || nextChar === ']') return num;
        const lowered = afterStripped.toLowerCase();
        for(const prefix of ['level','levels','lvl','to']){
          if(lowered.startsWith(prefix)) return num;
        }
        if(nextChar && /[a-z]/i.test(nextChar)) continue;
        return num;
      }
      return null;
    };

    const firstCountHint = extractLevelishNumber(leadingSegment);
    let tail = raw.slice(firstToIdx + 4);
    tail = tail.replace(/[,.;]+$/,'');
    tail = tail.replace(/\band\b/gi,',');
    tail = tail.replace(/&/g,',');
    tail = tail.replace(/\//g,',');
    const extractNumber = (segment)=>extractLevelishNumber(segment);
    const results = [];
    tail.split(',').map(part => part.trim()).filter(Boolean).forEach((part,index)=>{
      if(!part) return;
      let working = part;
      let countHint = null;
      const innerToIdx = working.toLowerCase().lastIndexOf(' to ');
      if(innerToIdx !== -1){
        const beforeInner = working.slice(0,innerToIdx);
        const afterInner = working.slice(innerToIdx + 4).trim();
        if(afterInner) working = afterInner;
        const innerNumber = extractNumber(beforeInner);
        if(innerNumber != null) countHint = innerNumber;
      }
      const prefixMatch = working.match(/^([0-9]+)\s*(?:levels?|lvl)?\b/i);
      if(prefixMatch){
        countHint = Number(prefixMatch[1]);
        working = working.slice(prefixMatch[0].length).trim();
      }
      const multiplierMatch = working.match(/\(x\s*([0-9]+)\s*\)/i);
      if(multiplierMatch){
        countHint = Number(multiplierMatch[1]);
        working = working.replace(multiplierMatch[0],'').trim();
      }
      const suffixMatch = working.match(/([0-9]+)\s*(?:levels?|lvl)\b/i);
      if(suffixMatch){
        countHint = Number(suffixMatch[1]);
        working = working.replace(suffixMatch[0],'').trim();
      }
      working = working.replace(/^[+&]+/,'').trim();
      if(!working) return;
      if(countHint == null && index === 0 && Number.isFinite(firstCountHint)){
        countHint = firstCountHint;
      }
      if(countHint == null) countHint = 1;
      results.push({ name: working, count: countHint });
    });
    return results;
  }

  function parseAllocationRecipients(text){
    return extractAllocationRecipientDetails(text).map(item => item.name).filter(Boolean);
  }

  function extractAllocationItemTokens(text){
    if(text && typeof text === 'object'){
      if(Array.isArray(text.allocation_item_tokens)){
        return text.allocation_item_tokens.slice();
      }
      text = text.allocation || '';
    }
    const raw = String(text || '');
    if(!raw) return [];
    const idx = raw.toLowerCase().lastIndexOf(' to ');
    const before = idx === -1 ? raw : raw.slice(0,idx);
    const candidates = before.split(/[+,&/]/).map(part => normalizeMatchToken(part));
    const tokens = new Set();
    candidates.forEach((token)=>{
      if(!token) return;
      if(token.length < 4) return;
      if(!/[a-z]/.test(token)) return;
      if(/^(?:level|levels|hours|extra|bonus|dtd|gp)$/.test(token)) return;
      if(/^\d/.test(token)) return;
      tokens.add(token);
    });
    return Array.from(tokens);
  }

  function interpretAllocationDetails(text){
    const raw = String(text || '');
    const recipientDetails = extractAllocationRecipientDetails(raw);
    const recipients = recipientDetails.map(item => item.name);
    const itemTokens = extractAllocationItemTokens(raw);
    const tokens = new Set();
    itemTokens.forEach((token)=>{
      if(token) tokens.add(`item:${token}`);
    });

    const addNumericToken = (prefix,value)=>{
      if(value == null) return;
      const rounded = value % 1 === 0 ? Math.trunc(value) : Number(value.toFixed(2));
      tokens.add(`${prefix}:${rounded}`);
    };

    const normalizeNumber = (value,kFlag)=>{
      if(value == null) return null;
      const cleaned = String(value).replace(/,/g,'');
      if(!cleaned) return null;
      const num = Number(cleaned);
      if(!Number.isFinite(num)) return null;
      return kFlag ? num * 1000 : num;
    };

    const detail = {
      recipients,
      itemTokens,
      tokens: null,
      levelsSpent: null,
      levelsGained: null,
      downtimeSpent: null,
      goldSpent: null
    };

    if(Array.isArray(recipients)){
      recipients.forEach((rec)=>{
        const normalized = normalizeMatchToken(rec);
        if(normalized) tokens.add(`recipient:${normalized}`);
      });
    }

    const explicitLevelMatches = [];
    raw.replace(/(?:^|[\s,+/&-])([0-9]+)\s*(?:levels?|lvl)\b/gi,(match,value)=>{
      const parsed = normalizeNumber(value,false);
      if(parsed != null) explicitLevelMatches.push(parsed);
      return match;
    });
    const explicitLevelTotal = explicitLevelMatches.reduce((sum,val)=>sum + val,0);
    const hasLevelKeyword = /\b(?:levels?|lvl)\b/i.test(raw);
    const levelAssignmentHint = /\blevels?\s+to\b/i.test(raw) || /\blvl\s+to\b/i.test(raw);
    const multiplierMatches = [];
    raw.replace(/\(x\s*([0-9]+)\s*\)/gi,(match,value)=>{
      const parsed = normalizeNumber(value,false);
      if(parsed != null) multiplierMatches.push(parsed);
      return match;
    });
    if(hasLevelKeyword && levelAssignmentHint){
      const levelsFromRecipients = recipientDetails.reduce((sum,item)=>{
        const value = Number(item && item.count);
        if(!Number.isFinite(value) || value <= 0) return sum;
        return sum + value;
      },0);
      if(levelsFromRecipients > 0){
        detail.levelsSpent = levelsFromRecipients;
      }else if(explicitLevelTotal > 0){
        detail.levelsSpent = explicitLevelTotal;
      }else if(multiplierMatches.length > 0){
        const multiplierTotal = multiplierMatches.reduce((sum,val)=>sum + val,0);
        if(multiplierTotal > 0){
          detail.levelsSpent = multiplierTotal;
        }
      }else if(recipientDetails.length > 0){
        detail.levelsSpent = recipientDetails.length;
      }else{
        detail.levelsSpent = 1;
      }
    }

    const dtdMatches = [];
    raw.replace(/([0-9][0-9,]*)(?:\s*(k))?\s*dtd\b/gi,(match,value,kFlag)=>{
      const parsed = normalizeNumber(value,kFlag);
      if(parsed != null) dtdMatches.push(parsed);
      return match;
    });
    if(dtdMatches.length > 0){
      const dtdTotal = dtdMatches.reduce((sum,val)=>sum + val,0);
      if(dtdTotal > 0) detail.downtimeSpent = dtdTotal;
    }

    const gpMatches = [];
    raw.replace(/([0-9][0-9,]*)(?:\s*(k))?\s*gp\b/gi,(match,value,kFlag)=>{
      const parsed = normalizeNumber(value,kFlag);
      if(parsed != null) gpMatches.push(parsed);
      return match;
    });
    if(gpMatches.length > 0){
      const gpTotal = gpMatches.reduce((sum,val)=>sum + val,0);
      if(gpTotal > 0) detail.goldSpent = gpTotal;
    }

    if(detail.levelsSpent != null) addNumericToken('levels',detail.levelsSpent);
    if(detail.downtimeSpent != null) addNumericToken('dtd',detail.downtimeSpent);
    if(detail.goldSpent != null) addNumericToken('gp',detail.goldSpent);

    detail.tokens = Array.from(tokens);
    return detail;
  }

  function extractContentTokens(values){
    const tokens = new Set();
    const stopWords = new Set(['and','the','for','with','from','into','onto','this','that','item','items','reward','rewards','entry','entries','log','card','cards','season','seasonal','dm','of','to','per','plus','minus','bonus','extra','cost','gp','hour','hours','level','levels','dtd','loss','spent','earned','player']);
    const addFromValue = (val)=>{
      if(val == null) return;
      if(Array.isArray(val)){
        val.forEach(addFromValue);
        return;
      }
      const text = String(val).toLowerCase();
      if(!text.trim()) return;
      text.split(/[^a-z0-9]+/).forEach((part)=>{
        const cleaned = part.trim();
        if(!cleaned) return;
        if(cleaned.length < 3) return;
        if(stopWords.has(cleaned)) return;
        const normalized = normalizeMatchToken(cleaned);
        if(!normalized) return;
        tokens.add(normalized);
      });
    };
    addFromValue(values);
    return Array.from(tokens);
  }

  function buildAllocationItemSeasonIndex(entries){
    const map = new Map();
    if(!Array.isArray(entries)) return map;
    entries.forEach((entry)=>{
      if(!entry || entry.type !== 'allocation') return;
      const season = entry.season || '';
      if(!season) return;
      extractAllocationItemTokens(entry).forEach((token)=>{
        if(!map.has(token)) map.set(token,new Set());
        map.get(token).add(season);
      });
    });
    return map;
  }

  const api = {
    normalizeDateString,
    normalizeMatchToken,
    extractAllocationRecipientDetails,
    parseAllocationRecipients,
    extractAllocationItemTokens,
    interpretAllocationDetails,
    extractContentTokens,
    buildAllocationItemSeasonIndex
  };

  if(GLOBAL_SCOPE){
    GLOBAL_SCOPE.AL_ALLOCATION_UTILS = api;
  }
  if(typeof module === 'object' && module && typeof module.exports === 'object'){
    module.exports = api;
  }
})(this);
