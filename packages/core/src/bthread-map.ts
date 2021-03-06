import { BThreadId } from './bthread';

export class BThreadMap<T> {
    private _map: Map<string, T> = new Map();

    public static toIdString(bThreadId: BThreadId): string {
        return bThreadId.key !== undefined ? `${bThreadId.name}__${bThreadId.key}` : bThreadId.name
    }

    public static toThreadId(idString: string): BThreadId {
        const [name, key] = idString.split('__');
        return {name: name, key: key};
    }

    public get(bThreadId: BThreadId | string): T | undefined{
        if(typeof bThreadId === 'string') {
            return this._map.get(bThreadId);
        }
        return this._map.get(BThreadMap.toIdString(bThreadId));
    }

    public set(bThreadId: BThreadId, val: T): this {
        this._map.set(BThreadMap.toIdString(bThreadId), val);
        return this;
    }

    public get size(): number {
        return this._map.size;
    }

    public has(bThreadId: BThreadId): boolean {
        return this._map.has(BThreadMap.toIdString(bThreadId));
    }

    public delete(bThreadId: BThreadId): boolean {
        return this._map.delete(BThreadMap.toIdString(bThreadId));
    }

    public clear(): void {
        return this._map.clear()
    }

    public keys(): BThreadId[] {
        return [...this._map.keys()].map(BThreadMap.toThreadId);
    }

    public forEach(callbackFn: (value: T, key: string, map: Map<string, T>) => void): void {
        this._map.forEach(callbackFn);
    }

    public clone(): BThreadMap<T> {
        const clone = new BThreadMap<T>();
        this._map.forEach((value, key) => {
            clone.set(BThreadMap.toThreadId(key), value);
        });
        return clone;
    }
}
