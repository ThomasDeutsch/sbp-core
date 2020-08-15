import { Bid } from './bid';
import { EventMap, FCEvent } from './event';
import * as utils from './utils';

export type GuardFunction = (payload: any) => boolean

export function getGuardForWaits(bids: Bid[] | undefined, event: FCEvent): GuardFunction | undefined {
    if(!bids) return undefined;
    let guards: GuardFunction[] | undefined = bids.map(bid => bid.guard).filter(utils.notUndefined);
    if(event.key !== undefined) {
        const g = getGuardForWaits(bids, {name: event.name}); // also get the guard from the no-key wait
        if(g) {
            guards = guards || [];
            guards.push(g);
        }
    }
    if(guards === undefined || guards.length === 0) return undefined;
    if(guards.length === 1) return guards[0];
    return (payload: any) => guards!.filter(utils.notUndefined).some(guard => guard(payload)); // return true if some BThread will accept the payload
}


export function getGuardedUnguardedBlocks(eventMap: EventMap<Bid[]> | undefined): [EventMap<true> | undefined, EventMap<GuardFunction> | undefined] {
    if(eventMap === undefined) return [undefined, undefined];
    const fixed: EventMap<true> = new EventMap();
    const guarded = new EventMap<GuardFunction>();
    eventMap.forEach((event, bids) => {
        const guards = bids.map(bid => bid.guard).filter(utils.notUndefined);
        if(guards.length !== bids.length) fixed.set(event, true);
        else guarded.set(event, (payload: any) => guards.some(guard => guard(payload)))
    });
    return [fixed, guarded.size() > 0 ? guarded: undefined];
}


export function combineGuards(eventMap: EventMap<Bid[]>, guardedBlocks: EventMap<GuardFunction>): void {
    guardedBlocks.forEach((event, blockGuard) => {
        const bids = eventMap.get(event);
        if(!bids) return;
        const newBids = bids.map(bid => {
            const oldGuard = bid.guard;
            bid.guard = (payload: any) => (!oldGuard || oldGuard(payload)) && !blockGuard(payload);
            return bid;
        })
        eventMap.set(event, newBids); // mutate the eventMap
    });
}