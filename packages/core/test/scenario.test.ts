import * as bp from "../src/bid";
import { testScenarios } from './testutils';
import { StagingFunction, Action, UpdateLoop, BTContext } from '../src/index';
import { flow } from '../src/scenario';

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

test("testScenarios can be used without updateCb and logger", done => {
    const thread1 = flow(null, function* (this: BTContext) {
        yield bp.request("A", delay(10));
        expect(1).toEqual(1); // simple test if this point is reached.
        done();
    })

    testScenarios((enable) => {
        enable(thread1());
    });
});

test("there is be a dispatch-function for every waiting event", () => {

    const thread1 = flow(null, function* () {
        yield [bp.wait("eventOne"), bp.wait("eventTwo")];
    })

    const thread2 = flow(null, function* () {
        yield bp.wait("eventThree");
    })

    testScenarios((enable) => {
        enable(thread1());
        enable(thread2());
    }, ({event}) => {
        expect(event('eventOne').dispatch).toBeDefined();
        expect(event('eventTwo').dispatch).toBeDefined();
        expect(event('eventThree').dispatch).toBeDefined();

    });
});


function loggerScenarios(stagingFunction: StagingFunction, da: Set<string>): void {
    const loop = new UpdateLoop(stagingFunction, (a: Action): void => {
        if(a) {
            if(a.payload) da.add(a.payload.event.name);
            loop.actionQueue.push(a);
        }
        loop.runLoop();   
    });
    loop.runLoop();
}

test("if a request is cancelled, it will not trigger the same event-name after resolving - even if there are threads waiting for this event. ", done => {
    const dispatchedActions = new Set<string>();
    
    const thread1 = flow(null, function* () {
        yield bp.request("cancel", delay(100));
    });

    const thread2 = flow(null, function* (): any {
        let [type] = yield [bp.request('async-event', () => delay(500)), bp.wait('cancel')];
        expect(type.name).toEqual('cancel');
        [type] = yield [bp.wait('async-event'), bp.request("async-event-two", () => delay(1000))];
        expect(type.name).toEqual('async-event-two');
        done();
    });
    
    loggerScenarios((enable) => {
        enable(thread1());
        enable(thread2());
    }, dispatchedActions);
});


test("pending will show what events are pending", (done) => {
    const thread1 = flow(null, function* () {
        yield bp.request("count", () => delay(2000));
    });

    testScenarios((enable, cache) => {
        cache({name: 'count'});
        enable(thread1());
    }, ({event}) => {
        if(event('count').pending) {
            expect(event("count")).toBeDefined();
            done();
        }
    });
});

test("the bThreadState is returned by the scenarios function", () => {

    const thread1 = flow({name: 'thread1', title: 'myThread1'}, function* () {
        yield bp.request("eventOne");
    });
  
    const thread2 = flow({name: 'thread2', title: 'myThread2'}, function* ({prop1: number, prop2: string}) {
        yield bp.wait("eventTwo");
    })
  
    testScenarios((enable) => {
        enable(thread1());
        enable(thread2({prop1: 912, prop2: 'test'}));
    }, ({thread}) => {
        expect(thread.get('thread1')?.isCompleted).toBeTruthy();
        expect(thread.get('thread2')?.isCompleted).toBeFalsy();
        
    });
  });