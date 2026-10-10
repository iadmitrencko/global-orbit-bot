// Симулятор Global Orbit: перевірка main.js без гри.
//
// Віртуальний час (година гри минає за кілька секунд), фейковий DOM і модель гри:
// - клієнт — як у бандлі гри: MapManager з hero/ships/portals, політ перетягуванням мишею,
//   клік по NPC виділяє його, Ctrl — лазери, C — конфігурація (кулдаун 5 с, номер приходить
//   у hero.config), J — стрибок, після якого гра створює героя заново;
// - сервер — як у публічному емуляторі DarkOrbit 10.0: NPC помічають корабель за 2000 од.,
//   підлітають на 300 і б'ють з 450, а загубивши — літають між випадковими точками карти;
//   щит у кожної конфігурації свій, щит ремонтується через 10 с після влучання, HP — через
//   10 с без бою взагалі; стрибок — через 3.25 с, якщо портал ближче 700 од.; за межами
//   0…20900 × 0…13000 радіація: 20 000 урону щосекунди, гра показує попередження;
// - гейт — за описом гравця: відлік 10 с, 4 хвилі, тоді два портали: лівий — у наступний
//   раунд, правий — додому.
// HP, швидкості й урон вигадані: симулятор перевіряє логіку бота, а не баланс. Коробок нема.
//
//   node sim/sim.mjs [опції]     один прогін і лог бота у віртуальному часі
//   node sim/suite.mjs           усі сценарії разом
//
// Після вставки бот має чекати команди, тож у кожному сценарії спершу секунда тиші:
// якщо він сам щось натисне чи полетить — це проблема.
//
// Сценарій. За замовчуванням — гейт, як у README: гравець підводить корабель до
// порталу, goBot.startPassGalaxyGate(). Інакше один із:
//   --nostop        goBot.start() (збір коробок), а тоді гейт — без goBot.stop()
//   --restart       goBot.start(), а за мить goBot.stop() і одразу гейт, поки старий цикл ще посеред дії
//   --far           корабель за 1600 од. від порталу — бот має відмовитись
//   --inside        старт посеред раунду, порталів на карті нема
//   --farm          звичайний режим: NPC на домашній карті й goBot.startKillNpc()
// Опції:
//   --seed=N        випадковість, 1
//   --rounds=N      раундів у гейті, 10
//   --from=N        з якого раунду, 1
//   --hard          NPC більше й вони сильніші
//   --nocfg         сервер не шле номер конфігурації після стрибка
//   --exitportal    у раунді з самого початку стоїть портал додому
//   --lowhp         на старті 60% HP
//   --edge          бій біля західного краю карти, NPC зі сходу: тікати «від них» — у радіацію
//   --radcircle=R   у гейті безпечна лише зона-коло радіусом R довкола центру, далі радіація
//   --stopat=S      goBot.stop() через S с після старту гейта
//   --cfg=JSON      поміняти goBot.config, напр. --cfg='{"gateKiteDist":500}'
//   --minutes=N     межа віртуального часу: 60 хв на раунд; для --farm це тривалість, 6 хв
//   --bot=PATH      який скрипт ганяти, ../main.js
//   --quiet         тільки підсумок
//   --json          тільки рядок JSON з підсумком (для suite.mjs)
// Код виходу: 0 — OK, 1 — проблема, 2 — не вдалося запустити.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FLAGS = ['nostop', 'restart', 'far', 'inside', 'farm', 'hard', 'nocfg', 'exitportal', 'lowhp', 'edge', 'quiet', 'json'];
const NUMBERS = ['seed', 'rounds', 'from', 'stopat', 'minutes', 'radcircle'];
const TEXTS = ['cfg', 'bot'];
const args = {};

for (const arg of process.argv.slice(2)) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
    const known = m && (m[2] === undefined ? FLAGS : NUMBERS.concat(TEXTS)).includes(m[1]);

    if (!known || (NUMBERS.includes(m[1]) && !/^\d+(\.\d+)?$/.test(m[2]))) {
        console.error('невідома опція ' + arg + ' — список на початку sim/sim.mjs');
        process.exit(2);
    }

    args[m[1]] = m[2] === undefined ? true : m[2];
}

const picked = ['nostop', 'restart', 'far', 'inside', 'farm'].filter(s => args[s]);

if (picked.length > 1) {
    console.error('сценарій має бути один, а тут: ' + picked.join(', '));
    process.exit(2);
}

const SCENARIO = picked[0] || 'gate';
const SEED = +args.seed || 1;
const ROUNDS = Math.max(1, Math.floor(+args.rounds) || 10);
const FROM = Math.min(ROUNDS, Math.max(1, Math.floor(+args.from) || 1));
const HARD = !!args.hard;
const QUIET = !!(args.quiet || args.json);
const BOT = path.resolve(args.bot || path.join(here, '..', 'main.js'));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------- випадковість і віртуальний час

// mulberry32: той самий сід — той самий прогін, бо й бот бере Math.random
let seed = SEED >>> 0;

Math.random = function () {
    seed = seed + 0x6D2B79F5 | 0;

    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);

    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;

    return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const rnd = (a, b) => a + Math.random() * (b - a);
