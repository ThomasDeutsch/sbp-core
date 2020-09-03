import { Action } from './action';
import { EventDispatch } from './event-dispatcher';
import { createUpdateLoop, ScenariosContext, StagingFunction } from './update-loop';

export * from './scenario';
export * from './event-dispatcher';
export * from './bthread';
export * from './update-loop';
export * from './event-cache';
export * from "./bid";
export * from './event';
export * from './logger';
export * from './action';
export * from './explain';
export * from './extend-context';
export type UpdateCallback = (scenario: ScenariosContext) => any;
export type StartReplay = (actions: Action[]) => void;

export function scenarios(stagingFunction: StagingFunction, updateCb?: UpdateCallback, updateInitial = false): [ScenariosContext, EventDispatch, StartReplay] {
    const bufferedActions: Action[] = [];
    const bufferedReplayMap = new Map<number, Action>();
    const [updateLoop, dispatch, actionQueue, replayMap, actionDispatch] = createUpdateLoop(stagingFunction, 
        (action: Action): void => {
            if(action) {
                if(action.index === null) {
                    bufferedActions.push(action);
                } else {  // is a replay action
                    if(action.index === 0) replayMap.clear();
                    bufferedReplayMap.set(action.index, action);
                }
                Promise.resolve().then(() => {
                    let withUpdate = false;
                    if(bufferedActions.length !== 0) {
                        bufferedActions.forEach(action => actionQueue.push(action));
                        bufferedActions.length = 0;
                        withUpdate = true;
                    } if(bufferedReplayMap.size !== 0) {
                        bufferedReplayMap.forEach((action, key) => replayMap.set(key, action));
                        bufferedReplayMap.clear();
                        withUpdate = true;
                    }
                    if(withUpdate) {
                        if(updateCb !== undefined) updateCb(updateLoop());
                        else updateLoop();
                    }
                }).catch(e => console.error(e));
            }
    });
    const startReplay = (actions: Action[]) => {
       actions.forEach(action => actionDispatch(action));
    }
    const initialScenarioContext = updateLoop();
    if(updateCb !== undefined && updateInitial) updateCb(initialScenarioContext); // callback with initial value
    return [initialScenarioContext, dispatch, startReplay];
}
