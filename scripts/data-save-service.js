(function(global){
  'use strict';

  const GLOBAL_SCOPE = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);

  function safeClone(value){
    try{
      return JSON.parse(JSON.stringify(value));
    }catch(err){
      return value;
    }
  }

  function resolveSerializableData(data,pipeline){
    const sourceData = data;
    if(pipeline){
      const canNormalize = typeof pipeline.normalizeData === 'function';
      const canPrepare = typeof pipeline.prepareForSave === 'function';
      if(canNormalize){
        try{
          const snapshot = safeClone(sourceData);
          const result = pipeline.normalizeData(snapshot) || {};
          if(result && result.data){
            return canPrepare ? pipeline.prepareForSave(result.data) : result.data;
          }
        }catch(err){
          /* fall through to next path */
        }
      }
      if(canPrepare){
        try{
          return pipeline.prepareForSave(sourceData);
        }catch(err){
          /* fall through to clone */
        }
      }
    }
    return safeClone(sourceData);
  }

  function buildDataJsPayload(data,pipeline){
    const serializable = resolveSerializableData(data,pipeline);
    return 'window.DATA = ' + JSON.stringify(serializable, null, 2) + ';';
  }

  function touchDataMetaTimestamp(data){
    if(!data || typeof data !== 'object') return;
    const meta = data.meta;
    if(meta && typeof meta === 'object'){
      try{
        meta.generated = new Date().toISOString();
      }catch(err){
        /* no-op */
      }
    }
  }

  const api = {
    resolveSerializableData,
    buildDataJsPayload,
    touchDataMetaTimestamp
  };

  if(GLOBAL_SCOPE){
    GLOBAL_SCOPE.AL_DATA_SAVE_SERVICE = api;
  }
  if(typeof module === 'object' && module && typeof module.exports === 'object'){
    module.exports = api;
  }
})(this);
