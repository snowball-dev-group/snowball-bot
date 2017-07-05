export function startsOrEqual(source:string, changed:string) {
    return changed.startsWith(source) || changed === source;
}

export function endsOrEqual(source:string, changed:string) {
    return changed.endsWith(source) || changed === source;
}

export function slice(source:string, start?:number, end?:number) {
    return source.slice(start, end);
}

export function escapeRegExp(str:string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export function replaceAll(str:string, search:string, replacement:string) {
    search = escapeRegExp(search);
    return str.replace(new RegExp(search, "g"), replacement);
};