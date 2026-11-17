const {spawnSync}=require('node:child_process'),path=require('node:path');

// Keep the documented command bound to the current automatic-delivery journey.
function run(){
 const result=spawnSync(process.execPath,['--test',path.join(__dirname,'chat-automatic-send-browser.test.cjs')],{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error('Conversation delivery checks failed.');
}
module.exports={run};if(require.main===module){try{run();}catch(error){console.error(error);process.exitCode=1;}}
