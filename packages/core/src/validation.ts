import { Bid, BidsByType, BidType, getMatchingBids } from './bid';
import { EventId } from './event-map';

export type Validation = (payload: any) => {isValid: boolean; message?: string} | boolean

export function isValid(bid: Bid, payload?: any): boolean {
    if(!bid.validate) return true;
    const validationReturn = bid.validate(payload);
    if(validationReturn === true) return true;
    if(validationReturn === false) return false;
    if(validationReturn.isValid === true) return true;
    return false;
}

export type BidValidationResult = {isValid: boolean; bid: Bid; message?: string}

export function getValidationResult(bid: Bid, payload?: any): BidValidationResult {
    if(bid.validate === undefined) return {isValid: true, bid: bid, message: bid.eventId.description};
    const validationReturn = bid.validate(payload);
    if(validationReturn === true) return {isValid: true, bid: bid, message: bid.eventId.description};
    if(validationReturn === false) return {isValid: false, bid: bid, message: bid.eventId.description};
    if(validationReturn.isValid === true) return {isValid: true, bid: bid, message: validationReturn.message};
    return {isValid: false, bid: bid, message: validationReturn.message};
}

export function withValidPayload(bids: Bid[] | undefined, payload: any): boolean {
    return (bids !== undefined) && bids.some(bid => isValid(bid, payload))
}

export interface ValidationResult {
    isValid: boolean;
    required: BidValidationResult[][];
    optional: BidValidationResult[];
}

export function validate(activeBidsByType: BidsByType, event: EventId, payload: any): ValidationResult {
    const bids = activeBidsByType[BidType.wait]?.get(event);
    const validationResult: ValidationResult = {
        isValid: false,
        required: [[]],
        optional: []
    }
    if(bids === undefined) return validationResult;
    const blocks = getMatchingBids(activeBidsByType, [BidType.block], event);
    const guardedBlocks = getMatchingBids(activeBidsByType, [BidType.guardedBlock], event);
    const ons = getMatchingBids(activeBidsByType, [BidType.on], event);

    bids.forEach(bid => {
        const bidValidationResult = getValidationResult(bid, payload);
        validationResult.required[0].push(bidValidationResult);
    });
    blocks?.forEach(bid => {
        const bidValidationResult = getValidationResult(bid, payload);
        bidValidationResult.isValid = !bidValidationResult.isValid; // reverse isValid because a passed block is a restriction.
        validationResult.required.push([bidValidationResult]);
    });
    guardedBlocks?.forEach(bid => {
        const bidValidationResult = getValidationResult(bid, payload);
        bidValidationResult.isValid = !bidValidationResult.isValid; // reverse isValid because a passed block is a restriction.
        validationResult.required.push([bidValidationResult]);
    });
    ons?.forEach(bid => {
        const bidValidationResult = getValidationResult(bid, payload);
        validationResult.optional.push(bidValidationResult);
    });
    validationResult.isValid = validationResult.required.every(validationResults => validationResults.some(({isValid}) => isValid === true));
    return validationResult;
}