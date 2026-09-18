/**
 * Global Orbit — автозбирач коробок.
 *
 * Вставити в консоль браузера на https://globalorbit.online/map-revolution
 *
 *   goBot.start()   — запустити
 *   goBot.stop()    — зупинити
 *   goBot.status()  — статистика
 *   goBot.boxes()   — що бот зараз бачить (таблиця)
 *   goBot.startKillNpc() — ще й атакувати NPC (коробки все одно в пріоритеті)
 *   goBot.stopKillNpc()  — перестати атакувати NPC
 *   goBot.npcs()    — які NPC бот зараз бачить (таблиця)
 *   goBot.config    — налаштування (міняються на льоту)
 *
 * Як воно працює:
 *   гра — це Vite ESM-бандл у <iframe src="/spacemap/index.html">. Повторний
 *   import() того самого URL усередині фрейму повертає той самий (уже
 *   виконаний) модуль, тому з нього дістається живий SceneManager, а з нього
 *   MapManager зі своїм станом: map.boxes (Map<hash, спрайт коробки>),
 *   map.hero, map.displayLayer (камера).
 *
 *   Сам збір робиться НЕ викликом внутрішніх методів, а справжнім кліком:
 *   світові координати коробки переводяться в екранні й туди відправляється
 *   pointermove/pointerdown/pointerup, як від миші. Далі все робить сама гра —
 *   MapManager.onBoxClicked() летить до коробки і в своєму update() шле
 *   sendCollectBoxRequest(), коли корабель підлетів ближче ніж на 20 одиниць.
 *
 *   NPC бот атакує так само, як людина: клік по кораблю виділяє ціль
 *   (MapManager.lockOnTarget), Ctrl вмикає лазери (toggleAttack). Дистанцію гра
 *   сама не тримає, тому бот підлітає, коли ціль далі за npcRange. Щойно видно
 *   потрібну коробку, бот кидається по неї — лазери при цьому б'ють далі, поки
 *   NPC у радіусі, а після збору бот повертається до тієї ж цілі.
 */
