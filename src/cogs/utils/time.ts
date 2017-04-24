export function currentTimestamp(returning:"ms"|"s" = "ms") {
    let ts = Date.now();
    switch(returning) {
        default: return ts;
        case "s": return ts / 1000;
    }
}

export function parseDate(t1:string) : number|undefined {
    if(/$[0-9]+^/.test(t1)) {
        // trying to parse
        let t = parseInt(t1, 10);
        if(!isNaN(t)) {
            return t;
        }
    }
    let t = (new Date(t1)).getTime();
    if(!isNaN(t)) {
        return t;
    } else {
        return undefined;
    }
}

export function timeDiff(t1:Date|number|string, t2:Date|number|string = Date.now(), returning:"ms"|"s" = "s") {
    if(t1 instanceof Date) {
        t1 = t1.getTime();
    } else if(typeof t1 === "string") {
        let parsed =  parseDate(t1);
        if(!parsed) {
            throw new Error("Invalid `t1` argument");
        }
        t1 = parsed;
    } else if(typeof t1 !== "number") {
        throw new Error("Invalid `t1` argument");
    }

    if(t2 instanceof Date) {
        t2 = t2.getTime();
    } else if(typeof t2 === "string") {
        let parsed =  parseDate(t2);
        if(!parsed) {
            throw new Error("Invalid `t2` argument");
        }
        t2 = parsed;
    } else if(typeof t2 !== "number") {
        throw new Error("Invalid `t2` argument");
    }

    let min = Math.min(t1, t2);
    let max = Math.max(t1, t2);

    let diff = max - min;

    switch(returning) {
        default: return diff;
        case "s": return diff / 1000;
    }
}