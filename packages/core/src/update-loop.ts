import { GeneratorFn, BThread, InterceptResultType, BThreadState, BThreadKey } from './bthread';
import { getAllBids, BidType, AllBidsByType, getMatchingBids, BThreadBids } from './bid';
import { Logger, Log } from './logger';
import { Action, getNextActionFromRequests, ActionType } from './action';
import { setupEventDispatcher, EventDispatch } from "./event-dispatcher";
import { EventMap, FCEvent, toEvent } from './event';
import * as utils from './utils';
import { EnableEventCache, EventCache, setEventCache, CachedItem } from './event-cache'
import { FlowContext } from './flow';


type EnableThread = ({id, title, gen, args, key}: FlowContext) => BThreadState;
type GetBThreadState = (id: string) => BThreadState;
export type StagingFunction = (e: EnableThread, s: EnableEventCache<unknown>, g: GetBThreadState) => void;
export type ActionDispatch = (action: Action) => void;
export type TriggerWaitDispatch = (payload: any) => void;

type GetCache = (event: FCEvent | string) => any;
type GetIsPending =  (event: FCEvent | string) => boolean;
export type UpdateLoopFunction = (actionQueue?: Action[] | undefined) => ScenariosContext;

export interface BThreadDictionary {
    [Key: string]: BThread;
}

export interface ScenariosContext {
    dispatch: EventDispatch;
    latest: GetCache;
    isPending: GetIsPending;
    log?: Log;
}

function createBThreadId(id: string, key?: BThreadKey): string {
    return key || key === 0 ? `${id}_${key.toString()}` : id;
}

