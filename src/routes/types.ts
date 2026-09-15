export type Tile = {
    id: number;
    value: number;
    row: number;
    col: number;
    mergedFrom?: [number, number];
    isNew?: boolean;
}