const realSetTimeout = setTimeout;
const realStart = performance.now();
const T0 = Date.parse('2026-10-10T12:00:00Z');
const timers = new Map();

let vnow = T0;
let timerSeq = 0;

Date.now = () => vnow;
globalThis.setTimeout = (fn, ms, ...rest) => {
    const id = ++timerSeq;

    timers.set(id, { at: vnow + Math.max(0, +ms || 0), fn, rest, id });

    return id;
};
globalThis.clearTimeout = id => timers.delete(id);

const later = (ms, fn) => globalThis.setTimeout(fn, ms);
const vt = () => {
    const s = (vnow - T0) / 1000;

    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + (s % 60).toFixed(1).padStart(4, '0');
};
const errors = [];

// Крутимо таймери у віртуальному часі, поки cond() не справдиться або не мине maxMs.
// Між таймерами віддаємо чергу мікрозадачам — так доходять await-и бота
async function runUntil(cond, maxMs) {
    const end = vnow + maxMs;

    while (vnow < end) {
        await new Promise(r => setImmediate(r));

        if (cond && cond()) {
            return true;
        }

        let next = null;

        for (const t of timers.values()) {
            if (!next || t.at < next.at || (t.at === next.at && t.id < next.id)) {
                next = t;
            }
        }

        if (!next) {
            await new Promise(r => realSetTimeout(r, 2));   // ще вантажиться модуль гри
            continue;
        }

        timers.delete(next.id);
        vnow = Math.max(vnow, next.at);

        try {
            next.fn(...next.rest);
        } catch (e) {
            console.error(e);
        }
    }

    return false;
}

// ------------------------------------------------- лог

const realLog = console.log;
const realError = console.error;
const botLog = [];

// вивід обрізали (| head) — далі писати нікуди
process.stdout.on('error', e => process.exit(e.code === 'EPIPE' ? 0 : 2));
const show = text => {
    if (!QUIET) {
        realLog('[' + vt() + '] ' + text);
    }
};
const say = text => {
    if (!args.json) {
        realLog(text);
    }
};
const simlog = text => show('  сим: ' + text);

// бот пише '%c[goBot 12:00:00]', 'color:…', текст — лишаємо тільки текст
console.log = (...parts) => {
    const text = parts
        .filter(p => typeof p !== 'string' || !p.startsWith('color:'))
        .map(p => typeof p === 'string' ? p : JSON.stringify(p))
        .join(' ')
        .replace(/%c/g, '')
        .replace(/^\[goBot \d\d:\d\d:\d\d\] ?/, '');

    botLog.push(text);
    show(text);
};
console.table = () => {};
console.error = (...parts) => {
    errors.push(parts.map(p => p && p.stack ? p.stack : String(p)).join(' '));
    realError('[' + vt() + '] ПОМИЛКА', ...parts);
};

// ------------------------------------------------- модель

const ZOOM = 0.77;
const SCREEN = { w: 1280, h: 720 };
const STEP = 50;
const HOME_MAP = 1;
const GATE_MAP = 51;
const CENTER = { x: 10500, y: 6500 };
const SPAWN = args.edge ? { x: 1500, y: 6500 } : CENTER;   // де корабель з'являється в раунді
const PORTAL = { x: 4000, y: 4000 };
const RAD_DAMAGE = 20000;
const HERO = {
    maxHp: 200000,
    maxShield: { 1: 150000, 2: 110000 },
    speed: { 1: 300, 2: 470 },
    laser: { 1: 9000, 2: 2500 }
};
const NPC_TYPES = [
    { name: '-=[ Streuner ]=-', speed: 280, hp: 40000, shield: 20000, dmg: 1100 },
    { name: '-=[ Lordakia ]=-', speed: 320, hp: 30000, shield: 30000, dmg: 1400 },
    { name: '-=[ Saimon ]=-', speed: 320, hp: 60000, shield: 30000, dmg: 1800 },
    { name: '-=[ Kristallin ]=-', speed: 430, hp: 50000, shield: 40000, dmg: 2200 },
    { name: '-=[ Mordon ]=-', speed: 150, hp: 120000, shield: 60000, dmg: 3200 }
];

const stat = {
    jumps: 0, jumpFails: 0, cfgSwitches: 0, cfgRejected: 0, clientCooldown: 0, doublePress: 0, inputs: 0,
    radSeconds: 0, radEntries: 0,
    kills: 0, deaths: 0, hits: 0, minHpPct: 100, maxAttackers: 0, attackerTicks: 0, ticks: 0,
    fightTicks: 0, dist: { '<300': 0, '300–450': 0, '450–600': 0, '600–700': 0, '>700': 0 },
    rounds: []
};

function homePortals() {
    return [
        { id: 900, x: PORTAL.x, y: PORTAL.y, graphicsId: 2, dest: { kind: 'round', round: FROM } },
        { id: 901, x: 18000, y: 11000, graphicsId: 1, dest: { kind: 'other' } }
    ];
}

