import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const fixture = path.resolve('tests/fixtures/self-test_KN-1811_stable_5.01.C.7.0-4_router_2026-10-20T15-11-31.276Z.txt');
const second = fs.readdirSync('tests/fixtures').find(name => name.includes('KN1912'));
test.skip(!fs.existsSync(fixture), 'Локальная диагностика 20.10.2026 отсутствует');

test('реальная диагностика: компактная сводка, переходы, темы и ширины', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  await page.goto('/');
  await page.setInputFiles('#fileInput', fixture);
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('.diagnostic-summary')).toContainText('5.01.C.7.0-4');
  await expect(page.locator('.diagnostic-summary')).toContainText('20.10.26 15:11:31 UTC');
  await expect(page.locator('#globalFileSelect option')).toContainText('20.10.26 15:11:31 UTC');
  for (const theme of ['light', 'dark', 'auto']) {
    await page.selectOption('#themeSelect', theme);
    for (const width of [320,360,390,768,820,900,1024,1440]) {
      await page.setViewportSize({width, height:1000});
      await expect(page.locator('#categoryJump')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
      expect((await page.locator('#categoryJump').boundingBox()).height).toBeGreaterThanOrEqual(24);
    }
  }
  await page.locator('.diagnostic-details summary').click();
  await expect(page.locator('.meta-grid')).toBeVisible();
  await page.selectOption('#categoryJump', 'vpn');
  await expect(page.locator('#exploreView h1')).toHaveText('VPN и туннели');
  await expect(page.locator('#exploreView h1')).toBeFocused();
  await page.locator('[data-section-key]').first().click();
  await expect(page.locator('#backToCategories')).toContainText('VPN и туннели');
  await page.locator('#backToCategories').click();
  await page.fill('#searchInput', 'Wireguard');
  await expect(page.locator('.search-results')).toBeVisible();
  await page.locator('[data-search-section]').first().click();
  await expect(page.locator('#exploreView .section-detail h2')).toBeFocused();
  await expect(page.locator('#backToCategories')).toContainText('К результатам поиска');
  await page.locator('#backToCategories').click();
  await expect(page.locator('.search-results')).toBeVisible();
  await expect(page.locator('[data-search-section]').first()).toBeFocused();
  await page.click('[data-nav-category="all"]');
  await page.selectOption('#themeSelect','light');
  await page.screenshot({path:'tmp/screens/usability-light.png'});
  await page.selectOption('#themeSelect','dark');
  await page.screenshot({path:'tmp/screens/usability-dark.png'});
  expect(errors).toEqual([]);
});

test('копирование на HTTP без Clipboard API, два файла и оба сравнения', async ({page}) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.setInputFiles('#fileInput',[fixture,path.resolve('tests/fixtures',second)]);
  await expect(page.locator('#globalFileSelect option')).toHaveCount(2);
  await page.locator('[data-section-key]').first().click();
  await page.evaluate(() => {
    Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});
    document.execCommand = command => {
      window.copyCheck = {command, text:document.activeElement.value}; return true;
    };
  });
  await page.click('#copySection');
  await expect(page.locator('#toast')).toContainText('Секция скопирована');
  expect(await page.evaluate(()=>window.copyCheck.command)).toBe('copy');
  expect(await page.evaluate(()=>window.copyCheck.text.length)).toBeGreaterThan(0);
  await expect(page.locator('#copySection')).toBeFocused();
  await page.click('[data-nav-compare]');
  await expect(page.locator('.semantic-group').first()).toBeVisible();
  await page.click('[data-compare-mode="raw"]');
  await expect(page.locator('.compare-row').first()).toBeVisible();
  expect(errors).toEqual([]);
});

const CONTRAST_PROBE = () => {
  const luminance = rgb => {
    const [r, g, b] = rgb.map(value => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const opaqueBackground = element => {
    for (let node = element; node; node = node.parentElement) {
      const background = getComputedStyle(node).backgroundColor;
      const alpha = Number((background.match(/[\d.]+/g) || [])[3] ?? 1);
      if (alpha > 0.9 && background !== "transparent") return parse(background);
    }
    return [255, 255, 255];
  };
  const results = [];
  for (const element of document.querySelectorAll("body *")) {
    const text = [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent.trim()).join("");
    if (!text) continue;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.opacity === "0") continue;
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const front = luminance(parse(style.color));
    const back = luminance(opaqueBackground(element));
    const ratio = (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
    if (ratio < (large ? 3 : 4.5)) {
      results.push({
        selector: element.tagName.toLowerCase() + (element.id ? `#${element.id}` : "") + (element.className ? `.${String(element.className).split(" ")[0]}` : ""),
        text: text.slice(0, 32),
        ratio: Math.round(ratio * 100) / 100,
      });
    }
  }
  return results;
};

const smallTargets = () => [...document.querySelectorAll("button, a[href], select, [tabindex='0']")]
  .map(element => ({ element, box: element.getBoundingClientRect() }))
  .filter(({ box }) => box.width > 0 && (box.width < 24 || box.height < 24))
  .map(({ element, box }) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : `.${String(element.className).split(" ")[0]}`} ${Math.round(box.width)}x${Math.round(box.height)}`);


test('целевые состояния: контраст, размеры целей и ширины с новой диагностикой', async ({page}) => {
  test.setTimeout(60_000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(['error','warning'].includes(m.type())) errors.push(m.text());});
  await page.goto('/');
  const check = async label => {
    for (const theme of ['light','dark']) {
      await page.selectOption('#themeSelect', theme);
      // Existing theme transitions last 200 ms; measure the settled colors.
      await page.waitForTimeout(250);
      for (const width of [320,360,390,768,820,900,1024,1440]) {
        await page.setViewportSize({width,height:900});
        expect(await page.evaluate(()=>document.documentElement.scrollWidth),`${label}/${theme}/${width}`).toBeLessThanOrEqual(width+1);
        expect(await page.evaluate(smallTargets),`${label}/${theme}/${width}`).toEqual([]);
      }
      expect(await page.evaluate(CONTRAST_PROBE),`${label}/${theme}`).toEqual([]);
    }
  };
  await check('пустой экран');
  await page.setInputFiles('#fileInput',{name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')});
  await expect(page.locator('#toast')).toContainText('не найдены секции');
  await page.setInputFiles('#fileInput',[fixture,path.resolve('tests/fixtures',second)]);
  await expect(page.locator('#workspace')).toBeVisible();
  await check('обзор');
  await page.locator('.diagnostic-details summary').click();
  await check('сведения');
  await page.selectOption('#categoryJump','vpn');
  await check('категория');
  await page.locator('[data-section-key]').first().click();
  await check('секция');
  await page.fill('#searchInput','Wireguard');
  await expect(page.locator('.search-results')).toBeVisible();
  await check('поиск');
  await page.click('[data-nav-compare]');
  await check('смысловое сравнение');
  await page.locator('[data-compare-key]').first().click();
  await check('деталь сравнения');
  await page.click('#backToCompare');
  await page.click('[data-compare-mode="raw"]');
  await check('сырое сравнение');
  await page.locator('[data-compare-key]').first().click();
  await check('diff');
  await page.click('#removeCurrentFile');
  await expect(page.locator('#toast button')).toBeFocused();
  await page.locator('#toast button').click();
  await expect(page.locator('#globalFileSelect option')).toHaveCount(2);
  expect(errors).toEqual([]);
});
