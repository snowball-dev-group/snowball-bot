import * as Types from "@sb-types/Types";
import * as logger from "loggy";
import { NamedClass } from "@sb-types/Interfaces";

export class LocalizerKeysAssignation implements NamedClass {
	private readonly _name: string;
	private readonly _log: logger.ILogFunction;
	private readonly _assignedKeys: Types.INullableHashMap<string[]>;

	constructor(name: string) {
		this._log = logger(name);
		this._assignedKeys = Object.create(null);
	}

	public get name() {
		return this._name;
	}

	/**
	 * Checks if the key is binded to anyone
	 * @param key Key to check
	 */
	public isAssigned(key: string) {
		const owners = this._assignedKeys[key];

		return owners != null && owners.length !== 0;
	}

	/**
	 * Assigns specified keys to disallow purge until unbinding happened
	 * 
	 * Assigning also disallows modification of the strings, any other modules will not be able to reintroduce the string
	 * @param keys Keys to bind
	 * @param owner Who's binding the keys (signature, etc.)
	 * @returns Successfully bound keys to the owner
	 */
	public assignKeys(keys: string | string[], owner: string) {
		keys = Array.isArray(keys) ? keys : [keys];

		const assignedKeys = this._assignedKeys;

		const assignResult: string[] = [];

		for (let i = 0, l = keys.length; i < l; i++) {
			const key = keys[i];

			let owners = assignedKeys[key];

			if (!owners) {
				this._log(`Key "${key}" being first time bound by "${owner}"`);

				owners = assignedKeys[key] = [];
			} else if (owners.includes(owner)) {
				throw new Error(`Key "${key}" is already bound to this owner ("${owner}")`);
			}

			owners.push(owner);

			assignResult.push(key);
		}

		return assignResult;
	}

	/**
	 * Divests the specified keys to allow purge if nobody assigns the same keys
	 * @param keys The keys to unbind
	 * @param owner Who's unbinding the keys (signature, etc.)
	 * @returns Sucessfully unbound keys from the owner
	 */
	public divestKeys(keys: string | string[], owner: string) {
		keys = Array.isArray(keys) ? keys : [keys];

		const assignedKeys = this._assignedKeys;

		const divestResult: string[] = [];

		for (let i = 0, l = keys.length; i < l; i++) {
			const key = keys[i];
			const owners = assignedKeys[key];

			if (!owners) {
				this._log("warn", `Key "${key}" wasn't bound to anyone. Not unbinding the key`);
				continue;
			}

			const index = owners.indexOf(owner);

			if (index === -1) {
				this._log("warn", `Key "${key}" wasn't bound to the "${owner}". Skipped`);
				continue;
			}

			divestResult.push(
				owners.splice(index, 1)[0]
			);
		}

		return divestResult;
	}
}

export default LocalizerKeysAssignation;
