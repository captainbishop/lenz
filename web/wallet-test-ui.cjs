async function selectRecipient(page, choice) {
 if (!await page.locator('#wallet-recipient-picker').count()) return page.locator('#near-recipient').selectOption(choice);
 if (await page.locator('#wallet-recipient-selected').isVisible()) await page.locator('#wallet-recipient-selected').click();
 if (typeof choice === 'object') await page.locator('#wallet-recipient-list').getByRole('button', {name:choice.label, exact:true}).click();
 else await page.locator('.wallet-person[data-contact-id="'+choice+'"]').click();
}
async function openIncoming(page) {
 const details=page.locator('.wallet-incoming');
 if (await details.count() && !await details.evaluate(n=>n.open)) await details.locator('summary').click();
}
async function openWalletSection(page,section){
 const ids={people:'wallet-contacts',payments:'wallet-payment-history',defi:'wallet-defi-positions'},id=ids[section];
 if(!id||!await page.locator('#'+id).count())return;
 if(section==='defi')await page.getByRole('tab',{name:'DeFi',exact:true}).click();
 if(!await page.locator('#'+id).evaluate(n=>n.open))await page.locator('#'+id+' > summary').click();
}
module.exports={selectRecipient,openIncoming,openWalletSection};