(async function () {
    'use strict';

    const CONFIG = {
        include: ['BONUS_BOX'],     // масив підрядків типів, null = всі коробки
        exclude: [],                // напр. ['ORE'] щоб не брати руду
                                    // типи: BONUS_BOX, CARGO_BOX, FROM_SHIP, ORE,
                                    // ALIEN, GIFT_BOXES, PIRATE_BOOTY[_RED|_BLUE|_GOLD]

        dryRun: false,              // true = тільки дивитись, нічого не клікати
        scanRadius: 0,              // радіус пошуку в світових одиницях, 0 = без ліміту
        edgeMargin: 70,             // не клікати ближче ніж стільки px до краю екрана
        mapPadding: 600,            // не підлітати ближче ніж стільки одиниць до краю карти
        checkOverlap: true,         // не клікати крізь відкриті вікна інтерфейсу
        stopWhenCargoFull: true,

        collectTimeout: 30000,      // максимум часу на політ до коробки, мс
        slowTypes: ['PIRATE_BOOTY'], // типи, які збираються довго (зелені/сині/червоні скрині)
        slowHoldMs: 6000,           // скільки стояти на місці після прильоту до такої коробки
        blacklistTime: 25000,       // скільки ігнорувати коробку після невдачі, мс

        // бій з NPC (goBot.startKillNpc)
        npcInclude: null,           // масив підрядків імені NPC, null = всі
        npcExclude: [],             // напр. ['Boss'] щоб не чіпати
        npcScanRadius: 0,           // радіус пошуку NPC, 0 = всі, кого показує гра (~2000 од.)
        npcRange: 550,              // далі цього підлітати до цілі (лазер б'є на ~700)
        npcMinHpPct: 30,            // не починати новий бій, коли HP корабля нижче, %
        npcStuckMs: 20000,          // кинути ціль, якщо стільки часу її HP і щит не падають
        npcBlacklistTime: 60000,    // скільки ігнорувати кинуту ціль, мс

        // політ: курсор тримається натиснутим біля краю екрана, корабель за ним
        steerRadius: 0.40,          // частка меншої сторони екрана — де тримати курсор
        steerTick: [70, 170],       // як часто підправляти курс під час польоту, мс
        steerTurn: 0.14,            // максимальний доворот за один тік, рад
        roamMaxMs: [12000, 28000],  // скільки летіти в один бік, поки нічого не видно
        approachMaxMs: 40000,       // максимум на підліт до вже поміченої коробки

        // «людськість»
        pause: [260, 900],          // пауза між діями
        reactPause: [180, 450],     // реакція, коли коробка щойно потрапила в поле зору
        longPauseChance: 0.07,      // іноді довша пауза — ніби відволікся
        longPause: [2500, 8000],
        mouseSteps: [8, 18],        // кроків у русі миші до цілі
        mouseStepDelay: [8, 22],
        clickHold: [45, 130],       // скільки тримати кнопку натиснутою
        keyHold: [60, 140],         // скільки тримати клавішу
        aimJitter: 7,               // розкид кліка навколо центру коробки, px
        pickSecondBestChance: 0.18  // іноді брати не найближчу, а другу
    };

    // гра перевіряє дистанцію до (box.x, box.y - 95), а не до центру коробки
    const COLLECT_Y_OFFSET = 95;

    let sleep = ms => new Promise(r => setTimeout(r, ms));
    let timerWorker = null;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const rndOf = range => rnd(range[0], range[1]);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const pad = n => String(n).padStart(2, '0');
    const stamp = () => {
        const d = new Date();

        return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    };
    const log = (...args) => console.log('%c[goBot ' + stamp() + ']', 'color:#66d9ef;font-weight:bold', ...args);
    const grid = (x, y) => Math.round(x / 100) + '/' + Math.round(y / 100);

    // ------------------------------------------------------------ вхід у гру

    function findGameFrame() {
        if (document.querySelector('#game-container canvas')) {
            return { win: window, doc: document };
        }
        for (const frame of document.querySelectorAll('iframe')) {
            let frameDoc = null;
            try {
                frameDoc = frame.contentDocument;
            } catch (e) {
                continue;
            }
            if (frameDoc && frameDoc.querySelector('#game-container canvas')) {
                return { win: frame.contentWindow, doc: frameDoc };
            }
        }
        return null;
    }

    function importViaScriptTag(win, doc, url) {
        return new Promise((resolve, reject) => {
            const key = '__goBotMod' + Math.random().toString(36).slice(2);
            const el = doc.createElement('script');

            el.type = 'module';
            el.textContent =
                'import(' + JSON.stringify(url) + ')' +
                '.then(m => { window[' + JSON.stringify(key) + '] = { ok: m }; })' +
                '.catch(e => { window[' + JSON.stringify(key) + '] = { err: String(e) }; });';
            doc.head.appendChild(el);

            const started = Date.now();

            (function poll() {
                const res = win[key];

                if (res) {
                    delete win[key];
                    el.remove();

                    return res.ok ? resolve(res.ok) : reject(new Error(res.err));
                }

                if (Date.now() - started > 15000) {
                    el.remove();

                    return reject(new Error('import timeout: ' + url));
                }

                setTimeout(poll, 25);
            })();
        });
    }

    // import() має виконатись у реалмі фрейму, інакше це буде друга, мертва копія модуля
    async function importInFrame(win, doc, url) {
        try {
            const mod = await new win.Function('u', 'return import(u);')(url);

            if (mod) {
                return mod;
            }
        } catch (e) {
            log('import через Function не вийшов, пробую <script type=module>:', e.message || e);
        }

        return importViaScriptTag(win, doc, url);
    }

    function pickSceneManager(ns) {
        if (!ns) {
            return null;
        }

        for (const value of Object.values(ns)) {
            if (value && typeof value === 'object' && value.SceneManager && 'app' in value.SceneManager) {
                return value.SceneManager;
            }
            if (typeof value === 'function' && 'app' in value && 'currentScene' in value) {
                return value;
            }
        }

        return null;
    }

    async function findSceneManager(win, doc) {
        const urls = Array.from(doc.querySelectorAll('script[type="module"][src]')).map(s => s.src);

        for (const url of urls) {
            let ns;

            try {
                ns = await importInFrame(win, doc, url);
            } catch (e) {
                continue;
            }

            const sceneManager = pickSceneManager(ns);

            if (sceneManager) {
                return sceneManager;
            }
        }

        return null;
    }

    // у прихованій вкладці setTimeout підрізається до ~1с (а згодом і до 1/хв),
    // тому таймер бота тікає з Web Worker — так само, як це робить сам рушій гри
    function makeSleep(win) {
        const pending = [];

        let worker;

        try {
            const blob = new win.Blob(['setInterval(() => postMessage(0), 10);'], { type: 'application/javascript' });

            worker = new win.Worker(win.URL.createObjectURL(blob));
            worker.onmessage = flush;
        } catch (e) {
            return { sleep: ms => new Promise(r => setTimeout(r, ms)), worker: null };
        }

        function flush() {
            const now = Date.now();

            for (let i = pending.length - 1; i >= 0; i--) {
                if (pending[i].at <= now) {
                    pending.splice(i, 1)[0].done();
                }
            }
        }

        return {
            worker: worker,
            sleep: ms => new Promise(resolve => {
                pending.push({ at: Date.now() + ms, done: resolve });
                setTimeout(flush, ms);   // страховка, якщо воркер помре
            })
        };
    }

    const frame = findGameFrame();

    if (!frame) {
        throw new Error('[goBot] не знайшов фрейм гри — відкрий /map-revolution і дочекайся завантаження карти');
    }

    const win = frame.win;
    const doc = frame.doc;
    const canvas = doc.querySelector('#game-container canvas');
    const timer = makeSleep(win);

    sleep = timer.sleep;
    timerWorker = timer.worker;
    const sceneManager = await findSceneManager(win, doc);

    if (!sceneManager || !sceneManager.app) {
        throw new Error('[goBot] не дістав SceneManager з бандла гри');
    }

    const app = sceneManager.app;

    function isMapManager(o) {
        return !!o && typeof o.createBox === 'function' && !!o.boxes && typeof o.boxes.values === 'function';
    }

    function findMapManager(node, depth) {
        if (!node || depth > 3) {
            return null;
        }
        if (isMapManager(node)) {
            return node;
        }
        for (const kid of node.children || []) {
            const found = findMapManager(kid, depth + 1);

            if (found) {
                return found;
            }
        }

        return null;
    }

    function getMap() {
        const scene = sceneManager.currentScene;

        return isMapManager(scene) ? scene : findMapManager(app.stage, 0);
    }

    if (!getMap()) {
        throw new Error('[goBot] карта ще не ініціалізована — дочекайся входу в гру і запусти ще раз');
    }

    // ------------------------------------------------- світ <-> екран

    function globalToClient(p) {
        const rect = canvas.getBoundingClientRect();
        const res = (app.renderer && app.renderer.resolution) || 1;
        const kx = canvas.width ? rect.width / canvas.width : 1;
        const ky = canvas.height ? rect.height / canvas.height : 1;

        return {
            x: rect.left + p.x * res * kx,
            y: rect.top + p.y * res * ky
        };
    }

    function worldToClient(map, wx, wy) {
        return globalToClient(map.displayLayer.toGlobal({ x: wx, y: wy }));
    }

    function boxToClient(map, box) {
        if (typeof box.getGlobalPosition === 'function') {
            try {
                return globalToClient(box.getGlobalPosition());
            } catch (e) { /* нижче фолбек */ }
        }

        return worldToClient(map, box.x, box.y);
    }

    // корабель — обгортка, сам PIXI-вузол у нього в pixiContainer
    function shipToClient(map, ship) {
        return boxToClient(map, ship.pixiContainer || ship);
    }

    function inRect(p, rect, margin) {
        return p.x >= rect.left + margin && p.x <= rect.right - margin
            && p.y >= rect.top + margin && p.y <= rect.bottom - margin;
    }

    function isClickable(p, rect) {
        rect = rect || canvas.getBoundingClientRect();

        if (!inRect(p, rect, CONFIG.edgeMargin)) {
            return false;
        }
        if (!CONFIG.checkOverlap) {
            return true;
        }

        // якщо зверху відкрите вікно інтерфейсу — людина туди не клікне
        return doc.elementFromPoint(p.x, p.y) === canvas;
    }

    function clampToRect(from, to, rect, margin) {
        const minX = rect.left + margin;
        const maxX = rect.right - margin;
        const minY = rect.top + margin;
        const maxY = rect.bottom - margin;
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        if (!dx && !dy) {
            return null;
        }

        let k = 1;

        if (dx > 0) k = Math.min(k, (maxX - from.x) / dx);
        if (dx < 0) k = Math.min(k, (minX - from.x) / dx);
        if (dy > 0) k = Math.min(k, (maxY - from.y) / dy);
        if (dy < 0) k = Math.min(k, (minY - from.y) / dy);

        k = clamp(k, 0, 1);

        return k <= 0.02 ? null : { x: from.x + dx * k, y: from.y + dy * k };
    }

    // ------------------------------------------------- емуляція миші

    const cursor = { x: 0, y: 0, ready: false };

    function fire(type, x, y, buttons) {
        const base = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: win,
            clientX: x,
            clientY: y,
            screenX: Math.round(x),
            screenY: Math.round(y),
            button: 0,
            buttons: buttons,
            detail: type === 'click' ? 1 : 0
        };

        let event;

        if (type.indexOf('pointer') === 0) {
            const PointerCtor = win.PointerEvent || window.PointerEvent;

            event = new PointerCtor(type, Object.assign({
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
                width: 1,
                height: 1,
                pressure: buttons ? 0.5 : 0
            }, base));
        } else {
            const MouseCtor = win.MouseEvent || window.MouseEvent;

            event = new MouseCtor(type, base);
        }

        canvas.dispatchEvent(event);
    }

    function ease(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    // рух по дузі з прискоренням і дрібним тремтінням — не по ідеальній прямій
    async function moveMouse(x, y, buttons, minSteps) {
        buttons = buttons || 0;

        if (!cursor.ready) {
            cursor.x = x;
            cursor.y = y;
            cursor.ready = true;
            fire('pointermove', x, y, buttons);
            fire('mousemove', x, y, buttons);

            return;
        }

        const x0 = cursor.x;
        const y0 = cursor.y;
        const dx = x - x0;
        const dy = y - y0;
        const dist = Math.hypot(dx, dy) || 1;
        const floor = minSteps === undefined ? CONFIG.mouseSteps[0] : minSteps;
        const steps = Math.round(clamp(dist / 40, floor, CONFIG.mouseSteps[1]));
        const bend = rnd(-1, 1) * Math.min(90, dist * 0.35);
        const cx = x0 + dx / 2 - (dy / dist) * bend;
        const cy = y0 + dy / 2 + (dx / dist) * bend;

        for (let i = 1; i <= steps; i++) {
            const t = ease(i / steps);
            const m = 1 - t;
            const px = m * m * x0 + 2 * m * t * cx + t * t * x + rnd(-0.8, 0.8);
            const py = m * m * y0 + 2 * m * t * cy + t * t * y + rnd(-0.8, 0.8);

            fire('pointermove', px, py, buttons);
            fire('mousemove', px, py, buttons);
            await sleep(rndOf(CONFIG.mouseStepDelay));
        }

        cursor.x = x;
        cursor.y = y;
    }

    async function press(x, y) {
        fire('pointerdown', x, y, 1);
        fire('mousedown', x, y, 1);
        await sleep(rndOf(CONFIG.clickHold));
        fire('pointerup', x, y, 0);
        fire('mouseup', x, y, 0);
        fire('click', x, y, 0);
    }

    async function click(x, y) {
        await moveMouse(x, y);
        await press(x, y);
    }

    // клік по цілі, що їде по екрану: поки ведемо мишу, камера рухається за кораблем,
    // тому перед натисканням перецілюємось на актуальну позицію
    async function clickTarget(aim) {
        let point = aim();

        if (!point) {
            return false;
        }

        for (let i = 0; i < 3; i++) {
            await moveMouse(point.x, point.y);

            const next = aim();

            if (!next) {
                return false;
            }

            const drift = Math.hypot(next.x - point.x, next.y - point.y);

            point = next;

            if (drift <= 4) {
                break;
            }
        }

        await press(point.x, point.y);

        return true;
    }

    // клавіатура: гра слухає keydown на document свого фрейму (Ctrl — атака)
    async function tapKey(key, code) {
        const active = doc.activeElement;

        // поки фокус у полі вводу (чат), гра клавіші ігнорує — людина спершу клікнула б у гру
        if (active && active !== doc.body && (/^(input|textarea)$/i.test(active.tagName) || active.isContentEditable)) {
            active.blur();
        }

        const KeyCtor = win.KeyboardEvent || window.KeyboardEvent;
        const target = doc.activeElement || doc.body;
        const init = { key: key, code: code, bubbles: true, cancelable: true, composed: true, view: win };

        target.dispatchEvent(new KeyCtor('keydown', Object.assign({ ctrlKey: key === 'Control' }, init)));
        await sleep(rndOf(CONFIG.keyHold));
        target.dispatchEvent(new KeyCtor('keyup', init));
    }

    // ------------------------------------------------- пошук коробок

    const blacklist = new Map();
    const npcBlacklist = new Map();
    const stats = { tries: 0, collected: 0, failed: 0, kills: 0, since: Date.now() };

    function purgeBlacklist() {
        const now = Date.now();

        for (const list of [blacklist, npcBlacklist]) {
            for (const [key, until] of list) {
                if (until <= now) {
                    list.delete(key);
                }
            }
        }
    }

    // скільки треба простояти на коробці після прильоту, не клікаючи нікуди:
    // будь-який pointerdown викликає в грі cancelCollectionBeamForUser і збір зривається
    function collectHold(type) {
        const t = String(type || '');

        return CONFIG.slowTypes.some(p => t.includes(p)) ? CONFIG.slowHoldMs : 0;
    }

    function typeAllowed(type) {
        const t = String(type || '');

        if (CONFIG.exclude.some(p => t.includes(p))) {
            return false;
        }

        return !CONFIG.include || CONFIG.include.some(p => t.includes(p));
    }

    function listBoxes(map) {
        map = map || getMap();

        const out = [];

        if (!map || !map.hero) {
            return out;
        }

        const hero = map.hero;
        const rect = canvas.getBoundingClientRect();

        for (const box of map.boxes.values()) {
            if (!box || box.destroyed || typeof box.x !== 'number') {
                continue;
            }

            const client = boxToClient(map, box);

            out.push({
                hash: box.hash,
                type: box.boxType,
                x: box.x,
                y: box.y,
                pos: grid(box.x, box.y),
                dist: Math.round(Math.hypot(box.x - hero.x, (box.y - COLLECT_Y_OFFSET) - hero.y)),
                visible: box.visible !== false,
                onScreen: inRect(client, rect, 0),
                clickable: isClickable(client, rect),
                client: client,
                box: box
            });
        }

        out.sort((a, b) => a.dist - b.dist);

        return out;
    }

    // все, що перехопить клік замість фону карти
    function screenObjects(map) {
        const out = [];
        const add = obj => {
            if (obj && typeof obj.x === 'number' && obj.visible !== false) {
                out.push(obj);
            }
        };

        for (const box of map.boxes.values()) add(box);
        for (const ship of map.ships.values()) add(ship);
        for (const station of map.stations.values()) add(station);
        for (const portal of map.portals || []) add(portal);
        add(map.hero);

        return out;
    }

    // клік по кораблю/порталу/станції гра обробить як вибір цілі, а не як політ
    function isFreeSpace(map, point, minPx) {
        for (const obj of screenObjects(map)) {
            const p = worldToClient(map, obj.x, obj.y);

            if (Math.hypot(p.x - point.x, p.y - point.y) < minPx) {
                return false;
            }
        }

        return true;
    }

    function pickTarget(map) {
        const now = Date.now();
        const list = listBoxes(map).filter(b =>
            b.visible
            && typeAllowed(b.type)
            && (!CONFIG.scanRadius || b.dist <= CONFIG.scanRadius)
            && !(blacklist.get(b.hash) > now)
        );

        if (!list.length) {
            return null;
        }
        if (list.length > 1 && Math.random() < CONFIG.pickSecondBestChance) {
            return list[1];
        }

        return list[0];
    }

    // ------------------------------------------------- пошук NPC

    function nameAllowed(name) {
        if (CONFIG.npcExclude.some(p => name.includes(p))) {
            return false;
        }

        return !CONFIG.npcInclude || CONFIG.npcInclude.some(p => name.includes(p));
    }

    // die() обнуляє hp ще до того, як корабель прибирають із map.ships
    function npcDead(ship) {
        return ship.hp <= 0;
    }

    function listNpcs(map) {
        map = map || getMap();

        const out = [];

        if (!map || !map.hero) {
            return out;
        }

        const hero = map.hero;
        const rect = canvas.getBoundingClientRect();

        for (const ship of map.ships.values()) {
            if (!ship || ship === hero || !ship.isNpc || ship.isPet || typeof ship.x !== 'number' || npcDead(ship)) {
                continue;
            }

            const client = shipToClient(map, ship);

            out.push({
                id: ship.userId,
                name: String(ship.userName || ship.shipId || 'NPC').trim(),
                pos: grid(ship.x, ship.y),
                dist: Math.round(Math.hypot(ship.x - hero.x, ship.y - hero.y)),
                visible: ship.visible !== false && !ship.isCloaked,
                onScreen: inRect(client, rect, 0),
                clickable: isClickable(client, rect),
                ship: ship
            });
        }

        out.sort((a, b) => a.dist - b.dist);

        return out;
    }

    let lowHpLoggedAt = 0;

    function pickNpc(map) {
        const now = Date.now();
        const hero = map.hero;
        const list = listNpcs(map).filter(n =>
            n.visible
            && nameAllowed(n.name)
            && (!CONFIG.npcScanRadius || n.dist <= CONFIG.npcScanRadius)
            && !(n.ship.untargetableUntil > now)
            && !(npcBlacklist.get(n.id) > now)
        );

        if (!list.length) {
            return null;
        }

        // ціль, яку вже виділили чи б'ємо, не міняємо
        const current = list.find(n => n.ship === hero.attackTarget || n.ship === map.lockedTarget);

        if (current) {
            return current;
        }

        if (hero.maxHp && hero.hp / hero.maxHp * 100 < CONFIG.npcMinHpPct) {
            if (now - lowHpLoggedAt > 60000) {
                lowHpLoggedAt = now;
                log('HP ' + Math.round(hero.hp / hero.maxHp * 100) + '% — нових NPC не чіпаю, поки не підлікуюсь');
            }

            return null;
        }

        return list[0];
    }

    // ------------------------------------------------- дії

    // Політ із затиснутою кнопкою — так літають гравці.
    // Гра щокадру робить displayLayer.toLocal(курсор), а камера їде за кораблем,
    // тому курсор біля краю екрана — це ціль, яка постійно тікає вперед: корабель
    // летить безперервно на повній швидкості. Одиночні кліки натомість дають
    // «долетів — став — полетів» ривками.
    async function drag(map, aim, done, maxMs) {
        let point = aim();

        if (!point || (done && done())) {
            return !!point;
        }

        point = freeSpot(map, point);

        await moveMouse(point.x, point.y);
        fire('pointerdown', point.x, point.y, 1);
        fire('mousedown', point.x, point.y, 1);

        const started = Date.now();

        let reached = false;

        try {
            while (running && Date.now() - started < maxMs) {
                await sleep(rndOf(CONFIG.steerTick));

                if (done && done()) {
                    reached = true;
                    break;
                }

                point = aim();

                if (!point) {
                    break;
                }

                await moveMouse(point.x, point.y, 1, 1);
            }
        } finally {
            fire('pointermove', cursor.x, cursor.y, 1);
            fire('pointerup', cursor.x, cursor.y, 0);
            fire('mouseup', cursor.x, cursor.y, 0);
            fire('click', cursor.x, cursor.y, 0);
        }

        return reached;
    }

    // Перший натиск мусить влучити в порожнечу: клік по кораблю гра обробить як
    // вибір цілі, по коробці — як збір, і польоту не буде. Під час самого
    // перетягування це вже неважливо — реагує тільки pointerdown.
    function freeSpot(map, point) {
        const rect = canvas.getBoundingClientRect();

        if (isFreeSpace(map, point, 55)) {
            return point;
        }
        if (!map.hero) {
            return point;
        }

        const from = worldToClient(map, map.hero.x, map.hero.y);
        const base = Math.atan2(point.y - from.y, point.x - from.x);
        const far = Math.hypot(point.x - from.x, point.y - from.y);

        for (let i = 1; i <= 8; i++) {
            const angle = base + (i % 2 ? 1 : -1) * 0.22 * Math.ceil(i / 2);
            const candidate = { x: from.x + Math.cos(angle) * far, y: from.y + Math.sin(angle) * far };

            if (isClickable(candidate, rect) && isFreeSpace(map, candidate, 55)) {
                return candidate;
            }
        }

        return point;
    }

    // точка, за яку «тягнемо» корабель: на краю екрана в заданому напрямку
    function steerPoint(map, angle) {
        if (!map.hero) {
            return null;
        }

        const rect = canvas.getBoundingClientRect();
        const from = worldToClient(map, map.hero.x, map.hero.y);
        const far = Math.min(rect.width, rect.height) * CONFIG.steerRadius;
        const raw = { x: from.x + Math.cos(angle) * far, y: from.y + Math.sin(angle) * far };

        return clampToRect(from, raw, rect, CONFIG.edgeMargin) || {
            x: clamp(raw.x, rect.left + CONFIG.edgeMargin, rect.right - CONFIG.edgeMargin),
            y: clamp(raw.y, rect.top + CONFIG.edgeMargin, rect.bottom - CONFIG.edgeMargin)
        };
    }

    function lerpAngle(a, b, t) {
        let d = b - a;

        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;

        return a + d * t;
    }

    async function waitCollected(map, target) {
        const holdMs = collectHold(target.type);
        const deadline = Date.now() + CONFIG.collectTimeout + holdMs;

        let lastPos = '';
        let movedAt = Date.now();
        let arrivedAt = 0;

        while (Date.now() < deadline) {
            await sleep(180);

            if (!running) {
                return false;
            }

            const hero = map.hero;

            if (!hero) {
                return false;
            }

            const gone = !map.boxes.has(target.hash);
            const near = Math.hypot(target.x - hero.x, (target.y - COLLECT_Y_OFFSET) - hero.y) <= 30;

            if (near && !arrivedAt) {
                arrivedAt = Date.now();

                if (holdMs) {
                    log('стою на ' + target.type + ' ' + Math.round(holdMs / 1000) + 'с');
                }
            }

            if (arrivedAt) {
                const held = Date.now() - arrivedAt;

                // повільні скрині: вистоюємо весь час збору, навіть якщо спрайт уже зник
                if (held < holdMs) {
                    continue;
                }
                if (gone) {
                    return true;
                }
                // стоїмо на місці, а сервер коробку так і не прибрав
                if (held > holdMs + 4000) {
                    return false;
                }

                continue;
            }

            // забрав хтось інший, поки ми летіли
            if (gone) {
                return true;
            }

            const pos = Math.round(hero.x) + ':' + Math.round(hero.y);

            if (pos !== lastPos) {
                lastPos = pos;
                movedAt = Date.now();
            } else if (Date.now() - movedAt > 2600 && !map.targetBoxToCollect) {
                return false;
            }
        }

        return false;
    }

    async function collectBox(map, target) {
        const jx = rnd(-CONFIG.aimJitter, CONFIG.aimJitter);
        const jy = rnd(-CONFIG.aimJitter, CONFIG.aimJitter);
        const aim = () => {
            if (target.box.destroyed || !map.boxes.has(target.hash)) {
                return null;
            }

            const c = boxToClient(map, target.box);

            // поки наводили мишу, корабель летів далі за попереднім курсом і коробка
            // могла піти за край екрана — тоді клік влучив би у фон, а не в неї
            if (!isClickable(c)) {
                return null;
            }

            return { x: c.x + jx, y: c.y + jy };
        };

        log('беру ' + target.type + ' @' + target.pos + ' (' + target.dist + ' од.)');

        if (!await clickTarget(aim)) {
            return false;   // коробку забрали, поки ми цілились
        }

        stats.tries++;

        if (await waitCollected(map, target)) {
            stats.collected++;

            return true;
        }

        stats.failed++;
        blacklist.set(target.hash, Date.now() + CONFIG.blacklistTime);
        log('не вийшло забрати ' + target.type + ' @' + target.pos + ', ігнорую ' + Math.round(CONFIG.blacklistTime / 1000) + 'с');

        return false;
    }

    // коробка ще поза екраном — ведемо корабель до неї, не відпускаючи кнопку
    async function approach(map, target) {
        const gone = () => target.box.destroyed || !map.boxes.has(target.hash);

        return drag(map, () => {
            if (!map.hero || gone()) {
                return null;
            }

            const rect = canvas.getBoundingClientRect();
            const from = worldToClient(map, map.hero.x, map.hero.y);

            return clampToRect(from, boxToClient(map, target.box), rect, CONFIG.edgeMargin);
        }, () => gone() || isClickable(boxToClient(map, target.box)), CONFIG.approachMaxMs);
    }

    let roamAngle = Math.random() * Math.PI * 2;

    // плавний доворот курсу + відхід від краю карти
    function turnRoamAngle(map) {
        const hero = map.hero;
        const w = map.mapWidth || 21000;
        const h = map.mapHeight || 13100;
        const pad = CONFIG.mapPadding;

        roamAngle += rnd(-CONFIG.steerTurn, CONFIG.steerTurn);

        const edge = Math.max(
            (pad - hero.x) / pad,
            (hero.x - (w - pad)) / pad,
            (pad - hero.y) / pad,
            (hero.y - (h - pad)) / pad
        );

        // що ближче до краю карти, то сильніше доводимо курс до центру
        if (edge > 0) {
            roamAngle = lerpAngle(roamAngle, Math.atan2(h / 2 - hero.y, w / 2 - hero.x), clamp(edge, 0, 1) * 0.4);
        }
    }

    async function roam(map) {
        return drag(map, () => {
            if (!map.hero) {
                return null;
            }

            turnRoamAngle(map);

            return steerPoint(map, roamAngle);
        }, () => {
            const target = pickTarget(map);

            return !!(target && target.clickable) || (killNpc && !!pickNpc(map));
        }, rndOf(CONFIG.roamMaxMs));
    }

    async function humanPause() {
        await sleep(Math.random() < CONFIG.longPauseChance ? rndOf(CONFIG.longPause) : rndOf(CONFIG.pause));
    }

    // ------------------------------------------------- бій з NPC

    function npcHealth(ship) {
        return (ship.hp || 0) + (ship.shield || 0);
    }

    function isAttackingNpc(map, ship) {
        const hero = map.hero;

        return !!(hero && hero.isAttacking && hero.attackTarget === ship);
    }

    // корабля вже немає на карті: вбили, відлетів за межу видимості або перезаспавнився під тим самим id
    function npcLost(map, target) {
        return map.ships.get(target.id) !== target.ship;
    }

    // Ctrl перемикає атаку, тому тиснемо, тільки коли лазери справді б'ють по NPC
    async function ceaseFire(map) {
        const hero = map && map.hero;

        if (hero && hero.isAttacking && hero.attackTarget && hero.attackTarget.isNpc) {
            await tapKey('Control', 'ControlLeft');
        }
    }

    // Як людина: клік по NPC виділяє його, Ctrl вмикає лазери. Перед Ctrl
    // перевіряємо, що виділився саме він, а не гравець, який опинився під курсором.
    async function engageNpc(map, target) {
        const ship = target.ship;
        const jx = rnd(-CONFIG.aimJitter, CONFIG.aimJitter);
        const jy = rnd(-CONFIG.aimJitter, CONFIG.aimJitter);
        const aim = () => {
            if (npcDead(ship) || npcLost(map, target)) {
                return null;
            }

            const c = shipToClient(map, ship);

            return isClickable(c) ? { x: c.x + jx, y: c.y + jy } : null;
        };

        if (map.lockedTarget !== ship) {
            if (!await clickTarget(aim)) {
                return false;
            }

            await sleep(rndOf(CONFIG.reactPause));

            if (map.lockedTarget !== ship) {
                return false;
            }
        }

        if (isAttackingNpc(map, ship)) {
            return true;
        }

        // лазери ще б'ють по іншій цілі — перший Ctrl їх вимкне
        if (map.hero && map.hero.isAttacking) {
            await tapKey('Control', 'ControlLeft');
            await sleep(rndOf(CONFIG.reactPause));
        }

        if (!running || !killNpc) {
            return false;
        }

        await tapKey('Control', 'ControlLeft');
        await sleep(rnd(200, 400));

        return isAttackingNpc(map, ship);
    }

    // підлітаємо із затиснутою кнопкою — не в сам корабель, а в точку трохи перед ним
    async function chaseNpc(map, target, maxMs) {
        const ship = target.ship;
        const gone = () => npcDead(ship) || npcLost(map, target);

        return drag(map, () => {
            const hero = map.hero;

            if (!hero || gone()) {
                return null;
            }

            const dist = Math.hypot(ship.x - hero.x, ship.y - hero.y) || 1;
            const short = Math.min(dist, CONFIG.npcRange * 0.4);
            const rect = canvas.getBoundingClientRect();
            const from = worldToClient(map, hero.x, hero.y);
            const to = worldToClient(map,
                ship.x - (ship.x - hero.x) / dist * short,
                ship.y - (ship.y - hero.y) / dist * short);

            return clampToRect(from, to, rect, CONFIG.edgeMargin);
        }, () => {
            const hero = map.hero;

            return !killNpc || gone() || !!pickTarget(map) || (!!hero
                && Math.hypot(ship.x - hero.x, ship.y - hero.y) <= CONFIG.npcRange * 0.6
                && isClickable(shipToClient(map, ship)));
        }, maxMs);
    }

    // Бій з однією ціллю. Виходить, коли її знищено, втрачено чи кинуто, або коли
    // з'явилась коробка: тоді лазери б'ють далі, а бот іде збирати.
    async function fightNpc(map, target) {
        const ship = target.ship;

        let last = npcHealth(ship);
        let progressAt = Date.now();
        let misses = 0;

        if (!isAttackingNpc(map, ship)) {
            log('атакую ' + target.name + ' @' + target.pos + ' (' + target.dist + ' од.)');
        }

        while (running && killNpc) {
            const hero = map.hero;

            if (!hero || hero.hp <= 0) {
                return;
            }
            if (npcDead(ship)) {
                stats.kills++;
                log('знищено ' + target.name + ', всього ' + stats.kills);

                return;
            }
            if (npcLost(map, target)) {
                log(target.name + ' зник з поля зору');

                return;
            }
            if (pickTarget(map)) {
                return;
            }

            // поки ціль не виділена, в hp/shield лежить заглушка гри —
            // тому рахуємо тільки падіння, а не порівнюємо з початком
            const health = npcHealth(ship);

            if (health < last) {
                progressAt = Date.now();
            }

            last = health;

            if (Date.now() - progressAt > CONFIG.npcStuckMs) {
                npcBlacklist.set(target.id, Date.now() + CONFIG.npcBlacklistTime);
                log('не пробиваю ' + target.name + ' вже ' + Math.round(CONFIG.npcStuckMs / 1000)
                    + 'с, ігнорую ' + Math.round(CONFIG.npcBlacklistTime / 1000) + 'с');
                await ceaseFire(map);

                return;
            }

            // після EMP ціль кілька секунд не виділяється
            if (ship.untargetableUntil > Date.now()) {
                await sleep(300);
                continue;
            }

            const dist = Math.hypot(ship.x - hero.x, ship.y - hero.y);

            if (dist > CONFIG.npcRange || (!isAttackingNpc(map, ship) && !isClickable(shipToClient(map, ship)))) {
                await chaseNpc(map, target, Math.max(1000, progressAt + CONFIG.npcStuckMs - Date.now()));
                await sleep(rndOf(CONFIG.reactPause));
                continue;
            }

            if (!isAttackingNpc(map, ship)) {
                if (await engageNpc(map, target)) {
                    misses = 0;
                } else if (++misses >= 3) {
                    npcBlacklist.set(target.id, Date.now() + CONFIG.npcBlacklistTime);
                    log('не вдається атакувати ' + target.name + ', ігнорую ' + Math.round(CONFIG.npcBlacklistTime / 1000) + 'с');

                    return;
                }

                await sleep(rndOf(CONFIG.reactPause));
                continue;
            }

            await sleep(rnd(250, 500));
        }
    }

    // ------------------------------------------------- головний цикл

    let running = false;
    let killNpc = false;

    async function loop() {
        while (running) {
            try {
                const map = getMap();

                if (!map || !map.hero) {
                    await sleep(1200);
                    continue;
                }

                if (CONFIG.dryRun) {
                    printBoxes(map);

                    if (killNpc) {
                        printNpcs(map);
                    }

                    await sleep(2000);
                    continue;
                }

                const hero = map.hero;

                if (hero.hp !== undefined && hero.hp <= 0) {
                    await sleep(3000);
                    continue;
                }

                if (CONFIG.stopWhenCargoFull && hero.maxCargo && hero.cargo >= hero.maxCargo) {
                    log('трюм повний (' + Math.floor(hero.cargo) + '/' + hero.maxCargo + '), чекаю');
                    await sleep(5000);
                    continue;
                }

                purgeBlacklist();

                const target = pickTarget(map);
                const npc = target || !killNpc ? null : pickNpc(map);

                if (npc) {
                    await fightNpc(map, npc);
                    await sleep(rndOf(CONFIG.reactPause));
                } else if (!target) {
                    // політ перервався тим, що в полі зору з'явилась коробка —
                    // тоді тільки коротка реакція, інакше пролетимо повз неї
                    await (await roam(map) ? sleep(rndOf(CONFIG.reactPause)) : humanPause());
                } else if (target.clickable) {
                    await collectBox(map, target);
                    await humanPause();
                } else {
                    if (!await approach(map, target)) {
                        blacklist.set(target.hash, Date.now() + 8000);
                    }

                    await sleep(rndOf(CONFIG.reactPause));
                }
            } catch (e) {
                console.error('[goBot ' + stamp() + ']', e);
                await sleep(1500);
            }
        }

        log('зупинено. ' + statusLine());
    }

    function statusLine() {
        const min = (Date.now() - stats.since) / 60000;

        return 'зібрано ' + stats.collected + ' / спроб ' + stats.tries
            + ' / невдач ' + stats.failed
            + ' / ' + (min > 0.1 ? (stats.collected / min).toFixed(1) : '0') + ' за хв'
            + (killNpc || stats.kills ? ' / NPC знищено ' + stats.kills : '');
    }

    function printNpcs(map) {
        map = map || getMap();

        const now = Date.now();
        const list = listNpcs(map);

        if (!list.length) {
            log('NPC не видно');

            return list;
        }

        log('видно NPC:', list.length);
        console.table(list.map(n => ({
            назва: n.name,
            координати: n.pos,
            дистанція: n.dist,
            'на екрані': n.onScreen,
            'можна клікнути': n.clickable,
            'проходить фільтр': nameAllowed(n.name) && !(npcBlacklist.get(n.id) > now),
            ціль: n.ship === map.lockedTarget
        })));

        return list;
    }

    function printBoxes(map) {
        const list = listBoxes(map);

        if (!list.length) {
            log('коробок не видно');

            return list;
        }

        log('видно коробок:', list.length);
        console.table(list.map(b => ({
            тип: b.type,
            координати: b.pos,
            дистанція: b.dist,
            видно: b.visible,
            'на екрані': b.onScreen,
            'можна клікнути': b.clickable
        })));

        return list;
    }

    // ------------------------------------------------- API

    if (window.goBot && typeof window.goBot.stop === 'function') {
        window.goBot.stop();

        if (typeof window.goBot._dispose === 'function') {
            window.goBot._dispose();
        }
    }

    const api = {
        start() {
            if (running) {
                return 'вже працює';
            }

            running = true;
            stats.since = Date.now();
            loop();

            return 'старт';
        },
        stop() {
            running = false;

            return 'стоп';
        },
        status() {
            const map = getMap();
            const hero = map && map.hero;

            return {
                працює: running,
                вкладка: doc.visibilityState === 'hidden' ? 'прихована' : 'активна',
                таймер: timerWorker ? 'web worker (без throttling)' : 'setTimeout (буде гальмувати у фоні)',
                коробок_видно: map ? map.boxes.size : 0,
                позиція: hero ? grid(hero.x, hero.y) : null,
                hp: hero ? Math.floor(hero.hp) + '/' + hero.maxHp : null,
                трюм: hero && hero.maxCargo ? Math.floor(hero.cargo || 0) + '/' + hero.maxCargo : null,
                NPC: killNpc ? 'атакую' : 'не чіпаю',
                ціль: map && map.lockedTarget ? String(map.lockedTarget.userName || '').trim() : null,
                статистика: statusLine()
            };
        },
        boxes() {
            return printBoxes();
        },
        startKillNpc() {
            killNpc = true;
            log('атакую NPC, коробки в пріоритеті');

            return running ? 'атака NPC увімкнена' : api.start() + ' + атака NPC';
        },
        stopKillNpc() {
            if (!killNpc) {
                return 'атака NPC і так вимкнена';
            }

            killNpc = false;
            ceaseFire(getMap());
            log('NPC більше не чіпаю');

            return 'атака NPC вимкнена';
        },
        npcs() {
            return printNpcs();
        },
        map: getMap,
        config: CONFIG,
        _dispose() {
            if (timerWorker) {
                timerWorker.terminate();
                timerWorker = null;
            }
        }
    };

    window.goBot = api;

    try {
        win.goBot = api;
    } catch (e) { /* інший реалм — не критично */ }

    log('готовий. Видно коробок:', getMap().boxes.size, '— goBot.stop() щоб зупинити, goBot.boxes() щоб подивитись список,'
        + ' goBot.startKillNpc() щоб ще й атакувати NPC');
    api.start();
})();