// сервер: правда про корабель і NPC
const S = {
    mapId: HOME_MAP,
    hero: {
        x: PORTAL.x + 250, y: PORTAL.y + 120,
        hp: HERO.maxHp * (args.lowhp ? 0.6 : 1),
        shield: { 1: HERO.maxShield[1], 2: HERO.maxShield[2] },
        config: 1, cfgAt: -1e9, lastHit: -1e9, lastShot: -1e9, regenAt: 0, laserAt: 0,
        target: null, alive: true, jumping: false
    },
    npcs: [],
    portals: homePortals(),
    round: 0, wave: 0, state: 'home', stateAt: 0, roundAt: 0,
    inRad: false, radAt: 0,
    nextNpcId: 5000
};

if (SCENARIO === 'inside') {
    Object.assign(S, { mapId: GATE_MAP, portals: [], round: FROM, state: 'countdown', stateAt: T0, roundAt: T0 });
    S.hero.x = SPAWN.x;
    S.hero.y = SPAWN.y;
} else if (SCENARIO === 'farm' && args.edge) {
    S.hero.x = SPAWN.x;
    S.hero.y = SPAWN.y;
}

// радіація: як у CheckRadiation емулятора — поза прямокутником карти, а з --radcircle у гейті
// ще й поза колом (так сервер робить радіаційні POI)
function radZone(x, y) {
    return x < 0 || x > 20900 || y < 0 || y > 13000
        || (!!args.radcircle && S.mapId === GATE_MAP && Math.hypot(x - CENTER.x, y - CENTER.y) > +args.radcircle);
}

// клієнт: те, що бачить бот
const cam = { x: S.hero.x, y: S.hero.y };
const input = { down: false, x: 0, y: 0 };
const map = {
    boxes: new Map(), ships: new Map(), stations: new Map(), portals: [],
    hero: null, lockedTarget: null, targetBoxToCollect: null, isPointerDown: false,
    mapWidth: 21000, mapHeight: 13100, currentMapId: S.mapId, lastConfigChangeTime: 0,
    createBox() {},
    displayLayer: {
        toGlobal: p => ({ x: (p.x - cam.x) * ZOOM + SCREEN.w / 2, y: (p.y - cam.y) * ZOOM + SCREEN.h / 2 })
    },
    // як у грі: 5 с між натисканнями, а без номера в hero.config просить 2-гу
    attemptConfigChange() {
        if (!this.hero) {
            return;
        }
        if (Date.now() - this.lastConfigChangeTime < 5000) {
            stat.clientCooldown++;
            simlog('клієнт: конфігурацію можна міняти раз на 5 с');

            return;
        }

        this.lastConfigChangeTime = Date.now();

        const asks = (this.hero.config || 1) === 1 ? 2 : 1;

        later(40, () => serverChangeConfig(asks));
    }
};

globalThis.__sim = {
    sceneManager: { app: { renderer: { resolution: 1 }, stage: { children: [] } }, currentScene: map }
};

const toScreen = (x, y) => map.displayLayer.toGlobal({ x, y });
const toWorld = (sx, sy) => ({ x: (sx - SCREEN.w / 2) / ZOOM + cam.x, y: (sy - SCREEN.h / 2) / ZOOM + cam.y });
const inMap = p => ({ x: clamp(p.x, 0, 21000), y: clamp(p.y, 0, 13100) });
// корабель гра пускає й за край карти — туди, де радіація
const inWorld = p => ({ x: clamp(p.x, -5000, 26000), y: clamp(p.y, -5000, 18100) });

// попередження гри про радіацію (ScreenNotificationManager.setRadiationZone): поки ми в ній,
// висить #do-rad-notification; при виході воно гасне (opacity 0) і зникає за 500 мс, а нове
// створюється окремим елементом — тому їх буває кілька водночас
let radElements = [];

function setRadiationWarning(on) {
    const shown = radElements.find(el => el.style.opacity !== '0');

    if (on && !shown) {
        radElements.push({ id: 'do-rad-notification', style: { opacity: '1' } });
    } else if (!on && shown) {
        shown.style.opacity = '0';
        later(500, () => {
            radElements = radElements.filter(el => el !== shown);
        });
    }
}

function clientPortal(p) {
    return { portalId: p.id, x: p.x, y: p.y, graphicsId: p.graphicsId, isJumping: false, destroyed: false };
}

// як initMapFromId + spawnShip у грі: усе з карти геть, герой — новий об'єкт
function initClientMap() {
    for (const p of map.portals) {
        p.destroyed = true;
    }
    for (const s of map.ships.values()) {
        s.destroyed = true;
    }

    const cfg = S.hero.config;

    map.portals = [];
    map.ships.clear();
    map.lockedTarget = null;
    map.currentMapId = S.mapId;
    radElements = [];   // як clearZoneWarnings у грі; сервер перевірить радіацію наступним тактом
    S.inRad = false;
    map.hero = {
        userId: 77, userName: 'hero', isSelf: true, isNpc: false, isPet: false,
        x: S.hero.x, y: S.hero.y, hp: S.hero.hp, maxHp: HERO.maxHp,
        shield: S.hero.shield[cfg], maxShield: HERO.maxShield[cfg], speed: HERO.speed[cfg],
        config: undefined, isAttacking: false, attackTarget: null, lastHitTime: 0,
        maxCargo: 1000, cargo: 0, visible: true, isCloaked: false, destroyed: false
    };
    map.ships.set(map.hero.userId, map.hero);
    cam.x = S.hero.x;
    cam.y = S.hero.y;

    // сервер шле номер конфігурації й портали окремими пакетами, трохи згодом
    if (!args.nocfg) {
        later(30, () => {
            if (map.hero) {
                map.hero.config = S.hero.config;
            }
        });
    }

    later(80, () => {
        for (const p of S.portals) {
            map.portals.push(clientPortal(p));
        }
    });
}

