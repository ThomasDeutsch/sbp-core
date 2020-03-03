import bp from "../src/bid";
import { createUpdateLoop, ScaffoldingFunction, UpdateLoopFunction } from '../src/updateloop';
import { Logger } from "../src/logger";

type TestLoop = (enable: ScaffoldingFunction) => Logger;
let updateLoop: TestLoop;

beforeEach(() => {
    updateLoop = (enable: ScaffoldingFunction): Logger => {
        const logger = new Logger();
        createUpdateLoop(enable, () => null, logger)();
        return logger;
    };
});


test("a bid-function: 'yield () => ...' will be evaluated every cycle", () => {
    let count = 0;
    let cycleNr = 0;

    function* requestThread() {
        yield bp.request("A", 1000);
        yield bp.request("A", 2000);
    }

    function* fnThread() {
        yield () => {
            count++;
            return bp.wait("never");
        }
    }

    const logger = updateLoop((enable: any) => {
        cycleNr++;
        enable(requestThread);
        enable(fnThread);
    });

    expect(count).toBe(cycleNr + 1); 
});


test("a bid-function can return a single bid", () => {
    let receivedValue;

    function* requestThread() {
        yield bp.request("A", 1000);
    }

    function* fnThread() {
        receivedValue = yield () => bp.wait("A");
    }

    updateLoop((enable: any) => {
        enable(requestThread);
        enable(fnThread);
    });

    expect(receivedValue).toBe(1000);
});


test("a bid-function can return multiple bids", () => {
    let receivedValue, receivedEvent;

    function* requestThread() {
        yield bp.request("A", 1000);
    }

    function* fnThread() {
        [receivedValue, receivedEvent] = yield () => [bp.wait("A"), bp.wait("B")];
    }

    updateLoop((enable: any) => {
        enable(requestThread);
        enable(fnThread);
    });

    expect(receivedValue).toBe(1000);
    expect(receivedEvent).toBe("A");
});