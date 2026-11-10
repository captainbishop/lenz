import {assert,bytes,keysAre} from './peer-crypto.js';
import {checkConfidentialObservation} from './intents-status.js';

export const PRIVATE_REPORT='lenz/private-spend-report/v1';
export const PRIVATE_REPORT_ACK='lenz/private-spend-report-ack/v1';
export const PRIVATE_REPORT_RESERVE=20000;

export function checkPrivateReportPacket(packet,from,to){
 assert(bytes(packet).length<=8192&&packet.from===from&&packet.to===to,'Wrong private report direction or size.');
}
export function checkPrivateReport(review,id,value,{now=Date.now()}={}){
 assert(keysAre(value,['type','id','observation'])&&value.type===PRIVATE_REPORT&&value.id===id,'Private report belongs to another approval.');
 return checkConfidentialObservation(review,value.observation,{now});
}
export function checkPrivateReportAck(id,packetId,observedAt,value,now=Date.now()){
 assert(keysAre(value,['type','id','packetId','acceptedAt'])&&value.type===PRIVATE_REPORT_ACK&&value.id===id&&value.packetId===packetId&&Number.isSafeInteger(value.acceptedAt)&&value.acceptedAt>=observedAt-60000&&value.acceptedAt<=now+60000,'Invalid private report storage receipt.');
}
// The provider update time orders reports. Repeated reads of one unchanged
// update retain its original packet instead of filling the courier queue.
export function privateReportOrder(previous,next){
 if(!previous)return 1;
 const before=Date.parse(previous.updatedAt),after=Date.parse(next.updatedAt);
 if(after!==before)return after>before?1:-1;
 assert(Object.keys(previous).filter(key=>key!=='observedAt').every(key=>previous[key]===next[key]),'Conflicting private reports for the same provider update.');
 return 0;
}
