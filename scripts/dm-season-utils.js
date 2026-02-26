(function(global){
  'use strict';

  const GLOBAL_SCOPE = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);

  function dmNormalizeSeasonLabel(label){
    const text = (label == null ? '' : String(label)).trim();
    return text || 'Unlabeled season';
  }

  function normalizeSeasonGroup(label){
    const text = (label == null ? '' : String(label)).trim().toLowerCase();
    if(!text) return '';
    if(text.startsWith('seasonal')) return 'seasonal';
    const seasonMatch = text.match(/^season\s*(\d+)([a-z])?/);
    if(seasonMatch){
      return `season-${seasonMatch[1]}`;
    }
    const anniversaryMatch = text.match(/(\d{1,3})(st|nd|rd|th)\s+anniversary\s+season/);
    if(anniversaryMatch){
      return `${anniversaryMatch[1]}th-anniversary-season`;
    }
    return text;
  }

  function extractSeasonLabel(text){
    if(!text) return '';
    const value = String(text);
    const anniversary = value.match(/(\d{1,3})(st|nd|rd|th)\s+Anniversary\s+Season\s+([A-Za-z])/i);
    if(anniversary){
      const ordinal = `${anniversary[1]}${anniversary[2]}`;
      const seasonLetter = anniversary[3].toUpperCase();
      return `${ordinal} Anniversary Season ${seasonLetter}`;
    }
    const seasonal = value.match(/Seasonal\s*\(([^)]+)\)/i);
    if(seasonal){
      return `Seasonal (${seasonal[1].trim()})`;
    }
    const detailed = value.match(/Season\s*(\d+)\s*([A-Za-z])?/i);
    if(detailed){
      const seasonNumber = detailed[1];
      const letter = (detailed[2] || '').trim();
      if(letter){
        return `Season ${seasonNumber}${letter.toLowerCase()}`;
      }
      return `Season ${seasonNumber}`;
    }
    return '';
  }

  function inferSeasonFromReward(adv){
    if(!adv || typeof adv !== 'object') return '';
    const direct = extractSeasonLabel(adv.season);
    if(direct) return dmNormalizeSeasonLabel(direct);
    const fromTitle = extractSeasonLabel(adv.title);
    if(fromTitle) return dmNormalizeSeasonLabel(fromTitle);
    const fromNotes = extractSeasonLabel(adv.notes);
    if(fromNotes) return dmNormalizeSeasonLabel(fromNotes);
    return '';
  }

  function dmToNullableNumber(value){
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function dmToNumber(value){
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function dmTimestamp(value){
    if(!value) return Number.NEGATIVE_INFINITY;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  }

  function dmDateCountsTowardHoursPool(date,startTimestamp){
    const ts = dmTimestamp(date);
    const threshold = Number.isFinite(startTimestamp) ? startTimestamp : Number.NEGATIVE_INFINITY;
    return ts >= threshold;
  }

  function parseSeasonNumber(label){
    if(!label) return null;
    const match = String(label).match(/season\s*(\d+)/i);
    if(!match) return null;
    const num = Number(match[1]);
    return Number.isFinite(num) ? num : null;
  }

  function escapeRegExp(str){
    const re = /[.*+?^${}()|[\]\\]/g;
    return String(str).replace(re,'\\$&');
  }

  function allocationSeasonEligibleForLevelAccrual(seasonLabel){
    if(!seasonLabel) return true;
    const normalized = String(seasonLabel).toLowerCase();
    if(normalized.includes('pre-season 11') || normalized.includes('pre season 11')){
      return false;
    }
    const seasonNumber = parseSeasonNumber(seasonLabel);
    if(seasonNumber == null) return true;
    return seasonNumber >= 11;
  }

  function isLevelOnlyAllocation(allocationText,parsed,{ interpretAllocationDetails }={}){
    const detail = parsed || (typeof interpretAllocationDetails === 'function' ? interpretAllocationDetails(allocationText) : null);
    if(!detail || detail.levelsSpent == null || !Number.isFinite(detail.levelsSpent) || detail.levelsSpent <= 0){
      return false;
    }
    if(detail.itemTokens && detail.itemTokens.length){
      return false;
    }
    if(detail.downtimeSpent != null && detail.downtimeSpent > 0){
      return false;
    }
    if(detail.goldSpent != null && detail.goldSpent > 0){
      return false;
    }
    let working = String(allocationText || '').toLowerCase();
    if(!working.trim()) return false;
    if(Array.isArray(detail.recipients)){
      detail.recipients.forEach((name)=>{
        if(!name) return;
        const lowered = String(name).toLowerCase().trim();
        if(!lowered) return;
        const pattern = new RegExp(escapeRegExp(lowered),'g');
        working = working.replace(pattern,' ');
      });
    }
    working = working.replace(/\b\d+\s*(?:levels?|lvl)\b/g,' ');
    working = working.replace(/\blevels?\b/g,' ');
    working = working.replace(/\bplayer\b/g,' ');
    working = working.replace(/\brewards?\b/g,' ');
    working = working.replace(/\band\b/g,' ');
    working = working.replace(/\bbonus\b/g,' ');
    working = working.replace(/\bto\b/g,' ');
    working = working.replace(/[+,&:()]/g,' ');
    working = working.replace(/\s+/g,' ').trim();
    return !working;
  }

  function allocationHasNonLevelReward(allocationText,parsed,{ interpretAllocationDetails }={}){
    const detail = parsed || (typeof interpretAllocationDetails === 'function' ? interpretAllocationDetails(allocationText) : null);
    if(!detail) return false;
    if(detail.downtimeSpent != null && detail.downtimeSpent > 0){
      return true;
    }
    if(detail.goldSpent != null && detail.goldSpent > 0){
      return true;
    }
    if(detail.itemTokens && detail.itemTokens.some(token => token && !/(?:loss|period|expire|expiration|forfeit|penalty)/i.test(token))){
      return true;
    }
    const raw = String(allocationText || '').toLowerCase();
    if(!raw.trim()) return false;
    if(/\b(loss|forfeit|expire|expiration|penalty)\b/.test(raw)){
      return false;
    }
    if(/\b(?:reward|item|potion|tattoo|wand|staff|amulet|boots|armor|shield|ring|stone|cloak|rod|scroll|saddle|quiver|caress|fiddle|maul|sword|bow|splint|mace|gem|guide|arrows|favor|rescue|saddle|boots|gloves|cowl|blade|tome|pen|shawl|sling|cloak)\b/.test(raw)){
      return true;
    }
    if(raw.includes('+')){
      return true;
    }
    return false;
  }

  function allocationGrantsLevelToPool(seasonLabel,allocationText,parsed,{ interpretAllocationDetails }={}){
    if(!allocationSeasonEligibleForLevelAccrual(seasonLabel)){
      return false;
    }
    if(isLevelOnlyAllocation(allocationText,parsed,{ interpretAllocationDetails })){
      return false;
    }
    return allocationHasNonLevelReward(allocationText,parsed,{ interpretAllocationDetails });
  }

  const api = {
    dmNormalizeSeasonLabel,
    normalizeSeasonGroup,
    extractSeasonLabel,
    inferSeasonFromReward,
    dmToNullableNumber,
    dmToNumber,
    dmTimestamp,
    dmDateCountsTowardHoursPool,
    parseSeasonNumber,
    escapeRegExp,
    allocationSeasonEligibleForLevelAccrual,
    isLevelOnlyAllocation,
    allocationHasNonLevelReward,
    allocationGrantsLevelToPool
  };

  if(GLOBAL_SCOPE){
    GLOBAL_SCOPE.AL_DM_SEASON_UTILS = api;
  }
  if(typeof module === 'object' && module && typeof module.exports === 'object'){
    module.exports = api;
  }
})(this);
