
import { Message } from "discord.js";
import { localizeForUser } from "@utils/ez-i18n";
import * as getLogger from "loggy";

const log = getLogger("utils:help");

export interface IArgumentInfo {
	description: string;
	optional: boolean;
	values?: string[];
	specialCheck?(msg: Message): boolean;
}

// Arguments
//  - name? => [optional, ]
export interface IHelpfulObject {
	arguments?: IArgumentsMap;
	description: string;
	specialCheck?(msg: Message): boolean;
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
	if (!dict) { dict = <{}> Object.create(null); }

	return dict;
}

interface IArgumentsMap {
	[argName: string]: IArgumentInfo;
}

export function categoryLocalizedName(category: string) {
	return `HELP_CATEGORY_${category.toUpperCase()}`;
}

export function addCommand(category: string, command: string, description: string, args?: IArgumentsMap, specialCheck?: (msg: Message) => boolean) {
	const categoriesMap = init();

	let categoryMap = categoriesMap[category];
	if (!categoryMap) {
		categoryMap = categoriesMap[category] = <{}> Object.create(null);
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

let _depWarningTriggered = false;
// /**
//  * @deprecated
//  */
export function command(category: string, command: string, description: string, args?: IArgumentsMap, specialCheck?: (msg: Message) => boolean) {
	if (!_depWarningTriggered) {
		log("warn_trace", "`command` decorator is deprecated and will be removed in future. Please, use `addCommand` instead");
		_depWarningTriggered = true;
	}

	return (target) => {
		addCommand(category, command, description, args, specialCheck);

		return target;
	};
}

export async function generateHelpContent(msg: Message) {
	let rStr = "";
	const user = msg.channel.type === "text" ? msg.member : msg.author;
	const categories = init();

	for (const category in categories) {
		const commands = categories[category];
		if (!commands) { continue; }

		let str = "";

		for (const command in commands) {
			const target = commands[command];
			if (!target) { continue; }

			if (target.specialCheck && !target.specialCheck(msg)) {
				continue;
			}

			str += `\n- ${command}`;
			if (target.arguments) {
				for (let argName in target.arguments) {
					const argInfo = target.arguments[argName];

					if (argName.startsWith("loc:")) {
						argName = await localizeForUser(user, argName.slice("loc:".length));
					}
					
					if (argInfo.specialCheck && !argInfo.specialCheck(msg)) {
						continue;
					}

					if (!argInfo.values) {
						str += argInfo.optional ? ` [${argName}]` : ` <${argName}>`;
						continue;
					}

					const fixedValues: string[] = [];

					for (let val of argInfo.values) {
						if (val.startsWith("loc:")) {
							val = await localizeForUser(user, val.slice("loc:".length));
						}
						fixedValues.push(val);
					}

					const vals = fixedValues.join("/");
					str += argInfo.optional ? ` [${vals}]` : ` <${vals}>`;
				}
			}

			let desc = target.description;
			if (desc.startsWith("loc:")) {
				desc = await localizeForUser(user, desc.slice("loc:".length));
			}

			str += `: ${desc}\n`;
			if (!target.arguments) { continue; }

			for (let argName in target.arguments) {
				const argInfo = target.arguments[argName];
				if (argName.startsWith("loc:")) {
					argName = await localizeForUser(user, argName.slice("loc:".length));
				}
				if (argInfo.specialCheck && !argInfo.specialCheck(msg)) {
					continue;
				}
				str += "  - ";
				if (argInfo.values) {
					const fixedValues: string[] = [];
					for (let val of argInfo.values) {
						if (val.startsWith("loc:")) {
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
				if (argDesc.startsWith("loc:")) {
					argDesc = await localizeForUser(user, argDesc.slice("loc:".length));
				}
				str += `: ${argDesc}\n`;
			}
		}

		if (str.trim().length > 0) {
			const catName = await localizeForUser(user, categoryLocalizedName(category));
			rStr += `\n# ${catName}\n${str}`;
		}
	}

	return rStr.trim();
}
