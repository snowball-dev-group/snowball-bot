export function convertNumbers(number:string|number) {
    let str = number + "";
    str = str.replace(/([0-9])/ig, (s) => {
        switch(s) {
            case "0": return ":zero:";
            case "1": return ":one:";
            case "2": return ":two:";
            case "3": return ":three:";
            case "4": return ":four:";
            case "5": return ":five:";
            case "6": return ":six:";
            case "7": return ":seven:";
            case "8": return ":eight:";
            case "9": return ":nine:";
            default: return s;
        }
    });
    return str;
}