function extendAction(allBids: AllBidsByType, bThreadDictionary: BThreadDictionary, action: Action): Action | undefined {
    let bids = getMatchingBids(allBids[BidType.extend], action.event);
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

function advanceWaits(allBids: AllBidsByType, bThreadDictionary: BThreadDictionary, action: Action): boolean {
    const bids = getMatchingBids(allBids[BidType.wait], action.event) || [];
    if(bids.length === 0) return false;
    bids.forEach(bid => {
        bThreadDictionary[bid.threadId].progressWait(action, bid);
    });
    return true;
}

function advanceBThreads(bThreadDictionary: BThreadDictionary, eventCache: EventCache, allBids: AllBidsByType, action: Action): void {
    if(action.type === ActionType.initial) return undefined;
    // requested
    if(action.type === ActionType.requested) {
        if (typeof action.payload === "function") {
            action.payload = action.payload(eventCache.get(action.event)?.current);
        } else if(action.payload === undefined) {
            action.payload = eventCache.get(action.event)?.current;
        }
        if(utils.isThenable(action.payload) && bThreadDictionary[action.threadId]) {
            bThreadDictionary[action.threadId].addPendingRequest(action.event, action.payload);
            return;
        }
        const nextAction = extendAction(allBids, bThreadDictionary, action);
        if(!nextAction) return;
        setEventCache(true, eventCache, nextAction.event, nextAction.payload);
        bThreadDictionary[nextAction.threadId].progressRequest(nextAction); // request got resolved
        advanceWaits(allBids, bThreadDictionary, nextAction);
        return;
    }
    // dispatched
    if(action.type === ActionType.dispatched) {
        const nextAction = extendAction(allBids, bThreadDictionary, action);
        if(!nextAction) return;
        const isValidDispatch = advanceWaits(allBids, bThreadDictionary, nextAction);
        if(!isValidDispatch) console.warn('action was not waited for: ', action.event.name)
        return;
    }
    // resolved
    if(action.type === ActionType.resolved) {
        if(bThreadDictionary[action.threadId]) {
            const isResolved = bThreadDictionary[action.threadId].resolvePending(action);
            if(isResolved === false) return;
        }
        const nextAction = extendAction(allBids, bThreadDictionary, action);
        if(!nextAction) return;
        setEventCache(true, eventCache, nextAction.event, nextAction.payload);
        bThreadDictionary[action.threadId].progressRequest(nextAction); // request got resolved
        advanceWaits(allBids, bThreadDictionary, nextAction); 
        return;
    }
    // rejected
    if(action.type === ActionType.rejected) {
        if(bThreadDictionary[action.threadId]) {
            bThreadDictionary[action.threadId].rejectPending(action);
        }
        return;
    }
}


function setupScaffolding(
    stagingFunction: StagingFunction,
    bThreadDictionary: BThreadDictionary,
    eventCache: EventCache,
    dispatch: ActionDispatch,
    logger?: Logger
) {
    const bids: BThreadBids[] = [];
    function enableBThread({id, title, gen, args, key}: FlowContext): BThreadState {
        id = createBThreadId(id, key);
        if (bThreadDictionary[id]) {
            bThreadDictionary[id].resetOnArgsChange(args);
        } else {
            bThreadDictionary[id] = new BThread(id, gen, args, dispatch, key, logger, title);
            logger?.addThreadInfo(id, {title: title, key: key});
        }
        const threadBids = bThreadDictionary[id].getBids();
        bids.push(threadBids);
        return bThreadDictionary[id].state;
    }
    function enableEventCache<T>(event: FCEvent | string, initial?: T): CachedItem<T> {
        event = toEvent(event);
        setEventCache<T>(false, eventCache, event, initial);
        return eventCache.get(event)!;
    }
    function getBThreadState(id: string): any {
        return bThreadDictionary[id].state;
    }
    function run(): BThreadBids[] {
        bids.length = 0;
        stagingFunction(enableBThread, enableEventCache, getBThreadState); 
        return [...bids];
    }
    return run;
}

// -----------------------------------------------------------------------------------
// UPDATE LOOP

export function createUpdateLoop(stagingFunction: StagingFunction, dispatch: ActionDispatch, disableLogging?: boolean): [UpdateLoopFunction, EventDispatch] {
    const bThreadDictionary: BThreadDictionary = {};
    const eventCache: EventCache = new EventMap();
    const logger = disableLogging ? undefined : new Logger();
    const scaffold = setupScaffolding(stagingFunction, bThreadDictionary, eventCache, dispatch, logger);
    const [updateEventDispatcher, eventDispatch] = setupEventDispatcher(dispatch);
    const getEventCache: GetCache = (event: FCEvent | string) => eventCache.get(toEvent(event))?.current;
    // main loop-function:
    function updateLoop(actionQueue?: Action[]): ScenariosContext {
        let action = actionQueue?.shift();
        // start a replay?
        if (action && action.type === ActionType.replay) {
            Object.keys(bThreadDictionary).forEach((threadId): void => { 
                bThreadDictionary[threadId].onDelete();
                delete bThreadDictionary[threadId]
            }); // delete all BThreads
            eventCache.clear();
            logger?.resetLog(); // empty current log
            return updateLoop(action.payload); // start a replay
        }
        // not a replay
        const bids = getAllBids(scaffold());
        action = action || getNextActionFromRequests(bids.request);
        if (action) {
            logger?.logAction(action);
            advanceBThreads(bThreadDictionary, eventCache, bids, action);
            return updateLoop(actionQueue);
        }
        // ------ create the return value:
        updateEventDispatcher(bids.wait?.difference(bids[BidType.pending]));
        logger?.logWaits(bids.wait);
        const pendingEventMap = bids[BidType.pending] || new EventMap();
        logger?.logPendingEvents(pendingEventMap);
        return {
            dispatch: eventDispatch,
            latest: getEventCache, // latest values from event cache
            isPending: (event: FCEvent | string) => pendingEventMap.has(toEvent(event)), // pending Events
            log: logger?.getLog() // get all actions and reactions + pending event-names by thread-Id
        };
    }
    return [updateLoop, eventDispatch];
}