function serverChangeConfig(n) {
    if (Date.now() - S.hero.cfgAt <= 5000) {
        stat.cfgRejected++;
        simlog('сервер: config_change_failed_time');

        return;
    }

    S.hero.cfgAt = Date.now();
    stat.cfgSwitches += S.hero.config !== n ? 1 : 0;
    S.hero.config = n;
    simlog('сервер: конфігурація ' + n);
    later(30, () => {
        if (map.hero) {
            map.hero.config = n;
        }
    });
}

function serverJump() {
    if (S.hero.jumping || !S.hero.alive) {
        return;
    }

    let best = null;

    for (const p of S.portals) {
        const d = Math.hypot(p.x - S.hero.x, p.y - S.hero.y);

        if (d <= 700 && (!best || d < best.d)) {
            best = { p, d };
        }
    }

    if (!best) {
        stat.jumpFails++;
        simlog('сервер: jumpgate_failed_no_gate');

        return;
    }

    S.hero.jumping = true;
    later(50, () => {
        const shown = map.portals.find(p => p.portalId === best.p.id);

        if (shown) {
            shown.isJumping = true;
        }
    });
    later(3250, () => doJump(best.p.dest));
}

function doJump(dest) {
    S.hero.jumping = false;
    S.hero.target = null;
    S.npcs = [];
    stat.jumps++;

    if (dest.kind === 'round') {
        S.mapId = GATE_MAP;
        S.round = dest.round;
        S.wave = 0;
        S.state = 'countdown';
        S.stateAt = vnow;
        S.roundAt = vnow;
        // --exitportal: портал додому стоїть від початку раунду, ще лівіше за «лівий»
        S.portals = args.exitportal ? [{ id: 777, x: 2500, y: CENTER.y, graphicsId: 1, dest: { kind: 'home' } }] : [];
        S.hero.x = SPAWN.x + rnd(-200, 200);
        S.hero.y = SPAWN.y + rnd(-200, 200);
        simlog('стрибок: гейт, раунд ' + dest.round);
    } else if (dest.kind === 'home') {
        S.mapId = HOME_MAP;
        S.state = 'home';
        S.portals = homePortals();
        S.hero.x = PORTAL.x + 300;
        S.hero.y = PORTAL.y + 300;
        simlog('стрибок: додому');
    } else {
        S.mapId = 2;
        S.state = 'other';
        S.portals = [];
        simlog('стрибок: на іншу карту');
    }

    initClientMap();
}

function spawnGroup(count, round) {
    const angle = args.edge ? rnd(-Math.PI / 3, Math.PI / 3) : rnd(0, Math.PI * 2);   // --edge: зі сходу
    const dist = rnd(700, 1400);
    const cx = clamp(S.hero.x + Math.cos(angle) * dist, 1000, 20000);
    const cy = clamp(S.hero.y + Math.sin(angle) * dist, 1000, 12100);
    const kinds = Math.min(NPC_TYPES.length, 2 + Math.floor(round / 2));
    const scale = 1 + 0.08 * (round - 1) + (HARD ? 0.5 : 0);

    for (let i = 0; i < count; i++) {
        const type = NPC_TYPES[Math.floor(Math.random() * kinds)];

        S.npcs.push({
            id: S.nextNpcId++, type, x: cx + rnd(-450, 450), y: cy + rnd(-450, 450),
            hp: type.hp * scale, maxHp: type.hp * scale, shield: type.shield * scale, maxShield: type.shield * scale,
            dmg: type.dmg * scale, speed: type.speed, dest: null, aiAt: vnow + rnd(0, 1000), attackAt: 0,
            selected: false, dead: false, attackingUntil: 0, lastHit: -1e9
        });
    }
}

function spawnWave() {
    const count = 2 + Math.ceil(S.round / 2) + (S.wave >= 2 ? 1 : 0) + (HARD ? 2 : 0);

    S.wave++;
    spawnGroup(count, S.round);
    simlog('раунд ' + S.round + ', хвиля ' + S.wave + ': ' + count + ' NPC');
}

function openPortals() {
    const left = {
        id: 1000 + S.round * 2, x: CENTER.x - 1500, y: CENTER.y + rnd(-300, 300), graphicsId: 3,
        dest: S.round >= ROUNDS ? { kind: 'other' } : { kind: 'round', round: S.round + 1 }
    };
    const right = { id: 1001 + S.round * 2, x: CENTER.x + 1500, y: CENTER.y + rnd(-300, 300), graphicsId: 4, dest: { kind: 'home' } };

    stat.rounds.push({ round: S.round, ms: vnow - S.roundAt });
    S.portals.push(left, right);
    simlog('раунд ' + S.round + ' зачищено, з\'явились портали');
    later(60, () => map.portals.push(clientPortal(left)));
    later(400, () => map.portals.push(clientPortal(right)));
}

