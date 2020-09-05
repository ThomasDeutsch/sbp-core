import { Action, ActionType } from './action';
import { Bid, BidSubType, BidType, BThreadBids, getBidsForBThread } from './bid';
import { EventMap, FCEvent, toEvent } from './event';
import { EventCache, setEventCache } from './event-cache';
import { ActionDispatch } from './update-loop';
import * as utils from './utils';
import { ExtendContext } from './extend-context';
import { BThreadMap } from './bthread-map';

export type BTGen = Generator<Bid | (Bid | null)[] | null, void, any>;
export type GeneratorFn = (props: any) => BTGen;
export type BThreadKey = string | number;
export type BThreadId = {name: string; key?: BThreadKey};

export interface BThreadInfo {
    name: string;
    key?: BThreadKey;
    destroyOnDisable?: boolean;
    cancelPendingOnDisable?: boolean;
    title?: string;
    description?: string;
}

export interface BTContext {
    key?: BThreadKey;
    section: (newValue: string) => void;
    isPending: (event: string | FCEvent) => boolean;
}

export interface PendingEventInfo {
    event: FCEvent;
    threadId: BThreadId;
    actionIndex: number | null;
    isExtend: boolean;
}

export interface BThreadState {
    section?: string;
    waits: EventMap<Bid>;
    blocks: EventMap<Bid>;
    requests: EventMap<Bid>;
    extends: EventMap<Bid>;
    pendingEvents: EventMap<PendingEventInfo>;
    isCompleted: boolean;
}

export class BThread {
    public readonly info: BThreadInfo;
    public readonly idString: string;
    public readonly id: BThreadId;
    private readonly _dispatch: ActionDispatch;
    private readonly _generatorFn: GeneratorFn;
    private _currentProps: Record<string, any>;
    private _thread: BTGen;
    private _currentBids?: BThreadBids;
    public get currentBids() { return this._currentBids; }
    private _nextBid?: any;
    private _pendingRequests: EventMap<PendingEventInfo> = new EventMap();
    private _pendingExtends: EventMap<PendingEventInfo> = new EventMap();
    private _state: BThreadState = {
        section: undefined,
        waits: this._currentBids?.[BidType.wait] || new EventMap(),
        blocks: this._currentBids?.[BidType.block] || new EventMap(),
        requests: this._currentBids?.[BidType.request] || new EventMap(),
        extends: this._currentBids?.[BidType.extend] || new EventMap(),
        pendingEvents: new EventMap(),
        isCompleted: false
    };
    public get state() { return this._state; }

    public constructor(id: BThreadId, info: BThreadInfo, generatorFn: GeneratorFn, props: Record<string, any>, dispatch: ActionDispatch) {
        this.id = id;
        this.idString = BThreadMap.toIdString(id);
        this.info = info;
        this._dispatch = dispatch;
        this._generatorFn = generatorFn.bind(this._getBTContext());
        this._currentProps = props;
        this._thread = this._generatorFn(this._currentProps);
        this._processNextBid();
    }

     // --- private

     private _getBTContext(): BTContext {
        const section = (value: string) => {
            this._state.section = value;
        }
        return {
            key: this.info.key,
            section: section,
            isPending: (event: string | FCEvent) => this._state.pendingEvents.has(toEvent(event))
        };
    }

    private _setCurrentBids() {
        this._state.pendingEvents = this._pendingRequests.clone().merge(this._pendingExtends);
        this._currentBids = getBidsForBThread(this.id, this._nextBid, this._state.pendingEvents);
        this._state.waits = this._currentBids?.[BidType.wait] || new EventMap();
        this._state.blocks = this._currentBids?.[BidType.block] || new EventMap();
        this._state.requests = this._currentBids?.[BidType.request] || new EventMap();
        this._state.extends = this._currentBids?.[BidType.extend] || new EventMap();
    }

    private _processNextBid(returnValue?: any): void {
        const next = this._thread.next(returnValue);
        if (next.done) {
            this._state.isCompleted = true;
            delete this._state.section;
            delete this._nextBid;
            delete this._currentBids;
        } else {
            this._nextBid = next.value;
            this._setCurrentBids();
        }
    }

    private _progressBThread(bid: Bid, payload: any, isReject = false): void {
        let returnVal;
        if(!isReject) {
            returnVal = this._currentBids && this._currentBids.withMultipleBids ? [bid.event, payload] : payload;
        }
        this._pendingRequests.clear();
        this._processNextBid(returnVal);
    }


