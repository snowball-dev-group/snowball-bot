import { getDB } from "@utils/db";
import * as Knex from "knex";

export class BaseDBManager {
	private constructor() {
		throw new Error("This class is not initializable");
	}

	public static readonly DB = getDB();

	public static async isTableExists(tableName: string) {
		return BaseDBManager.DB.schema.hasTable(tableName);
	}

	public static async createTableIfNotExists(tableName: string, callback: (tableBuilder: Knex.TableBuilder) => void) {
		if (BaseDBManager.isTableExists(tableName)) {
			return;
		}

		return BaseDBManager.DB.schema.createTableIfNotExists(
			tableName,
			callback
		);
	}
}

export default BaseDBManager;
