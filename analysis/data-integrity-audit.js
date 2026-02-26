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

function summarizeByCode(issues){
  const counts = {};
  (issues || []).forEach((issue)=>{
    const code = (issue && issue.code) || 'unknown';
    counts[code] = (counts[code] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a,b)=>b[1]-a[1])
    .map(([code,count])=>({ code, count }));
}

function summarizeBySeverity(issues){
  const counts = {};
  (issues || []).forEach((issue)=>{
    const severity = (issue && issue.severity) || 'unknown';
    counts[severity] = (counts[severity] || 0) + 1;
  });
  return counts;
}

function topExamples(issues,code,limit=25){
  return (issues || [])
    .filter((issue)=>issue && issue.code === code)
    .slice(0,limit)
    .map((issue)=>({
      severity: issue.severity || 'warning',
      code: issue.code || '',
      message: issue.message || '',
      charKey: issue.charKey || null,
      adventureIndex: Number.isFinite(issue.adventureIndex) ? issue.adventureIndex : null,
      path: issue.path || ''
    }));
}

function runAudit(targetPath){
  const absPath = path.resolve(process.cwd(), targetPath);
  const raw = loadDataModule(absPath);
  const normalizedResult = pipeline.normalizeData(raw);
  const normalized = normalizedResult.data;
  const normalizedSchema = pipeline.validateNormalizedData(normalized);
  const integrity = pipeline.validateItemEventIntegrity(normalized, { severity: 'warning' });
  const allIssues = []
    .concat(normalizedResult.issues || [])
    .concat(normalizedSchema.issues || [])
    .concat(integrity.issues || []);

  return {
    generatedAt: new Date().toISOString(),
    source: targetPath,
    totals: {
      allIssues: allIssues.length,
      normalizeIssues: (normalizedResult.issues || []).length,
      schemaIssues: (normalizedSchema.issues || []).length,
      integrityIssues: (integrity.issues || []).length
    },
    severity: summarizeBySeverity(allIssues),
    byCode: summarizeByCode(allIssues),
    examples: {
      missing_acquisition_path: topExamples(allIssues,'missing_acquisition_path',20),
      trade_reciprocity_unmatched: topExamples(allIssues,'trade_reciprocity_unmatched',20)
    }
  };
}

function main(){
  const [, , target='data/data.js', out='analysis/data-integrity-report.json'] = process.argv;
  const report = runAudit(target);
  const outPath = path.resolve(process.cwd(), out);
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${out}`);
  console.log(`Total issues: ${report.totals.allIssues}`);
}

if(require.main === module){
  try{
    main();
  }catch(err){
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