// щит бере 80% удару, поки його вистачає
function damageHero(dmg) {
    const h = S.hero;
    const shield = h.shield[h.config];
    const toShield = shield >= dmg ? dmg * 0.8 : shield;

    h.shield[h.config] = Math.max(0, shield - toShield);
    stat.hits++;
    hurt(dmg - toShield);
}

// по HP: і від NPC, і від радіації
function hurt(hpLoss) {
    const h = S.hero;

    h.hp -= hpLoss;
    h.lastHit = vnow;
    stat.minHpPct = Math.min(stat.minHpPct, Math.max(0, h.hp / HERO.maxHp * 100));

    if (map.hero) {
        map.hero.lastHitTime = vnow;
    }

    if (h.hp <= 0) {
        h.hp = 0;
        h.alive = false;
        stat.deaths++;
        simlog('КОРАБЕЛЬ ЗНИЩЕНО');

        if (map.hero) {
            map.hero.hp = 0;
            map.hero.isAttacking = false;
        }
    }
}

function clearTarget() {
    map.lockedTarget = null;

    if (map.hero && map.hero.isAttacking) {
        map.hero.isAttacking = false;
        map.hero.attackTarget = null;
    }
}

function removeShip(id) {
    const ship = map.ships.get(id);

    if (ship) {
        if (map.lockedTarget === ship) {
            clearTarget();
        }

        ship.destroyed = true;
        map.ships.delete(id);
    }
}

function moveToward(o, dest, speed) {
    const dx = dest.x - o.x;
    const dy = dest.y - o.y;
    const d = Math.hypot(dx, dy);
    const step = speed * STEP / 1000;

    if (d <= step) {
        o.x = dest.x;
        o.y = dest.y;

        return true;
    }

    o.x += dx / d * step;
    o.y += dy / d * step;

    return false;
}

// ------------------------------------------------- такт світу

