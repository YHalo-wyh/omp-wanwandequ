import { Command } from "@oh-my-pi/pi-utils/cli";
import { wqHelp as commandHelp } from "../cli/command-help";
import { runWqCommand } from "../wq/cli";

export default class Wq extends Command {
	static description = commandHelp.description;
	static strict = false;

	async run(): Promise<void> {
		await runWqCommand(this.argv);
	}
}
