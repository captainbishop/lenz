import {HYPERLIQUID,checkedHyperliquidDomain} from './hyperliquid-environment.js';
const check=ok=>{if(!ok)throw Error('Invalid lending market data');};
const decimal=v=>typeof v==='string'&&/^(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,20})?$/.test(v)&&Number.isFinite(Number(v));
export function normalizeHyperLending(reserves,meta,observedAt=Date.now()){
 check(Array.isArray(reserves)&&reserves.length<=100&&Array.isArray(meta?.tokens)&&meta.tokens.length<=10000);
 const seen=new Set(),rows=reserves.map(entry=>{
  check(Array.isArray(entry)&&entry.length===2);const [index,v]=entry;
  check(Number.isSafeInteger(index)&&index>=0&&!seen.has(index));seen.add(index);
  const matches=meta.tokens.filter(t=>t.index===index);check(matches.length===1);const token=matches[0];
  check(typeof token.name==='string'&&/^[A-Za-z0-9._-]{1,40}$/.test(token.name));
  for(const k of ['borrowYearlyRate','supplyYearlyRate','balance','utilization','oraclePx','ltv','totalSupplied','totalBorrowed'])check(decimal(v?.[k]));
  check(Number(v.utilization)<=1&&Number(v.ltv)<=1&&Number(v.borrowYearlyRate)<=1000&&Number(v.supplyYearlyRate)<=1000&&Number(v.oraclePx)>0);
  return {id:'hyperlend:'+index,tokenIndex:index,symbol:token.name,supplyAPR:Number(v.supplyYearlyRate)*100,borrowAPR:Number(v.borrowYearlyRate)*100,availableLiquidity:v.balance,totalSupplied:v.totalSupplied,totalBorrowed:v.totalBorrowed,ltvBps:Math.round(Number(v.ltv)*10000),utilization:Number(v.utilization),price:v.oraclePx,executable:false};
 });return {version:2,environment:HYPERLIQUID.environment,chainId:HYPERLIQUID.chainId,provider:'hyperliquid',observedAt,rows,executable:false};
}
export function checkedHyperLending(value,now=Date.now()){
 checkedHyperliquidDomain(value);
 check(value?.version===2&&value.provider==='hyperliquid'&&value.executable===false&&Number.isSafeInteger(value.observedAt)&&value.observedAt>0&&value.observedAt<=now+5000&&Array.isArray(value.rows)&&value.rows.length<=100);
 const ids=new Set();for(const r of value.rows){check(Number.isSafeInteger(r.tokenIndex)&&r.tokenIndex>=0&&r.id==='hyperlend:'+r.tokenIndex&&!ids.has(r.id)&&r.executable===false&&typeof r.symbol==='string'&&/^[A-Za-z0-9._-]{1,40}$/.test(r.symbol));ids.add(r.id);
  for(const key of ['availableLiquidity','totalSupplied','totalBorrowed','price'])check(decimal(r[key]));
  for(const key of ['supplyAPR','borrowAPR'])check(typeof r[key]==='number'&&Number.isFinite(r[key])&&r[key]>=0&&r[key]<=100000);
  check(Number.isInteger(r.ltvBps)&&r.ltvBps>=0&&r.ltvBps<=10000&&Number.isFinite(r.utilization)&&r.utilization>=0&&r.utilization<=1);
 }return value;
}
