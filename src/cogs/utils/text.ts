export function startsOrEqual(source:string, changed:string) {
    return changed.startsWith(source) || changed === source;
}

export function endsOrEqual(source:string, changed:string) {
    return changed.endsWith(source) || changed === source;
}

export function slice(source:string, start?:number, end?:number) {
    return source.slice(start, end);
}