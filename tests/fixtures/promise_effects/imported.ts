export declare function syncEffect(): void;
export declare function promisedEffect(): Promise<number>;

export interface ImportedThenable<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

export declare function thenableEffect(): ImportedThenable<string>;
export declare function unionEffect(): void | Promise<number>;
export declare function overloadedEffect(kind: "sync"): void;
export declare function overloadedEffect(kind: "async"): Promise<string>;
export declare function genericEffect<T>(value: T): T;