function tick() {
    later(STEP, tick);   // першим ділом: виняток нижче не має зупинити світ

    const h = S.hero;
    const cfg = h.config;

    stat.ticks++;

    // кнопка затиснута — корабель летить у точку під курсором, а камера їде за ним
    if (input.down && map.hero && h.alive) {
        h.target = inWorld(toWorld(input.x, input.y));
    }
    if (h.alive && h.target && !h.jumping && moveToward(h, h.target, HERO.speed[cfg])) {
        h.target = null;
    }

    // радіація: попередження — як тільки сервер її помітив, урон — щосекунди, щит не рятує
    const rad = h.alive && !h.jumping && radZone(h.x, h.y);

    if (rad !== S.inRad) {
        S.inRad = rad;
        stat.radEntries += rad ? 1 : 0;
        simlog(rad ? 'корабель у радіації' : 'корабель вийшов з радіації');
        later(30, () => setRadiationWarning(rad));
    }
    if (rad && vnow - S.radAt >= 1000) {
        S.radAt = vnow;
        stat.radSeconds++;
        hurt(RAD_DAMAGE);
    }

    let attackers = 0;

    for (const n of S.npcs) {
        if (n.dead) {
            continue;
        }

        const d = Math.hypot(n.x - h.x, n.y - h.y);

        // раз на секунду: бачить корабель — летить у точку за 300 од. від нього, ні — блукає
        if (vnow >= n.aiAt) {
            n.aiAt = vnow + 1000;

            if (h.alive && !h.jumping && d <= 2000) {
                if (!n.selected || h.target) {
                    const a = rnd(0, Math.PI * 2);

                    n.dest = inMap({ x: h.x + Math.cos(a) * 300, y: h.y + Math.sin(a) * 300 });
                }

                n.selected = true;
            } else {
                n.selected = false;
                n.dest = n.dest || { x: rnd(500, 20500), y: rnd(500, 12600) };
            }
        }

        if (n.dest && moveToward(n, n.dest, n.speed)) {
            n.dest = null;
        }
        if (n.selected && h.alive && !h.jumping && d <= 450 && vnow - n.attackAt >= 1000) {
            n.attackAt = vnow;
            n.attackingUntil = vnow + 1500;
            damageHero(n.dmg);
        }
        if (vnow - n.lastHit > 10000 && n.shield < n.maxShield) {
            n.shield = Math.min(n.maxShield, n.shield + n.maxShield / 10 * STEP / 1000);
        }

        attackers += n.attackingUntil > vnow ? 1 : 0;
    }

    stat.maxAttackers = Math.max(stat.maxAttackers, attackers);
    stat.attackerTicks += attackers;

    // лазери героя: раз на секунду, якщо ціль ближче 700
    const hero = map.hero;
    const aim = hero && hero.isAttacking && hero.attackTarget
        ? S.npcs.find(n => n.id === hero.attackTarget.userId && !n.dead)
        : null;

    if (aim && h.alive) {
        const d = Math.hypot(aim.x - h.x, aim.y - h.y);

        stat.fightTicks++;
        stat.dist[d < 300 ? '<300' : d < 450 ? '300–450' : d < 600 ? '450–600' : d <= 700 ? '600–700' : '>700']++;

        if (d <= 700 && vnow - h.laserAt >= 1000) {
            const dmg = HERO.laser[cfg];
            const toShield = Math.min(aim.shield, dmg * 0.7);

            h.laserAt = vnow;
            h.lastShot = vnow;
            aim.lastHit = vnow;
            aim.shield -= toShield;
            aim.hp -= dmg - toShield;

            if (aim.hp <= 0) {
                const shown = map.ships.get(aim.id);

                aim.hp = 0;
                aim.dead = true;
                stat.kills++;

                // як die() у грі: спершу hp = 0, а з карти — трохи згодом
                if (shown) {
                    shown.hp = 0;
                }

                later(300, () => removeShip(aim.id));
            }
        }
    }

    // ремонт раз на секунду: HP — через 10 с без бою, щит активної конфігурації — через 10 с без влучань
    if (h.alive && vnow - h.regenAt >= 1000) {
        h.regenAt = vnow;

        if (vnow - Math.max(h.lastHit, h.lastShot) > 10000) {
            h.hp = Math.min(HERO.maxHp, h.hp + HERO.maxHp / 40);
        }
        if (vnow - h.lastHit > 10000) {
            h.shield[cfg] = Math.min(HERO.maxShield[cfg], h.shield[cfg] + HERO.maxShield[cfg] / 25);
        }
    }

    // гейт: відлік 10 с, 4 хвилі (наступна — за 3 с після попередньої), тоді портали
    if (S.mapId === GATE_MAP) {
        const alive = S.npcs.some(n => !n.dead);

        if (S.state === 'countdown' && vnow - S.stateAt >= 10000) {
            S.state = 'wave';
            spawnWave();
        } else if (S.state === 'wave' && !alive) {
            S.state = S.wave >= 4 ? 'clearing' : 'between';
            S.stateAt = vnow;
        } else if (S.state === 'between' && vnow - S.stateAt >= 3000) {
            S.state = 'wave';
            spawnWave();
        } else if (S.state === 'clearing' && vnow - S.stateAt >= 1000) {
            S.state = 'cleared';
            openPortals();
        }
    }

    // клієнт бачить NPC ближче 2000 од.
    if (hero) {
        for (const n of S.npcs) {
            const shown = map.ships.get(n.id);

            if (!n.dead && Math.hypot(n.x - h.x, n.y - h.y) <= 2000) {
                const ship = shown || {
                    userId: n.id, userName: n.type.name, shipId: 'ship', isNpc: true, isPet: false,
                    maxHp: n.maxHp, maxShield: n.maxShield, speed: n.speed,
                    visible: true, isCloaked: false, destroyed: false
                };

                map.ships.set(n.id, ship);
                Object.assign(ship, { x: n.x, y: n.y, hp: n.hp, shield: n.shield, isAttacking: n.attackingUntil > vnow });
                ship.attackTarget = ship.isAttacking ? hero : null;
            } else if (shown && !n.dead) {
                removeShip(n.id);
            }
        }

        Object.assign(hero, {
            x: h.x, y: h.y, hp: h.alive ? h.hp : 0,
            shield: h.shield[cfg], maxShield: HERO.maxShield[cfg], speed: HERO.speed[cfg]
        });
        cam.x = h.x;
        cam.y = h.y;
    }
}

// ------------------------------------------------- DOM: полотно гри й клавіатура

const canvas = {
    tagName: 'CANVAS', width: SCREEN.w, height: SCREEN.h,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: SCREEN.w, bottom: SCREEN.h, width: SCREEN.w, height: SCREEN.h }),
    dispatchEvent(e) {
        stat.inputs++;

        if (!map.hero) {
            return true;
        }

        if (e.type === 'pointerdown') {
            // кнопку натиснули, не відпустивши: мишу водночас ведуть дві дії бота
            if (input.down) {
                stat.doublePress++;
            }

            // по NPC — виділення (і лазери вимикаються, як у lockOnTarget), інакше — політ
            for (const ship of map.ships.values()) {
                const p = toScreen(ship.x, ship.y);

                if (ship.isNpc && ship.hp > 0 && Math.hypot(p.x - e.clientX, p.y - e.clientY) < 35) {
                    if (map.lockedTarget !== ship) {
                        clearTarget();
                        map.lockedTarget = ship;
                    }

                    return true;
                }
            }

            // як MapManager.onPointerDown: прапорець ставить лише клік у порожнечу
            Object.assign(input, { down: true, x: e.clientX, y: e.clientY });
            map.isPointerDown = true;
            S.hero.target = inWorld(toWorld(input.x, input.y));
        } else if (e.type === 'pointermove' && input.down) {
            Object.assign(input, { x: e.clientX, y: e.clientY });
        } else if (e.type === 'pointerup') {
            input.down = false;
            map.isPointerDown = false;
        }

        return true;
    }
};

