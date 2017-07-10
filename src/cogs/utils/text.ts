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

export function simpleCmdParse(str:string) {
    let args = str.split(" ");
    let cmd = args.shift(); // !cmd
    let subCmd = args.shift(); // subcmd / undefined
    args = args.join(" ").split(",").map(arg => arg.trim());
    return {
        command: cmd,
        subCommand: subCmd,
        args: args.length > 0 ? args : undefined
    };
}

export function canBeSnowflake(str:string) {
    return /[0-9]{16,20}/.test(str);
}