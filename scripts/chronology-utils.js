(function(global){
  'use strict';

  const GLOBAL_SCOPE = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);
  const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
  let pacificDateFormatter = null;

  function fmtDate(value){
    if(!value) return '—';
    const text = String(value).trim();
    if(!text) return '—';
    let dateObj = null;
    const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(dateOnlyMatch){
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]);
      const day = Number(dateOnlyMatch[3]);
      if(Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)){
        dateObj = new Date(Date.UTC(year, month - 1, day));
      }
    }
    if(!dateObj){
      dateObj = new Date(text);
    }
    if(Number.isNaN(dateObj.getTime())){
      return String(value);
    }
    return dateObj.toLocaleDateString(undefined,{ year:'numeric', month:'short', day:'numeric' });
  }

  function getPacificDateFormatter(){
    if(pacificDateFormatter) return pacificDateFormatter;
    if(typeof Intl !== 'object' || typeof Intl.DateTimeFormat !== 'function') return null;
    try{
      pacificDateFormatter = new Intl.DateTimeFormat('en-US',{
        timeZone:PACIFIC_TIME_ZONE,
        year:'numeric',
        month:'2-digit',
        day:'2-digit',
        hour:'2-digit',
        minute:'2-digit',
        second:'2-digit',
        hour12:false
      });
    }catch(err){
      pacificDateFormatter = null;
    }
    return pacificDateFormatter;
  }

  function parseYmdString(value){
    if(!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if(!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if(month < 1 || month > 12) return null;
    if(day < 1 || day > 31) return null;
    return { year, month, day };
  }

  function resolvePacificOffsetHours(parts){
    const formatter = getPacificDateFormatter();
    if(!formatter) return null;
    const approx = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
    if(Number.isNaN(approx.getTime())) return null;
    const formattedParts = {};
    formatter.formatToParts(approx).forEach((part)=>{
      if(part && part.type && part.type !== 'literal'){
        formattedParts[part.type] = part.value;
      }
    });
    const fYear = Number(formattedParts.year);
    const fMonth = Number(formattedParts.month);
    const fDay = Number(formattedParts.day);
    const fHour = Number(formattedParts.hour);
    const fMinute = Number(formattedParts.minute);
    const fSecond = Number(formattedParts.second);
    if([fYear,fMonth,fDay,fHour,fMinute,fSecond].some(num => !Number.isFinite(num))){
      return null;
    }
    const pacificUtc = Date.UTC(fYear, fMonth - 1, fDay, fHour, fMinute, fSecond);
    const offsetMs = pacificUtc - approx.getTime();
    return offsetMs / 3600000;
  }

  function pacificBaseTimestamp(dayKey,{ baseHour = 9 } = {}){
    const parts = parseYmdString(dayKey);
    if(!parts) return NaN;
    const offsetHours = resolvePacificOffsetHours(parts);
    const baseUtc = Date.UTC(parts.year, parts.month - 1, parts.day, baseHour, 0, 0);
    if(Number.isFinite(offsetHours)){
      return baseUtc - (offsetHours * 3600000);
    }
    return baseUtc;
  }

  function gatherSameDayTimes(collection,dayKey,exclude){
    const times = [];
    if(!Array.isArray(collection) || !dayKey) return times;
    collection.forEach((item)=>{
      if(!item || item === exclude) return;
      const raw = item.date;
      if(!raw) return;
      const prefix = String(raw).slice(0,10);
      if(prefix !== dayKey) return;
      const ts = new Date(raw).getTime();
      if(Number.isFinite(ts)) times.push(ts);
    });
    return times;
  }

  function computeChronologicalDate(rawDate,{ collection = null, exclude = null, wasNew = false, currentValue = null, baseHour = 9, stepHours = 1 } = {}){
    const normalized = String(rawDate || '').trim();
    if(!normalized) return '';
    if(normalized.includes('T')) return normalized;
    const dayKey = normalized.slice(0,10);
    const baseMs = pacificBaseTimestamp(dayKey,{ baseHour });
    if(!Number.isFinite(baseMs)) return normalized;
    if(!wasNew){
      const currentStr = String(currentValue || '').trim();
      if(currentStr && currentStr.includes('T') && currentStr.slice(0,10) === dayKey){
        const currentTs = new Date(currentStr).getTime();
        if(Number.isFinite(currentTs)){
          return new Date(currentTs).toISOString();
        }
      }
    }
    const existingTimes = gatherSameDayTimes(collection, dayKey, exclude);
    if(existingTimes.length){
      const maxExisting = Math.max(...existingTimes);
      if(Number.isFinite(maxExisting) && maxExisting >= baseMs){
        const stepMs = Math.max(1, Number(stepHours || 1)) * 3600000;
        const assigned = Math.max(baseMs, maxExisting + stepMs);
        return new Date(assigned).toISOString();
      }
    }
    return new Date(baseMs).toISOString();
  }

  const api = {
    fmtDate,
    parseYmdString,
    resolvePacificOffsetHours,
    pacificBaseTimestamp,
    gatherSameDayTimes,
    computeChronologicalDate
  };

  if(GLOBAL_SCOPE){
    GLOBAL_SCOPE.AL_CHRONOLOGY_UTILS = api;
  }
  if(typeof module === 'object' && module && typeof module.exports === 'object'){
    module.exports = api;
  }
})(this);
