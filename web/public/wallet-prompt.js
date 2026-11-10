const activeProviders=new WeakSet();

// Share across authentication and private spending, including separate sessions.
// Call release only after the underlying wallet request settles; UI cancellation
// does not close a wallet's approval prompt.
export function acquireWalletPrompt(provider){
  if(activeProviders.has(provider))throw Error('A wallet prompt is still open. Finish it in your wallet.');
  activeProviders.add(provider);let released=false;
  return ()=>{if(!released){released=true;activeProviders.delete(provider);}};
}
