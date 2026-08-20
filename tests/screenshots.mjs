import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const base = 'file:///tmp/gamescatalog-swap/index.html';
const shots = [
  ['home', '', 1280, 1400],
  ['collection', '?c=tactical-military', 1280, 1000],
  ['filtered', '?perspective=First+Person&genre=Shooter,Tactical+Shooter&mode=Co-op', 1280, 1000],
  ['mobile', '?c=survival-coop', 420, 1100]
];
for (const [name, qs, w, h] of shots) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(base + qs);
  await p.waitForSelector('#rows tr, #empty:not([hidden])');
  await p.waitForTimeout(150);
  await p.screenshot({ path: `/tmp/shot-${name}.png` });
  await p.close();
}
await b.close();
console.log('ok');
