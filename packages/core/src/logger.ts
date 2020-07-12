import { Action, ActionType } from './action';
import { FCEvent } from './event';
import { BThreadKey } from './bthread';
import { Bid } from './bid';

export interface LoggedAction extends Action {
    actionIndex: number;
    reactingBThreads: Set<string>;
}

export interface BThreadInfo {
    id: string;
    enabledInStep: number;
    key?: BThreadKey;
    title?: string;
    reactions: Map<number, ThreadProgression | ThreadReset>;
}

export interface Log {
    actions: LoggedAction[];
    bThreadInfoById: Record<string, BThreadInfo>;
    latestAction: Action;
}

export interface ThreadProgression extends Bid {
    actionIndex: number;
    cancelledPromises?: FCEvent[];
}

export interface ThreadReset {
    actionIndex: number;
    changedProps: string[];
    cancelledPromises?: FCEvent[];
}

export class Logger {
    private _actions: LoggedAction[] = [];
    private _bThreadInfoById: Record<string, BThreadInfo> = {};

    private _getActionIndex(): number {
        return this._actions.length-1;
    }

    public addThreadInfo(id: string, title?: string) {
        this._bThreadInfoById[id] = {id: id, title: title, reactions: new Map<number, ThreadProgression>(), enabledInStep: this._getActionIndex()};
    }

    public logAction(action: Action): void {
        this._actions.push({...action, reactingBThreads: new Set(), actionIndex: this._getActionIndex()});
    }

    public logThreadProgression(bid: Bid, cancelledPromises?: FCEvent[]): void {
        const actionIndex = this._getActionIndex();
        this._actions[actionIndex].reactingBThreads.add(bid.threadId);
        const reaction: ThreadProgression = {
            ...bid,
            actionIndex: actionIndex,
            cancelledPromises: cancelledPromises
        };
        this._bThreadInfoById[bid.threadId].reactions.set(actionIndex, reaction);
    }

    public logThreadReset(threadId: string, changedProps: string[], cancelledPromises?: FCEvent[], ) {
        const actionIndex = this._getActionIndex();
        this._actions[actionIndex].reactingBThreads.add(threadId);
        const reaction: ThreadReset = {
            actionIndex: actionIndex,
            changedProps: changedProps,
            cancelledPromises: cancelledPromises
        };
        this._bThreadInfoById[threadId].reactions.set(actionIndex, reaction);
    }

    public getLog(): Log {
        return {
            actions: this._actions,
            latestAction: this._actions[this._actions.length-1],
            bThreadInfoById: this._bThreadInfoById
        };
    }

    public resetLog(): void {
        this._actions = [];
        this._bThreadInfoById = {};  
    }
}
