import { IColorfulMigration, IColorfulGuildColorInfo } from "../colors";
import * as knex from "knex";
import { IHashMap } from "../../../types/Interfaces";
import { getLogger } from "../../utils/utils";

class NoES6Maps implements IColorfulMigration {
    name = "NO_ES6_MAPS";
    description = "Converts ES6 maps to hashmaps";
    log = getLogger(`ColorsJS:Migration:${this.name}`);

    async perform(db: knex, tableName: string) {
        const oldName = `${tableName}_bak${Date.now()}`;
        this.log("info", `Renaming '${tableName}' to '${oldName}'...`);
        await db.schema.renameTable(tableName, oldName);

        this.log("info", `Creating new table '${tableName}' like '${oldName}'...`);
        await db.raw(`CREATE TABLE ${tableName} LIKE ${oldName};`);

        this.log("info", "Converting old values to new table performing convertation");
        let elements = await db(oldName).select() as Array<{ guildId: string; rolePrefixes: string; }>;
        for(const element of elements) {
            const parsedElem = {
                guildId: element.guildId,
                rolePrefixes: new Map<string, IColorfulGuildColorInfo>(JSON.parse(element.rolePrefixes))
            };

            const hashMap: IHashMap<IColorfulGuildColorInfo> = {};
            for(const [colorName, colorfulInfo] of parsedElem.rolePrefixes) {
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