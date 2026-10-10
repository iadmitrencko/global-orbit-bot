// Усі сценарії симулятора разом: паралельно, з таблицею OK/ПРОБЛЕМА.
//
//   node sim/suite.mjs [--bot=PATH]
//
// Код виходу: 0 — усе OK, 1 — є проблеми. Опції sim.mjs описано на початку sim/sim.mjs.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = process.argv.slice(2);
const SCENARIOS = [
    ['гейт, сід 1', ['--seed=1']],
    ['гейт, сід 2', ['--seed=2']],
    ['гейт, сід 3', ['--seed=3']],
    ['гейт, сід 4', ['--seed=4']],
    ['важкі NPC', ['--hard', '--rounds=5', '--seed=11']],
    ['важкі NPC без номера конфігурації', ['--hard', '--nocfg', '--rounds=5', '--seed=12']],
    ['портал додому вже в раунді', ['--exitportal', '--rounds=3', '--seed=31']],
    ['мало HP на старті', ['--lowhp', '--rounds=2', '--seed=13']],
    ['старт посеред 8-го раунду', ['--inside', '--from=8', '--seed=5']],
    ['старт без goBot.stop()', ['--nostop', '--rounds=2']],
    ['stop() і одразу старт гейта', ['--restart', '--rounds=3']],
    ['далеко від порталу', ['--far']],
    ['goBot.stop() посеред гейта', ['--stopat=90', '--rounds=3', '--seed=6']],
    ['звичайний режим, startKillNpc', ['--farm', '--seed=21']]
];
const TIMEOUT = 10 * 60000;
const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const parallel = Math.max(1, Math.min(SCENARIOS.length, cores - 1));

function run([name, args]) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [path.join(here, 'sim.mjs'), ...args, ...extra, '--json'], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', d => stdout += d);
        child.stderr.on('data', d => stderr += d);
        child.on('close', code => {
            clearTimeout(timer);

            let result = null;

            try {
                result = JSON.parse(stdout.trim().split('\n').pop());
            } catch (e) {
                // не дожив до підсумку: впав, завис чи не стартував
            }

            resolve({ name, args, code, result, stderr: stderr.trim() });
        });
    });
}

const results = [];

let next = 0;

async function worker() {
    while (next < SCENARIOS.length) {
        const i = next++;

        results[i] = await run(SCENARIOS[i]);
        console.log((results[i].result && results[i].result.ok ? 'OK       ' : 'ПРОБЛЕМА ') + results[i].name);
    }
}

console.log('сценаріїв ' + SCENARIOS.length + ', паралельно ' + parallel + '\n');
await Promise.all(Array.from({ length: parallel }, worker));

const columns = [
    ['сценарій', r => r.name, 34],
    ['результат', r => r.result ? (r.result.ok ? 'OK' : 'ПРОБЛЕМА') : 'НЕ ДОЖИВ', 10],
    ['раунди', r => r.result && r.result.rounds ? r.result.cleared + '/' + r.result.rounds : '', 7],
    ['NPC', r => r.result ? String(r.result.kills) : '', 5],
    ['втеч', r => r.result ? String(r.result.flees) : '', 5],
    ['мін. HP', r => r.result ? r.result.minHp + '%' : '', 8],
    ['вірт. час', r => r.result ? r.result.virtualMin + ' хв' : '', 10],
    ['реальний', r => r.result ? r.result.realSec + ' с' : '', 9]
];
const line = cells => cells.map((cell, i) => cell.padEnd(columns[i][2])).join(' ').trimEnd();

console.log('\n' + line(columns.map(c => c[0])));

for (const r of results) {
    console.log(line(columns.map(c => c[1](r))));

    if (!r.result || !r.result.ok) {
        const why = r.result ? r.result.problems.join('; ') : 'код виходу ' + r.code;

        console.log('    ' + why + ' — повтори: node sim/sim.mjs ' + r.args.concat(extra).join(' '));

        if (r.stderr) {
            console.log('    ' + r.stderr.split('\n').slice(0, 6).join('\n    '));
        }
    }
}

const failed = results.filter(r => !r.result || !r.result.ok).length;

console.log('\n' + (failed ? 'ПРОБЛЕМИ: ' + failed + ' з ' + results.length : 'Усе OK'));
process.exit(failed ? 1 : 0);
