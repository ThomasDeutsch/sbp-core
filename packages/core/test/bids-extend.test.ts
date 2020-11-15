import * as bp from "../src/bid";
import { testScenarios, delay } from "./testutils";
import { flow } from '../src/scenario';
import { ExtendContext } from '../src/extend-context';


// Extends
//-------------------------------------------------------------------------

test("requests can be extended", () => {
    let progressedRequest = false,
        progressedExtend = false,
        setupCount = 0;

    const thread1 = flow({name: 'requesting thread'}, function* () {
        yield bp.request("A");
        progressedRequest = true;
    });

    const thread3 = flow({name: 'extending thread'}, function* () {
        yield bp.extend("A");
        progressedExtend = true;
        yield bp.askFor('X');
    })

    testScenarios((enable) => {
        enable(thread1());
        enable(thread3());
        setupCount++;
    }, ({event}) => {
        expect(progressedExtend).toBe(true);
        expect(event('A').isPending).toBeTruthy();
        expect(progressedRequest).toBe(false);
        expect(setupCount).toEqual(2);
    }
 );  
});


test("if an extend is not applied, than the next extend will get the event", () => {
    let requestAdvanced = false;
    let waitBAdvanced = false;
    let waitCAdvanced = false;
    let waitDAdvanced = false;

    const requestThread = flow(null, function* () {
        yield bp.request("A", 1000);
        requestAdvanced = true;
    });

    const waitThread = flow(null, function* () {
        yield bp.askFor("A", (pl: number) => pl === 1000);
        waitBAdvanced = true;
    });

    const extendPriorityLowThread = flow(null, function* () {
        yield bp.extend("A", (pl: number) => pl === 1000);
        waitCAdvanced = true;
    });

    const extendPriorityHighThread = flow(null, function* () {
        yield bp.extend("A", (pl: number) => pl !== 1000);
        waitDAdvanced = true;
    });

    testScenarios((enable) => {
        enable(requestThread());
        enable(waitThread());
        enable(extendPriorityLowThread());
        enable(extendPriorityHighThread());
    }, ({event}) => {
        expect(waitBAdvanced).toBe(false);
        expect(waitCAdvanced).toBe(true);
        expect(waitDAdvanced).toBe(false);
        expect(requestAdvanced).toBe(false);
        expect(event('A').isPending).toBeTruthy();
    });
});

test("if an extended thread completed, without resolving or rejecting the event, it will keep the event pending", () => {
    let progressedRequest = false,
        progressedExtend = false,
        setupCount = 0;

    const thread1 = flow(null, function* () {
        yield bp.request("A");
        progressedRequest = true;
    });

    const thread3 = flow(null, function* () {
        yield bp.extend("A");
        progressedExtend = true;
    });

    testScenarios((enable) => {
        enable(thread1());
        enable(thread3());
        setupCount++;
    }, ({event}) => {
        expect(event('A').isPending).toBeTruthy();
    }
 );
    expect(setupCount).toEqual(2);
    expect(progressedRequest).toBe(false);
    expect(progressedExtend).toBe(true);
});


test("extends will receive a value (like waits)", () => {
    let extendedValue: ExtendContext;
    let thread1Advanced = false;

    const thread1 = flow(null, function* () {
        yield bp.request("A", 1000);
        thread1Advanced = true;
    });

    const thread2 = flow(null, function* () {
        yield bp.askFor("A");
    });

    const thread3 = flow(null, function* () {
        extendedValue = yield bp.extend("A");
    });

    testScenarios((enable) => {
        enable(thread1());
        enable(thread2());
        enable(thread3());
    }, ({event}) => {
        expect(thread1Advanced).toBe(false);
        expect(extendedValue.value).toBe(1000);
        expect(event('A').isPending).toBeTruthy();
    });
});


