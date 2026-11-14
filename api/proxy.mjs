import {createHostedProxy} from '../web/hosted-proxy.mjs';
import {hostedIncomingPath} from '../web/hosted-policy.mjs';
let route;
export default async function handler(req,res){
 const path=hostedIncomingPath(req.url);
 if(path===null){res.statusCode=404;res.end();return;}
 req.url=path;
 route??=createHostedProxy({origin:process.env.LENZ_HOSTED_ORIGIN,gatewayURL:process.env.LENZ_GATEWAY_URL,gatewaySecret:process.env.LENZ_GATEWAY_SECRET,sessionSecret:process.env.LENZ_DEMO_SESSION_SECRET,custody:JSON.parse(process.env.LENZ_HOSTED_CUSTODY??'{}')});
 await route(req,res);
}
