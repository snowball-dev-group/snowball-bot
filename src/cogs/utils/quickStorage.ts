import * as fs from "mz/fs";
import * as path from "path";
import * as knex from "knex";
import * as getLogger from "loggy";
import { INullableHashMap } from "@sb-types/Types";

const ITEMS_TABLE_NAME = "ItemTable";

const LOG = getLogger("Utils:QuickStorage");

LOG("warn", "This is a prototype version of the QuickStorage");
LOG("warn", "It is not meant for usage in any plugins until complete realization");

export class QuickStorage {
	private _sessionStorage: INullableHashMap<any>;
	private _sessionStorageItemsCount = 0;
	private _db?: knex;

	constructor() {
		LOG("warn_trace", "QuickStorage is not ready and should not be used util then!");
		LOG("warn", "Any usage comes with a great risk and no warranty of safety and stability");
		this._sessionStorage = Object.create(null);
	}

	/**
	 * __Make the current session storage persistent__.
	 * 
	 * Since the upgrade, all changed items will be written to the PSF by selected path.
	 * 
	 * If there are already items from the current session, these will be written to the PSF first.
	 * Then all the items from the PSF will be cached to the session (in-memory) storage for fastest access
	 * @param fileName The path to the persistent storage file
	 */
	public async makePersistent(fileName: string) {
		if (this._db) {
			throw new Error("This storage is already persistent, therefore cannot be upgrade");
		}

		fileName = path.isAbsolute(fileName) ?
			fileName :
			path.join(process.cwd(), fileName);

		await fs.access(fileName);

		this._db = knex({
			client: "sqlite3",
			connection: <knex.Sqlite3ConnectionConfig> {
				filename: fileName
			}
		});

		if (!(await this._db.schema.hasTable(ITEMS_TABLE_NAME))) {
			await this._db.schema.createTable(
				ITEMS_TABLE_NAME, (tb) => {
					tb.string("key").notNullable();
					tb.binary("value").nullable();
				}
			);
		}

		const items = <IKeyValue[]> await this._db(ITEMS_TABLE_NAME).select();

		const sessionStorage = this._sessionStorage;

		{ // Move current session items to the PSF
			const sessionStorageKeys = Object.keys(sessionStorage);

			const keysCount = sessionStorageKeys.length;
			for (let i = 0; i < keysCount; i++) {
				const key = sessionStorageKeys[i];
				const value = sessionStorage[key];

				await this._setPersistentItem(key, value);
			}
		}

		{ // Cache persistent items from the PSF
			const itemsCount = items.length;
			for (let i = 0; i < itemsCount; i++) {
				const { key, value } = items[i];
				sessionStorage[key] = value;
			}

			this._sessionStorageItemsCount = Object.keys(sessionStorage).length;
		}
	}

	/**
	 * Finds and returns the selected key from the session storage
	 * @param key Key
	 */
	public getItem(key: string) {
		return this._sessionStorage[key];
	}

	/**
	 * 
	 * @param key A string containing the name of the key you want to create/update.
	 * @param value A string containing the value you want to give the key you are creating/updating.
	 */
	public setItem(key: string, value: any) {
		if (value === undefined) {
			return this._deleteItem(key);
		}

		value = String(value);

		if (this._sessionStorage[key] === undefined) {
			this._sessionStorageItemsCount++;
		}

		this._sessionStorage[key] = value;

		if (!this._db) { return; }

		this._setPersistentItem(key, value);
	}

	private async _setPersistentItem(key: string, value: string) {
		const result = <IKeyValue> await this._db!(ITEMS_TABLE_NAME)
			.select()
			.where("key", key)
			.first();

		if (!result) {
			return this._db!(ITEMS_TABLE_NAME)
				.insert({ key, value });
		}

		this._db!(ITEMS_TABLE_NAME)
			.update("value", value)
			.where("key", key);
	}

	public clear() {
		this._sessionStorageItemsCount = 0;
		this._sessionStorage = Object.create(null);

		if (!this._db) { return; }

		this._clearPersistentStorage();
	}

	private async _clearPersistentStorage() {
		await this._db!(ITEMS_TABLE_NAME).delete();
	}

	private _deleteItem(key: string) {
		const isNotCached = this._sessionStorage[key] === undefined;

		if (isNotCached) { return; }

		this._sessionStorageItemsCount--;
		delete this._sessionStorage[key];

		if (!this._db) { return; }

		this._deletePersistentItem(key);
	}

	private async _deletePersistentItem(key: string) {
		await this._db!(ITEMS_TABLE_NAME)
			.where({ key })
			.delete();
	}

	public get length() {
		return this._sessionStorageItemsCount;
	}
}

interface IKeyValue {
	key: string;
	value: string;
}

export async function createDatabase(name: string) {
	const storage = new QuickStorage();

	await storage.makePersistent(`./data/${name}.localstorage`);

	return storage;
}

export default QuickStorage;
