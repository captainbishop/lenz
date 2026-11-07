async function chooseTheme(page,theme){
 await page.locator('#theme-toggle').click();
 await page.getByRole('menuitemradio',{name:theme[0].toUpperCase()+theme.slice(1),exact:true}).click();
 await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
}
module.exports={chooseTheme};
