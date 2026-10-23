/** 检查 peerDependencies 里不许出现上界（<）。
 *
 * 背景：DSH 在加载插件之前会按 peerDependencies 做静态判定，范围越界就直接
 * 「拒绝加载」——此时模块能解析、apply() 不执行、宿主也没有 error，用户只能
 * 看到一条别的插件弹的提示，可能几天后才发现插件没跑。
 *
 * 一个猜出来的上界并不能保护任何东西，只会让「所有更新的 harness 一律装不上」。
 * 所以：用测试钉住声明，而不是用注释提醒自己。
 *
 * 用法：node scripts/check-peer-ranges.mjs
 * 退出码：0 = 通过；1 = 发现上界
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const peers = pkg.peerDependencies ?? {};
const names = Object.keys(peers);

if (names.length === 0) {
  console.log('未声明 peerDependencies，跳过。');
  process.exit(0);
}

const offenders = names.filter((name) => peers[name].includes('<'));
console.log(`peerDependencies (${names.length}):`);
for (const name of names) {
  const range = peers[name];
  console.log(`  ${offenders.includes(name) ? '✗' : '✓'} ${name} = ${range}`);
}

if (offenders.length > 0) {
  console.error('\n发现上界（<）。DSH 会在加载前按 peer 范围静态判定，上界会导致新版本 harness 拒绝加载本插件，');
  console.error('而拒绝加载时 apply() 不会执行、宿主也不会报错。请去掉上界，例如：');
  for (const name of offenders) {
    const lower = peers[name].split('<')[0].trim();
    console.error(`  "${name}": "${lower}"   ← 原为 "${peers[name]}"`);
  }
  process.exit(1);
}

console.log('\n✓ 所有 peer 范围都没有上界。');
