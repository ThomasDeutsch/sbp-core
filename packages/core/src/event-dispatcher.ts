import { BidsForBidType, Bid, BidSubType, PendingEventInfo } from './bid';
import { ActionType } from './action';
import { ActionDispatch } from './update-loop';
import { FCEvent, EventMap, toEvent } from './event';
import { getGuardForWaits, GuardFunction } from './guard';


export type TriggerDispatch = () => void
type CachedDispatch = (payload: any) => TriggerDispatch | undefined;
export type EventDispatch = (event: FCEvent | string, payload?: any) => TriggerDispatch | undefined;
type EventDispatchUpdater = (waits: BidsForBidType, pending: EventMap<PendingEventInfo>) => void;


interface DispatchCache {
    payload?: any;
    dispatch?: TriggerDispatch | undefined;
}


export function setupEventDispatcher(dispatch: ActionDispatch): [EventDispatchUpdater, EventDispatch] {
    const dispatchByEvent = new EventMap<CachedDispatch>();
    const guardByEvent = new EventMap<GuardFunction | undefined>();
    const dispatchFunction: EventDispatch = (event: FCEvent | string, payload?: any): TriggerDispatch | undefined  => {
        const dp = dispatchByEvent.get(toEvent(event));
        if(dp === undefined) return undefined;
        return dp(payload);
    }
    const updateEventDispatcher = (waits: BidsForBidType, pending: EventMap<PendingEventInfo>): void => {
        guardByEvent.clear();
        const dpWaits = new EventMap<Bid[]>();
        waits?.forEach((event, bids) => {
            const newBids = bids.filter(bid => (bid.subType !== BidSubType.on) && !pending.has(event));
            if(newBids.length > 0) dpWaits.set(event, newBids);
        })
        if(!dpWaits || dpWaits.size() === 0) { 
            dispatchByEvent.clear();
            return;
        }
        dispatchByEvent.intersection(dpWaits);
        dpWaits.forEach((waitEvent) => {
            guardByEvent.set(waitEvent, getGuardForWaits(dpWaits.get(waitEvent), waitEvent));
            if(!dispatchByEvent.has(waitEvent)) {
                const cache: DispatchCache = {};
                dispatchByEvent.set(waitEvent, (payload?: any): TriggerDispatch | undefined => {
                    const guard = guardByEvent.get(waitEvent);
                    if(guard && guard(payload) === false) return undefined;
                    if(cache.dispatch && Object.is(payload, cache.payload)) return cache.dispatch;
                    cache.payload = payload;
                    cache.dispatch = (): void => dispatch({index: null, type: ActionType.dispatched, event: waitEvent, payload: payload, threadId: ""});
                    return cache.dispatch;
                });
            }
        });
    }
    return [updateEventDispatcher, dispatchFunction];
}