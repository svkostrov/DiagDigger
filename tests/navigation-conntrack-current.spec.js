import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {parseDiagnostic,parseConntrack} from '../parser.js';
test.use({baseURL: process.env.DIAGDIGGER_URL || 'http://127.0.0.1:4173'});
const filename='self-test_KN-1811_stable_5.01.C.8.0-2_router_2026-10-23T14-42-33.200Z.txt';
const fixture=path.resolve('tests/fixtures',filename);
const second=path.resolve('tests/fixtures',fs.readdirSync('tests/fixtures').find(n=>n.includes('KN1912')));
const real=fs.existsSync(fixture)?parseDiagnostic(filename,fs.readFileSync(fixture,'utf8')):null;
test.skip(!real,'Локальная диагностика 23.10.2026 отсутствует');
const checkTableAccessibility = () => {
 const root=document.querySelector('.conntrack-section');
 const luminance=rgb=>rgb.map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const rgb=value=>(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
 const failures=[];
 for(const el of root.querySelectorAll('*')){
  if(!el.getBoundingClientRect().height||![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
  const style=getComputedStyle(el);let bg=el;
  while(bg.parentElement&&getComputedStyle(bg).backgroundColor==='rgba(0, 0, 0, 0)')bg=bg.parentElement;
  const a=luminance(rgb(style.color)),b=luminance(rgb(getComputedStyle(bg).backgroundColor));
  if((Math.max(a,b)+.05)/(Math.min(a,b)+.05)<4.5)failures.push(el.tagName);
 }
 for(const el of root.querySelectorAll('button,select,summary,[tabindex="0"]')){
  const box=el.getBoundingClientRect();if(box.height&&(box.width<24||box.height<24))failures.push('small '+el.tagName);
 }
 return failures;
};
const openConntrack=async page=>{
 await page.selectOption('#categoryJump','internet');
 const more=page.locator('[data-category="internet"]');if(await more.count())await more.click();
 await page.locator('[data-section-key="derived:internet:show-ip-conntrack"]').click();
 await expect(page.locator('.conntrack-section')).toBeVisible();
};
test('browser back/forward restores categories, search, sections and comparison',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.setInputFiles('#fileInput',[fixture,second]);
 await openConntrack(page);
 await page.goBack();await expect(page.locator('#exploreView h1')).toHaveText('Интернет');
 await page.goForward();await expect(page.locator('.conntrack-section')).toBeVisible();
 await page.goBack();await page.fill('#searchInput','Wireguard');
 await expect(page.locator('.search-results')).toBeVisible();
 await page.locator('[data-search-section]').first().click();
 await expect(page.locator('.section-detail')).toBeVisible();
 await page.goBack();await expect(page.locator('.search-results')).toBeVisible();
 await expect(page.locator('[data-search-section]').first()).toBeFocused();
 await page.click('[data-nav-compare]');await page.locator('[data-compare-key]').first().click();
 await expect(page.locator('#backToCompare')).toBeVisible();
 await page.goBack();await expect(page.locator('#backToCompare')).toHaveCount(0);
 await page.goBack();await expect(page.locator('.search-results')).toBeVisible();
 await page.goForward();await page.click('[data-compare-mode="raw"]');
 await page.locator('[data-compare-key]').first().click();
 await page.goBack();await expect(page.locator('.compare-row').first()).toBeVisible();
 await expect(page.locator('[data-compare-mode="raw"]')).toHaveClass(/active/);
 expect(errors).toEqual([]);
});
test('conntrack matches real tuples, client filter, IPv6, themes and screen widths',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['warning','error'].includes(m.type()))errors.push(m.text());});
 await page.goto('/');await page.setInputFiles('#fileInput',fixture);await openConntrack(page);
 const parsed=parseConntrack(real.sections.find(s=>s.name==='show ip conntrack').content);
 await expect(page.locator('.conntrack-section tbody tr')).toHaveCount(parsed.sessions.length);
 const first=parsed.sessions[0];
 await expect(page.locator('.conntrack-section')).toContainText(`${first.original.src}:${first.original.sport}`);
 await expect(page.locator('.conntrack-section')).toContainText(`${first.original.dst}:${first.original.dport}`);
 const options=await page.locator('#conntrackClient option').evaluateAll(nodes=>nodes.slice(1).map(n=>({value:n.value,label:n.textContent})));
 expect(options.some(o=>o.label.includes(' · '))).toBeTruthy();
 await page.selectOption('#conntrackClient',options[0].value);
 await expect(page.locator('.conntrack-client:visible')).toHaveCount(1);
 await page.selectOption('#conntrackClient','');
 for(const theme of ['light','dark','auto']){
  await page.selectOption('#themeSelect',theme);await page.waitForTimeout(250);
  for(const width of [320,360,390,768,820,900,1024,1440]){
   await page.setViewportSize({width,height:900});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
   expect((await page.locator('#conntrackClient').boundingBox()).height).toBeGreaterThanOrEqual(24);
   expect(await page.evaluate(checkTableAccessibility),`${theme}/${width}`).toEqual([]);
  }
  await page.screenshot({path:`tmp/screens/conntrack-${theme}.png`});
 }
 await page.locator('.conntrack-section .json-raw summary').click();
 await expect(page.locator('.conntrack-section .code-view')).toBeVisible();
 await page.selectOption('#categoryJump','ipv6');
 const more=page.locator('[data-category="ipv6"]');if(await more.count())await more.click();
 await page.locator('[data-section-key="derived:ipv6:show-ipv6-conntrack"]').click();
 await expect(page.locator('.conntrack-section tbody tr')).toHaveCount(4);
 await page.click('#removeCurrentFile');await page.locator('#toast button').click();
 await expect(page.locator('.conntrack-section tbody tr')).toHaveCount(4);
 expect(errors).toEqual([]);
});