test("blocked events can not be extended", () => {
    let extendedValue: ExtendContext;
    let thread1Advanced = false;

    const thread1 = flow(null, function* () {
        yield bp.request("A", 1000);
        thread1Advanced = true;
    });

    const thread2 = flow(null, function* () {
        yield bp.block("A");
    });

    const thread3 = flow(null, function* () {
        extendedValue = yield bp.extend("A");
    });

    testScenarios((enable) => {
        enable(thread1());
        enable(thread2());
        enable(thread3());
    }, ({event}) => {
        expect(thread1Advanced).toBe(false);
        expect(extendedValue).toBe(undefined);
        expect(event('A').isPending).toBeFalsy();
    });
});


test("extends will extend requests", () => {
    let extended: ExtendContext

    const thread1 = flow(null, function* () {
        yield bp.request("A", 1000);
    });

    const thread2 = flow(null, function* () {
        extended = yield bp.extend("A");
    }); 

    testScenarios((enable) => {
        enable(thread1());
        enable(thread2());
    }, () => {
        expect(extended.value).toEqual(1000);
    });
});


test("the last extend that is enabled has the highest priority", () => {
    let advancedThread1 = false, 
    advancedThread2 = false;

    const requestThread = flow(null, function* () {
        yield bp.request("A");
    });

    const extendThread1 = flow(null, function* () {
        yield bp.extend("A");
        advancedThread1 = true;
    });
    
    const extendThread2 = flow(null, function* () {
        yield bp.extend("A");
        advancedThread2 = true;
    });

    testScenarios((enable) => {
        enable(requestThread());
        enable(extendThread1());
        enable(extendThread2());
    },() => {
        expect(advancedThread1).toBeFalsy();
        expect(advancedThread2).toBe(true);
    });
});


test("an extend will create a pending event", () => {
    const requestingThread = flow(null, function* () {
        yield bp.request("A", 100); //not an async event
    });

    const extendingThread = flow(null, function* () {
        yield bp.extend("A"); // but this extend will make it async
        yield bp.wait('fin');
    });

    testScenarios((enable) => {
        enable(requestingThread());
        enable(extendingThread());
    }, ({event}) => {
        expect(event('A').isPending).toBe(true);
    });
});


test("an extend will wait for the pending-event to finish before it extends.", (done) => {
    const requestingThread = flow({name: 'requestingThread'}, function* () {
        yield bp.request("A", delay(100, 'resolvedValue'));
    });

    const extendingThread = flow({name: 'extendingThread'}, function* () {
        const {value} = yield bp.extend("A");
        expect(value).toBe('resolvedValue');
        yield bp.request("V", delay(200, 'resolvedValue'));
    });

    testScenarios((enable) => {
        enable(requestingThread());
        enable(extendingThread());
    }, ({event, thread}) => {
        if(thread.get('extendingThread')?.isCompleted) {
            expect(event('A').isPending).toBeTruthy();
            expect(thread.get('requestingThread')?.isCompleted).toBeFalsy();
            done();
        }
    });
});


test("an extend can be resolved. This will progress waits and requests", (done) => {
    const requestingThread = flow({name: 'requestingThread'}, function* () {
        const val = yield bp.request("A", delay(100, 'value'));
        expect(val).toBe('value extended');
    });

    const extendingThread = flow({name: 'extendingThread'}, function* () {
        const extend = yield bp.extend("A");
        expect(extend.value).toBe('value');
        extend.resolve(extend.value + " extended");
    });

    const waitingThread = flow({name: 'waitingThread'}, function* () {
        const val = yield bp.askFor("A");
        expect(val).toBe('value extended');
        yield bp.askFor('fin');
    });

    testScenarios((enable) => {
        enable(requestingThread());
        enable(extendingThread());
        enable(waitingThread());
    }, ({event}) => {
        if(event('fin').dispatch) {
            done();
        }  
    });
});

test("an extend will keep the event-pending if the BThread with the extend completes.", (done) => {
    let requestingThreadProgressed = false;
    const requestingThread = flow(null, function* () {
        yield bp.request("A", 1);
        requestingThreadProgressed = true;
    });

    const extendingThread = flow(null, function* () {
        yield bp.extend("A");
        // after the extend, this BThread completes, keeping the extend active.
    });

    testScenarios((enable) => {
        enable(requestingThread());
        enable(extendingThread());
    }, ({event}) => {
        expect(event('A').isPending).toBeTruthy();
        expect(requestingThreadProgressed).toBe(false);
        done();
    });
});

