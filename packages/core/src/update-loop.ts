import { GeneratorFn, BThread, BThreadState, InterceptResultType } from './bthread';
import { getAllBids, BidType, AllBidsByType, getMatchingBids, BThreadBids, Bid } from './bid';
import { Logger, Log } from './logger';
import { Action, getNextActionFromRequests, ActionType } from './action';
import { setupEventDispatcher, EventDispatch } from "./event-dispatcher";
import { EventMap, FCEvent, toEvent } from './event';
import * as utils from './utils';


type EnableThreadFunctionType = (gen: GeneratorFn, args?: any[], key?: string | number) => BThreadState;
type EnableCacheFunction = (event: FCEvent | string, initialValue: any) => StateRef<any>;
export type StagingFunction = (e: EnableThreadFunctionType, s: EnableCacheFunction) => void;
export type ActionDispatch = (action: Action) => void;
export type TriggerWaitDispatch = (payload: any) => void;
export type UpdateLoopFunction = (dispatchedAction?: Action, nextActions?: Action[]) => ScenariosContext;
type EventCache = EventMap<StateRef<any>>;
type GetStateFunction = (event: FCEvent | string) => any;

export interface BThreadDictionary {
    [Key: string]: BThread;
}

export interface StateRef<T> {
    current: T;
    previous?: T;
}

export interface ScenariosContext {
    dispatch: EventDispatch;
    state: GetStateFunction;
    bTState: Record<string, BThreadState>;
    log?: Log;
}

function createScenarioId(generator: GeneratorFn, key?: string | number): string {
    const id = generator.name;
    return key || key === 0 ? `${id}_${key.toString()}` : id;
}

function interceptAction(allBids: AllBidsByType, bThreadDictionary: BThreadDictionary, action: Action): Action | undefined {
    let bids = getMatchingBids(allBids[BidType.intercept], action.event);
    if(bids === undefined || bids.length === 0) return action;
    bids = [...bids];
    while(bids.length > 0) {
        const nextBid = bids.pop();
        if(nextBid === undefined) continue;
        const nextAction = {...action};
        if(nextBid.payload !== undefined && (nextAction.type === ActionType.dispatched || nextAction.type === ActionType.requested)) {
            nextAction.payload = (typeof nextBid.payload === 'function') ? nextBid.payload(nextAction.payload) : nextBid.payload;
            if(utils.isThenable(nextAction.payload) && bThreadDictionary[nextAction.threadId]) {
                bThreadDictionary[nextAction.threadId].addPendingRequest(nextBid.event, nextAction.payload);
                return undefined;
            }
        }
        const interceptResult = bThreadDictionary[nextBid.threadId].progressIntercept(nextAction, nextBid);
        if(interceptResult === InterceptResultType.interceptingThread) return undefined;
        if(interceptResult === InterceptResultType.progress) action = nextAction;
    } 
    return action;
}

function advanceRequests(allBids: AllBidsByType, bThreadDictionary: BThreadDictionary, action: Action): void {
    const bids = getMatchingBids(allBids[BidType.request], action.event);
    if(bids === undefined || bids.length === 0) return;
    bids.forEach(bid => {
        bThreadDictionary[bid.threadId].progressRequest(action, bid);
    });
}

function advanceWaits(allBids: AllBidsByType, bThreadDictionary: BThreadDictionary, action: Action): void {
    const bids = getMatchingBids(allBids[BidType.wait], action.event);
    if(bids === undefined || bids.length === 0) return;
    bids.forEach(bid => {
        bThreadDictionary[bid.threadId].progressWait(action, bid);
    });
}

function advanceBThreads(bThreadDictionary: BThreadDictionary, eventCache: EventCache, allBids: AllBidsByType, action: Action): void {
    if(action.type === ActionType.initial) return;
    // requested
    if(action.type === ActionType.requested) {
        if (typeof action.payload === "function") {
            action.payload = action.payload(eventCache.get(action.event)?.current);
        }
        if(utils.isThenable(action.payload) && bThreadDictionary[action.threadId]) {
            bThreadDictionary[action.threadId].addPendingRequest(action.event, action.payload);
            return;
        }
        const nextAction = interceptAction(allBids, bThreadDictionary, action);
        if(nextAction) {
            advanceRequests(allBids, bThreadDictionary, nextAction);
            advanceWaits(allBids, bThreadDictionary, nextAction);
        }
    }
    // dispatched
    else if(action.type === ActionType.dispatched) {
        const nextAction = interceptAction(allBids, bThreadDictionary, action);
        if(nextAction) {
            advanceWaits(allBids, bThreadDictionary, nextAction);
        }
    }
    // resolved
    else if(action.type === ActionType.resolved) {
        if(bThreadDictionary[action.threadId]) {
            bThreadDictionary[action.threadId].resolvePending(action);
        }
        const nextAction = interceptAction(allBids, bThreadDictionary, action);
        if(nextAction) {
            bThreadDictionary[action.threadId].progressRequest(nextAction); // request got resolved
            advanceRequests(allBids, bThreadDictionary, nextAction);
            advanceWaits(allBids, bThreadDictionary, nextAction);
        }
    }
    // rejected
    else if(action.type === ActionType.rejected) {
        if(bThreadDictionary[action.threadId]) {
            bThreadDictionary[action.threadId].rejectPending(action);
        }
    }
}

