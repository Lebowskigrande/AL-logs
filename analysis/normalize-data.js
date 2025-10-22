#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pipeline = require('../data-pipeline');

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

function formatIssues(issues){
  if(!Array.isArray(issues) || !issues.length){
    return;
  }
  console.warn('Normalization completed with issues:');
  issues.forEach((issue)=>{
    if(!issue) return;
    const parts = [issue.severity || 'unknown', issue.code || ''];
    if(issue.message) parts.push(issue.message);
    if(issue.path) parts.push(`at ${issue.path}`);
    console.warn(' •', parts.filter(Boolean).join(' – '));
  });
}

function normalizeDataFile(targetPath){
  const absPath = path.resolve(process.cwd(), targetPath);
  const payload = loadDataModule(absPath);
  const { data, issues } = pipeline.normalizeData(payload);
  const clean = pipeline.prepareForSave(data);
  const output = 'window.DATA = ' + JSON.stringify(clean, null, 2) + ';\n';
  fs.writeFileSync(absPath, output);
  formatIssues(issues);
}

function main(){
  const [, , target = 'data.js'] = process.argv;
  normalizeDataFile(target);
}

if(require.main === module){
  try{
    main();
  }catch(err){
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
