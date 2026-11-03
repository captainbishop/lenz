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
module.exports={selectRecipient,openIncoming};
