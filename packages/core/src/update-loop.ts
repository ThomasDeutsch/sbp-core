/* eslint-disable @typescript-eslint/no-explicit-any */

import { scenarioId, ThreadGen, BThread, ThreadDictionary, ThreadState } from './bthread';
import { getAllBids, BidArrayDictionary, BidDictionariesByType, BidType, BidDictionaries } from './bid';
import * as utils from "./utils";
import { Logger } from "./logger";
import { Action, getNextActionFromRequests } from "./action";
import { dispatchByWait } from "./dispatch-by-wait";
import { getOverridesByComponentName, OverridesByComponent } from './overrides';


// -----------------------------------------------------------------------------------
// ADVANCE THREADS

function advanceThreads(
    threadDictionary: ThreadDictionary,
    waits: BidArrayDictionary,
    intercepts: BidArrayDictionary,
    action: Action
): void {
    let wasAsyncRequest,
        payload = action.payload;
    if (action.threadId && threadDictionary[action.threadId]) {
        [payload, wasAsyncRequest] = threadDictionary[action.threadId].progressRequestResolve(action.type, action.eventName, payload);
    }
    if (!wasAsyncRequest && waits[action.eventName] && waits[action.eventName].length) {
        if (intercepts[action.eventName]) {
            const i = [...intercepts[action.eventName]];
            while(i.length) {
                const nextThread = i.pop();
                if(nextThread) {
                    const wasIntercepted = threadDictionary[nextThread.threadId].progressWaitIntercept(BidType.intercept, action.eventName, payload);
                    if(wasIntercepted) return;
                }
            }  
        }
        waits[action.eventName].forEach(({ threadId }): void => {
            threadDictionary[threadId].progressWaitIntercept(BidType.wait, action.eventName, payload);
        });
    }
}


// -----------------------------------------------------------------------------------
// UPDATE & DELETE THREADS


type EnableThreadFunctionType = (gen: ThreadGen, args?: any[], key?: string | number) => ThreadState;

export type ScaffoldingFunction = (e: EnableThreadFunctionType) => void;


function setupAndDeleteThreads(
    scaffolding: ScaffoldingFunction,
    threadDictionary: ThreadDictionary,
    dispatch: Function,
    logger?: Logger
): string[] {
    const threadIds: Set<string> = new Set();
    const orderedThreadIds: string[] = [];

    const enableThread: EnableThreadFunctionType = (gen: ThreadGen, args?: any[], key?: string | number): ThreadState => {
        if(!args) args = [];
        const id: string = scenarioId(gen, key);
        threadIds.add(id);
        orderedThreadIds.push(id);
        if (threadDictionary[id]) {
            threadDictionary[id].resetOnArgsChange(args);
        } else {
            threadDictionary[id] = new BThread(gen, args, dispatch, key, logger);
        }
        return threadDictionary[id].state;
    };

    scaffolding(enableThread); // enable threads
    Object.keys(threadDictionary).forEach((id): void => {
        const notEnabledAndNotProgressed = !threadIds.has(id) && threadDictionary[id].nrProgressions === 0;
        if (notEnabledAndNotProgressed) {
            threadDictionary[id].onDelete();
            delete threadDictionary[id]; // delete unused threads
        }
    });
    return orderedThreadIds;
}


// -----------------------------------------------------------------------------------
// UPDATE LOOP

export interface ScenarioStates {
    dispatchByWait: Record<string, Function>;
    overrides: OverridesByComponent,
    thread: Record<string,ThreadState>;
}

export interface DispatchedActions {
    isReplay?: boolean;
    actions: Action[];
}

export type UpdateLoopFunction = (ext?: DispatchedActions | null) => ScenarioStates;


export function createUpdateLoop(scaffolding: ScaffoldingFunction, dispatch: Function, logger?: Logger): UpdateLoopFunction {
    const threadDictionary: ThreadDictionary = {};
    let orderedThreadIds: string[];
    let bids: BidDictionariesByType;

    const setThreadsAndBids = (): void => {
        orderedThreadIds = setupAndDeleteThreads(scaffolding, threadDictionary, dispatch, logger);
        bids = getAllBids(orderedThreadIds.map((id): BidDictionaries | null => threadDictionary[id].getBids()));
    };
    setThreadsAndBids(); // initial setup

    const updateLoop: UpdateLoopFunction = (ext?: DispatchedActions | null): ScenarioStates => {
        let nextAction: Action | null = null;
        let remainingActions: DispatchedActions | null = null;
        if (ext && ext.actions.length > 0) {  // external event
            if (ext.isReplay) { // external event is a replay
                Object.keys(threadDictionary).forEach((key): void => { delete threadDictionary[key] });
                setThreadsAndBids();
            }
            nextAction = ext.actions[0];
            remainingActions = {
                isReplay: false,
                actions: utils.dropFirst(ext.actions)
            };
        } else {
            nextAction = getNextActionFromRequests(bids.request);
        }
        if (nextAction) {
            if (logger) logger.logAction(nextAction);
            advanceThreads(threadDictionary, bids.wait, bids.intercept, nextAction);
            setThreadsAndBids();
            return updateLoop(remainingActions);
        }
        const dbw = dispatchByWait(dispatch, bids.wait)
        return {
            dispatchByWait: dbw,
            overrides: getOverridesByComponentName(orderedThreadIds, dbw, threadDictionary),
            thread: Object.keys(threadDictionary).reduce((acc: Record<string, ThreadState>, threadId: string): Record<string, ThreadState> => {
                acc[threadId] = threadDictionary[threadId].state;
                return acc;
            }, {})
        };
    };
    return updateLoop;
}