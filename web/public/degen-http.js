export async function degenPost(request,signal){
  const response=await fetch('/api/degen/read',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(request),signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
  if(!response.ok){const error=Error(response.status===429?'Waiting for data':'Source unavailable');if(response.status===429){const seconds=Number(response.headers.get('Retry-After'));error.retryAfterMs=Number.isFinite(seconds)&&seconds>0?Math.max(1000,Math.min(300000,seconds*1000)):60000;}throw error;}
  const raw=await response.text();if(raw.length>1500000)throw Error('Source too large');return JSON.parse(raw);
}
