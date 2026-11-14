async function chooseTheme(page,theme){
 for(let step=0;step<3;step++){
  if(await page.locator('html').getAttribute('data-theme')===theme)break;
  await page.locator('#theme-toggle').click();
 }
 await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
}
module.exports={chooseTheme};
