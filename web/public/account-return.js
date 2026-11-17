export function accountReturnTarget(search){
 const params=new URLSearchParams(search);
 if(params.get('next')!=='wallet')return '/chat.html';
 return params.get('funding')==='private'?'/money.html?funding=private':'/money.html';
}

export function consumePrivateFundingReturn(){
 const url=new URL(location.href);
 if(url.searchParams.get('funding')!=='private')return false;
 url.searchParams.delete('funding');
 history.replaceState(history.state,'',url.pathname+url.search+url.hash);
 return true;
}
