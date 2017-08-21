
import { Message } from "discord.js";
import { localizeForUser } from "./ez-i18n";

export enum Category {
    Helpful,
    Utilites,
    Fun,
    Profiles,
    Colors,
    Premium,
    Guilds,
    Language
}

export interface IArgumentInfo {
    description: string;
    optional: boolean;
    values?: string[];
    specialCheck?: (msg: Message) => boolean;
}

// Arguments
//  - name? => [optional, ]
export interface IHelpfulObject {
    arguments?: IArgumentsMap;
    description: string;
    specialCheck?: (msg: Message) => boolean;
}

interface ICategory {
    [command: string]: IHelpfulObject | undefined;
}

type UnknownCategory = ICategory | undefined;

interface ICategories {
    [category: string]: UnknownCategory;
}

// - Category
//   - Command => IHelpfulObject
let dict: ICategories | undefined = undefined;

function init(): ICategories {
    if(!dict) {
        dict = {};
    }
    return dict;
}

interface IArgumentsMap {
    [argName: string]: IArgumentInfo;
}

export function command(category: Category, command: string, description: string, args?: IArgumentsMap, specialCheck?: (msg: Message) => boolean) {
    return (target) => {
        let d = init();

        let cat = d[category];
        if(!cat) {
            cat = d[category] = {};
            if(!cat) {
                return target;
            }
        }

        cat[command] = {
            arguments: args,
            description,
            specialCheck
        };

        return target;
    };
}

export async function getHelp(msg: Message) {
    let rStr = "";
    let user = msg.channel.type === "text" ? msg.member : msg.author;
    let categories = init();

    for(let category in categories) {
        let commands = categories[category];
        if(!commands) {
            continue;
        }

        let str = "";

        for(let command in commands) {
            let target = commands[command];
            if(!target) { continue; }

            if(target.specialCheck && !target.specialCheck(msg)) {
                continue;
            }

            str += `\n- ${command}`;
            if(target.arguments) {
                for(let argName in target.arguments) {
                    let argInfo = target.arguments[argName];
                    if(argName.startsWith("loc:")) {
                        argName = await localizeForUser(user, argName.slice("loc:".length));
                    }
                    if(argInfo.specialCheck && !argInfo.specialCheck(msg)) {
                        continue;
                    }
                    if(argInfo.values) {
                        let fixedValues: string[] = [];
                        for(let val of argInfo.values) {
                            if(val.startsWith("loc:")) {
                                val = await localizeForUser(user, val.slice("loc:".length));
                            }
                            fixedValues.push(val);
                        }
                        let vals = fixedValues.join("/");
                        str += argInfo.optional ? ` [${vals}]` : ` <${vals}>`;
                    } else {
                        str += argInfo.optional ? ` [${argName}]` : ` <${argName}>`;
                    }
                }
            }

            let desc = target.description;
            if(desc.startsWith("loc:")) {
                desc = await localizeForUser(user, desc.slice("loc:".length));
            }

            str += `: ${desc}\n`;
            if(target.arguments) {
                for(let argName in target.arguments) {
                    let argInfo = target.arguments[argName];
                    if(argName.startsWith("loc:")) {
                        argName = await localizeForUser(user, argName.slice("loc:".length));
                    }
                    if(argInfo.specialCheck && !argInfo.specialCheck(msg)) {
                        continue;
                    }
                    str += "  - ";
                    if(argInfo.values) {
                        let fixedValues: string[] = [];
                        for(let val of argInfo.values) {
                            if(val.startsWith("loc:")) {
                                val = await localizeForUser(user, val.slice("loc:".length));
                            }
                            fixedValues.push(val);
                        }
                        let vals = fixedValues.join("/");
                        str += argInfo.optional ? `[${vals}]` : `<${vals}>`;
                    } else {
                        str += argInfo.optional ? `[${argName}]` : `<${argName}>`;
                    }

                    let argDesc = argInfo.description;
                    if(argDesc.startsWith("loc:")) {
                        argDesc = await localizeForUser(user, argDesc.slice("loc:".length));
                    }
                    str += `: ${argDesc}\n`;
                }
            }
        }
        if(str.trim().length > 0) {
            let catName = Category[category];
            catName = await localizeForUser(user, `HELP_CATEGORY_${catName}`.toUpperCase());
            rStr += `\n# ${catName}\n${str}`;
        }
    }

    return rStr.trim();
}