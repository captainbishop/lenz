// Convert the pinned library's embedded worker to a same-origin file, without eval.
export function externalizeProofWorker(source) {
  const pattern=/const threadSource = stringToBase64\("\(" \+ ("function thread\(self\)[^\n]+") \+ "\)\(self\)"\);\r?\nconst workerSource = "data:application\/javascript;base64," \+ threadSource;/g;
  const matches=[...source.matchAll(pattern)];
  if(matches.length!==1)throw Error('Pinned ffjavascript worker layout changed; review the browser build');
  const worker='('+JSON.parse(matches[0][1])+')(self);\n';
  return {source:source.replace(pattern,"const workerSource = new URL('./ffjavascript-worker.js', import.meta.url);"),worker};
}
