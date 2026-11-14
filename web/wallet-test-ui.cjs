async function selectRecipient(page, choice) {
 if (!await page.locator('#wallet-recipient-picker').count()) return page.locator('#near-recipient').selectOption(choice);
 await page.waitForFunction(()=>{
  const picker=document.querySelector('#wallet-recipient-picker'),selected=document.querySelector('#wallet-recipient-selected');
  return document.querySelector('#near-recipient').value?picker.hidden&&!selected.hidden:!picker.hidden&&selected.hidden;
 });
 if (await page.locator('#wallet-recipient-selected').isVisible()) await page.locator('#wallet-recipient-selected').click();
 if (typeof choice === 'object') await page.locator('#wallet-recipient-list').getByRole('button', {name:choice.label, exact:true}).click();
 else await page.locator('.wallet-person[data-contact-id="'+choice+'"]').click();
 await page.locator('#wallet-recipient-selected').waitFor({state:'visible'});
}
async function openIncoming(page) {
 const details=page.locator('.wallet-incoming');
 if (await details.count() && !await details.evaluate(n=>n.open)) await details.locator('summary').click();
}
async function openWalletSection(page,section){
 if(await page.locator('#wallet-account-dialog').count()){
  if(section==='account'){if(!await page.locator('#wallet-account-dialog').evaluate(n=>n.open))await page.locator('#wallet-account').click();return;}
  if(['people','payments','offline','settings'].includes(section)){
   for(let i=0;i<4&&await page.locator('#wallet-activity-dialog[open],#wallet-account-dialog[open],#wallet-contacts[open],#evm-send-dialog[open]').count();i++)await page.keyboard.press('Escape');
   if(section==='payments'){await page.locator('#wallet-activity').click();return;}
   if(section==='people'){await page.locator('#wallet-send').click();await page.locator('#wallet-send-contacts').click();return;}
   if(section==='settings'){await page.locator('.wallet-settings summary').click();return;}
   if(section==='offline'){await page.getByRole('tab',{name:'Tokens',exact:true}).click();if(!await page.locator('.wallet-offline-token').evaluate(n=>n.open))await page.locator('.wallet-offline-token>summary').click();return;}
  }
 }
 const ids={people:'wallet-contacts',payments:'wallet-payment-history',defi:'wallet-defi-positions'},id=ids[section];
 if(!id||!await page.locator('#'+id).count())return;
 if(section==='defi')await page.getByRole('tab',{name:'DeFi',exact:true}).click();
 if(!await page.locator('#'+id).evaluate(n=>n.open))await page.locator('#'+id+' > summary').click();
}
module.exports={selectRecipient,openIncoming,openWalletSection};
async function walletClick(page,id){
 if(await page.locator('#wallet-account-dialog').count()){
  if(['evm-connect','evm-refresh','evm-receive','evm-disconnect'].includes(id)){await openWalletSection(page,'account');await page.locator('#'+id).click();if(id==='evm-disconnect')await page.locator('#wallet-account-dialog .wallet-close').click();return;}
  if(id==='evm-send'){for(const dialog of ['wallet-account-dialog','wallet-activity-dialog'])if(await page.locator('#'+dialog).evaluate(n=>n.open))await page.locator('#'+dialog+' .wallet-close').click();if(await page.locator('#wallet-send').isVisible())await page.locator('#wallet-send').click();else{await openWalletSection(page,'account');await page.locator('#evm-send').click();}return;}
  if(['near-send','near-receive','near-fund'].includes(id))await openWalletSection(page,'offline');
  if(id==='show-card')await openWalletSection(page,'settings');
 }
 await page.locator('#'+id).click();
}
module.exports.walletClick=walletClick;
