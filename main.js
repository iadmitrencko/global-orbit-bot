function randomMove(centerX, centerY, distance) {
    const current = getMapCoords();

    for (let attempt = 0; attempt < 20; attempt++) {
        const angle = Math.random() * Math.PI * 2;

        const mapXChange = Math.cos(angle) * distance / 100;
        const mapYChange = Math.sin(angle) * distance / 100;

        const newX = current.x + mapXChange;
        const newY = current.y + mapYChange;

        if (newX >= 1 && newX <= 206 && newY >= 1 && newY <= 120) {
            const x = centerX + Math.cos(angle) * distance;
            const y = centerY + Math.sin(angle) * distance;

            move(x, y);

            return true;
        }
    }

    return false;
}

function move(x, y) {
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: 'mouse'
    }));

    canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1
    }));

    canvas.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 0,
        pointerId: 1,
        pointerType: 'mouse'
    }));

    canvas.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 0
    }));

    canvas.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0
    }));
}

function getMapCoords() {
    const [, x, y] = coords.innerText.match(/(\d+)\/(\d+)/);

    return {
        x: Number(x),
        y: Number(y)
    };
}

async function waitUntilStop() {
    let previousCoords = coords.innerText;
    let sameCount = 0;

    while (sameCount < 3) {
        await new Promise(resolve => setTimeout(resolve, 200));

        const currentCoords = coords.innerText;

        if (currentCoords === previousCoords) {
            sameCount++;
        } else {
            sameCount = 0;
        }

        previousCoords = currentCoords;
    }
}

const game = document.querySelector('#game-preload');
const coords = game.contentDocument.querySelector('#coordsText');
const canvas = game.contentDocument.querySelector('#game-container canvas');
const rect = canvas.getBoundingClientRect();

for (let i = 0; i < 10; i++) {
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const moveStepFrom = 100;
    const moveStepTo = 300;
    const distance = moveStepFrom + Math.random() * (moveStepTo - moveStepFrom);

    randomMove(centerX, centerY, distance);

    await waitUntilStop();
}
