import { FCEvent } from './event';

export enum ReactionType {
    init = "init",
    delete = "delete",
    reset = "reset",
    promise = "promise",
    progress = "progress",
    resolve = "resolve",
    reject = "reject"
}

export interface Reaction {
    threadId: string;
    type: ReactionType;
    cancelledPromises?: FCEvent[];
    pendingEvents?: string[];
}