function updateEventCache(eventCache: EventCache, action: Action): void {
    if (action.type !== ActionType.requested) return;
    const events = eventCache.getAllMatchingEvents(action.event);
    if(events === undefined) return;
    events.forEach(event => {
        const isCachedEvent = eventCache.has({name: event.name});
        if(isCachedEvent) {
            let val = eventCache.get(event) || {current: undefined};
            val.previous =  val.current;
            val.current = action.payload;
            eventCache.set(event, val);
        }
    }); 
}

function stageBThreadsAndEventCaches(
    stagingFunction: StagingFunction,
    bThreadDictionary: BThreadDictionary,
    eventCache: EventCache,
    dispatch: ActionDispatch,
    logger?: Logger
): string[] {
    const threadIds: Set<string> = new Set();
    const orderedThreadIds: string[] = [];
    const enableBThread: EnableThreadFunctionType = (gen: GeneratorFn, args: any[] = [], key?: string | number): BThreadState => {
        const id: string = createScenarioId(gen, key);
        threadIds.add(id);
        orderedThreadIds.push(id);
        if (bThreadDictionary[id]) {
            bThreadDictionary[id].resetOnArgsChange(args);
        } else {
            bThreadDictionary[id] = new BThread(id, gen, args, dispatch, key, logger);
        }
        return bThreadDictionary[id].state;
    };
    const enableEventCache: EnableCacheFunction = (event: FCEvent | string, initialValue?: any): StateRef<any> => {
        event = toEvent(event);
        if(!eventCache.has(event)) {
            eventCache.set(event, {current: initialValue});
        }
        return eventCache.get(event)!;
    }
    stagingFunction(enableBThread, enableEventCache); 
    return orderedThreadIds;
}

// -----------------------------------------------------------------------------------
// UPDATE LOOP

export function createUpdateLoop(stagingFunction: StagingFunction, dispatch: ActionDispatch, disableLogging?: boolean): [UpdateLoopFunction, EventDispatch] {
    const bThreadDictionary: BThreadDictionary = {};
    const eventCache: EventCache = new EventMap();
    let orderedThreadIds: string[];
    const logger = disableLogging ? undefined : new Logger();
    const [updateEventDispatcher, eventDispatch] = setupEventDispatcher(dispatch);
    const getEventCache: GetStateFunction = (event: FCEvent | string) => eventCache.get(toEvent(event))?.current;
    const updateLoop: UpdateLoopFunction = (dispatchedAction?: Action, remainingReplayActions?: Action[]): ScenariosContext => {
        if (dispatchedAction !== undefined) { 
            if (dispatchedAction.type === ActionType.replay) {
                Object.keys(bThreadDictionary).forEach((threadId): void => { 
                    bThreadDictionary[threadId].onDelete();
                    delete bThreadDictionary[threadId]
                }); // delete all BThreads
                eventCache.clear();
                logger?.resetLog(); // empty current log
                return updateLoop(undefined, dispatchedAction.payload); // start a replay
            }
        } 
        orderedThreadIds = stageBThreadsAndEventCaches(stagingFunction, bThreadDictionary, eventCache, dispatch, logger);
        const bThreadBids = orderedThreadIds.map(id => bThreadDictionary[id].getBids());
        const bids = getAllBids(bThreadBids);
        // get the next action
        let nextAction: Action | undefined, restActions: Action[] | undefined;
        if(remainingReplayActions !== undefined && remainingReplayActions.length > 0) {
            [nextAction, ...restActions] = remainingReplayActions;
        } else if(dispatchedAction) {
            nextAction = dispatchedAction;
        } else {
            nextAction = getNextActionFromRequests(bids.request);
        }
        if (nextAction) {
            logger?.logAction(nextAction);
            advanceBThreads(bThreadDictionary, eventCache, bids, nextAction);
            updateEventCache(eventCache, nextAction);
            return updateLoop(undefined, restActions);
        }
        // ------ create the return value:
        updateEventDispatcher(bids.wait?.difference(bids[BidType.pending]));
        logger?.logPendingEvents(bids[BidType.pending] || new EventMap());
        logger?.logWaits(bids.wait);
        const bTStateById = Object.keys(bThreadDictionary).reduce((acc: Record<string, BThreadState>, threadId: string): Record<string, BThreadState> => {
            acc[threadId] = bThreadDictionary[threadId].state;
            return acc;
        }, {});
        return {
            dispatch: eventDispatch,
            state: getEventCache, // event caches
            bTState: bTStateById, // BThread state by id
            log: logger?.getLog() // get all actions and reactions + pending event-names by thread-Id
        };
    };
    return [updateLoop, eventDispatch];
}
