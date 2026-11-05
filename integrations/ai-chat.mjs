import {nearAIOptions} from './chart-analysis.mjs';
import {aiConversation} from '../web/public/ai-conversation.js';

export async function createAIChat(config,{loadSDK=()=>import('./near-ai/client.mjs'),nodeVersion=process.versions.node}={}){
  const options=nearAIOptions(config,{nodeVersion}),{InferenceClient}=await loadSDK(),client=new InferenceClient(options);
  return async input=>{
    const {messages}=aiConversation(input);
    try{
      const completion=await client.chat.completions.create({model:config.model,stream:false,max_tokens:1200,messages});
      if(typeof completion?.id!=='string'||!completion.id)throw Error('Missing response identity');
      const verified=await client.verifyResponse(completion.id);
      if(verified?.id!==completion.id||verified.signatureKind!=='provider_tee')throw Error('Missing model verification');
      const message=completion.choices?.[0]?.message;
      if(message?.tool_calls?.length||message?.function_call||typeof message?.content!=='string'||!message.content.trim()||message.content.length>8000)throw Error('Invalid response');
      return {text:message.content,verified:true,executable:false};
    }catch{throw Error('NEAR AI could not verify a reply.');}
  };
}
