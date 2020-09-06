import * as bp from "../src/bid";
import { testScenarios } from "./testutils";
import { flow } from '../src/scenario'
import { delay } from './testutils';
import { BTContext } from '../src/bthread';


test("A promise can be requested and will create a pending-event", () => {
    const thread1 = flow({name: 'requestingThread', key: 1}, function* () {
        yield bp.request("A", delay(100));
    });

    testScenarios((enable) => {
        enable(thread1());
    }, ({event}) => {
        if(event('A').isPending) {
            expect(event('A').isPending).toBeTruthy();
            expect(event('A').value).toBeUndefined();
            expect(event('A').history).toBeUndefined();
            expect(event('A').explain().pending?.threadId.name).toEqual('requestingThread');
        }
    });
});


test("a pending event is different from another pending-event if the name OR key are not the same", (done) => {
    let value1: number, value2: number;
    const thread1 = flow({name: 'requestingThreadOne'}, function* () {
        yield bp.onPending({name: 'A' });
        value1 = yield bp.request("A", delay(100));
    });
    const thread2 = flow({name: 'requestingThreadTwo'}, function* () {
        value2 = yield bp.request({name: "A", key: 1}, delay(50));
    });

    testScenarios((enable) => {
        enable(thread2());
        enable(thread1()); 
    }, ({event, thread}) => {
        if(event('A', 1).isPending) {
            expect(event('A').explain().pending).toBeDefined();
        } else if(event('A').isPending) {
            expect(thread.get('requestingThreadTwo')?.isCompleted).toBeTruthy();
            done();
        }
    });
});

test("pending-events with the same name but different keys can be run in parallel", (done) => {
    let value1: number, value2: number;
    const thread1 = flow({name: 'requestingThreadOne'}, function* () {
        value1 = yield bp.request({name: "A", key: 1}, () => delay(250));
    });
    const thread2 = flow({name: 'requestingThreadTwo'}, function* () {
        value2 = yield bp.request({name: "A", key: 2}, () => delay(250));
    });

    testScenarios((enable) => {
        enable(thread1());
        enable(thread2());
    }, ({event, thread}) => {
        if(event('A', 1).isPending && event('A', 2).isPending) {
            expect(thread.get('requestingThreadOne')?.isCompleted).toBeFalsy();
            expect(thread.get('requestingThreadTwo')?.isCompleted).toBeFalsy();
            done();
        }
    });
});


test("A promise-function can be requested and will create a pending-event", () => {
    const thread1 = flow({name: 'thread1'}, function* () {
        yield bp.request("A", () => delay(100));
    });

    testScenarios((enable) => {
        enable(thread1());
    }, (({event}) => {
        const isAPending = event('A').isPending;
        if(isAPending) {
            expect(isAPending).toBeTruthy();
            expect(event('A').dispatch).toBeUndefined();
        }
    }));
});


test("multiple async-requests can be run sequentially", (done) => {
    let threadResetCounter = -1;
    const flow1 = flow(
        {
          name: "flow1",
          title: "card validation scenario"
        },
        function*() {
            threadResetCounter++;
            yield bp.request("WaitForCard", () => delay(100));
            yield bp.request("ValidateCard", () => delay(100));
            yield bp.request("LoadAccount", () => delay(100));
            yield bp.request("WaitForPin", () => delay(100));
        }
    );

    testScenarios((enable) => {
        enable(flow1());
    }, (({thread}) => {
        if(thread.get('flow1')?.isCompleted) {
            expect(threadResetCounter).toEqual(0);
            done();
        }
    }));
});


test("for multiple active promises in one yield, only one resolve will progress the BThread", (done) => {
    let threadState: any = null;
    let progressed2 = false;
    let progressed3 = false;
    
    const thread1 = flow({name: 'requestingThread'}, function* () {
        yield [bp.request("HeyA", () => delay(1000)), bp.request("HeyB", () => delay(1000))];
    });

    const thread2 = flow(null, function* () {
        yield bp.wait('HeyA');
        progressed2 = true;
    });

    const thread3 = flow(null, function* () {
        yield bp.wait('HeyB');
        progressed3 = true;
    });

    testScenarios((enable) => {
        threadState = enable(thread1());
        enable(thread2());
        enable(thread3());
    }, ({thread}) => {
        if(thread.get('requestingThread')?.isCompleted) {
            expect(progressed2).not.toBe(progressed3);
            done();
        }
    });
});


test("if a thread gets disabled, before the pending-event resolves, the pending-event resolve will still be dispatched", (done) => {
    const thread1 = flow({name: 'thread1'}, function* () {
        yield bp.request("A", () => delay(100));
        const [event] = yield [bp.wait('B'),  bp.request("X", () => delay(500))];
        expect(event.name).toEqual('B');
    });

    const thread2 = flow({name: 'thread2'}, function*() {
        yield bp.request("B", () => delay(300)); 
    });

    testScenarios((enable) => {
        const t1 = enable(thread1());
        if(t1.pendingEvents.has('A')) {
            enable(thread2());
        }
    }, (({thread}) => {
        if(thread.get('thread1')?.isCompleted) {
            expect(thread.get('thread2')?.isCompleted).toBeTruthy();
            done();
        }
    }));
});

test("given the cancelPendingOnDisable option, pending events will be canceled on disable", (done) => {
    const thread1 = flow({name: 'thread1'}, function* () {
        yield bp.request("A", () => delay(100));
        const [event] = yield [bp.wait('B'),  bp.request("X", () => delay(500))];
        expect(event.name).toEqual('X');
    });

    const thread2 = flow({name: 'thread2', cancelPendingOnDisable: true}, function*() {
        yield bp.request("B", () => delay(300));
    });

    testScenarios((enable) => {
        const t1 = enable(thread1());
        if(t1.pendingEvents.has('A')) {
            enable(thread2());
        }
    }, (({thread}) => {
        if(thread.get('thread1')?.isCompleted) {
            expect(thread.get('thread2')?.isCompleted).toBeFalsy();
            done();
        }
    }));
});

test("given the destoryOnDisable option, pending events will be canceled on destroy", (done) => {
    const thread1 = flow({name: 'thread1'}, function* () {
        yield bp.request("A", () => delay(100));
        const [event] = yield [bp.wait('B'),  bp.request("X", () => delay(500))];
        expect(event.name).toEqual('X');
    });

    const thread2 = flow({name: 'thread2', destroyOnDisable: true}, function*() {
        yield bp.request("B", () => delay(300));
    });

    testScenarios((enable) => {
        const t1 = enable(thread1());
        if(t1.pendingEvents.has('A')) {
            enable(thread2());
        }
    }, (({thread}) => {
        if(thread.get('thread1')?.isCompleted) {
            expect(thread.get('thread2')?.isCompleted).toBeFalsy();
            done();
        }
    }));
});


test("a thread in a pending-event state can place additional bids.", (done) => {
    const thread1 = flow({name: 'requestingThread'}, function* (this: BTContext) {
        yield [bp.request("A", () => delay(100)), bp.block('B', () => this.isPending('A'))];
    });

    const thread2 = flow({name: 'waitingThread'}, function* () {
        yield bp.wait('B');
    });

    testScenarios((enable) => {
        enable(thread1());
        enable(thread2());
    }, ({event, thread}) => {
        if(event('A').isPending) {
            expect(event('B').explain().blocked.length > 0).toBeTruthy();
        } else if( thread.get('requestingThread')?.isCompleted) {
            expect(event('B').explain().blocked.length === 0).toBeTruthy();
            done();
        }
    });
});