
import { Message } from "discord.js";
import { localizeForUser } from "./ez-i18n";

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

function categoryLocalizedName(category: string) {
	return `HELP_CATEGORY_${category.toUpperCase()}`;
}

export function addCommand(category: string, command: string, description: string, args?: IArgumentsMap, specialCheck?: (msg: Message) => boolean) {
	const categoriesMap = init();

	let categoryMap = categoriesMap[category];
	if(!categoryMap) {
		categoryMap = categoriesMap[category] = {};
	}

	try {
		$localizer.getString($localizer.sourceLanguage, categoryLocalizedName(category));
	} catch (err) {
		throw new Error(`Could not find localized name for the category "${category}"`);
	}

	categoryMap[command] = {
		arguments: args,
		description,
		specialCheck
	};
}

export function command(category: string, command: string, description: string, args?: IArgumentsMap, specialCheck?: (msg: Message) => boolean) {
	return (target) => {
		addCommand(category, command, description, args, specialCheck);
		return target;
	};
}

export async function generateHelpContent(msg: Message) {
	let rStr = "";
	let user = msg.channel.type === "text" ? msg.member : msg.author;
	const categories = init();

	for(let category in categories) {
		let commands = categories[category];
		if(!commands) { continue; }

		let str = "";

		for(const command in commands) {
			const target = commands[command];
			if(!target) { continue; }

			if(target.specialCheck && !target.specialCheck(msg)) {
				continue;
			}

			str += `\n- ${command}`;
			if(target.arguments) {
				for(let argName in target.arguments) {
					const argInfo = target.arguments[argName];
					if(argName.startsWith("loc:")) {
						argName = await localizeForUser(user, argName.slice("loc:".length));
					}
					if(argInfo.specialCheck && !argInfo.specialCheck(msg)) {
						continue;
					}
					if(argInfo.values) {
						const fixedValues: string[] = [];
						for(let val of argInfo.values) {
							if(val.startsWith("loc:")) {
								val = await localizeForUser(user, val.slice("loc:".length));
							}
							fixedValues.push(val);
						}
						const vals = fixedValues.join("/");
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
						const fixedValues: string[] = [];
						for(let val of argInfo.values) {
							if(val.startsWith("loc:")) {
								val = await localizeForUser(user, val.slice("loc:".length));
							}
							fixedValues.push(val);
						}
						const vals = fixedValues.join("/");
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
			let catName = await localizeForUser(user, categoryLocalizedName(category));
			rStr += `\n# ${catName}\n${str}`;
		}
	}

	return rStr.trim();
}