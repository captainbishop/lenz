import {isAbsolute,relative,resolve,sep} from 'node:path';

export function outsideRepository(repository,path){
 if(typeof path!=='string'||path.length===0)return false;
 const location=relative(resolve(repository),resolve(path));
 return location==='..'||location.startsWith('..'+sep)||isAbsolute(location);
}