const body = {
    tagName: 'BODY',
    dispatchEvent(e) {
        const key = e.type === 'keydown' && map.hero ? e.key.toLowerCase() : '';

        stat.inputs++;

        if (key === 'control') {
            if (map.hero.isAttacking) {
                map.hero.isAttacking = false;
                map.hero.attackTarget = null;
            } else if (map.lockedTarget) {
                map.hero.isAttacking = true;
                map.hero.attackTarget = map.lockedTarget;
            }
        } else if (key === 'c') {
            map.attemptConfigChange();
        } else if (key === 'j') {
            serverJump();
        }

        return true;
    }
};

class FakeEvent {
    constructor(type, init) {
        Object.assign(this, init);
        this.type = type;
    }
}

globalThis.window = globalThis;
globalThis.document = {
    querySelector: sel => sel === '#game-container canvas' ? canvas : null,
    querySelectorAll: sel => sel === '#do-rad-notification' ? radElements.slice()
        : sel.indexOf('script') === 0 ? [{ src: pathToFileURL(path.join(here, 'fakegame.mjs')).href }] : [],
    getElementById: id => id === 'do-rad-notification' ? radElements[0] || null : null,
    elementFromPoint: () => canvas,
    activeElement: body,
    body: body,
    head: { appendChild() {} },
    visibilityState: 'visible',
    createElement: () => ({ remove() {} })
};
globalThis.PointerEvent = FakeEvent;
globalThis.MouseEvent = FakeEvent;
globalThis.KeyboardEvent = FakeEvent;
globalThis.Worker = undefined;   // таймер бота — на setTimeout, тобто на віртуальному часі

// ------------------------------------------------- сценарій

initClientMap();
later(STEP, tick);

let code;

try {
    code = fs.readFileSync(BOT, 'utf8');
} catch (e) {
    realError('не прочитав ' + BOT + ': ' + e.message);
    process.exit(2);
}

// як вставка в консоль
new Function('return ' + code.trim())().catch(e => console.error('запуск бота:', e));

// поки бот по-справжньому вантажить «бандл гри», віртуальний час стоїть: інакше скільки тактів
// він устигне пройти, залежало б від швидкості машини, і той самий сід давав би різні прогони
for (const until = performance.now() + 30000; !globalThis.goBot && !errors.length && performance.now() < until;) {
    await new Promise(r => realSetTimeout(r, 5));
}

if (!globalThis.goBot) {
    realError('бот не стартував' + (errors.length ? ': ' + errors.join('; ') : ''));
    process.exit(2);
}

const goBot = globalThis.goBot;

goBot.config.gateRounds = ROUNDS;

if (args.cfg) {
    try {
        Object.assign(goBot.config, JSON.parse(args.cfg));
    } catch (e) {
        realError('--cfg не JSON: ' + e.message);
        process.exit(2);
    }
}

const call = (text, fn) => {
    const reply = fn();

    show('>> ' + text + ' = ' + JSON.stringify(reply));

    return reply;
};
const running = () => goBot.status().працює;

// скільки часу бот провів за кожною дією гейта
const actionTime = {};

(function sample() {
    const st = goBot.status();

    if (st.працює && st.гейт && st.гейт !== 'ні') {
        const action = String(st.гейт).replace(/^раунд \d+\/\d+, /, '').replace(/ \d+$/, '');

        actionTime[action] = (actionTime[action] || 0) + 1;
    }

    later(1000, sample);
})();

const limit = (+args.minutes || (SCENARIO === 'farm' ? 6 : 60 * (ROUNDS - FROM + 1))) * 60000;

// після вставки бот чекає команди: секунда тиші, і ні миші, ні клавіш
const selfStarted = running();

await runUntil(null, 1000);

const idleInputs = stat.inputs;

let reply = null;

if (SCENARIO === 'farm') {
    spawnGroup(4, 1);
    spawnGroup(4, 1);
    call('goBot.startKillNpc()', () => goBot.startKillNpc());
    await runUntil(null, limit);
    call('goBot.stop()', () => goBot.stop());
    await runUntil(null, 2000);
} else {
    if (SCENARIO === 'nostop' || SCENARIO === 'restart') {
        // бот збирає коробки біля порталу; гейт — без stop() або одразу після нього
        call('goBot.start()', () => goBot.start());
        await runUntil(null, SCENARIO === 'nostop' ? 500 : 2500);

        if (SCENARIO === 'restart') {
            call('goBot.stop()', () => goBot.stop());
            Object.assign(S.hero, { x: PORTAL.x + 220, y: PORTAL.y + 90, target: null });
        }
    } else if (SCENARIO !== 'inside') {
        const far = SCENARIO === 'far';

        Object.assign(S.hero, { x: PORTAL.x + (far ? 1600 : 220), y: PORTAL.y + (far ? 0 : 90), target: null });
        show('(гравець підвів корабель до порталу' + (far ? ', але не близько' : '') + ')');
        await runUntil(null, 1000);
    }

    const started = vnow;

    reply = call('goBot.startPassGalaxyGate(' + (FROM > 1 ? FROM : '') + ')',
        () => goBot.startPassGalaxyGate(FROM > 1 ? FROM : undefined));

    if (args.stopat) {
        await runUntil(() => !running(), +args.stopat * 1000);
        call('goBot.stop()', () => goBot.stop());
    }

    await runUntil(() => !running(), Math.max(0, limit - (vnow - started)));
    await runUntil(null, 1500);
}

