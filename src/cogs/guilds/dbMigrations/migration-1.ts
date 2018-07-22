import { IGuildRow, GuildsDBController } from "@cogs/guilds/dbController";
import { DatabaseMigration } from "@sb-types/Types";
import * as logger from "loggy";

export class GuildIDMigration extends DatabaseMigration<IGuildRow> {
	private static _regexp = /[A-Z0-9]{9,14}\:[A-Z0-9]{9,14}/i;
	private readonly _log = logger("GuildIDMigration");

	public isRequired() {
		return new Promise<boolean>((resolve) => {
			this._processInChunks(async (chunk, size, stop) => {
				for (let i = 0; i < size; i++) {
					const row = chunk[i];
	
					if (!GuildIDMigration._requiresFix(row)) {
						return;
					}

					this._log("info", `[${this._tableName}] Found guild with bad ID: ${row.gid}. Migration is required`);

					resolve(true);

					return stop();
				}
			});
		});
	}

	public async migrate() {
		const _tableName = this._tableName;

		await this._processInChunks(async (chunk, size) => {
			for (let i = 0; i < size; i++) {
				const row = chunk[i];

				if (!GuildIDMigration._requiresFix(row)) {
					return;
				}
	
				this._log("info", `[${_tableName}] Fix of guild with bad ID: ${row.gid}...`);
	
				await this._db(_tableName)
					.where(row)
					.update({
						...row,
						gid: GuildsDBController.createGID()
					});
			}
		});

		this._log("ok", `[${_tableName}] Successfully completed the migration`);

		return true;
	}

	private static _requiresFix(row: IGuildRow) {
		return !GuildIDMigration._regexp.test(row.gid);
	}
}

export default GuildIDMigration;