test("multiple extends will resolve after another. After all extends complete, the request and wait will continue", (done) => {
    const requestingThread = flow(null, function* () {
        const val = yield bp.request("A", delay(100, 'super'));
        expect(val).toBe('super extend1 extend2');
    });

    const extendingThread = flow(null, function* () {
        const extend = yield bp.extend("A");
        expect(extend.value).toBe('super extend1');
        extend.resolve(extend.value + " extend2");
    });

    const extendingThreadHigherPriority = flow(null, function* () {
        const extend = yield bp.extend("A");
        expect(extend.value).toBe('super');
        extend.resolve(extend.value + ' extend1');
    });

    const waitingThread = flow(null, function* () {
        const val = yield bp.askFor("A");
        expect(val).toBe('super extend1 extend2');
        yield bp.askFor('fin');
    });
    
    testScenarios((enable) => {
        enable(requestingThread());
        enable(extendingThread());
        enable(extendingThreadHigherPriority()); // this BThread is enabled after the first extendingThread, giving it a higher priority
        enable(waitingThread());
    }, ({event}) => {
        if(event('fin').dispatch) {
            done();
        }  
    });
});

test("an extend can be resolved in the same cycle", () => {
    let loopCount = 0;
    let requestedValue: number;

    const requestingThread = flow(null, function* () {
        const val: number = yield bp.request("A", 1);
        requestedValue = val;
    });

    const extendingThread = flow(null, function* () {
        const extendContext: ExtendContext = yield bp.extend("A");
        extendContext.resolve(extendContext.value + 1);
    });

    testScenarios((enable) => {
        loopCount++;
        enable(requestingThread());
        enable(extendingThread());
    }, ({event}) => {
        expect(event('A').isPending).toBeFalsy();
        expect(requestedValue).toEqual(2);
        expect(loopCount).toEqual(2); // 1: init, 2: request & extend (same loop)
    });
});

test("an extend can have an optional validation-function", () => {

    const requestingThread = flow(null, function* () {
        const val: number = yield bp.request("A", 1);
        expect(val).toBe(10);
        const val2: number = yield bp.request("A", 2);
        expect(val2).toBe(99);
    });

    const extendingThreadOne = flow(null, function* () {
        const extendContext: ExtendContext = yield bp.extend("A", (val: number) => val === 2);
        extendContext.resolve(99);
    });
    const extendingThreadTwo = flow(null, function* () {
        const extendContext: ExtendContext = yield bp.extend("A", (val: number) => val === 1);
        extendContext.resolve(10);
    });

    testScenarios((enable) => {
        enable(requestingThread());
        enable(extendingThreadOne());
        enable(extendingThreadTwo());
    }, ({event}) => {
        expect(event('A').isPending).toBeFalsy();
    });
});

test("a wait can be extended. during the extension, the event is pending", (done) => {
    const waitingThread = flow(null, function* () {
        yield bp.wait("AB");
    });

    const extendingThread = flow(null, function* () {
        const x = yield bp.extend("AB");
        yield bp.wait('fin');
    });

    testScenarios((enable) => {
        enable(waitingThread());
        enable(extendingThread());
    }, ({event, log}) => {
        if(event('AB').dispatch !== undefined) event('AB')!.dispatch!();
        else {
            expect(event('AB').isPending).toBe(true);
            done();
        }

    });
});

test("a wait can be extended. After resolving the extend, the wait will be continued", (done) => {
    let timesEventADispatched = 0;

    const waitingThread = flow(null, function* () {
        const val = yield bp.wait("eventA");
        expect(val).toBe(12);
        expect(timesEventADispatched).toBe(1);
        done();
    });

    const extendingThread = flow(null, function* () {
        const x = yield bp.extend("eventA");
        yield bp.request('ASYNC', () => delay(200));
        x.resolve(12);
    });


    testScenarios((enable) => {
        enable(waitingThread());
        enable(extendingThread());
    }, ({event}) => {
        if(event('eventA').dispatch !== undefined) {
            event('eventA')!.dispatch!(10);
            timesEventADispatched++;
        }

    });
});