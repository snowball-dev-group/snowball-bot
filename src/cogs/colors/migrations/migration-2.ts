import { IColorfulMigration, IColorfulGuildColorInfo } from "../colors";
import * as knex from "knex";
import * as getLogger from "loggy";
import { IHashMap } from "../../../types/Types";

class NoES6Maps implements IColorfulMigration {
	public name = "NO_ES6_MAPS";
	public description = "Converts ES6 maps to hashmaps";
	private readonly _log = getLogger(`ColorsJS:Migration:${this.name}`);

	public async perform(db: knex, tableName: string) {
		const oldName = `${tableName}_bak${Date.now()}`;
		this._log("info", `Renaming '${tableName}' to '${oldName}'...`);
		await db.schema.renameTable(tableName, oldName);

		this._log("info", `Creating new table '${tableName}' like '${oldName}'...`);
		await db.raw(`CREATE TABLE ${tableName} LIKE ${oldName};`);

		this._log("info", "Converting old values to new table performing convertation");
		const elements = <Array<{ guildId: string; rolePrefixes: string; }>> await db(oldName).select();
		for (const element of elements) {
			const parsedElem = {
				guildId: element.guildId,
				rolePrefixes: new Map<string, IColorfulGuildColorInfo>(JSON.parse(element.rolePrefixes))
			};

			const hashMap: IHashMap<IColorfulGuildColorInfo> = Object.create(null);
			for (const [colorName, colorfulInfo] of parsedElem.rolePrefixes) {
				hashMap[colorName] = colorfulInfo;
			}

			await db(tableName).insert({
				guildId: parsedElem.guildId,
				rolePrefixes: JSON.stringify(hashMap)
			});
		}

		return true;
	}
}

module.exports = NoES6Maps;
