
export enum Category {
    Helpful,
    Utilites,
    Fun,
    Profiles
};

export interface IArgumentInfo {
    description: string,
    optional: boolean,
    values?:string[]
}

// Arguments
//  - name? => [optional, ]
export interface IHelpfulObject {
    arguments?:Map<string, IArgumentInfo>,
    description:string
}

// - Category
//   - Command => IHelpfulObject
let dict:Map<Category,Map<string, IHelpfulObject>>|undefined = undefined;

function init() {
    if(!dict) {
        dict = new Map<Category, Map<string, IHelpfulObject>>();
    }
    return dict;
}

export function command(category:Category, command:string, description:string, args?:Map<string, IArgumentInfo>) {
    return (target) => {
        let d = init();
        
        let cat = d.get(category);
        if(!cat) {
            cat = d.set(category, new Map<string, IHelpfulObject>()).get(category);
            if(!cat) {
                return target;
            }
        }

        cat.set(command, {
            arguments: args,
            description: description
        });

        return target;
    };
}

export function getHelp() {
    let str = "";
    init().forEach((commands, category) => {
        str += `\n# ${Category[category]}\n`;
        commands.forEach((target, command) => {
            str += `\n- ${command}`;
            if(target.arguments) {
                target.arguments.forEach((argInfo, argName) => {
                    if(argInfo.values) {
                        let vals = argInfo.values.join("/");
                        str += argInfo.optional ? ` [${vals}]` : ` <${vals}>`;
                    } else {
                        str += argInfo.optional ? ` [${argName}]` : ` <${argName}>`;
                    }
                });
            }
            str += `: ${target.description}\n`;
            if(target.arguments) {
                target.arguments.forEach((argInfo, argName) => {
                    str += "  - ";
                    if(argInfo.values) {
                        let vals = argInfo.values.join("/");
                        str += argInfo.optional ? `[${vals}]` : `<${vals}>`;
                    } else {
                        str += argInfo.optional ? `[${argName}]` : `<${argName}>`;
                    }
                    
                    str += `: ${argInfo.description}\n`;
                });
            }
        });
        str += "";
    });
    return str.trim();
}