    private _deletePending(action: Action): boolean {
        if(action.resolve?.isResolvedExtend) {
            return this._pendingExtends.deleteSingle(action.event);
        }
        else {
            return this._pendingRequests.deleteSingle(action.event);
        }
    }

    // --- public

    public resetOnPropsChange(nextProps: any): void {
        const changedProps = utils.getChangedProps(this._currentProps, nextProps);
        if (changedProps === undefined) return;
        // reset
        this._pendingExtends = new EventMap();
        this._setCurrentBids();
        this._currentProps = nextProps;
        this._state.isCompleted = false;
        delete this._state.section;
        this._thread = this._generatorFn(this._currentProps);
        this._pendingRequests.clear();
        this._pendingExtends.clear();
        this._processNextBid();
    }

    public addPendingEvent(action: Action, isExtendPromise: boolean): void {
        const eventInfo: PendingEventInfo = {
            threadId: action.bThreadId,
            event: action.event,
            actionIndex: action.index,
            isExtend: isExtendPromise
        }    
        if(isExtendPromise) {
            this._pendingExtends.set(action.event, eventInfo);
        } else {
            this._pendingRequests.set(action.event, eventInfo);
        }
        this._setCurrentBids();
        const startTime = new Date().getTime();
        action.payload.then((data: any): void => {
            if(!this._thread) return; // was deleted
            const pendingEventInfo = this.state.pendingEvents.get(action.event);
            if (pendingEventInfo?.actionIndex === action.index) {
                const requestDuration = new Date().getTime() - startTime;
                this._dispatch({
                    index: action.resolveActionIndex || null, 
                    type: ActionType.resolved,
                    bThreadId: this.id,
                    event: action.event,
                    payload: data,
                    resolve: {
                        isResolvedExtend: isExtendPromise,
                        requestedActionIndex: action.index!,
                        requestDuration: requestDuration
                    }
                });
            }
        }).catch((e: Error): void => {
            if(!this._thread) return; // was deleted
            const pendingEventInfo = this.state.pendingEvents.get(action.event);
            if (pendingEventInfo?.actionIndex === action.index) {
                const requestDuration = new Date().getTime() - startTime;
                this._dispatch({
                    index: action.resolveActionIndex || null,
                    type: ActionType.rejected,
                    bThreadId: this.id,
                    event: action.event,
                    payload: e,
                    resolve: {
                        isResolvedExtend: isExtendPromise,
                        requestedActionIndex: action.index!,
                        requestDuration: requestDuration
                    }
                });
            }
        });
    }

    public resolvePending(action: Action): boolean {
        if(this._deletePending(action) === false) return false;
        this._setCurrentBids();
        return true;
    }

    public rejectPending(action: Action): void {
        if(action.type !== ActionType.rejected || action.resolve?.isResolvedExtend) return;
        if(!this._deletePending(action)) return;
        if(this._thread && this._thread.throw) {
            this._thread.throw({event: action.event, error: action.payload});
            const bid = this._currentBids?.request?.get(action.event);
            if(!bid) return;
            this._progressBThread(bid, action.payload, true);
        }
    }
    
    public progressRequest(eventCache: EventCache, event: FCEvent, payload: any): void {
        const bid = this._currentBids?.request?.get(event) || this._currentBids?.extend?.get(event);
        if(!bid) return;
        if(bid.subType === BidSubType.set) {
            setEventCache(eventCache, event, payload);
        }
        this._progressBThread(bid, payload);
    }

    public progressWait(bid: Bid, payload: any): void {
        if(!bid || bid.guard && !bid.guard(payload)) return;
        this._progressBThread(bid, payload);
    }

    public progressExtend(action: Action, bid: Bid): ExtendContext | undefined {
        if(!bid || bid.guard && !bid.guard(action.payload)) return undefined;
        const extendContext = new ExtendContext(action.payload);
        this._progressBThread(bid, extendContext);
        extendContext.createPromiseIfNotCompleted();
        return extendContext;
    }

    public cancelPending() {
        this._pendingRequests.clear();
        this._pendingExtends.clear();
    }

    public destroy(): void {
        this.cancelPending();
        delete this._state;
        delete this._thread;
    }
}