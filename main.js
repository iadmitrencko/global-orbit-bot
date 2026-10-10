(async function () {
    'use strict';

    const CONFIG = {
        include: ['BONUS_BOX', 'CARGO_BOX'], // масив підрядків типів, null = всі коробки
        exclude: [],                         // напр. ['ORE'] щоб не брати руду
                                             // типи: BONUS_BOX, CARGO_BOX, FROM_SHIP, ORE,
                                             // ALIEN, GIFT_BOXES, PIRATE_BOOTY[_RED|_BLUE|_GOLD]

        dryRun: false,              // true = тільки дивитись, нічого не клікати
        scanRadius: 0,              // радіус пошуку в світових одиницях, 0 = без ліміту
        edgeMargin: 70,             // не клікати ближче ніж стільки px до краю екрана
        mapPadding: 600,            // не підлітати ближче ніж стільки одиниць до краю карти: за ним радіація
        checkOverlap: true,         // не клікати крізь відкриті вікна інтерфейсу
        stopWhenCargoFull: true,

        collectTimeout: 30000,      // максимум часу на політ до коробки, мс
        slowTypes: ['PIRATE_BOOTY'], // типи, які збираються довго (зелені/сині/червоні скрині)
        slowHoldMs: 6000,           // скільки стояти на місці після прильоту до такої коробки
        blacklistTime: 25000,       // скільки ігнорувати коробку після невдачі, мс

        // бій з NPC (goBot.startKillNpc)
        npcInclude: null,           // масив підрядків імені NPC (регістр неважливий), null = всі
        npcExclude: [],             // напр. ['Boss'] щоб не чіпати
        npcAvoid: ['Boss Devolarium', 'Boss Sibelon'], // від таких не просто відмовлятись, а відлітати; [] = ні від кого
        npcAvoidDist: 1500,         // триматись від них далі ніж стільки одиниць
        npcScanRadius: 0,           // радіус пошуку NPC, 0 = всі, кого показує гра (~2000 од.)
        npcRange: 550,              // далі цього підлітати до цілі (лазер б'є на ~700)
        npcMinHpPct: 30,            // не починати новий бій, коли HP корабля нижче, %
        npcStuckMs: 20000,          // кинути ціль, якщо стільки часу її HP і щит не падають
        npcBlacklistTime: 60000,    // скільки ігнорувати кинуту ціль, мс

        // відступ, коли HP мало (працює і без атаки NPC)
        retreatHpPct: 20,           // нижче цього кинути все і тікати від NPC, %; 0 = вимкнено
        retreatUntilHpPct: 75,      // повертатись до роботи, коли HP відновиться до стількох, %
        retreatSafeDist: 1500,      // тікати, поки NPC ближче за стільки одиниць або по нас б'ють

        // гейт (goBot.startPassGalaxyGate): 1-ша конфігурація — бій, 2-га — швидкість для втечі
        gateRounds: 10,             // раундів у гейті; після останнього бот летить у правий портал, додому
        gateStartDist: 700,         // на старті портал гейта має бути ближче за стільки одиниць
        gateFleeHpPct: 30,          // тікати на 2-й конфігурації, коли HP нижче цього, %...
        gateFleeShieldPct: 0,       // ...а щит не більше цього, %
        gatePanicHpPct: 15,         // а нижче цього тікати, хоч би який щит, %; 0 = вимкнено
        gateRepairHpPct: 90,        // ремонтуватись на 1-й до стількох HP, перш ніж у бій чи в наступний раунд, %
        gateRepairShieldPct: 90,    // ...і до стількох щита, %
        gateFleeDist: 3000,         // коли NPC зникли з очей, відлетіти ще на стільки одиниць: деякі дуже швидкі
        gateKiteDist: 560,          // тримати ціль на такій відстані, поки б'ємо (лазер ~700)
        gateCrowdDist: 500,         // інші NPC, ближчі за це, відштовхують курс, щоб не влетіти в зграю
        gateStuckMs: 15000,         // взяти іншу ціль, якщо стільки часу її HP і щит не падають
        gateSearchMs: 20000,        // стільки чекати без NPC (відлік, між хвилями), перш ніж шукати їх картою

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
    const stats = { tries: 0, collected: 0, failed: 0, kills: 0, retreats: 0, rounds: 0, since: Date.now() };

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
        const avoided = avoidedNpcs(map);
        const list = listBoxes(map).filter(b =>
            b.visible
            && typeAllowed(b.type)
            && (!CONFIG.scanRadius || b.dist <= CONFIG.scanRadius)
            && !(blacklist.get(b.hash) > now)
            && !nearAvoided(avoided, b.x, b.y)
            && !unsafeBy(map, b.x, b.y - COLLECT_Y_OFFSET, 200)   // у радіацію навіть по коробку не летимо
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

    function nameMatches(list, name) {
        const lower = name.toLowerCase();

        return !!list && list.some(p => lower.includes(String(p).toLowerCase()));
    }

    function isAvoided(name) {
        return nameMatches(CONFIG.npcAvoid, name);
    }

    function nameAllowed(name) {
        if (isAvoided(name) || nameMatches(CONFIG.npcExclude, name)) {
            return false;
        }

        return !CONFIG.npcInclude || nameMatches(CONFIG.npcInclude, name);
    }

    function avoidedNpcs(map) {
        return CONFIG.npcAvoid && CONFIG.npcAvoid.length
            ? listNpcs(map).filter(n => n.visible && isAvoided(n.name))
            : [];
    }

    // коробки й NPC біля того, від кого тікаємо, не беремо — інакше бот смикатиметься туди-сюди
    function nearAvoided(avoided, x, y) {
        return avoided.some(n => Math.hypot(n.ship.x - x, n.ship.y - y) < CONFIG.npcAvoidDist);
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
        const avoided = avoidedNpcs(map);
        const list = listNpcs(map).filter(n =>
            n.visible
            && nameAllowed(n.name)
            && (!CONFIG.npcScanRadius || n.dist <= CONFIG.npcScanRadius)
            && !(n.ship.untargetableUntil > now)
            && !(npcBlacklist.get(n.id) > now)
            && !nearAvoided(avoided, n.ship.x, n.ship.y)
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

    // ------------------------------------------------- безпечна зона (радіація)

    // За краєм карти радіація: у публічному коді сервера — все поза 0…20900 × 0…13000, а клієнт
    // вважає карту 21000 × 13100. Та сервер уміє й зону-коло (радіаційний POI), і її межі клієнт
    // не знає. Тож курс тримаємо всередині карти з запасом mapPadding, а коли вже ловили
    // радіацію, вважаємо безпечним лише коло довкола того, де літали без неї, — до найближчого
    // місця, де її ловили. Для круглої зони це майже вона сама, для будь-якої іншої — обережніше
    const SAFE_LOOK = 600;      // курс годиться, якщо й за стільки одиниць попереду ще безпечно
    const RAD_SPOT = 1000;      // місце, де ловили радіацію, обходимо на стільки одиниць

    const radiation = { mapId: null, spots: [], safe: null, warned: false, sumX: 0, sumY: 0, count: 0, at: 0 };

    // середина того, де літали без радіації, і відстань від неї до найближчого місця, де ловили
    function radiationCircle() {
        if (!radiation.spots.length || !radiation.count) {
            return null;
        }

        const x = radiation.sumX / radiation.count;
        const y = radiation.sumY / radiation.count;

        return { x, y, r: Math.min(...radiation.spots.map(s => Math.hypot(s.x - x, s.y - y))) };
    }

    // гра сама показує попередження, поки корабель у радіації (BeaconCommand.inRadiationZone);
    // згасле ще пів секунди висить у DOM, а нове з'являється окремим елементом
    function inRadiation() {
        for (const el of doc.querySelectorAll('#do-rad-notification')) {
            if (el.style.opacity !== '0') {
                return true;
            }
        }

        return false;
    }

    // запам'ятовуємо, де були без радіації і де в неї влетіли; на іншій карті — усе спочатку
    function watchRadiation(map) {
        const hero = map.hero;

        if (radiation.mapId !== map.currentMapId) {
            Object.assign(radiation, { mapId: map.currentMapId, spots: [], safe: null, warned: false, sumX: 0, sumY: 0, count: 0, at: 0 });
        }
        if (!hero) {
            return false;
        }
        if (!inRadiation()) {
            radiation.safe = { x: hero.x, y: hero.y };
            radiation.warned = false;

            // раз на секунду — у середню точку безпечних місць
            if (Date.now() - radiation.at >= 1000) {
                radiation.at = Date.now();
                radiation.sumX += hero.x;
                radiation.sumY += hero.y;
                radiation.count++;
            }

            return false;
        }
        if (!radiation.spots.some(s => Math.hypot(s.x - hero.x, s.y - hero.y) < RAD_SPOT / 2)) {
            radiation.spots.push({ x: hero.x, y: hero.y });
            radiation.spots.splice(0, radiation.spots.length - 20);
        }
        if (!radiation.warned) {
            radiation.warned = true;
            log('радіація @' + grid(hero.x, hero.y) + '! повертаюсь туди, де її не було');
        }

        return true;
    }

    // наскільки точка поза безпечною зоною, од.; 0 — всередині
    function unsafeBy(map, x, y, pad) {
        const w = map.mapWidth || 21000;
        const h = map.mapHeight || 13100;
        const margin = pad === undefined ? CONFIG.mapPadding : pad;

        let out = Math.max(0, margin - x, x - (w - margin)) + Math.max(0, margin - y, y - (h - margin));

        for (const s of radiation.spots) {
            out += Math.max(0, RAD_SPOT - Math.hypot(x - s.x, y - s.y));
        }

        const circle = radiationCircle();

        if (circle) {
            out += Math.max(0, Math.hypot(x - circle.x, y - circle.y) - (circle.r - margin));
        }

        return out;
    }

    // Найближчий до бажаного курс, що не виводить із безпечної зони; уже в радіації — назад,
    // туди, де її не було. Через це проходить кожен політ із затиснутою кнопкою
    function safeAngle(map, angle) {
        const hero = map.hero;

        if (watchRadiation(map)) {
            const back = radiation.safe || { x: (map.mapWidth || 21000) / 2, y: (map.mapHeight || 13100) / 2 };

            return Math.atan2(back.y - hero.y, back.x - hero.x);
        }

        let best = angle;
        let bestOut = Infinity;

        for (let i = 0; i <= 12; i++) {
            for (const side of i ? [1, -1] : [1]) {
                const a = angle + side * i * Math.PI / 12;
                const out = unsafeBy(map, hero.x + Math.cos(a) * SAFE_LOOK, hero.y + Math.sin(a) * SAFE_LOOK);

                if (!out) {
                    return a;
                }
                if (out < bestOut) {
                    best = a;
                    bestOut = out;
                }
            }
        }

        return best;
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
        if (!await pressFree(map, point)) {
            return false;
        }

        const started = Date.now();

        let reached = false;

        try {
            while (running && Date.now() - started < maxMs) {
                await sleep(rndOf(CONFIG.steerTick));

                if (done && done()) {
                    reached = true;
                    break;
                }

                // гра сама відпустила кнопку (скажімо, вкладку сховали) — політ скінчився
                if (map.isPointerDown === false) {
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

    // Натиск, з якого починається політ. Поки миша їде до вільного місця, туди може підлетіти
    // NPC, тож перед самим натиском дивимось ще раз, а після — чи гра справді почала політ
    // (MapManager.isPointerDown ставить тільки клік у порожнечу). Не почала — відпускаємо й
    // пробуємо деінде: інакше бот «тягнув» би мишу, а корабель стояв би посеред бою
    async function pressFree(map, point) {
        for (let attempt = 0; attempt < 3; attempt++) {
            point = freeSpot(map, point);
            await moveMouse(point.x, point.y);

            const spot = freeSpot(map, point);

            if (spot.x !== point.x || spot.y !== point.y) {
                fire('pointermove', spot.x, spot.y, 0);
                fire('mousemove', spot.x, spot.y, 0);
                cursor.x = spot.x;
                cursor.y = spot.y;
            }

            fire('pointerdown', spot.x, spot.y, 1);
            fire('mousedown', spot.x, spot.y, 1);

            // старий клієнт без цього прапорця — віримо на слово
            if (map.isPointerDown !== false) {
                return true;
            }

            fire('pointerup', spot.x, spot.y, 0);
            fire('mouseup', spot.x, spot.y, 0);
            await sleep(rndOf(CONFIG.reactPause));
        }

        return false;
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

    // точка, за яку «тягнемо» корабель: на краю екрана в заданому напрямку, але не з безпечної зони
    function steerPoint(map, angle) {
        if (!map.hero) {
            return null;
        }

        const rect = canvas.getBoundingClientRect();
        const from = worldToClient(map, map.hero.x, map.hero.y);
        const far = Math.min(rect.width, rect.height) * CONFIG.steerRadius;
        const safe = safeAngle(map, angle);
        const raw = { x: from.x + Math.cos(safe) * far, y: from.y + Math.sin(safe) * far };

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

            if (!hero || mustLeave(map)) {
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

        // кинули коробку, бо треба відходити — це не невдача
        if (mustLeave(map)) {
            return false;
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
        }, () => gone() || mustLeave(map) || isClickable(boxToClient(map, target.box)), CONFIG.approachMaxMs);
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

            return !!(target && target.clickable) || (killNpc && !!pickNpc(map)) || mustLeave(map);
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

        if (!running || !(killNpc || gate)) {
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

            return !killNpc || gone() || mustLeave(map) || !!pickTarget(map) || (!!hero
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

            if (!hero || hero.hp <= 0 || mustLeave(map)) {
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

    // ------------------------------------------------- відступ

    let retreating = false;

    function hpPct(hero) {
        return hero && hero.maxHp ? Math.floor(hero.hp / hero.maxHp * 100) : 100;
    }

    function mustRetreat(map) {
        const hero = map.hero;

        return CONFIG.retreatHpPct > 0 && !!hero && hero.hp > 0 && hpPct(hero) < CONFIG.retreatHpPct;
    }

    // гра сама ставить hero.lastHitTime на кожне влучання (onReceiveHit)
    function heroHit(map, ms) {
        return !!map.hero && Date.now() - (map.hero.lastHitTime || 0) < ms;
    }

    function inDanger(map) {
        return heroHit(map, 3000) || listNpcs(map).some(n => n.visible && n.dist < CONFIG.retreatSafeDist);
    }

    // Геть від загроз: пробуємо 24 курси й беремо той, що за FLEE_LOOK од. виведе найдалі від
    // найближчої загрози (від тих, що б'ють по нас, — ще далі), не покидаючи безпечної зони.
    // Біля краю карти так виходить ковзати вздовж нього, а з кута — вибиратися вбік
    const FLEE_LOOK = 1500;

    function fleeAngle(map, threats) {
        const hero = map.hero;
        const cx = (map.mapWidth || 21000) / 2;
        const cy = (map.mapHeight || 13100) / 2;

        let best = roamAngle;
        let bestScore = -Infinity;

        for (let i = 0; i < 24; i++) {
            const a = i * Math.PI / 12;
            const x = hero.x + Math.cos(a) * FLEE_LOOK;
            const y = hero.y + Math.sin(a) * FLEE_LOOK;

            // нікого не видно, а по нас б'ють (невидимка) — до середини карти
            let score = threats.length ? Infinity : -Math.hypot(cx - x, cy - y);

            for (const n of threats) {
                const k = n.ship.isAttacking && n.ship.attackTarget === hero ? 1.5 : 1;

                score = Math.min(score, Math.hypot(n.ship.x - x, n.ship.y - y) / k);
            }

            // без різких кидків, а за край — нізащо
            score += Math.cos(a - roamAngle) * 150 - unsafeBy(map, x, y) * 4;

            if (score > bestScore) {
                best = a;
                bestScore = score;
            }
        }

        return best;
    }

    async function flee(map, threats, done) {
        return drag(map, () => {
            if (!map.hero) {
                return null;
            }

            roamAngle = lerpAngle(roamAngle, fleeAngle(map, threats()), 0.35);

            return steerPoint(map, roamAngle);
        }, done, 30000);
    }

    // Усе кидаємо, вимикаємо лазери, тікаємо, поки поруч NPC або по нас б'ють,
    // а тоді стоїмо, поки гра не відремонтує корабель
    async function retreat(map) {
        const until = Math.max(CONFIG.retreatUntilHpPct, CONFIG.retreatHpPct + 1);

        retreating = true;
        stats.retreats++;
        log('HP ' + hpPct(map.hero) + '% — кидаю все й відходжу, повернусь при ' + until + '%');

        try {
            await ceaseFire(map);

            let lastPct = hpPct(map.hero);
            let growAt = Date.now();
            let reportAt = Date.now();
            let hinted = false;

            while (running && !gate) {
                const hero = map.hero;

                if (!hero || hero.hp <= 0) {
                    return;
                }

                const pct = hpPct(hero);

                if (pct >= until) {
                    log('HP ' + pct + '%, повертаюсь до роботи');

                    return;
                }

                if (inDanger(map)) {
                    await flee(map, () => listNpcs(map).filter(n => n.dist <= CONFIG.retreatSafeDist * 1.5), () => !inDanger(map));
                    growAt = Date.now();   // під час втечі гра й так не ремонтує
                    continue;
                }

                if (pct > lastPct) {
                    growAt = Date.now();
                }

                lastPct = pct;

                if (!hinted && Date.now() - growAt > 60000) {
                    hinted = true;
                    log('HP не росте вже хвилину — схоже, тут корабель не ремонтується.'
                        + ' Можна знизити goBot.config.retreatUntilHpPct або зупинити бота');
                }

                if (Date.now() - reportAt > 30000) {
                    reportAt = Date.now();
                    log('ремонтуюсь: HP ' + pct + '% із ' + until + '%');
                }

                await sleep(rnd(700, 1500));
            }
        } finally {
            retreating = false;
        }
    }

    // ------------------------------------------------- NPC, від яких тікаємо (npcAvoid)

    // k > 1 — запас на втечу: у публічному коді сервера NPC переслідує гравця,
    // поки той ближче ~2000 од., тож відлітати треба далі, ніж спрацював тригер
    function avoidNeeded(map, k) {
        return avoidedNpcs(map).some(n => n.dist < CONFIG.npcAvoidDist * (k || 1));
    }

    // час кидати поточну справу: пора в гейт, мало HP або поруч той, від кого тікаємо
    function mustLeave(map) {
        return !!gate || mustRetreat(map) || avoidNeeded(map);
    }

    async function avoid(map) {
        const nearest = avoidedNpcs(map)[0];

        if (!nearest) {
            return;
        }

        log('бачу ' + nearest.name + ' за ' + nearest.dist + ' од. — відлітаю');

        await flee(map, () => avoidedNpcs(map), () => !avoidNeeded(map, 1.4) || mustRetreat(map));

        if (!avoidNeeded(map)) {
            log('відлетів від ' + nearest.name + ', працюю далі');
        }
    }

    // Залетіли в радіацію — кидаємо все й назад: курс туди, де її не було, дає safeAngle
    async function leaveRadiation(map) {
        await drag(map, () => steerPoint(map, roamAngle),
            () => !inRadiation() || !map.hero || map.hero.hp <= 0, 20000);
    }

    // ------------------------------------------------- гейт (goBot.startPassGalaxyGate)

    // гра й сервер дають міняти конфігурацію раз на 5 с — тиснемо з запасом
    const CONFIG_SWITCH_MS = 5400;

    let gate = null;   // проходження гейта: раунд, фаза, ціль; null — звичайний режим

    const mmss = ms => Math.floor(ms / 60000) + ':' + pad(Math.floor(ms / 1000) % 60);
    const configName = n => n === 1 ? '1-шу' : '2-гу';

    function shieldPct(hero) {
        return hero && hero.maxShield ? Math.floor(Math.max(0, hero.shield || 0) / hero.maxShield * 100) : 0;
    }

    function visibleNpcs(map) {
        return listNpcs(map).filter(n => n.visible);
    }

    function listPortals(map) {
        const hero = map.hero;
        const out = [];

        for (const portal of map.portals || []) {
            if (!portal || portal.destroyed || typeof portal.x !== 'number') {
                continue;
            }

            out.push({
                id: portal.portalId,
                pos: grid(portal.x, portal.y),
                dist: hero ? Math.round(Math.hypot(portal.x - hero.x, portal.y - hero.y)) : Infinity,
                portal: portal
            });
        }

        out.sort((a, b) => a.dist - b.dist);

        return out;
    }

    // портали, яких не було до першого NPC: їх відкриває зачищений раунд
    function freshPortals(map, g) {
        return listPortals(map).filter(p => !g.known.has(p.id));
    }

    // номер конфігурації сервер шле в hero.config, але героя гра створює заново після
    // кожного стрибка — поки номер не прийшов, віримо тому, що знаємо самі
    function heroConfig(map, g) {
        const n = map.hero && map.hero.config;

        if (n && n !== g.config) {
            g.config = n;
            g.configSince = Date.now();
        }

        return g.config;
    }

    // уже на 1-й і з її щитом: номер і щит приходять окремими пакетами, а щит у 2-ї свій
    function onFirstConfig(map, g) {
        return heroConfig(map, g) === 1 && Date.now() - g.configSince > 1000;
    }

    function configReady(map, g) {
        return Date.now() - Math.max(map.lastConfigChangeTime || 0, g.configAt) >= CONFIG_SWITCH_MS;
    }

    // C, якщо треба й уже можна. Відповіді не чекаємо: вона сама прийде в hero.config,
    // а якщо гра попросить не ту конфігурацію, наступне натискання за 5 с це виправить
    async function switchConfig(map, g, want) {
        if (!map.hero || heroConfig(map, g) === want || !configReady(map, g)) {
            return;
        }

        // так рахує сама гра: не знаючи номера, вона просить 2-гу
        const asks = (map.hero.config || 1) === 1 ? 2 : 1;

        log('перемикаю на ' + configName(asks) + ' конфігурацію');
        g.configAt = Date.now();
        await tapKey('c', 'KeyC');

        if (map.hero && !map.hero.config) {
            g.config = asks;
            g.configSince = Date.now();
        }
    }

    // правило гейта: HP нижче gateFleeHpPct при порожньому щиті — або зовсім мало HP
    function gateLow(hero) {
        const hp = hpPct(hero);

        return hp < CONFIG.gatePanicHpPct
            || (hp < CONFIG.gateFleeHpPct && shieldPct(hero) <= CONFIG.gateFleeShieldPct);
    }

    // по нас б'ють або NPC зовсім поруч
    function gateDanger(map) {
        return heroHit(map, 3000) || visibleNpcs(map).some(n => n.dist < CONFIG.retreatSafeDist);
    }

    function gateRepaired(hero, part) {
        return hpPct(hero) >= CONFIG.gateRepairHpPct * (part || 1)
            && (!hero.maxShield || shieldPct(hero) >= CONFIG.gateRepairShieldPct * (part || 1));
    }

    // дію гейта пора кидати: стоп, корабель знищено або гра створила нового героя (стрибок)
    function gateBroken(map, g) {
        return gate !== g || !map.hero || map.hero !== g.hero || map.hero.hp <= 0;
    }

    // Курс, яким «тягаємо» NPC: ціль доганяє, а ми відходимо навскіс, тримаючи відстань want —
    // далі за неї летимо до цілі, ближче — геть від неї, а на самій want — за 45° від «геть».
    // Так відстань сама стає там, де наш відхід зрівнюється зі швидкістю цілі. Решта зграї
    // й край карти відштовхують. Лазери б'ють, а NPC рідше дістають нас усі разом
    function kiteAngle(map, g, ship, want) {
        const hero = map.hero;
        const w = map.mapWidth || 21000;
        const h = map.mapHeight || 13100;
        const pad = CONFIG.mapPadding * 2;
        const ex = clamp((pad - hero.x) / pad, 0, 1) - clamp((hero.x - (w - pad)) / pad, 0, 1);
        const ey = clamp((pad - hero.y) / pad, 0, 1) - clamp((hero.y - (h - pad)) / pad, 0, 1);
        const toward = Math.atan2(ship.y - hero.y, ship.x - hero.x);
        const err = (Math.hypot(ship.x - hero.x, ship.y - hero.y) - want) / 200;
        const orbit = () => toward + g.orbit * clamp((1 - err) * Math.PI * 3 / 4, 0, Math.PI);

        let angle = orbit();

        // відхід жене в край карти — беремо навскіс в інший бік
        if (Math.cos(angle) * ex + Math.sin(angle) * ey < -0.3 && Date.now() - g.orbitAt > 3000) {
            g.orbit = -g.orbit;
            g.orbitAt = Date.now();
            angle = orbit();
        }

        let vx = Math.cos(angle) + ex * 2;
        let vy = Math.sin(angle) + ey * 2;

        for (const n of listNpcs(map)) {
            if (n.ship === ship || !n.visible || n.dist >= CONFIG.gateCrowdDist) {
                continue;
            }

            const d = Math.max(n.dist, 50);
            const k = 1.5 * (1 - d / CONFIG.gateCrowdDist);

            vx += (hero.x - n.ship.x) / d * k;
            vy += (hero.y - n.ship.y) / d * k;
        }

        return Math.atan2(vy, vx);
    }

    // і бій, і підліт — перетягуванням, як звичайний політ; курс щотіку з kiteAngle
    async function gateKite(map, g, target, want, stop, maxMs) {
        const ship = target.ship;
        const gone = () => npcDead(ship) || npcLost(map, target);

        return drag(map, () => {
            if (!map.hero || gone()) {
                return null;
            }

            g.heading = lerpAngle(g.heading, kiteAngle(map, g, ship, want), 0.5);

            return steerPoint(map, g.heading);
        }, () => gateBroken(map, g) || gone() || gateLow(map.hero) || stop(), maxMs);
    }

    // б'ємо ту, яку вже б'ємо чи виділили, інакше найближчу; свою ціль
    // кидаємо, лише коли вона відстала, а інший NPC уже поруч
    function gateTarget(map, g, npcs) {
        const now = Date.now();
        const hero = map.hero;
        const list = npcs.filter(n => !(n.ship.untargetableUntil > now) && !(npcBlacklist.get(n.id) > now));
        const current = list.find(n => n.ship === hero.attackTarget)
            || list.find(n => n.ship === map.lockedTarget)
            || list.find(n => n.ship === g.target);

        if (current && !(current.dist > CONFIG.gateKiteDist + 400 && list[0].dist < CONFIG.gateKiteDist)) {
            return current;
        }

        return list[0] || null;
    }

    // запам'ятовуємо, де кого бачили: хто зник з очей живим, того потім шукаємо там
    function gateSeeNpcs(g, npcs) {
        const now = Date.now();

        for (const n of npcs) {
            g.seen.set(n.id, { x: n.ship.x, y: n.ship.y, at: now, checked: false });
        }
    }

    // ціль загинула чи зникла з очей — рахуємо й забуваємо
    function gateCheckTarget(map, g) {
        const ship = g.target;

        if (!ship) {
            return;
        }

        if (npcDead(ship)) {
            stats.kills++;
            g.kills++;
            g.seen.delete(g.targetId);
            log('знищено ' + g.targetName + ', у цьому раунді ' + g.kills);
        } else if (map.ships.get(g.targetId) === ship) {
            return;
        } else {
            log(g.targetName + ' зник з поля зору');
        }

        g.target = null;
    }

    async function gateFight(map, g, npcs) {
        const target = gateTarget(map, g, npcs);

        g.action = 'бій';

        if (!target) {
            await sleep(300);   // усі, хто поруч, під EMP чи вже кинуті

            return;
        }

        const ship = target.ship;
        const health = npcHealth(ship);

        if (g.target !== ship) {
            g.target = ship;
            g.targetId = target.id;
            g.targetName = target.name;
            g.health = health;
            g.progressAt = Date.now();
            g.misses = 0;
            log('атакую ' + target.name + ' @' + target.pos + ' (' + target.dist + ' од.)');
        }

        // поки ціль не виділена, в hp/shield лежить заглушка гри — рахуємо тільки падіння
        if (health < g.health) {
            g.progressAt = Date.now();
        }

        g.health = health;

        if (Date.now() - g.progressAt > CONFIG.gateStuckMs) {
            npcBlacklist.set(target.id, Date.now() + 15000);
            log('не пробиваю ' + target.name + ' вже ' + Math.round(CONFIG.gateStuckMs / 1000) + 'с, беру іншого');
            g.target = null;
            await ceaseFire(map);

            return;
        }

        if (isAttackingNpc(map, ship)) {
            await gateKite(map, g, target, CONFIG.gateKiteDist, () => !isAttackingNpc(map, ship), rnd(5000, 9000));

            return;
        }

        // виділити можна тільки те, що на екрані, тож для цього підлітаємо ближче, ніж кружлятимемо
        const reach = () => {
            const hero = map.hero;

            return !!hero && Math.hypot(ship.x - hero.x, ship.y - hero.y) <= CONFIG.gateKiteDist + 100
                && isClickable(shipToClient(map, ship));
        };

        if (!reach()) {
            await gateKite(map, g, target, CONFIG.gateKiteDist - 200, reach, 10000);

            return;
        }

        if (await engageNpc(map, target)) {
            g.misses = 0;
            g.progressAt = Date.now();
        } else if (++g.misses >= 3) {
            npcBlacklist.set(target.id, Date.now() + 15000);
            log('не вдається атакувати ' + target.name + ', беру іншого');
            g.target = null;
        }
    }

    // Правило гейта: мало HP і порожній щит — на 2-гу конфігурацію (швидкість) і геть,
    // поки NPC не зникнуть з очей, а тоді ще на gateFleeDist: деякі дуже швидкі, а хто
    // нас загубив, долітає туди, де бачив востаннє. Ремонт потім на 1-й — щит у кожної свій
    async function gateFlee(map, g) {
        const started = Date.now();
        const spot = () => ({ x: map.hero.x, y: map.hero.y });
        const threats = () => {
            const list = visibleNpcs(map);

            if (list.length) {
                g.threat = { x: list[0].ship.x, y: list[0].ship.y };
                g.lostAt = spot();
                gateSeeNpcs(g, list);

                return list;
            }

            // нікого вже не видно — далі від того, кого бачили останнім
            return g.threat ? [{ dist: Math.hypot(g.threat.x - map.hero.x, g.threat.y - map.hero.y), ship: g.threat }] : [];
        };
        // далеко від місця, де NPC зникли з очей, — або їх уже так довго не видно, що вони
        // нас загубили: біля краю карти на gateFleeDist буває й нікуди відлітати
        const safe = () => {
            if (visibleNpcs(map).length || heroHit(map, 3000)) {
                g.calmAt = 0;

                return false;
            }

            g.calmAt = g.calmAt || Date.now();

            return Math.hypot(g.lostAt.x - map.hero.x, g.lostAt.y - map.hero.y) >= CONFIG.gateFleeDist
                || Date.now() - g.calmAt > 12000;
        };
        const switchDue = () => heroConfig(map, g) !== 2 && configReady(map, g);

        g.action = 'втеча';
        g.flees++;
        g.threat = null;
        g.calmAt = 0;
        g.lostAt = spot();
        threats();
        stats.retreats++;
        log((g.repairing ? 'NPC поруч, а я ще не відремонтувався' : 'HP ' + hpPct(map.hero) + '%, щит ' + shieldPct(map.hero) + '%')
            + ' — на 2-гу конфігурацію й геть');
        g.target = null;
        await ceaseFire(map);

        // у тісній зоні NPC не відстають, а стояти й ремонтуватись не дадуть; зате на льоту,
        // коли 10 с не влучають, ремонтуються HP і щит 2-ї — з ними й повертаємось у бій
        const healed = () => !heroHit(map, 10000) && hpPct(map.hero) >= CONFIG.gateRepairHpPct
            && (!map.hero.maxShield || shieldPct(map.hero) >= CONFIG.gateRepairShieldPct);

        let warned = false;

        while (!gateBroken(map, g) && !safe() && !healed()) {
            await switchConfig(map, g, 2);
            await flee(map, threats, () => gateBroken(map, g) || safe() || healed() || switchDue());

            if (!warned && Date.now() - started > 60000) {
                warned = true;
                log('не можу відірватися вже хвилину — тікаю далі');
            }
        }

        if (gateBroken(map, g)) {
            return;
        }

        if (safe()) {
            g.repairing = true;
            log('відірвався: заряджаю щит 2-ї, тоді ремонтуюсь на 1-й до HP ' + CONFIG.gateRepairHpPct
                + '%, щит ' + CONFIG.gateRepairShieldPct + '%');
        } else {
            g.repairing = false;
            log('NPC не відстають, але HP відновилось на льоту до ' + hpPct(map.hero) + '% — назад у бій');
        }
    }

    // Стоїмо, поки гра ремонтує корабель. У публічному коді сервера щит лагодиться тільки
    // в активної конфігурації й лише через 10 с після бою — тому на 1-й і подалі від NPC.
    // Виходить, коли відремонтувались, коли ремонту нема або коли NPC поруч
    async function gateRepair(map, g) {
        let last = -1;
        let growAt = Date.now();
        let reportAt = Date.now();

        // true, поки ремонт іде; стоїть 30 с — тут не ремонтує
        const growing = value => {
            if (value > last) {
                growAt = Date.now();
            }

            last = value;

            return Date.now() - growAt <= 30000;
        };

        g.action = 'ремонт';

        while (!gateBroken(map, g) && !gateDanger(map)) {
            const onSecond = heroConfig(map, g) === 2;
            const second = map.hero;

            // Щит ремонтується лише в активної конфігурації, тож, поки ще на 2-й, спершу
            // заряджаємо її щит — інакше наступна втеча буде голою. HP тим часом теж росте
            if (onSecond && second.maxShield && shieldPct(second) < CONFIG.gateRepairShieldPct
                && growing(hpPct(second) + shieldPct(second))) {
                if (Date.now() - reportAt > 15000) {
                    reportAt = Date.now();
                    log('заряджаю щит 2-ї конфігурації: ' + shieldPct(second) + '%, HP ' + hpPct(second) + '%');
                }

                await sleep(rnd(600, 1200));
                continue;
            }

            if (!onFirstConfig(map, g)) {
                await switchConfig(map, g, 1);
                await sleep(rnd(400, 700));
                last = -1;
                growAt = Date.now();
                continue;
            }

            const hero = map.hero;
            const hp = hpPct(hero);
            const shield = shieldPct(hero);

            if (gateRepaired(hero)) {
                g.repairing = false;
                log('відремонтувався: HP ' + hp + '%, щит ' + shield + '%');

                return;
            }

            if (!growing(hp + shield)) {
                g.repairing = false;
                log('HP і щит не ростуть уже 30 с — далі як є: HP ' + hp + '%, щит ' + shield + '%');

                return;
            }

            if (Date.now() - reportAt > 15000) {
                reportAt = Date.now();
                log('ремонтуюсь: HP ' + hp + '%, щит ' + shield + '%');
            }

            await sleep(rnd(600, 1200));
        }
    }

    // летимо до точки, поки не побачимо NPC
    async function gateGoTo(map, g, pos) {
        return drag(map, () => {
            const hero = map.hero;

            if (!hero) {
                return null;
            }

            roamAngle = lerpAngle(roamAngle, Math.atan2(pos.y - hero.y, pos.x - hero.x), 0.3);

            return steerPoint(map, roamAngle);
        }, () => gateBroken(map, g) || visibleNpcs(map).length > 0
            || Math.hypot(pos.x - map.hero.x, pos.y - map.hero.y) < 500, CONFIG.approachMaxMs);
    }

    // NPC, що загубили ціль, у публічному коді сервера літають між випадковими точками
    // карти, тож найчастіше — через її середину: там і шукаємо, кружляючи
    async function gateSearch(map, g) {
        const cx = (map.mapWidth || 21000) / 2;
        const cy = (map.mapHeight || 13100) / 2;

        return drag(map, () => {
            const hero = map.hero;

            if (!hero) {
                return null;
            }

            const err = (Math.hypot(cx - hero.x, cy - hero.y) - 2500) / 1000;
            const angle = Math.atan2(cy - hero.y, cx - hero.x) + g.orbit * clamp((1 - err) * Math.PI / 2, 0, Math.PI * 3 / 4);

            roamAngle = lerpAngle(roamAngle, angle, 0.3);

            return steerPoint(map, roamAngle);
        }, () => gateBroken(map, g) || visibleNpcs(map).length > 0 || freshPortals(map, g).length > 0,
        rndOf(CONFIG.roamMaxMs));
    }

    // Тягнемо корабель курсором прямо на портал: щойно той на екрані, курсор
    // стоїть на ньому, і корабель зупиняється в самому порталі
    async function gateFlyTo(map, g, portal, near) {
        return drag(map, () => {
            if (!map.hero || portal.destroyed) {
                return null;
            }

            return clampToRect(worldToClient(map, map.hero.x, map.hero.y), boxToClient(map, portal),
                canvas.getBoundingClientRect(), CONFIG.edgeMargin);
        }, () => gateBroken(map, g) || portal.destroyed
            || Math.hypot(portal.x - map.hero.x, portal.y - map.hero.y) <= near, CONFIG.approachMaxMs);
    }

    // стрибок видно з анімації порталу, а прибуття — з нового героя: гра створює його на кожній карті
    async function gateArrived(map, g, hero, portal) {
        const started = Date.now();

        let jumping = false;

        while (running && gate === g) {
            await sleep(250);

            if (map.hero && map.hero !== hero) {
                return true;
            }

            jumping = jumping || !!portal.isJumping;

            // анімації нема — сервер стрибок не прийняв
            if (Date.now() - started > (jumping ? 20000 : 6000)) {
                return false;
            }
        }

        return false;
    }

    // в сам портал (гра пускає з 500 од., сервер у публічному коді — з 700) і J
    async function gateJump(map, g, target) {
        const portal = target.portal;

        for (let attempt = 1; attempt <= 3; attempt++) {
            if (gate === g && map.hero && map.hero !== g.hero) {
                return true;   // таки перелетіли, хоч і пізніше, ніж чекали
            }
            if (gateBroken(map, g) || portal.destroyed) {
                return false;
            }

            if (Math.hypot(portal.x - map.hero.x, portal.y - map.hero.y) > 150) {
                await gateFlyTo(map, g, portal, 120);
                await sleep(rnd(600, 1000));   // корабель доїжджає за курсором

                if (gateBroken(map, g) || portal.destroyed) {
                    continue;
                }
            }

            const hero = map.hero;

            log('тисну J біля порталу @' + target.pos);
            await tapKey('j', 'KeyJ');

            if (await gateArrived(map, g, hero, portal)) {
                return true;
            }

            log('стрибок не вийшов, спроба ' + attempt + ' з 3');
        }

        return false;
    }

    function startRound(map, g) {
        Object.assign(g, {
            phase: 'round',
            hero: map.hero,
            roundAt: Date.now(),
            known: new Set(listPortals(map).map(p => p.id)),
            npcSeen: false,
            npcAt: 0,
            seen: new Map(),
            threat: null,
            lostAt: null,
            target: null,
            clearedAt: 0,
            kills: 0,
            flees: 0,
            repairing: false,
            ready: false,
            action: 'відлік, чекаю NPC'
        });
        log('раунд ' + g.round + '/' + CONFIG.gateRounds + ': чекаю на NPC');
    }

    // Перед стрибком у раунд — ремонт і 1-ша конфігурація: потім не буде коли.
    // true — можна стрибати
    async function gateReady(map, g) {
        if (!onFirstConfig(map, g)) {
            g.action = 'перемикаю конфігурацію';
            await switchConfig(map, g, 1);
            await sleep(300);

            return false;
        }

        if (!g.ready) {
            if (!gateRepaired(map.hero) && !gateDanger(map)) {
                if (!g.repairing) {
                    g.repairing = true;
                    log('перед стрибком ремонтуюсь до HP ' + CONFIG.gateRepairHpPct + '%, щит ' + CONFIG.gateRepairShieldPct + '%');
                }

                await gateRepair(map, g);

                if (g.repairing) {
                    return false;   // NPC поруч чи стоп — наступний крок розбереться
                }
            }

            g.ready = true;
            g.repairing = false;
        }

        return true;
    }

    async function gateEnter(map, g) {
        const target = listPortals(map).find(p => p.id === g.portalId);

        g.action = 'стрибок у гейт';

        if (!target) {
            finishGate(g, 'портал гейта зник');

            return;
        }
        if (!await gateReady(map, g)) {
            return;
        }

        if (await gateJump(map, g, target)) {
            startRound(map, g);
        } else {
            finishGate(g, 'не вдалося стрибнути в портал гейта');
        }
    }

    async function gateRound(map, g) {
        const now = Date.now();
        const npcs = visibleNpcs(map);

        gateCheckTarget(map, g);
        purgeBlacklist();

        if (npcs.length) {
            if (!g.npcSeen) {
                g.npcSeen = true;
                log('раунд ' + g.round + ': з\'явились NPC (' + npcs.length + ')');
            }

            g.npcAt = now;
            gateSeeNpcs(g, npcs);
        } else if (!g.npcSeen) {
            // портали, що є до першого NPC, — не ті, що відкриває зачищений раунд
            g.known = new Set(listPortals(map).map(p => p.id));
        }

        // раунд зачищено: NPC нема, а портали з'явились (другий може прийти трохи пізніше)
        if (g.npcSeen && !npcs.length && freshPortals(map, g).length) {
            g.clearedAt = g.clearedAt || now;

            if (now - g.clearedAt < 1500) {
                await sleep(300);

                return;
            }

            g.phase = 'cleared';
            g.cleared++;
            stats.rounds++;
            log('раунд ' + g.round + '/' + CONFIG.gateRounds + ' пройдено за ' + mmss(now - g.roundAt)
                + ': знищено ' + g.kills + (g.flees ? ', відступів ' + g.flees : ''));

            return;
        }

        g.clearedAt = 0;

        // NPC самі прилетіли, поки ремонтуємось: з половиною HP і щита б'ємось, інакше знову геть
        if (g.repairing && gateDanger(map) && !gateLow(map.hero)
            && onFirstConfig(map, g) && gateRepaired(map.hero, 0.5)) {
            g.repairing = false;
            log('NPC прилетіли самі, а в мене вже HP ' + hpPct(map.hero) + '%, щит ' + shieldPct(map.hero) + '% — б\'юсь');
        }
        if ((gateLow(map.hero) || g.repairing) && gateDanger(map)) {
            await gateFlee(map, g);

            return;
        }
        if (g.repairing) {
            await gateRepair(map, g);

            return;
        }

        await switchConfig(map, g, 1);   // б'ємось на 1-й

        if (npcs.length) {
            await gateFight(map, g, npcs);

            return;
        }

        // Нікого не видно. Хто зник з очей живим, того шукаємо, де бачили востаннє, а далі
        // посередині карти; якщо всіх побачених знищено — чекаємо наступну хвилю
        let spot = null;

        for (const s of g.seen.values()) {
            if (!s.checked && (!spot || s.at > spot.at)) {
                spot = s;
            }
        }

        if (spot && Math.hypot(spot.x - map.hero.x, spot.y - map.hero.y) > 600) {
            g.action = 'лечу до NPC';
            await gateGoTo(map, g, spot);

            return;
        }

        // долетіли — тут нікого, і поблизу теж
        for (const s of g.seen.values()) {
            s.checked = s.checked || Math.hypot(s.x - map.hero.x, s.y - map.hero.y) < 2000;
        }

        const idle = now - (g.npcSeen ? g.npcAt : g.roundAt);

        if (!g.seen.size && idle < CONFIG.gateSearchMs) {
            g.action = g.npcSeen ? 'чекаю наступну хвилю' : 'відлік, чекаю NPC';
            await sleep(500);

            return;
        }
        if (!g.npcSeen && idle > 180000) {
            finishGate(g, 'за 3 хв жодного NPC — схоже, це не гейт');

            return;
        }

        g.action = 'шукаю NPC';
        await gateSearch(map, g);
    }

    // лівий портал веде в наступний раунд, правий — додому
    async function gateCleared(map, g) {
        const last = g.round >= CONFIG.gateRounds;
        const fresh = freshPortals(map, g);

        if (visibleNpcs(map).length) {
            log('NPC ще є — раунд не закінчено');
            g.phase = 'round';
            g.clearedAt = 0;

            return;
        }
        if (!fresh.length) {
            g.action = 'чекаю на портали';
            await sleep(500);

            return;
        }
        if (!last && !await gateReady(map, g)) {
            return;
        }

        const target = fresh.reduce((a, b) => (last ? b.portal.x > a.portal.x : b.portal.x < a.portal.x) ? b : a);

        g.action = last ? 'лечу додому' : 'лечу в раунд ' + (g.round + 1);
        log((last ? 'гейт зачищено — лечу в правий портал, додому' : 'лечу в лівий портал, у раунд ' + (g.round + 1))
            + ' @' + target.pos);

        if (!await gateJump(map, g, target)) {
            finishGate(g, 'не вдалося стрибнути в портал');

            return;
        }
        if (last) {
            finishGate(g, 'гейт пройдено');

            return;
        }

        g.round++;
        startRound(map, g);
    }

    async function gateStep(map) {
        const g = gate;
        const hero = map.hero;

        if (hero.hp !== undefined && hero.hp <= 0) {
            finishGate(g, 'корабель знищено в раунді ' + g.round);

            return;
        }

        // гра створила героя заново, а ми не стрибали: стрибок руками чи телепорт
        if (hero !== g.hero) {
            log('карта змінилась — вважаю, що це раунд ' + g.round);
            startRound(map, g);

            return;
        }

        if (g.phase === 'enter') {
            await gateEnter(map, g);
        } else if (g.phase === 'cleared') {
            await gateCleared(map, g);
        } else {
            await gateRound(map, g);
        }
    }

    function newGate(map, round, portal) {
        const g = {
            round: round,
            cleared: 0,
            config: map.hero.config || 1,   // у гейт заходимо на 1-й конфігурації
            configAt: 0,
            configSince: 0,
            orbit: Math.random() < 0.5 ? 1 : -1,
            orbitAt: 0,
            heading: Math.random() * Math.PI * 2,
            startedAt: Date.now()
        };

        if (portal) {
            Object.assign(g, {
                phase: 'enter',
                portalId: portal.id,
                hero: map.hero,
                repairing: false,
                ready: false,
                action: 'стрибок у гейт'
            });
        } else {
            startRound(map, g);
        }

        return g;
    }

    function finishGate(g, message) {
        if (gate !== g) {
            return;
        }

        gate = null;
        running = false;
        log(message + '. Раундів пройдено: ' + g.cleared + ', час ' + mmss(Date.now() - g.startedAt));
    }

    // ------------------------------------------------- головний цикл

    let running = false;
    let looping = false;   // цикл ще живий: після stop() він дограє поточну дію
    let killNpc = false;

    async function loop() {
        looping = true;

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

                // радіація важливіша за все, і в гейті теж (якщо корабель ще цілий)
                if (!(map.hero.hp <= 0) && watchRadiation(map)) {
                    await leaveRadiation(map);
                    continue;
                }

                if (gate) {
                    await gateStep(map);
                    continue;
                }

                const hero = map.hero;

                if (hero.hp !== undefined && hero.hp <= 0) {
                    await sleep(3000);
                    continue;
                }

                if (mustRetreat(map)) {
                    await retreat(map);
                    continue;
                }

                if (avoidNeeded(map)) {
                    await avoid(map);
                    await sleep(rndOf(CONFIG.reactPause));
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

                    if (!mustLeave(map)) {
                        await humanPause();
                    }
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

        looping = false;
        log('зупинено. ' + statusLine());
    }

    // Якщо після stop() старий цикл ще не дограв поточну дію (паузу, політ), він і
    // працюватиме далі: новий цикл поруч водив би мишу навперебій зі старим
    function launch() {
        running = true;
        stats.since = Date.now();

        if (!looping) {
            loop();
        }
    }

    function statusLine() {
        const min = (Date.now() - stats.since) / 60000;

        return 'зібрано ' + stats.collected + ' / спроб ' + stats.tries
            + ' / невдач ' + stats.failed
            + ' / ' + (min > 0.1 ? (stats.collected / min).toFixed(1) : '0') + ' за хв'
            + (killNpc || stats.kills ? ' / NPC знищено ' + stats.kills : '')
            + (stats.retreats ? ' / відступів ' + stats.retreats : '')
            + (stats.rounds ? ' / раундів гейта ' + stats.rounds : '');
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
            уникаю: isAvoided(n.name),
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

            launch();

            return 'старт';
        },
        stop() {
            if (gate) {
                log('проходження гейта перервано, раунд ' + gate.round);
                gate = null;
            }

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
                щит: hero ? Math.floor(hero.shield || 0) + '/' + (hero.maxShield || 0) : null,
                конфігурація: hero && hero.config || null,
                трюм: hero && hero.maxCargo ? Math.floor(hero.cargo || 0) + '/' + hero.maxCargo : null,
                гейт: gate ? 'раунд ' + gate.round + '/' + CONFIG.gateRounds + ', ' + gate.action : 'ні',
                NPC: killNpc ? 'атакую' : 'не чіпаю',
                відступ: retreating ? 'так, чекаю HP ' + CONFIG.retreatUntilHpPct + '%' : 'ні',
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
        // round — з якого раунду продовжується гейт, якщо не з 1-го
        startPassGalaxyGate(round) {
            if (gate) {
                return 'вже проходжу гейт: раунд ' + gate.round + '/' + CONFIG.gateRounds;
            }

            const map = getMap();

            if (!map || !map.hero) {
                return 'карта ще не готова';
            }

            // у самому раунді порталів нема: вони з'являються, коли всіх NPC вбито
            const portal = listPortals(map)[0];

            if (portal && portal.dist > CONFIG.gateStartDist) {
                return 'підлети до порталу гейта ближче ніж на ' + CONFIG.gateStartDist
                    + ' од. (до найближчого зараз ' + portal.dist + ') і запусти ще раз';
            }

            const from = clamp(Math.floor(Number(round)) || 1, 1, CONFIG.gateRounds);

            log(portal
                ? 'гейт: стрибаю в портал @' + portal.pos + ', раунд ' + from + ' з ' + CONFIG.gateRounds
                : 'гейт: порталів нема — вважаю, що я вже в раунді');
            gate = newGate(map, from, portal);

            if (running) {
                return 'проходжу гейт';
            }

            launch();

            return 'старт: проходжу гейт';
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

    // сам нічого не починає: що робити, кажуть командою
    log('готовий, чекаю команди: goBot.start() — збирати коробки, goBot.startKillNpc() — ще й бити NPC,'
        + ' goBot.startPassGalaxyGate() біля порталу гейта — пройти гейт, goBot.stop() — зупинити');
})();