// ------------------------------------------------- підсумок

const st = goBot.status();
const flees = botLog.filter(text => text.includes('на 2-гу конфігурацію й геть')).length;
const wholeGate = SCENARIO !== 'farm' && SCENARIO !== 'far' && !args.stopat;
const problems = [];

if (errors.length) {
    problems.push('помилок ' + errors.length);
}
if (selfStarted || idleInputs) {
    problems.push('бот почав діяти сам, без команди' + (idleInputs ? ', подій миші й клавіатури: ' + idleInputs : ''));
}
if (stat.deaths) {
    problems.push('корабель знищено');
}
if (stat.doublePress) {
    problems.push('мишу натиснуто, не відпустивши, ' + stat.doublePress + ' раз(и) — дві дії бота водночас');
}
// за край карти бот не має залітати взагалі; невідому зону-коло — хіба що ненадовго
if (stat.radSeconds > (args.radcircle ? 60 : 0)) {
    problems.push('у радіації ' + stat.radSeconds + ' с');
}

if (SCENARIO === 'farm') {
    if (!stat.kills) {
        problems.push('жодного знищеного NPC');
    }
} else if (SCENARIO === 'far') {
    if (!/^підлети/.test(String(reply))) {
        problems.push('бот не відмовився стартувати далеко від порталу');
    }
    if (st.гейт !== 'ні') {
        problems.push('гейт усе ж запущено');
    }
} else if (args.stopat) {
    if (st.працює || st.гейт !== 'ні') {
        problems.push('бот не зупинився після stop()');
    }
} else if (st.працює) {
    problems.push('не встиг за ' + Math.round(limit / 60000) + ' хв віртуального часу, гейт: ' + st.гейт);
} else {
    const want = ROUNDS - FROM + 1;

    if (stat.rounds.length !== want) {
        problems.push('раундів зачищено ' + stat.rounds.length + ' з ' + want);
    }
    if (S.mapId !== HOME_MAP) {
        problems.push('корабель не вдома');
    }
}

const result = {
    scenario: SCENARIO,
    seed: SEED,
    ok: !problems.length,
    problems: problems,
    virtualMin: Math.round((vnow - T0) / 6000) / 10,
    realSec: Math.round((performance.now() - realStart) / 100) / 10,
    rounds: wholeGate ? ROUNDS - FROM + 1 : 0,
    cleared: stat.rounds.length,
    kills: stat.kills,
    deaths: stat.deaths,
    minHp: Math.round(stat.minHpPct * 10) / 10,
    flees: flees,
    radSeconds: stat.radSeconds,
    errors: errors.length
};
const pct = n => Math.round(n / Math.max(1, stat.fightTicks) * 100) + '%';

say('');
say('================ підсумок: ' + SCENARIO + ', сід ' + SEED);
say('віртуальний час ' + vt() + ' (реальний ' + result.realSec + ' с); бот працює: ' + (st.працює ? 'так' : 'ні') + ', гейт: ' + st.гейт);
say('сервер: ' + (S.mapId === HOME_MAP ? 'вдома' : S.mapId === GATE_MAP ? 'у гейті, раунд ' + S.round : 'карта ' + S.mapId)
    + ', HP ' + Math.round(S.hero.hp / HERO.maxHp * 100) + '%, мінімум ' + result.minHp + '%, смертей ' + stat.deaths);

if (SCENARIO !== 'farm') {
    say('раундів зачищено ' + stat.rounds.length + (wholeGate ? '/' + result.rounds : '')
        + (stat.rounds.length ? ' за ' + stat.rounds.map(r => (r.ms / 60000).toFixed(1)).join(', ') + ' хв' : '')
        + '; стрибків ' + stat.jumps + ', невдалих ' + stat.jumpFails);
}

say('знищено NPC ' + stat.kills + ', втеч ' + flees + '; конфігурацію змінено ' + stat.cfgSwitches + ' раз(и), сервер відмовив '
    + stat.cfgRejected + ', клієнт відмовив ' + stat.clientCooldown);
say('ціль під час стрільби: ' + Object.keys(stat.dist).map(k => k + ' ' + pct(stat.dist[k])).join(', '));
say('по кораблю б\'ють одночасно: у середньому ' + (stat.attackerTicks / Math.max(1, stat.ticks)).toFixed(2)
    + ', найбільше ' + stat.maxAttackers + '; влучань ' + stat.hits);
say('радіація: ' + stat.radSeconds + ' с, заходів ' + stat.radEntries);

if (Object.keys(actionTime).length) {
    say('час за діями гейта, с: ' + Object.entries(actionTime).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', '));
}

for (const e of errors.slice(0, 5)) {
    say('ПОМИЛКА: ' + e);
}

if (errors.length > 5) {
    say('…і ще помилок: ' + (errors.length - 5));
}

say('РЕЗУЛЬТАТ: ' + (problems.length ? 'ПРОБЛЕМА — ' + problems.join('; ') : 'OK'));

if (args.json) {
    realLog(JSON.stringify(result));
}

process.exit(problems.length ? 1 : 0);
