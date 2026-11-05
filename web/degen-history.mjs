import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {checkedCandles,degenRequest} from './public/degen-model.js';
const key=request=>createHash('sha256').update(JSON.stringify(degenRequest(request))).digest('hex');
export class CandleHistory{
  constructor(directory,{limit=200,clock=Date.now}={}){mkdirSync(directory,{recursive:true});this.clock=clock;this.limit=limit;this.db=new DatabaseSync(resolve(directory,'candles.sqlite'));this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS candles (id TEXT PRIMARY KEY, observed INTEGER NOT NULL, body TEXT NOT NULL)');}
  get(request){const row=this.db.prepare('SELECT body FROM candles WHERE id=?').get(key(request));if(!row||row.body.length>250000)return null;try{return checkedCandles(JSON.parse(row.body),request,{now:this.clock(),saved:true});}catch{return null;}}
  put(value){const data=checkedCandles(value,value.request,{now:this.clock()}),body=JSON.stringify(data);if(body.length>250000)throw Error('Candle history too large');this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO candles VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET observed=excluded.observed,body=excluded.body WHERE excluded.observed>=candles.observed').run(key(data.request),data.observedAt,body);this.db.prepare('DELETE FROM candles WHERE id IN (SELECT id FROM candles ORDER BY observed DESC LIMIT -1 OFFSET ?)').run(this.limit);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
}
let store;
export const candleHistory={get(request){return (store??=new CandleHistory(resolve('.market-data'))).get(request);},put(value){(store??=new CandleHistory(resolve('.market-data'))).put(value);}};
